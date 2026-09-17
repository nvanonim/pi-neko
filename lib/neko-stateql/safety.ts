import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { StateQLToolInput, WriteToolInput } from "./commands.ts";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_QUERY_KEY = /(?:pass(?:word)?|pwd|secret|token|api[_-]?key|credential)/i;
const SECRET_FIELD = /(?:pass(?:word)?|pwd|secret|token|api[_-]?key|credential|authorization)/i;

export interface ConnectionSourceDetails {
  target?: string | null;
  secret_env?: string | null;
  read_only?: boolean;
}

export function assertCredentialInputSafe(input: StateQLToolInput): void {
  if (input.secret_env) {
    if (!ENV_NAME.test(input.secret_env)) throw new Error("secret_env must be an environment variable name");
    if (process.env[input.secret_env] === undefined) throw new Error(`Environment variable ${input.secret_env} is not set`);
  }
  if (!input.target || !input.target.includes("://")) return;
  let url: URL;
  try {
    url = new URL(input.target);
  } catch {
    throw new Error("Connection target URL is invalid");
  }
  if (url.password) throw new Error("Connection target must not contain a password; use secret_env");
  for (const key of url.searchParams.keys()) {
    if (SECRET_QUERY_KEY.test(key)) throw new Error(`Connection target must not contain secret query parameter ${key}; use secret_env`);
  }
}

function short(value: string, limit = 2_000): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function redactSensitiveFields(value: unknown, key = ""): unknown {
  if (SECRET_FIELD.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((entry) => redactSensitiveFields(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entry]) => [entryKey, redactSensitiveFields(entry, entryKey)]));
  }
  return value;
}

function reviewJson(value: unknown): string {
  return short(JSON.stringify(redactSensitiveFields(value), null, 2));
}

function sanitizedSource(value: string): string {
  if (!value.includes("://")) return short(value, 500);
  try {
    const url = new URL(value);
    const username = url.username ? `${url.username}@` : "";
    const port = url.port ? `:${url.port}` : "";
    const options = url.search ? " (connection options omitted)" : "";
    return `${url.protocol}//${username}${url.hostname}${port}${url.pathname}${options}`;
  } catch {
    return "[invalid database URL]";
  }
}

export function connectionReview(input: StateQLToolInput, profile?: ConnectionSourceDetails): string | undefined {
  const source = input.target
    ?? (input.secret_env ? process.env[input.secret_env] : undefined)
    ?? profile?.target
    ?? (profile?.secret_env ? process.env[profile.secret_env] : undefined);
  const lines: string[] = [];
  if (input.profile) lines.push(`Profile: ${input.profile}`);
  if (input.secret_env ?? profile?.secret_env) lines.push(`Credential source: environment variable ${input.secret_env ?? profile?.secret_env}`);
  if (source) lines.push(`Endpoint: ${sanitizedSource(source)}`);
  if (profile?.read_only !== undefined) lines.push(`Stored profile policy: ${profile.read_only ? "read-only" : "read-write"}`);
  return lines.length ? lines.join("\n") : undefined;
}

export function operationSummary(input: StateQLToolInput): string {
  const lines = [`Command: ${input.command}`];
  if (input.profile) lines.push(`Profile: ${input.profile}`);
  if (input.secret_env) lines.push(`Credential source: environment variable ${input.secret_env}`);
  if (input.target) lines.push(`Target: ${sanitizedSource(input.target)}`);
  if (input.name) lines.push(`Name: ${input.name}`);
  if (input.handle) lines.push(`Handle: ${input.handle}`);
  if (input.sql) lines.push(`SQL:\n${short(input.sql)}`);
  if (input.params) lines.push(`Parameters:\n${reviewJson(input.params)}`);
  if (input.mongo) lines.push(`MongoDB command:\n${reviewJson(input.mongo)}`);
  if (input.redis) {
    const redis = input.redis.command.toUpperCase() === "AUTH"
      ? { command: input.redis.command, args: ["[REDACTED]"] }
      : input.redis;
    lines.push(`Redis command:\n${reviewJson(redis)}`);
  }
  const requestedReadOnly = "read_only" in input ? input.read_only : undefined;
  if (requestedReadOnly !== undefined) lines.push(`Requested profile policy: ${requestedReadOnly ? "read-only" : "read-write"}`);
  const idempotencyKey = "idempotency_key" in input ? input.idempotency_key : undefined;
  if (idempotencyKey) lines.push(`Idempotency key: ${idempotencyKey}`);
  return lines.join("\n");
}

export async function requireConfirmation(
  ctx: ExtensionContext,
  title: string,
  message: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!ctx.hasUI) throw new Error(`${title} requires interactive confirmation`);
  const confirmed = await ctx.ui.confirm(title, message, { signal });
  if (!confirmed) throw new Error(`${title} declined; nothing was executed`);
}

export async function confirmReadConnection(
  input: StateQLToolInput,
  ctx: ExtensionContext,
  signal?: AbortSignal,
  connection?: string,
): Promise<void> {
  await requireConfirmation(
    ctx,
    input.command === "disconnect" ? "Disconnect Neko StateQL" : "Connect Neko StateQL read-only",
    `${operationSummary(input)}${connection ? `\n${connection}` : ""}\n\nSQL, parameters, and returned database rows may enter Pi history and be sent to the selected model provider.`,
    signal,
  );
}

export async function confirmWrite(
  input: WriteToolInput,
  ctx: ExtensionContext,
  signal?: AbortSignal,
  reviewContext?: string,
): Promise<void> {
  await requireConfirmation(
    ctx,
    "Approve Neko StateQL write operation",
    `${operationSummary(input)}${reviewContext ? `\n\nReview context:\n${reviewContext}` : ""}\n\nThis operation may modify database or durable StateQL configuration.`,
    signal,
  );
  if (input.allow_unbounded) {
    await requireConfirmation(
      ctx,
      "Approve unbounded database mutation",
      "StateQL detected or may permit a mutation without a bounded selector. Confirm this independent override.",
      signal,
    );
  }
  if (input.allow_destructive) {
    await requireConfirmation(
      ctx,
      "Approve destructive database operation",
      "StateQL may execute a destructive operation. Confirm this independent override.",
      signal,
    );
  }
}
