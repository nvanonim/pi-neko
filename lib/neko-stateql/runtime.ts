import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { BatchCommand, CLIResponse } from "./commands.ts";

const require = createRequire(import.meta.url);
const MAX_PROCESS_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 38_000;
const MUTATIONS = new Set(["exec", "mongo.exec", "redis.exec", "atomic", "profile.add", "profile.replace", "profile.remove"]);

export function stateQLHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.PI_NEKO_STATEQL_HOME?.trim();
  if (configured) return resolve(configured);
  const agentHome = env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
  return join(resolve(agentHome), "state", "neko-stateql-v1");
}

export function actorIdForSession(sessionId: string): string {
  const digest = createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
  return `pi-neko:stateql:${digest}`;
}

function failure(code: string, message: string, executed: boolean | string = false): CLIResponse {
  return { ok: false, error: { code, message, executed, retryable: false } };
}

function packagedBinary(): string {
  const packagePath = require.resolve("@fadhilp/stateql/package.json");
  const metadata = JSON.parse(readFileSync(packagePath, "utf8"));
  if (metadata.version !== "1.1.0") throw new Error("Neko StateQL requires its pinned @fadhilp/stateql 1.1.0 dependency");
  const { findBinary } = require(join(dirname(packagePath), "bin", "binary.js")) as { findBinary(): string | undefined };
  const binary = findBinary();
  if (!binary) throw new Error("The StateQL package has no binary for this operating system and architecture");
  return binary;
}

function nativeCommand(command: BatchCommand): Record<string, unknown> {
  const { command: name, timeout_ms: _timeout, ...fields } = command;
  switch (name) {
    case "connect":
      return {
        command: "connect",
        ...(fields.secret_env ? { env: fields.secret_env } : { target: fields.profile ?? fields.target }),
        ...(fields.read_only === false ? { read_write: true } : { read_only: true }),
      };
    case "disconnect": case "status": case "doctor":
      return { command: name };
    case "query": case "mongo.query": case "redis.query":
      return {
        command: "query",
        stmt: fields.sql ?? JSON.stringify(fields.mongo ?? fields.redis),
        ...(fields.params === undefined ? {} : { params: fields.params }),
        ...(fields.as === undefined ? {} : { as: fields.as }),
        preview_rows: fields.preview_rows ?? 10,
        max_cell_characters: fields.max_cell_characters ?? 8_000,
        max_rows: 10_000,
        max_bytes: MAX_OUTPUT_BYTES,
      };
    case "exec": case "mongo.exec": case "redis.exec":
      return {
        command: "exec",
        stmt: fields.sql ?? JSON.stringify(fields.mongo ?? fields.redis),
        ...Object.fromEntries(["params", "expect_rows", "idempotency_key", "allow_unbounded", "allow_destructive"]
          .filter((key) => fields[key] !== undefined).map((key) => [key, fields[key]])),
      };
    case "filter": {
      const { where, ...rest } = fields;
      return { command: "filter", ...rest, predicate: where, max_bytes: MAX_OUTPUT_BYTES, max_cell_characters: fields.max_cell_characters ?? 8_000 };
    }
    case "rows":
      return {
        command: "rows", ...fields,
        ...(Array.isArray(fields.columns) ? { columns: fields.columns.join(",") } : {}),
        limit: fields.limit ?? 20,
        max_bytes: MAX_OUTPUT_BYTES,
        max_cell_characters: fields.max_cell_characters ?? 8_000,
      };
    case "summarize": case "receipt":
      return { command: name, handle: fields.handle };
    case "history":
      return { command: "history", limit: fields.limit ?? 20 };
    case "objects.list":
      return { command: "objects", ...fields, limit: fields.limit ?? 50 };
    case "object.describe":
      return { command: "describe", name: fields.name };
    default:
      throw new Error(`Unsupported StateQL adapter command: ${name}`);
  }
}

function profileArgs(command: BatchCommand): string[] {
  switch (command.command) {
    case "profile.list": case "profile.show":
      return ["profile", "list"];
    case "profile.remove":
      return ["profile", "remove", "--", String(command.name)];
    case "profile.add": case "profile.replace": {
      const flags: string[] = [];
      if (command.secret_env) flags.push("--env", String(command.secret_env));
      if (command.read_only === false) flags.push("--read-write");
      if (command.command === "profile.replace") flags.push("--force");
      return ["profile", "add", ...flags, "--", String(command.name), ...(command.target ? [String(command.target)] : [])];
    }
    default:
      throw new Error("Unsupported profile command");
  }
}

function isResponse(value: unknown): value is CLIResponse {
  if (!value || typeof value !== "object" || typeof (value as CLIResponse).ok !== "boolean") return false;
  const response = value as CLIResponse;
  return response.ok || !!(response.error && typeof response.error.code === "string" && typeof response.error.message === "string");
}

/** One private, serialized CLI session; no database credentials are read by this wrapper. */
export class NekoStateQLRuntime {
  readonly sessionId: string;
  readonly home: string;
  readonly actorId: string;
  #closed = false;
  #queue: Promise<unknown> = Promise.resolve();
  #active: AbortController | undefined;

  constructor(sessionId: string, home = stateQLHome()) {
    this.sessionId = sessionId;
    this.home = resolve(home);
    this.actorId = actorIdForSession(sessionId);
  }

  async execute(
    command: BatchCommand,
    signal?: AbortSignal,
  ): Promise<CLIResponse> {
    const task = this.#queue.then(() => this.#execute(command, signal));
    this.#queue = task.catch(() => undefined);
    return task;
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#active?.abort();
    await this.#queue;
  }

  async #execute(command: BatchCommand, signal?: AbortSignal): Promise<CLIResponse> {
    if (this.#closed) throw new Error("Neko StateQL runtime is closed");
    if (signal?.aborted) return failure("CANCELLED", "StateQL operation cancelled before execution");
    if (existsSync(join(this.home, "state.sqlite"))) {
      throw new Error("Neko StateQL refuses a legacy state.sqlite home. Import profiles into a separate v1 directory first.");
    }
    const binary = packagedBinary();
    const timeout = typeof command.timeout_ms === "number" ? command.timeout_ms : 30_000;
    if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 120_000) throw new Error("Invalid StateQL timeout");
    const isProfile = command.command.startsWith("profile.");
    const atomic = command.command === "atomic";
    let lines: Record<string, unknown>[] = [];
    if (!isProfile) {
      if (atomic) {
        const statements = command.statements;
        if (!Array.isArray(statements) || statements.length === 0 || statements.length > 20) throw new Error("Atomic writes require 1 to 20 SQL statements");
        lines = statements.map((statement) => nativeCommand({ ...(statement as Record<string, unknown>), command: "exec" }));
      } else {
        lines = [nativeCommand(command)];
      }
    }
    const args = ["--timeout-ms", String(timeout), ...(isProfile ? profileArgs(command) : [
      "pipe", ...(atomic ? ["--atomic", ...(command.isolation ? ["--isolation", String(command.isolation)] : [])] : []),
    ])];
    const input = lines.map((line) => JSON.stringify(line)).join("\n") + (lines.length ? "\n" : "");
    if (Buffer.byteLength(input) > 2 * 1024 * 1024) throw new Error("StateQL command input is too large");
    const control = new AbortController();
    this.#active = control;
    const cancel = () => control.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) control.abort();
    const overallTimeout = (timeout + 2_500) * Math.max(1, lines.length);
    const timer = setTimeout(cancel, overallTimeout);
    try {
      const result = await this.#run(binary, args, input, control.signal, MUTATIONS.has(command.command), atomic, lines.length);
      if (command.command === "profile.show" && result.ok) {
        const profiles = result.profiles;
        const found = Array.isArray(profiles)
          ? profiles.find((entry) => entry && typeof entry === "object" && entry.name === command.name)
          : undefined;
        if (!found) return failure("PROFILE_NOT_FOUND", "StateQL profile was not found");
        return {
          ok: true, profile: found.name,
          ...(found.url === undefined ? {} : { target: found.url }),
          ...(found.env === undefined ? {} : { secret_env: found.env }),
          ...(found.env_file === undefined ? {} : { env_file: found.env_file }),
          read_only: found.read_only === true,
        };
      }
      return result;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      this.#active = undefined;
    }
  }

  #run(binary: string, args: string[], input: string, signal: AbortSignal, mutating: boolean, atomic: boolean, lineCount: number): Promise<CLIResponse> {
    if (signal.aborted) return Promise.resolve(failure("CANCELLED", "StateQL operation cancelled before execution"));
    return new Promise((resolveResult) => {
      let spawned = false;
      let stopped = false;
      let bytes = 0;
      const chunks: Buffer[] = [];
      const child = spawn(binary, args, {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, STQL_HOME: this.home, STQL_SESSION: this.actorId },
      });
      const stop = () => {
        stopped = true;
        // Termination is deliberately forceful: an interrupted write has an unknown outcome.
        child.kill("SIGKILL");
      };
      signal.addEventListener("abort", stop, { once: true });
      child.once("spawn", () => {
        spawned = true;
        if (signal.aborted) stop();
      });
      child.once("error", () => {});
      child.stdin.on("error", () => {});
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_PROCESS_BYTES) stop();
        else chunks.push(chunk);
      });
      // Never surface raw stderr: a driver error could contain connection credentials.
      child.stderr.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_PROCESS_BYTES) stop();
      });
      child.once("close", (code, killedBy) => {
        signal.removeEventListener("abort", stop);
        const uncertain = mutating && spawned;
        const incomplete = () => failure(
          uncertain ? "OUTCOME_UNKNOWN" : "CLI_FAILED",
          uncertain ? "StateQL write outcome could not be proven. Inspect authoritative database state before proceeding."
            : "StateQL process failed or returned invalid output; no raw process output is exposed.",
          uncertain ? "unknown" : false,
        );
        if (stopped || killedBy || !spawned) {
          resolveResult(!uncertain && signal.aborted
            ? failure("CANCELLED", "StateQL operation cancelled")
            : incomplete());
          return;
        }
        try {
          const output = Buffer.concat(chunks).toString("utf8").trim();
          const responses: unknown[] = output.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
          if (responses.length === 0 || !responses.every(isResponse)) {
            resolveResult(incomplete());
            return;
          }
          const typed = responses as CLIResponse[];
          const error = typed.find((response) => !response.ok);
          if (error) {
            resolveResult(typed.length === 1 ? error : { ...error, responses: typed });
            return;
          }
          const last = typed.at(-1)!;
          const receipts = typed.slice(0, -1);
          const pendingHandles = receipts.filter((receipt) => receipt.status === "pending").map((receipt) => receipt.handle);
          const committedHandles = Array.isArray(last.operations) ? last.operations : [];
          const complete = atomic
            ? typed.length === lineCount + 1 && last.status === "committed"
              && receipts.every((receipt) => typeof receipt.handle === "string" && ["pending", "committed"].includes(String(receipt.status)))
              && pendingHandles.every((handle) => committedHandles.includes(handle))
              && committedHandles.length === pendingHandles.length
            : typed.length === 1;
          if (code !== 0 || !complete) {
            // Pending atomic receipts do not prove a commit; require the final commit response.
            resolveResult(incomplete());
            return;
          }
          resolveResult(typed.length === 1 ? typed[0]! : { ok: true, responses: typed });
        } catch {
          resolveResult(incomplete());
        }
      });
      child.stdin.end(input);
    });
  }
}
