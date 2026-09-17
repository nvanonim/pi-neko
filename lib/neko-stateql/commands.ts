import { StringEnum } from "@earendil-works/pi-ai";
import type { BatchCommand } from "@fadhilp/stateql";
import { Type, type Static } from "typebox";

export const READ_COMMANDS = [
  "connect",
  "disconnect",
  "status",
  "profile.list",
  "profile.show",
  "session.summary",
  "query",
  "filter",
  "mongo.query",
  "redis.query",
  "show",
  "rows",
  "count",
  "columns",
  "alias.set",
  "inspect",
  "objects.list",
  "object.describe",
  "transaction.status",
  "receipt",
  "history",
  "doctor",
  "capabilities",
] as const;

export const WRITE_COMMANDS = [
  "connect",
  "profile.add",
  "profile.update",
  "profile.remove",
  "exec",
  "plan",
  "apply",
  "mongo.exec",
  "mongo.plan",
  "redis.exec",
  "redis.plan",
  "transaction.begin",
  "transaction.commit",
  "transaction.rollback",
] as const;

const DocumentSchema = Type.Record(Type.String(), Type.Unknown());
const RedisSchema = Type.Object({
  command: Type.String({ minLength: 1, maxLength: 100 }),
  args: Type.Optional(Type.Array(Type.String({ maxLength: 20_000 }), { maxItems: 1_000 })),
}, { additionalProperties: false });

const commonProperties = {
  target: Type.Optional(Type.String({ description: "connect/profile only: SQLite path or credential-free database URL", maxLength: 4096 })),
  sql: Type.Optional(Type.String({ description: "query/exec/plan only: one SQL statement", maxLength: 100_000 })),
  where: Type.Optional(Type.String({ description: "filter only: local parameterized predicate over a stored result", maxLength: 20_000 })),
  handle: Type.Optional(Type.String({ description: "Opaque result, plan, operation, or transaction handle", maxLength: 300 })),
  name: Type.Optional(Type.String({ description: "Profile or alias name", maxLength: 200 })),
  as: Type.Optional(Type.String({ description: "Alias assigned to a new stored result", maxLength: 200 })),
  kind: Type.Optional(Type.String({ description: "Catalog or inspection kind", maxLength: 100 })),
  table: Type.Optional(Type.String({ description: "Optional table or collection name for inspect", maxLength: 500 })),
  schema: Type.Optional(Type.String({ description: "Optional database schema filter", maxLength: 200 })),
  search: Type.Optional(Type.String({ description: "Optional bounded object-name search", maxLength: 500 })),
  params: Type.Optional(Type.Union([Type.Array(Type.Unknown()), DocumentSchema], { description: "SQL/filter positional array or named parameter object" })),
  mongo: Type.Optional(Type.Intersect([DocumentSchema], { description: "StateQL MongoDB command object" })),
  redis: Type.Optional(Type.Intersect([RedisSchema], { description: "StateQL Redis command and argument list" })),
  object: Type.Optional(Type.Intersect([DocumentSchema], { description: "Opaque catalog object returned by objects.list" })),
  cache: Type.Optional(StringEnum(["auto", "bypass", "require"] as const, { description: "Read cache policy" })),
  preview_rows: Type.Optional(Type.Integer({ description: "Rows included in query response; remaining rows stay in handle", minimum: 0, maximum: 50 })),
  read_only: Type.Optional(Type.Boolean({ description: "profile.add/update only: stored profile access policy; defaults true for add" })),
  secret_env: Type.Optional(Type.String({ description: "Environment variable name containing complete database URL; never the value", minLength: 1, maxLength: 200 })),
  profile: Type.Optional(Type.String({ description: "Existing StateQL profile name", minLength: 1, maxLength: 200 })),
  idempotency_key: Type.Optional(Type.String({ description: "Stable duplicate-protection key for retryable writes", minLength: 1, maxLength: 500 })),
  allow_unbounded: Type.Optional(Type.Boolean({ description: "Independent confirmed override for unbounded mutations" })),
  allow_destructive: Type.Optional(Type.Boolean({ description: "Independent confirmed override for destructive operations" })),
  offset: Type.Optional(Type.Integer({ description: "Non-negative result/history/catalog offset", minimum: 0 })),
  cursor: Type.Optional(Type.String({ description: "Opaque Redis catalog cursor", maxLength: 500 })),
  limit: Type.Optional(Type.Integer({ description: "Bounded page size", minimum: 1, maximum: 200 })),
  isolation: Type.Optional(Type.String({ description: "transaction.begin only: database-supported isolation level", maxLength: 100 })),
  timeout_ms: Type.Optional(Type.Integer({ description: "Database operation timeout in milliseconds", minimum: 100, maximum: 120_000 })),
  history_origin: Type.Optional(StringEnum(["legacy", "user", "model", "system", "api"] as const, { description: "history only: origin filter" })),
  history_category: Type.Optional(StringEnum(["statement", "introspection", "management"] as const, { description: "history only: category filter" })),
  history_internal: Type.Optional(Type.Boolean({ description: "history only: include or exclude internal commands" })),
};

export const ReadToolSchema = Type.Object({
  command: StringEnum(READ_COMMANDS, { description: "Read-oriented StateQL command" }),
  target: commonProperties.target,
  sql: commonProperties.sql,
  where: commonProperties.where,
  handle: commonProperties.handle,
  name: commonProperties.name,
  as: commonProperties.as,
  kind: commonProperties.kind,
  table: commonProperties.table,
  schema: commonProperties.schema,
  search: commonProperties.search,
  params: commonProperties.params,
  mongo: commonProperties.mongo,
  redis: commonProperties.redis,
  object: commonProperties.object,
  cache: commonProperties.cache,
  preview_rows: commonProperties.preview_rows,
  secret_env: commonProperties.secret_env,
  profile: commonProperties.profile,
  offset: commonProperties.offset,
  cursor: commonProperties.cursor,
  limit: commonProperties.limit,
  timeout_ms: commonProperties.timeout_ms,
  history_origin: commonProperties.history_origin,
  history_category: commonProperties.history_category,
  history_internal: commonProperties.history_internal,
}, { additionalProperties: false });

export const WriteToolSchema = Type.Object({
  command: StringEnum(WRITE_COMMANDS, { description: "Write-capable StateQL command" }),
  target: commonProperties.target,
  sql: commonProperties.sql,
  handle: commonProperties.handle,
  name: commonProperties.name,
  params: commonProperties.params,
  mongo: commonProperties.mongo,
  redis: commonProperties.redis,
  read_only: commonProperties.read_only,
  secret_env: commonProperties.secret_env,
  profile: commonProperties.profile,
  idempotency_key: commonProperties.idempotency_key,
  allow_unbounded: commonProperties.allow_unbounded,
  allow_destructive: commonProperties.allow_destructive,
  isolation: commonProperties.isolation,
  timeout_ms: commonProperties.timeout_ms,
}, { additionalProperties: false });

export type ReadToolInput = Static<typeof ReadToolSchema>;
export type WriteToolInput = Static<typeof WriteToolSchema>;
export type StateQLToolInput = ReadToolInput | WriteToolInput;

const READ_FIELDS: Record<(typeof READ_COMMANDS)[number], readonly string[]> = {
  connect: ["target", "secret_env", "profile", "name", "timeout_ms"],
  disconnect: [],
  status: [],
  "profile.list": [],
  "profile.show": ["name"],
  "session.summary": [],
  query: ["sql", "params", "cache", "preview_rows", "as", "timeout_ms"],
  filter: ["handle", "where", "params", "as"],
  "mongo.query": ["mongo", "cache", "preview_rows", "as", "timeout_ms"],
  "redis.query": ["redis", "cache", "preview_rows", "as", "timeout_ms"],
  show: ["handle"],
  rows: ["handle", "offset", "limit"],
  count: ["handle"],
  columns: ["handle"],
  "alias.set": ["name", "handle"],
  inspect: ["kind", "table", "timeout_ms"],
  "objects.list": ["kind", "schema", "search", "offset", "cursor", "limit", "timeout_ms"],
  "object.describe": ["object", "timeout_ms"],
  "transaction.status": ["handle"],
  receipt: ["handle"],
  history: ["limit", "offset", "history_origin", "history_category", "history_internal"],
  doctor: [],
  capabilities: [],
};

const WRITE_FIELDS: Record<(typeof WRITE_COMMANDS)[number], readonly string[]> = {
  connect: ["target", "secret_env", "profile", "name", "timeout_ms"],
  "profile.add": ["name", "target", "secret_env", "read_only"],
  "profile.update": ["name", "target", "secret_env", "read_only"],
  "profile.remove": ["name"],
  exec: ["sql", "params", "idempotency_key", "allow_unbounded", "allow_destructive", "timeout_ms"],
  plan: ["sql", "params", "allow_unbounded", "allow_destructive", "timeout_ms"],
  apply: ["handle", "timeout_ms"],
  "mongo.exec": ["mongo", "idempotency_key", "allow_unbounded", "allow_destructive", "timeout_ms"],
  "mongo.plan": ["mongo", "allow_unbounded", "allow_destructive", "timeout_ms"],
  "redis.exec": ["redis", "idempotency_key", "timeout_ms"],
  "redis.plan": ["redis", "timeout_ms"],
  "transaction.begin": ["isolation"],
  "transaction.commit": ["handle", "timeout_ms"],
  "transaction.rollback": ["handle"],
};

const REQUIRED: Partial<Record<string, readonly string[]>> = {
  "profile.show": ["name"],
  query: ["sql"],
  filter: ["handle", "where"],
  "mongo.query": ["mongo"],
  "redis.query": ["redis"],
  show: ["handle"],
  rows: ["handle"],
  count: ["handle"],
  columns: ["handle"],
  "alias.set": ["name", "handle"],
  inspect: ["kind"],
  "object.describe": ["object"],
  receipt: ["handle"],
  "profile.add": ["name"],
  "profile.update": ["name"],
  "profile.remove": ["name"],
  exec: ["sql"],
  plan: ["sql"],
  apply: ["handle"],
  "mongo.exec": ["mongo"],
  "mongo.plan": ["mongo"],
  "redis.exec": ["redis"],
  "redis.plan": ["redis"],
};

function sourceCount(input: StateQLToolInput): number {
  return [input.target, input.secret_env, input.profile].filter((value) => value !== undefined).length;
}

function validateInput(input: StateQLToolInput, fields: readonly string[]): void {
  const allowed = new Set(["command", ...fields]);
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && !allowed.has(key)) throw new Error(`${input.command} does not accept ${key}`);
  }
  for (const field of REQUIRED[input.command] ?? []) {
    if ((input as Record<string, unknown>)[field] === undefined) throw new Error(`${input.command} requires ${field}`);
  }
  if (input.command === "connect" && sourceCount(input) !== 1) {
    throw new Error("connect requires exactly one of target, secret_env, or profile");
  }
  if (input.command === "profile.add") {
    const count = [input.target, input.secret_env].filter((value) => value !== undefined).length;
    if (count !== 1) throw new Error("profile.add requires exactly one of target or secret_env");
  }
  if (input.command === "profile.update") {
    const count = [input.target, input.secret_env].filter((value) => value !== undefined).length;
    if (count > 1) throw new Error("profile.update accepts only one of target or secret_env");
    if (count === 0 && input.read_only === undefined) throw new Error("profile.update requires target, secret_env, or read_only");
  }
  if (input.command === "objects.list" && input.offset !== undefined && input.cursor !== undefined) {
    throw new Error("objects.list accepts offset or cursor, not both");
  }
}

function batchFrom(input: StateQLToolInput, fields: readonly string[]): BatchCommand {
  const output: Record<string, unknown> = { command: input.command };
  for (const field of fields) {
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) output[field] = value;
  }
  if (input.command === "objects.list" && input.cursor !== undefined) {
    delete output.cursor;
    output.offset = input.cursor;
  }
  return output as unknown as BatchCommand;
}

export function toReadBatch(input: ReadToolInput): BatchCommand {
  const fields = READ_FIELDS[input.command];
  validateInput(input, fields);
  const output = batchFrom(input, fields);
  if (input.command === "connect") output.read_only = true;
  return output;
}

export function toWriteBatch(input: WriteToolInput): BatchCommand {
  const fields = WRITE_FIELDS[input.command];
  validateInput(input, fields);
  const output = batchFrom(input, fields);
  if (input.command === "connect") output.read_only = false;
  if (input.command === "profile.add" && input.read_only === undefined) output.read_only = true;
  return output;
}
