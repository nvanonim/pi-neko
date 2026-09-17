import assert from "node:assert/strict";
import test from "node:test";

import { toReadBatch, toWriteBatch } from "../lib/neko-stateql/commands.ts";
import { boundedJson, MAX_TOOL_OUTPUT_BYTES, redactCredential } from "../lib/neko-stateql/output.ts";
import { actorIdForSession, stateQLHome } from "../lib/neko-stateql/runtime.ts";
import { assertCredentialInputSafe, connectionReview, operationSummary } from "../lib/neko-stateql/safety.ts";

test("maps strict read commands and forces read-only connections", () => {
  assert.deepEqual(
    toReadBatch({ command: "connect", secret_env: "COMPANY_DATABASE_URL" }),
    { command: "connect", secret_env: "COMPANY_DATABASE_URL", read_only: true },
  );
  assert.deepEqual(
    toReadBatch({ command: "objects.list", cursor: "42", limit: 20 }),
    { command: "objects.list", offset: "42", limit: 20 },
  );
  assert.throws(
    () => toReadBatch({ command: "query", sql: "SELECT 1", allow_destructive: true } as any),
    /does not accept allow_destructive/,
  );
  assert.throws(
    () => toReadBatch({ command: "connect", target: "./one.db", profile: "other" }),
    /exactly one/,
  );
});

test("maps writes without exposing replay and defaults new profiles to read-only", () => {
  assert.deepEqual(
    toWriteBatch({ command: "connect", profile: "company" }),
    { command: "connect", profile: "company", read_only: false },
  );
  assert.deepEqual(
    toWriteBatch({ command: "profile.add", name: "company", secret_env: "COMPANY_DATABASE_URL" }),
    { command: "profile.add", name: "company", secret_env: "COMPANY_DATABASE_URL", read_only: true },
  );
  assert.throws(
    () => toWriteBatch({ command: "exec", sql: "UPDATE jobs SET done = 1", replay: true } as any),
    /does not accept replay/,
  );
  assert.throws(
    () => toWriteBatch({ command: "profile.update", name: "company" }),
    /requires target, secret_env, or read_only/,
  );
});

test("rejects credential-bearing targets and missing environment variables", () => {
  assert.throws(
    () => assertCredentialInputSafe({ command: "connect", target: "postgres://user:secret@example.com/app" }),
    /must not contain a password/,
  );
  assert.throws(
    () => assertCredentialInputSafe({ command: "connect", target: "postgres://user@example.com/app?api_key=secret" }),
    /secret query parameter api_key/,
  );
  assert.throws(
    () => assertCredentialInputSafe({ command: "connect", secret_env: "not-valid" }),
    /environment variable name/,
  );
  delete process.env.NEKO_STATEQL_MISSING_TEST;
  assert.throws(
    () => assertCredentialInputSafe({ command: "connect", secret_env: "NEKO_STATEQL_MISSING_TEST" }),
    /is not set/,
  );
});

test("confirmation summaries show decisive values and redact sensitive named fields", () => {
  const summary = operationSummary({
    command: "exec",
    sql: "UPDATE users SET email = :email, password = :password WHERE id = :id",
    params: { email: "review@example.com", password: "do-not-display", id: 42 },
    idempotency_key: "user-42-email",
  });
  assert.match(summary, /review@example\.com/);
  assert.match(summary, /\"id\": 42/);
  assert.doesNotMatch(summary, /do-not-display/);
  assert.match(summary, /\"password\": \"\[REDACTED\]\"/);
  assert.match(summary, /Idempotency key: user-42-email/);

  const mongo = operationSummary({
    command: "mongo.exec",
    mongo: { operation: "updateOne", collection: "users", filter: { id: 42 }, update: { $set: { role: "admin" } } },
  });
  assert.match(mongo, /users/);
  assert.match(mongo, /admin/);

  const redis = operationSummary({ command: "redis.exec", redis: { command: "SET", args: ["feature", "enabled"] } });
  assert.match(redis, /feature/);
  assert.match(redis, /enabled/);
});

test("connection review shows endpoint identity without credentials or query secrets", () => {
  process.env.NEKO_STATEQL_ENDPOINT_TEST = "postgresql://company-user:super-secret@db.example.com:5432/app?sslmode=require&token=nope";
  try {
    const review = connectionReview(
      { command: "connect", profile: "company" },
      { secret_env: "NEKO_STATEQL_ENDPOINT_TEST", read_only: false },
    ) ?? "";
    assert.match(review, /company-user@db\.example\.com:5432\/app/);
    assert.match(review, /Stored profile policy: read-write/);
    assert.doesNotMatch(review, /super-secret|token=nope|sslmode=require/);
  } finally {
    delete process.env.NEKO_STATEQL_ENDPOINT_TEST;
  }
});

test("bounds UTF-8 output and redacts the selected environment credential", () => {
  const bounded = boundedJson({ rows: [{ value: "猫".repeat(50_000) }] });
  assert.equal(bounded.truncated, true);
  assert.ok(Buffer.byteLength(bounded.text) <= MAX_TOOL_OUTPUT_BYTES);
  assert.match(bounded.text, /response truncated/);
  assert.equal(JSON.parse(bounded.text).truncated, true);

  process.env.NEKO_STATEQL_SECRET_TEST = "postgres://user:super-secret@example.com/app";
  try {
    const redacted = redactCredential(
      `failed for ${process.env.NEKO_STATEQL_SECRET_TEST}`,
      { command: "connect", secret_env: "NEKO_STATEQL_SECRET_TEST" },
    );
    assert.equal(redacted, "failed for [REDACTED]");
  } finally {
    delete process.env.NEKO_STATEQL_SECRET_TEST;
  }
});

test("uses deterministic namespaced actors and isolated home paths", () => {
  assert.equal(actorIdForSession("session-one"), actorIdForSession("session-one"));
  assert.notEqual(actorIdForSession("session-one"), actorIdForSession("session-two"));
  assert.match(actorIdForSession("session-one"), /^pi-neko:stateql:[a-f0-9]{32}$/);
  assert.equal(
    stateQLHome({ PI_CODING_AGENT_DIR: "/tmp/pi-agent" }),
    "/tmp/pi-agent/state/neko-stateql",
  );
  assert.equal(
    stateQLHome({ PI_NEKO_STATEQL_HOME: "/tmp/custom-stateql" }),
    "/tmp/custom-stateql",
  );
});
