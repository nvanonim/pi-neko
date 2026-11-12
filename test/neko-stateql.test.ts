import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import nekoStateQL from "../extensions/neko-stateql.ts";
import { createMockExtensionHarness } from "./helpers/mock-extension-api.ts";

type RuntimeFactory = NonNullable<Parameters<typeof nekoStateQL>[1]>;

function setup(sessionId: string, runtimeFactory?: RuntimeFactory) {
  const harness = createMockExtensionHarness();
  harness.state.sessionId = sessionId;
  nekoStateQL(harness.api, runtimeFactory);
  const read = harness.tools.get("neko_stateql");
  const write = harness.tools.get("neko_stateql_write");
  const mode = harness.commands.get("neko-stateql");
  assert.ok(read);
  assert.ok(write);
  assert.ok(mode);
  return {
    harness,
    mode,
    read: async (input: unknown, signal?: AbortSignal) => JSON.parse((await read.execute("read", input, signal, undefined, harness.ctx)).content[0].text),
    write: async (input: unknown, signal?: AbortSignal) => JSON.parse((await write.execute("write", input, signal, undefined, harness.ctx)).content[0].text),
  };
}

type Client = ReturnType<typeof setup>;

async function withFixture(run: (fixture: { database: string; home: string; client: (session?: string) => Client }) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "pi-neko-cli-test-"));
  const home = join(root, "state-v1");
  const database = join(root, "synthetic.sqlite");
  const sqlite = new DatabaseSync(database);
  sqlite.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL);
    INSERT INTO users (name, status) VALUES ('Ada', 'active'), ('Grace', 'inactive');
    CREATE TABLE payloads (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
  `);
  const insert = sqlite.prepare("INSERT INTO payloads (value) VALUES (?)");
  for (let index = 0; index < 10; index++) insert.run("x".repeat(8_000));
  sqlite.close();
  const previousHome = process.env.PI_NEKO_STATEQL_HOME;
  process.env.PI_NEKO_STATEQL_HOME = home;
  const clients: Client[] = [];
  try {
    await run({ database, home, client(session = "synthetic-session") {
      const client = setup(session);
      clients.push(client);
      return client;
    } });
  } finally {
    for (const client of clients) await client.harness.emit("session_shutdown", { reason: "quit" });
    if (previousHome === undefined) delete process.env.PI_NEKO_STATEQL_HOME;
    else process.env.PI_NEKO_STATEQL_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
}

async function enableWrites(client: Client, database: string) {
  await client.harness.emit("session_start", { reason: "startup" });
  await client.mode.handler("write", client.harness.ctx);
  const connected = await client.write({ command: "connect", target: database });
  assert.equal(connected.ok, true);
}

test("reads native column-array results, filters and summarizes durable handles after restart", async () => {
  await withFixture(async ({ database, client }) => {
    const first = client();
    await first.harness.emit("session_start", { reason: "startup" });
    assert.ok(first.harness.state.activeTools.includes("neko_stateql"));
    assert.ok(!first.harness.state.activeTools.includes("neko_stateql_write"));
    const connected = await first.read({ command: "connect", target: database });
    assert.equal(connected.read_only, true);
    assert.match(first.harness.confirmations[0]?.message ?? "", /model provider/);

    const queried = await first.read({
      command: "query", sql: "SELECT id, name FROM users WHERE status = ? ORDER BY id LIMIT 10", params: ["active"],
    });
    assert.equal(queried.ok, true);
    assert.deepEqual(queried.columns, ["id", "name"]);
    assert.deepEqual(queried.rows, [[1, "Ada"]]);
    assert.equal(queried.total, 1);
    assert.equal(typeof queried.handle, "string");

    const filtered = await first.read({ command: "filter", handle: queried.handle, where: "name LIKE ?", params: ["A%"] });
    assert.equal(filtered.ok, true);
    assert.deepEqual(filtered.rows, [[1, "Ada"]]);
    const summary = await first.read({ command: "summarize", handle: queried.handle });
    assert.equal(summary.ok, true);
    assert.match(JSON.stringify(summary), /name/);

    await first.harness.emit("session_shutdown", { reason: "quit" });
    const resumed = client();
    await resumed.harness.emit("session_start", { reason: "resume" });
    const rows = await resumed.read({ command: "rows", handle: queried.handle, columns: ["name"], offset: 0, limit: 10 });
    assert.equal(rows.ok, true);
    assert.deepEqual(rows.columns, ["name"]);
    assert.deepEqual(rows.rows, [["Ada"]]);
    const metadata = await resumed.read({ command: "rows", handle: queried.handle, limit: 0 });
    assert.equal(metadata.total, 1);
    // StateQL 1.x omits empty arrays in metadata-only responses.
    assert.deepEqual(metadata.rows ?? [], []);
  });
});

test("bounds native output without losing rows when continuing with next_offset", async () => {
  await withFixture(async ({ database, client }) => {
    const c = client();
    await c.read({ command: "connect", target: database });
    let page = await c.read({ command: "query", sql: "SELECT id, value FROM payloads ORDER BY id LIMIT 10", preview_rows: 10 });
    assert.equal(page.ok, true);
    assert.ok(page.rows.length > 0 && page.rows.length < 10);
    assert.ok(Number.isInteger(page.next_offset));
    const handle = page.handle;
    const ids: number[] = [];
    for (let pages = 0; pages < 10; pages++) {
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 40 * 1024);
      ids.push(...page.rows.map((row: any[]) => row[0]));
      if (page.next_offset === undefined) break;
      const next = page.next_offset;
      assert.ok(next > (page.offset ?? 0));
      page = await c.read({ command: "rows", handle, offset: next, limit: 10 });
      assert.equal(page.ok, true);
    }
    assert.deepEqual(ids, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

test("enforces read mode, declined writes, expected row counts, and duplicate protection", async () => {
  await withFixture(async ({ database, client }) => {
    const c = client();
    await c.harness.emit("session_start", { reason: "startup" });
    await assert.rejects(c.write({ command: "exec", sql: "DELETE FROM users WHERE id = ?", params: [1] }), /read mode/);
    await enableWrites(c, database);
    c.harness.state.confirmationResults.push(false);
    await assert.rejects(c.write({ command: "exec", sql: "INSERT INTO users (name, status) VALUES (?, ?)", params: ["Rejected", "active"] }), /declined/);
    const rejected = await c.read({ command: "query", sql: "SELECT count(*) FROM users WHERE name = ?", params: ["Rejected"] });
    assert.deepEqual(rejected.rows, [[0]]);

    const mismatch = await c.write({ command: "exec", sql: "UPDATE users SET status = ? WHERE id = ?", params: ["changed", 1], expect_rows: 2 });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.error.code, "ROW_COUNT_MISMATCH");
    const original = await c.read({ command: "query", sql: "SELECT status FROM users WHERE id = ?", params: [1] });
    assert.deepEqual(original.rows, [["active"]]);

    const insert = { command: "exec", sql: "INSERT INTO users (name, status) VALUES (?, ?)", params: ["Linus", "active"], expect_rows: 1, idempotency_key: "insert-linus-once" };
    const inserted = await c.write(insert);
    assert.equal(inserted.ok, true);
    assert.equal(inserted.affected_rows, 1);
    assert.equal((await c.write(insert)).ok, true);
    const count = await c.read({ command: "query", sql: "SELECT count(*) FROM users WHERE name = ?", params: ["Linus"] });
    assert.deepEqual(count.rows, [[1]]);
    assert.match(c.harness.confirmations.map((entry) => entry.message).join("\n"), /Linus/);

    await c.mode.handler("read", c.harness.ctx);
    assert.ok(!c.harness.state.activeTools.includes("neko_stateql_write"));
    await assert.rejects(c.write(insert), /read mode/);
    await c.mode.handler("write", c.harness.ctx);
    await c.harness.emit("session_start", { reason: "resume" });
    await assert.rejects(c.write(insert), /read mode/);
  });
});

test("forces read-only even for a saved read-write SQLite profile", async () => {
  await withFixture(async ({ database, home, client }) => {
    // Native profile add/replace probes the OS keyring even for SQLite. Seed only temporary metadata instead.
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "profiles.toml"), `[profiles.synthetic-company]\nurl = ${JSON.stringify(database)}\nread_only = false\n`);
    const c = client();
    await c.harness.emit("session_start", { reason: "startup" });
    assert.equal((await c.read({ command: "profile.show", name: "synthetic-company" })).read_only, false);
    const connected = await c.read({ command: "connect", profile: "synthetic-company" });
    assert.equal(connected.ok, true);
    assert.equal(connected.read_only, true);
    assert.equal((await c.read({ command: "profile.show", name: "synthetic-company" })).read_only, false);
    await c.mode.handler("write", c.harness.ctx);
    const blocked = await c.write({ command: "exec", sql: "UPDATE users SET status = ? WHERE id = ?", params: ["unexpected", 1] });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, "READ_ONLY");
  });
});

test("reviews stored and proposed policies before replacing a complete profile", async () => {
  const calls: unknown[] = [];
  const c = setup("profile-review-session", (sessionId) => ({
    sessionId, async close() {},
    async execute(command) {
      calls.push(command);
      if (command.command === "profile.show") {
        return { ok: true, profile: "synthetic-company", target: "/tmp/synthetic.sqlite", read_only: false };
      }
      assert.equal(command.command, "profile.replace");
      return { ok: true, profile: "synthetic-company", saved: { url: command.target, read_only: command.read_only } };
    },
  }));
  await c.mode.handler("write", c.harness.ctx);
  const result = await c.write({ command: "profile.replace", name: "synthetic-company", target: "/tmp/synthetic.sqlite", read_only: true });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  const review = c.harness.confirmations.at(-1)?.message ?? "";
  assert.match(review, /read-write/);
  assert.match(review, /read-only/);
  assert.match(review, /synthetic\.sqlite/);
});

test("confirms complete atomic SQL batches and rolls back all writes on a row-count mismatch", async () => {
  await withFixture(async ({ database, client }) => {
    const c = client();
    await enableWrites(c, database);
    const committed = await c.write({ command: "atomic", statements: [
      { sql: "UPDATE users SET status = ? WHERE id = ?", params: ["first", 1], expect_rows: 1 },
      { sql: "UPDATE users SET status = ? WHERE id = ?", params: ["second", 2], expect_rows: 1 },
    ] });
    assert.equal(committed.ok, true);
    assert.equal(committed.responses.at(-1).status, "committed");
    const summary = c.harness.confirmations.at(-1)?.message ?? "";
    assert.match(summary, /first/);
    assert.match(summary, /second/);

    const failed = await c.write({ command: "atomic", statements: [
      { sql: "UPDATE users SET status = ? WHERE id = ?", params: ["must-roll-back", 1], expect_rows: 1 },
      { sql: "UPDATE users SET status = ? WHERE id = ?", params: ["missing", 99], expect_rows: 1 },
    ] });
    assert.equal(failed.ok, false);
    assert.equal(failed.error.code, "ROW_COUNT_MISMATCH");
    const actual = await c.read({ command: "query", sql: "SELECT status FROM users ORDER BY id" });
    assert.deepEqual(actual.rows, [["first"], ["second"]]);

    const before = c.harness.confirmations.length;
    const destructive = await c.write({ command: "atomic", statements: [
      { sql: "DELETE FROM users", allow_unbounded: true, allow_destructive: true, expect_rows: 2 },
    ] });
    assert.equal(destructive.ok, true);
    assert.equal(c.harness.confirmations.length - before, 3);
    assert.match(c.harness.confirmations.at(-2)?.title ?? "", /unbounded/i);
    assert.match(c.harness.confirmations.at(-1)?.title ?? "", /destructive/i);
  });
});

test("atomic idempotent retries and mixed old/new operations report proven commits", async () => {
  await withFixture(async ({ database, client }) => {
    const c = client();
    await enableWrites(c, database);
    const first = { sql: "INSERT INTO users (name, status) VALUES (?, ?)", params: ["One", "active"], expect_rows: 1, idempotency_key: "atomic-one" };
    const second = { sql: "INSERT INTO users (name, status) VALUES (?, ?)", params: ["Two", "active"], expect_rows: 1, idempotency_key: "atomic-two" };
    assert.equal((await c.write({ command: "atomic", statements: [first] })).ok, true);
    assert.equal((await c.write({ command: "atomic", statements: [first] })).ok, true);
    assert.equal((await c.write({ command: "atomic", statements: [first, second] })).ok, true);
    const rows = await c.read({ command: "query", sql: "SELECT name FROM users WHERE name IN (?, ?) ORDER BY name", params: ["One", "Two"] });
    assert.deepEqual(rows.rows, [["One"], ["Two"]]);
    assert.ok(c.harness.state.activeTools.includes("neko_stateql_write"));
  });
});

test("target profile aliases still receive endpoint and reduced TLS review", async () => {
  const calls: string[] = [];
  const c = setup("alias-review", (sessionId) => ({
    sessionId, async close() {},
    async execute(command) {
      calls.push(command.command);
      if (command.command === "profile.show") return { ok: true, target: "postgresql://reader@db.example.test/app", read_only: true };
      return { ok: true, read_only: true };
    },
  }));
  await c.read({ command: "connect", target: "test-alias" });
  assert.deepEqual(calls, ["profile.show", "connect"]);
  assert.match(c.harness.confirmations[0]?.title ?? "", /transport security/);
  assert.match(c.harness.confirmations.at(-1)?.message ?? "", /db.example.test/);
});

test("env-file profiles fail closed when their endpoint cannot be reviewed", async () => {
  const calls: string[] = [];
  const c = setup("env-file-review", (sessionId) => ({
    sessionId, async close() {},
    async execute(command) {
      calls.push(command.command);
      return { ok: true, secret_env: "NEKO_ENV_FILE_UNSET_TEST", env_file: "/not-read.env", read_only: true };
    },
  }));
  delete process.env.NEKO_ENV_FILE_UNSET_TEST;
  await assert.rejects(c.read({ command: "connect", profile: "test-env-file" }), /cannot review env-file/);
  assert.deepEqual(calls, ["profile.show"]);
});

test("rejects removed commands, named parameters, and undeclared atomic fields before execution", async () => {
  const c = setup("invalid-session", () => ({
    sessionId: "invalid-session", async close() {},
    async execute() { assert.fail("Invalid arguments reached the process adapter"); },
  }));
  await c.mode.handler("write", c.harness.ctx);
  for (const command of ["plan", "apply", "transaction.begin", "transaction.commit", "profile.update"]) {
    await assert.rejects(c.write({ command }), /Unsupported|Invalid|removed/i);
  }
  await assert.rejects(c.read({ command: "query", sql: "SELECT 1", cache: "bypass" }), /does not accept cache/);
  await assert.rejects(c.read({ command: "query", sql: "SELECT :id", params: { id: 1 } }), /Invalid/);
  await assert.rejects(c.write({ command: "atomic", statements: [{ sql: "UPDATE users SET status = 1", replay: true }] }), /Invalid/);
});

test("cancels native reads and refuses to open a legacy state home", async () => {
  await withFixture(async ({ database, home, client }) => {
    const c = client();
    await c.read({ command: "connect", target: database });
    const before = new AbortController();
    before.abort();
    const cancelled = await c.read({ command: "query", sql: "SELECT 1" }, before.signal);
    assert.equal(cancelled.ok, false);
    assert.equal(cancelled.error.code, "CANCELLED");

    const active = new AbortController();
    const running = c.read({ command: "query", sql: "WITH RECURSIVE numbers(x) AS (VALUES(1) UNION ALL SELECT x + 1 FROM numbers WHERE x < 1000000000) SELECT sum(x) FROM numbers", timeout_ms: 5_000 }, active.signal);
    const timer = setTimeout(() => active.abort(), 50);
    try {
      const result = await running;
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "CANCELLED");
    } finally {
      clearTimeout(timer);
    }
    assert.equal((await c.read({ command: "query", sql: "SELECT 1" })).ok, true);

    writeFileSync(join(home, "state.sqlite"), "synthetic legacy marker");
    await assert.rejects(c.read({ command: "status" }), /legacy state\.sqlite home/);
  });
});

test("locks writes immediately after an unknown outcome without retrying", async () => {
  let executed = 0;
  const c = setup("unknown-session", (sessionId) => ({
    sessionId, async close() {},
    async execute() {
      executed++;
      return { ok: false, error: { code: "OUTCOME_UNKNOWN", message: "Write outcome could not be proven.", executed: "unknown", retryable: false } };
    },
  }));
  await c.harness.emit("session_start", { reason: "startup" });
  await c.mode.handler("write", c.harness.ctx);
  const input = { command: "exec", sql: "UPDATE jobs SET claimed = 1 WHERE id = ?", params: [42] };
  const result = await c.write(input);
  assert.equal(result.error.code, "OUTCOME_UNKNOWN");
  assert.equal(executed, 1);
  assert.ok(!c.harness.state.activeTools.includes("neko_stateql_write"));
  assert.match(c.harness.statuses.get("neko-stateql-outcome") ?? "", /outcome unknown/);
  await assert.rejects(c.write(input), /read mode/);
  assert.equal(executed, 1);
});

test("declined or headless permissions fail closed and read mode wins a pending write confirmation", async () => {
  let executed = 0;
  const c = setup("permission-session", (sessionId) => ({
    sessionId, async close() {},
    async execute() { executed++; return { ok: true }; },
  }));
  await c.harness.emit("session_start", { reason: "startup" });
  c.harness.state.confirmationResults.push(false);
  await assert.rejects(c.mode.handler("write", c.harness.ctx), /declined/);
  assert.ok(!c.harness.state.activeTools.includes("neko_stateql_write"));
  (c.harness.ctx as any).hasUI = false;
  await assert.rejects(c.mode.handler("write", c.harness.ctx), /interactive confirmation/);
  await assert.rejects(c.read({ command: "connect", target: "/tmp/synthetic.sqlite" }), /interactive confirmation/);
  assert.equal(executed, 0);

  (c.harness.ctx as any).hasUI = true;
  await c.mode.handler("write", c.harness.ctx);
  let finish: ((confirmed: boolean) => void) | undefined;
  let started: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => { started = resolve; });
  (c.harness.ctx.ui as any).confirm = async () => {
    started!();
    return new Promise<boolean>((resolve) => { finish = resolve; });
  };
  const pending = c.write({ command: "exec", sql: "UPDATE users SET status = ? WHERE id = ?", params: ["changed", 1] });
  await waiting;
  await c.mode.handler("read", c.harness.ctx);
  finish!(true);
  await assert.rejects(pending, /locked|read mode/i);
  assert.equal(executed, 0);
});
