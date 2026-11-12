import assert from "node:assert/strict";
import test from "node:test";

import { toReadBatch, toWriteBatch } from "../lib/neko-stateql/commands.ts";
import { boundedJson, MAX_TOOL_OUTPUT_BYTES, redactCredential } from "../lib/neko-stateql/output.ts";
import { stateQLHome } from "../lib/neko-stateql/runtime.ts";
import { assertCredentialInputSafe, connectionReview, connectionTLSWarning, operationSummary } from "../lib/neko-stateql/safety.ts";

test("rejects read-write escalation, removed commands, and unsupported arguments", () => {
  assert.deepEqual(toReadBatch({ command: "connect", profile: "synthetic-company" }), {
    command: "connect", profile: "synthetic-company", read_only: true,
  });
  assert.throws(() => toReadBatch({ command: "connect", profile: "synthetic-company", read_only: false } as any), /does not accept read_only/);
  assert.throws(() => toReadBatch({ command: "query", sql: "SELECT 1", allow_destructive: true } as any), /does not accept allow_destructive/);
  assert.throws(() => toReadBatch({ command: "query", sql: "SELECT 1", cache: "bypass" } as any), /does not accept cache/);
  assert.throws(() => toReadBatch({ command: "query", sql: "SELECT :id", params: { id: 42 } } as any), /Invalid/);
  assert.throws(() => toReadBatch({ command: "connect", target: "./one.db", profile: "other" }), /exactly one/);
  assert.throws(() => toReadBatch({ command: "rows", handle: "r_fixture", columns: ["id,name"] }), /must not contain commas/);
  assert.throws(() => toWriteBatch({ command: "apply", handle: "p_fixture" } as any), /Unsupported|removed/i);
});

test("profiles default to read-only and replacements require a complete source", () => {
  assert.deepEqual(toWriteBatch({ command: "profile.add", name: "synthetic-company", secret_env: "NEKO_SYNTHETIC_DATABASE_URL" }), {
    command: "profile.add", name: "synthetic-company", secret_env: "NEKO_SYNTHETIC_DATABASE_URL", read_only: true,
  });
  assert.deepEqual(toWriteBatch({ command: "profile.replace", name: "synthetic-company", target: "./fixture.sqlite" }), {
    command: "profile.replace", name: "synthetic-company", target: "./fixture.sqlite", read_only: true,
  });
  assert.throws(() => toWriteBatch({ command: "profile.replace", name: "synthetic-company", read_only: true }), /exactly one/);
  assert.throws(() => toWriteBatch({ command: "exec", sql: "UPDATE jobs SET done = 1", replay: true } as any), /does not accept replay/);
  assert.throws(() => toWriteBatch({ command: "atomic", statements: [{ sql: "UPDATE jobs SET done = 1", expect_rows: -1 }] }), /Invalid/);
  assert.throws(() => toWriteBatch({ command: "atomic", statements: [{ sql: "UPDATE jobs SET done = 1", command: "connect" }] } as any), /Invalid/);
  assert.throws(() => toWriteBatch({ command: "atomic", statements: Array.from({ length: 21 }, () => ({ sql: "DELETE FROM jobs WHERE id = 1" })) }), /Invalid/);
});

test("rejects credentials in literal targets and invalid or missing environment references", () => {
  assert.throws(() => assertCredentialInputSafe({ command: "connect", target: "postgres://user:synthetic-password@example.invalid/app" }), /must not contain a password/);
  assert.throws(() => assertCredentialInputSafe({ command: "connect", target: "postgres://user@example.invalid/app?api_key=synthetic-secret" }), /secret query parameter api_key/);
  assert.throws(() => assertCredentialInputSafe({ command: "connect", secret_env: "not-valid" }), /environment variable name/);
  const missing = "NEKO_STATEQL_MISSING_TEST";
  const previous = process.env[missing];
  delete process.env[missing];
  try {
    assert.throws(() => assertCredentialInputSafe({ command: "connect", secret_env: missing }), /is not set/);
  } finally {
    if (previous !== undefined) process.env[missing] = previous;
  }
});

test("write review includes positional values, expected row counts, and every atomic statement", () => {
  const summary = operationSummary({
    command: "exec", sql: "UPDATE users SET email = ? WHERE id = ?",
    params: ["review@example.invalid", 42], expect_rows: 1, idempotency_key: "user-42-email",
  });
  assert.match(summary, /review@example\.invalid/);
  assert.match(summary, /42/);
  assert.match(summary, /expected|expect_rows/i);
  assert.match(summary, /user-42-email/);

  const atomic = operationSummary({ command: "atomic", statements: [
    { sql: "UPDATE users SET status = ? WHERE id = ?", params: ["first-change", 1], expect_rows: 1 },
    { sql: "DELETE FROM users WHERE id = ?", params: [2], allow_destructive: true, expect_rows: 1 },
  ] });
  assert.match(atomic, /first-change/);
  assert.match(atomic, /DELETE FROM users/);

  const mongo = operationSummary({ command: "mongo.exec", mongo: {
    operation: "updateOne", collection: "users", filter: { id: 42 }, update: { $set: { role: "admin", password: "do-not-display" } },
  } });
  assert.match(mongo, /users/);
  assert.match(mongo, /admin/);
  assert.doesNotMatch(mongo, /do-not-display/);
  assert.match(mongo, /REDACTED/);
  const redis = operationSummary({ command: "redis.exec", redis: { command: "SET", args: ["feature", "enabled"] } });
  assert.match(redis, /feature/);
  assert.match(redis, /enabled/);
});

test("connection review shows identity and policy but hides credential and URL query secrets", () => {
  const key = "NEKO_STATEQL_ENDPOINT_TEST";
  const previous = process.env[key];
  process.env[key] = "postgresql://synthetic-user:synthetic-password@db.example.invalid:5432/app?sslmode=require&token=synthetic-token";
  try {
    const review = connectionReview({ command: "connect", profile: "synthetic-company" }, { secret_env: key, read_only: false }) ?? "";
    assert.match(review, /synthetic-user@db\.example\.invalid:5432\/app/);
    assert.match(review, /read-write/);
    assert.doesNotMatch(review, /synthetic-password|synthetic-token/);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test("unknown MongoDB transport formats and explicit SRV TLS opt-outs require approval", () => {
  assert.match(connectionTLSWarning({ command: "connect", profile: "synthetic" }, {
    target: "mongodb://node1.example.invalid:27017,node2.example.invalid:27017/app",
  }) ?? "", /unknown|cannot be reviewed/);
  assert.match(connectionTLSWarning({ command: "connect", profile: "synthetic" }, {
    target: "mongodb+srv://cluster.example.invalid/app?tls=false",
  }) ?? "", /does not enable/);
  assert.equal(connectionTLSWarning({ command: "connect", profile: "synthetic" }, {
    target: "mongodb+srv://cluster.example.invalid/app",
  }), undefined);
});

test("bounds UTF-8 JSON and redacts only a synthetic selected environment credential", () => {
  const bounded = boundedJson({ rows: [["猫".repeat(50_000)]] });
  assert.equal(bounded.truncated, true);
  assert.ok(Buffer.byteLength(bounded.text) <= MAX_TOOL_OUTPUT_BYTES);
  assert.equal(JSON.parse(bounded.text).truncated, true);
  const key = "NEKO_STATEQL_SECRET_TEST";
  const previous = process.env[key];
  process.env[key] = "postgres://user:synthetic-secret@example.invalid/app";
  try {
    assert.equal(redactCredential(`failed for ${process.env[key]}`, { command: "connect", secret_env: key }), "failed for [REDACTED]");
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test("uses a separate v1 home by default while respecting explicit overrides", () => {
  assert.equal(stateQLHome({ PI_CODING_AGENT_DIR: "/tmp/pi-agent" }), "/tmp/pi-agent/state/neko-stateql-v1");
  assert.equal(stateQLHome({ PI_NEKO_STATEQL_HOME: "/tmp/custom-stateql" }), "/tmp/custom-stateql");
});
