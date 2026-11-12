import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";

/** Internal adapter input, never an unrestricted model-facing command. */
export interface BatchCommand {
  command: string;
  [key: string]: unknown;
}

export interface CLIResponse {
  ok: boolean;
  error?: {
    code: string;
    message: string;
    executed?: boolean | string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export const READ_COMMANDS = [
  "connect", "disconnect", "status", "profile.list", "profile.show", "query", "filter",
  "mongo.query", "redis.query", "rows", "summarize", "objects.list", "object.describe",
  "receipt", "history", "doctor",
] as const;

export const WRITE_COMMANDS = [
  "connect", "profile.add", "profile.replace", "profile.remove", "exec", "mongo.exec", "redis.exec", "atomic",
] as const;

const DocumentSchema = Type.Record(Type.String(), Type.Unknown());
const SqlSchema = Type.String({ minLength: 1, maxLength: 100_000 });
const ParamsSchema = Type.Array(Type.Unknown(), { maxItems: 1_000, description: "Positional JSON parameter values; PostgreSQL uses $1, SQLite/MySQL use ?" });
const RedisSchema = Type.Object({
  command: Type.String({ minLength: 1, maxLength: 100 }),
  args: Type.Optional(Type.Array(Type.String({ maxLength: 20_000 }), { maxItems: 1_000 })),
}, { additionalProperties: false });
const MutationProperties = {
  idempotency_key: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  expect_rows: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  allow_unbounded: Type.Optional(Type.Boolean()),
  allow_destructive: Type.Optional(Type.Boolean()),
};
const AtomicStatementSchema = Type.Object({
  sql: SqlSchema,
  params: Type.Optional(ParamsSchema),
  ...MutationProperties,
}, { additionalProperties: false });
const CommonProperties = {
  target: Type.Optional(Type.String({ description: "Credential-free database URL or SQLite path", minLength: 1, maxLength: 4_096 })),
  secret_env: Type.Optional(Type.String({ description: "Environment variable name holding the complete URL, never its value", pattern: "^[A-Za-z_][A-Za-z0-9_]*$", maxLength: 200 })),
  profile: Type.Optional(Type.String({ description: "Saved profile name", minLength: 1, maxLength: 200 })),
  name: Type.Optional(Type.String({ description: "Profile or database object name", minLength: 1, maxLength: 500 })),
  sql: Type.Optional(SqlSchema),
  params: Type.Optional(ParamsSchema),
  mongo: Type.Optional(DocumentSchema),
  redis: Type.Optional(RedisSchema),
  timeout_ms: Type.Optional(Type.Integer({ minimum: 100, maximum: 120_000 })),
};

export const ReadToolSchema = Type.Object({
  command: StringEnum(READ_COMMANDS, { description: "Read-oriented StateQL 1.x command" }),
  ...CommonProperties,
  where: Type.Optional(Type.String({ description: "SQLite filter predicate over stored rows", minLength: 1, maxLength: 20_000 })),
  handle: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
  as: Type.Optional(Type.String({ description: "Name assigned when creating a result", minLength: 1, maxLength: 200 })),
  kind: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  search: Type.Optional(Type.String({ maxLength: 500 })),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  limit: Type.Optional(Type.Integer({ description: "Bounded page size; zero returns rows metadata only", minimum: 0, maximum: 200 })),
  preview_rows: Type.Optional(Type.Integer({ minimum: 0, maximum: 50 })),
  columns: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1, maxItems: 200 })),
  max_cell_characters: Type.Optional(Type.Integer({ minimum: 1, maximum: 32_000 })),
}, { additionalProperties: false });

export const WriteToolSchema = Type.Object({
  command: StringEnum(WRITE_COMMANDS, { description: "Explicitly confirmed StateQL 1.x write command" }),
  ...CommonProperties,
  ...MutationProperties,
  read_only: Type.Optional(Type.Boolean({ description: "Saved profile policy; defaults to read-only" })),
  statements: Type.Optional(Type.Array(AtomicStatementSchema, { description: "SQL writes to execute in one atomic pipe; no reads or connection commands", minItems: 1, maxItems: 20 })),
  isolation: Type.Optional(StringEnum(["read-committed", "repeatable-read", "serializable"] as const)),
}, { additionalProperties: false });

export type ReadToolInput = Static<typeof ReadToolSchema>;
export type WriteToolInput = Static<typeof WriteToolSchema>;
export type StateQLToolInput = ReadToolInput | WriteToolInput;

const READ_FIELDS: Record<(typeof READ_COMMANDS)[number], readonly string[]> = {
  connect: ["target", "secret_env", "profile", "timeout_ms"],
  disconnect: [],
  status: [],
  "profile.list": [],
  "profile.show": ["name"],
  query: ["sql", "params", "preview_rows", "as", "max_cell_characters", "timeout_ms"],
  "mongo.query": ["mongo", "preview_rows", "as", "max_cell_characters", "timeout_ms"],
  "redis.query": ["redis", "preview_rows", "as", "max_cell_characters", "timeout_ms"],
  filter: ["handle", "where", "params", "as", "max_cell_characters", "timeout_ms"],
  rows: ["handle", "offset", "limit", "columns", "max_cell_characters", "timeout_ms"],
  summarize: ["handle", "timeout_ms"],
  "objects.list": ["kind", "search", "cursor", "limit", "timeout_ms"],
  "object.describe": ["name", "timeout_ms"],
  receipt: ["handle"],
  history: ["limit"],
  doctor: [],
};
const WRITE_FIELDS: Record<(typeof WRITE_COMMANDS)[number], readonly string[]> = {
  connect: ["target", "secret_env", "profile", "timeout_ms"],
  "profile.add": ["name", "target", "secret_env", "read_only"],
  "profile.replace": ["name", "target", "secret_env", "read_only"],
  "profile.remove": ["name"],
  exec: ["sql", "params", ...Object.keys(MutationProperties), "timeout_ms"],
  "mongo.exec": ["mongo", ...Object.keys(MutationProperties), "timeout_ms"],
  "redis.exec": ["redis", ...Object.keys(MutationProperties), "timeout_ms"],
  atomic: ["statements", "isolation", "timeout_ms"],
};
const REQUIRED: Record<string, readonly string[]> = {
  "profile.show": ["name"], "profile.add": ["name"], "profile.replace": ["name"], "profile.remove": ["name"],
  query: ["sql"], "mongo.query": ["mongo"], "redis.query": ["redis"],
  exec: ["sql"], "mongo.exec": ["mongo"], "redis.exec": ["redis"],
  filter: ["handle", "where"], rows: ["handle"], summarize: ["handle"], receipt: ["handle"],
  "object.describe": ["name"], atomic: ["statements"],
};

function validateInput(input: StateQLToolInput, fields: readonly string[] | undefined): void {
  if (!fields) throw new Error("Unsupported StateQL command; cache, plans, and staged transactions were removed in StateQL 1.x");
  const allowed = new Set(["command", ...fields]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`${input.command} does not accept ${key}`);
  }
  for (const field of REQUIRED[input.command] ?? []) {
    if ((input as Record<string, unknown>)[field] === undefined) throw new Error(`${input.command} requires ${field}`);
  }
  if (input.command === "connect") {
    const count = [input.target, input.secret_env, input.profile].filter((value) => value !== undefined).length;
    if (count !== 1) throw new Error("connect requires exactly one of target, secret_env, or profile");
  }
  if (input.command === "profile.add" || input.command === "profile.replace") {
    const count = [input.target, input.secret_env].filter((value) => value !== undefined).length;
    if (count !== 1) throw new Error(`${input.command} requires exactly one of target or secret_env`);
  }
  if ("columns" in input && input.columns?.some((name) => name.includes(","))) {
    throw new Error("columns entries must not contain commas");
  }
}

export function toReadBatch(input: ReadToolInput): BatchCommand {
  validateInput(input, READ_FIELDS[input.command]);
  if (!Check(ReadToolSchema, input)) throw new Error("Invalid Neko StateQL read arguments");
  return { ...input, ...(input.command === "connect" ? { read_only: true } : {}) };
}

export function toWriteBatch(input: WriteToolInput): BatchCommand {
  validateInput(input, WRITE_FIELDS[input.command]);
  if (!Check(WriteToolSchema, input)) throw new Error("Invalid Neko StateQL write arguments");
  return {
    ...input,
    ...(input.command === "connect" ? { read_only: false } : {}),
    ...(["profile.add", "profile.replace"].includes(input.command) ? { read_only: input.read_only ?? true } : {}),
  };
}
