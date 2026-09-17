import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { BatchCommand, CommandOrigin, Response, StateQL } from "@fadhilp/stateql";

const DEFAULT_MAX_RESULT_BYTES = 16 * 1024 * 1024;

export function stateQLHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.PI_NEKO_STATEQL_HOME?.trim();
  if (configured) return resolve(configured);
  const agentHome = env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
  return join(resolve(agentHome), "state", "neko-stateql");
}

export function actorIdForSession(sessionId: string): string {
  const digest = createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
  return `pi-neko:stateql:${digest}`;
}

export class NekoStateQLRuntime {
  readonly sessionId: string;
  readonly home: string;
  readonly actorId: string;
  #clientPromise: Promise<StateQL> | undefined;
  #closed = false;

  constructor(sessionId: string, home = stateQLHome()) {
    this.sessionId = sessionId;
    this.home = home;
    this.actorId = actorIdForSession(sessionId);
  }

  async execute(
    command: BatchCommand,
    signal?: AbortSignal,
    origin: CommandOrigin = "model",
    internal = false,
  ): Promise<Response<unknown>> {
    if (this.#closed) throw new Error("Neko StateQL runtime is closed");
    const client = await this.#client();
    return client.executeCommand(command, { origin, internal, signal });
  }

  async close(): Promise<void> {
    this.#closed = true;
    const pending = this.#clientPromise;
    this.#clientPromise = undefined;
    if (pending) (await pending).close();
  }

  async #client(): Promise<StateQL> {
    if (!this.#clientPromise) {
      this.#clientPromise = import("@fadhilp/stateql").then(({ StateQL }) => StateQL.forActor({
        actor: this.actorId,
        home: this.home,
        previewRows: 10,
        maxCellCharacters: 8_000,
        maxResultRows: 10_000,
        maxResultBytes: DEFAULT_MAX_RESULT_BYTES,
      }));
    }
    return this.#clientPromise;
  }
}
