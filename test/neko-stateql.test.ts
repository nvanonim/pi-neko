import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import nekoStateQL from "../extensions/neko-stateql.ts";
import { createMockExtensionHarness } from "./helpers/mock-extension-api.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-neko-stateql-"));
  const home = join(root, "state");
  const database = join(root, "company.sqlite");
  const sqlite = new DatabaseSync(database);
  sqlite.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL);
    INSERT INTO users (name, status) VALUES ('Ada', 'active'), ('Grace', 'inactive');
    CREATE TABLE payloads (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
  `);
  const insertPayload = sqlite.prepare("INSERT INTO payloads (value) VALUES (?)");
  for (let index = 0; index < 10; index++) insertPayload.run("x".repeat(8_000));
  sqlite.close();
  return { root, home, database };
}

function setup(sessionId: string, runtimeFactory?: Parameters<typeof nekoStateQL>[1]) {
  const harness = createMockExtensionHarness();
  harness.state.sessionId = sessionId;
  nekoStateQL(harness.api, runtimeFactory);
  const read = harness.tools.get("neko_stateql");
  const write = harness.tools.get("neko_stateql_write");
  const writeCommand = harness.commands.get("neko-stateql");
  assert.ok(read);
  assert.ok(write);
  assert.ok(writeCommand);
  return { harness, read, write, writeCommand };
}

function parsed(result: any): any {
  return JSON.parse(result.content[0].text);
}

test("runs a read-only SQLite workflow and reuses durable handles after restart", async () => {
  const data = fixture();
  const previousHome = process.env.PI_NEKO_STATEQL_HOME;
  process.env.PI_NEKO_STATEQL_HOME = data.home;
  const first = setup("read-session");
  try {
    await first.harness.emit("session_start", { reason: "startup" });
    assert.ok(first.harness.state.activeTools.includes("neko_stateql"));
    assert.ok(!first.harness.state.activeTools.includes("neko_stateql_write"));

    const connected = parsed(await first.read.execute(
      "connect",
      { command: "connect", target: data.database },
      undefined,
      undefined,
      first.harness.ctx,
    ));
    assert.equal(connected.ok, true);
    assert.equal(connected.data.read_only, true);
    assert.match(first.harness.confirmations[0]?.message ?? "", /model provider/);

    const queried = parsed(await first.read.execute(
      "query",
      {
        command: "query",
        sql: "SELECT id, name FROM users WHERE status = ? ORDER BY id LIMIT 10",
        params: ["active"],
        cache: "bypass",
      },
      undefined,
      undefined,
      first.harness.ctx,
    ));
    assert.equal(queried.ok, true);
    assert.deepEqual(queried.data.preview, [{ id: 1, name: "Ada" }]);
    const handle = queried.data.result_id as string;

    const rows = parsed(await first.read.execute(
      "rows",
      { command: "rows", handle, offset: 0, limit: 10 },
      undefined,
      undefined,
      first.harness.ctx,
    ));
    assert.equal(rows.data.total, 1);
    assert.deepEqual(rows.data.rows, [{ id: 1, name: "Ada" }]);

    const largeResult = await first.read.execute(
      "large-query",
      { command: "query", sql: "SELECT value FROM payloads ORDER BY id LIMIT 10", cache: "bypass", preview_rows: 10 },
      undefined,
      undefined,
      first.harness.ctx,
    );
    const largeEnvelope = JSON.parse(largeResult.content[0].text);
    assert.equal(largeEnvelope.truncated, true);
    assert.match(largeEnvelope.message, /narrower query/);
    assert.ok(Buffer.byteLength(largeResult.content[0].text) <= 40 * 1024);

    const controller = new AbortController();
    controller.abort();
    const cancelled = parsed(await first.read.execute(
      "cancelled-query",
      { command: "query", sql: "SELECT 1", cache: "bypass" },
      controller.signal,
      undefined,
      first.harness.ctx,
    ));
    assert.equal(cancelled.ok, false);
    assert.match(cancelled.error.code, /CANCEL/i);

    await first.harness.emit("session_shutdown", { reason: "quit" });
    const resumed = setup("read-session");
    await resumed.harness.emit("session_start", { reason: "resume" });
    try {
      const durableRows = parsed(await resumed.read.execute(
        "rows",
        { command: "rows", handle, offset: 0, limit: 10 },
        undefined,
        undefined,
        resumed.harness.ctx,
      ));
      assert.equal(durableRows.ok, true);
      assert.deepEqual(durableRows.data.rows, [{ id: 1, name: "Ada" }]);
    } finally {
      await resumed.harness.emit("session_shutdown", { reason: "quit" });
    }
  } finally {
    await first.harness.emit("session_shutdown", { reason: "quit" });
    if (previousHome === undefined) delete process.env.PI_NEKO_STATEQL_HOME;
    else process.env.PI_NEKO_STATEQL_HOME = previousHome;
    rmSync(data.root, { recursive: true, force: true });
  }
});

test("keeps writes inactive until user enables write mode and confirms every write", async () => {
  const data = fixture();
  const previousHome = process.env.PI_NEKO_STATEQL_HOME;
  process.env.PI_NEKO_STATEQL_HOME = data.home;
  const { harness, read, write, writeCommand } = setup("write-session");
  try {
    await harness.emit("session_start", { reason: "startup" });
    await assert.rejects(
      write.execute("locked", { command: "connect", target: data.database }, undefined, undefined, harness.ctx),
      /in read mode/,
    );

    await writeCommand.handler("write", harness.ctx);
    assert.ok(harness.state.activeTools.includes("neko_stateql_write"));
    assert.match(harness.statuses.get("neko-stateql-writes") ?? "", /write mode/);

    const connected = parsed(await write.execute(
      "write-connect",
      { command: "connect", target: data.database },
      undefined,
      undefined,
      harness.ctx,
    ));
    assert.equal(connected.data.read_only, false);

    harness.state.confirmationResults.push(false);
    await assert.rejects(
      write.execute(
        "declined-insert",
        { command: "exec", sql: "INSERT INTO users (name, status) VALUES (?, ?)", params: ["Rejected", "active"] },
        undefined,
        undefined,
        harness.ctx,
      ),
      /declined; nothing was executed/,
    );
    const rejected = parsed(await read.execute(
      "check-declined",
      { command: "query", sql: "SELECT count(*) AS total FROM users WHERE name = ?", params: ["Rejected"], cache: "bypass" },
      undefined,
      undefined,
      harness.ctx,
    ));
    assert.equal(rejected.data.preview[0].total, 0);

    const inserted = parsed(await write.execute(
      "insert",
      {
        command: "exec",
        sql: "INSERT INTO users (name, status) VALUES (?, ?)",
        params: ["Linus", "active"],
        idempotency_key: "insert-linus-once",
      },
      undefined,
      undefined,
      harness.ctx,
    ));
    assert.equal(inserted.ok, true);
    assert.equal(inserted.data.affected_rows, 1);

    const plannedInsert = parsed(await write.execute(
      "plan-insert",
      {
        command: "plan",
        sql: "INSERT INTO users (name, status) VALUES (?, ?)",
        params: ["Planned User", "active"],
      },
      undefined,
      undefined,
      harness.ctx,
    ));
    const appliedInsert = parsed(await write.execute(
      "apply-insert",
      { command: "apply", handle: plannedInsert.data.plan_id },
      undefined,
      undefined,
      harness.ctx,
    ));
    assert.equal(appliedInsert.ok, true);
    assert.match(harness.confirmations.at(-1)?.message ?? "", /Planned User/);

    await assert.rejects(
      write.execute("unknown-plan", { command: "apply", handle: "p_unknown" }, undefined, undefined, harness.ctx),
      /only apply a plan created and reviewed in the current Pi session/,
    );

    const queried = parsed(await read.execute(
      "query",
      { command: "query", sql: "SELECT name FROM users WHERE name = ? LIMIT 1", params: ["Linus"], cache: "bypass" },
      undefined,
      undefined,
      harness.ctx,
    ));
    assert.deepEqual(queried.data.preview, [{ name: "Linus" }]);

    const profile = parsed(await write.execute(
      "profile",
      { command: "profile.add", name: "company-write", target: data.database, read_only: false },
      undefined,
      undefined,
      harness.ctx,
    ));
    assert.equal(profile.data.read_only, false);
    assert.match(harness.confirmations.at(-1)?.message ?? "", /Requested profile policy: read-write/);

    const updatedProfile = parsed(await write.execute(
      "profile-update",
      { command: "profile.update", name: "company-write", read_only: true },
      undefined,
      undefined,
      harness.ctx,
    ));
    assert.equal(updatedProfile.data.read_only, true);
    assert.match(harness.confirmations.at(-1)?.message ?? "", /Stored profile policy: read-write/);
    assert.match(harness.confirmations.at(-1)?.message ?? "", /Requested profile policy: read-only/);

    await write.execute(
      "profile-restore",
      { command: "profile.update", name: "company-write", read_only: false },
      undefined,
      undefined,
      harness.ctx,
    );

    await writeCommand.handler("read", harness.ctx);
    assert.ok(!harness.state.activeTools.includes("neko_stateql_write"));
    const readOnlyReconnect = parsed(await read.execute(
      "read-profile",
      { command: "connect", profile: "company-write" },
      undefined,
      undefined,
      harness.ctx,
    ));
    assert.equal(readOnlyReconnect.data.read_only, true);

    assert.ok(!harness.state.activeTools.includes("neko_stateql_write"));
    assert.equal(harness.statuses.has("neko-stateql-writes"), false);
    await assert.rejects(
      write.execute("locked-again", { command: "exec", sql: "DELETE FROM users WHERE id = ?", params: [1] }, undefined, undefined, harness.ctx),
      /in read mode/,
    );
  } finally {
    await harness.emit("session_shutdown", { reason: "quit" });
    if (previousHome === undefined) delete process.env.PI_NEKO_STATEQL_HOME;
    else process.env.PI_NEKO_STATEQL_HOME = previousHome;
    rmSync(data.root, { recursive: true, force: true });
  }
});

test("requires independent unbounded and destructive confirmations", async () => {
  const data = fixture();
  const previousHome = process.env.PI_NEKO_STATEQL_HOME;
  process.env.PI_NEKO_STATEQL_HOME = data.home;
  const { harness, write, writeCommand } = setup("override-session");
  try {
    await harness.emit("session_start", { reason: "startup" });
    await writeCommand.handler("write", harness.ctx);
    await write.execute("connect", { command: "connect", target: data.database }, undefined, undefined, harness.ctx);
    const before = harness.confirmations.length;

    const planned = parsed(await write.execute(
      "plan",
      {
        command: "plan",
        sql: "DELETE FROM users",
        allow_unbounded: true,
        allow_destructive: true,
      },
      undefined,
      undefined,
      harness.ctx,
    ));
    assert.equal(planned.ok, true);
    assert.equal(harness.confirmations.length - before, 3);
    assert.match(harness.confirmations.at(-2)?.title ?? "", /unbounded/);
    assert.match(harness.confirmations.at(-1)?.title ?? "", /destructive/);
  } finally {
    await harness.emit("session_shutdown", { reason: "quit" });
    if (previousHome === undefined) delete process.env.PI_NEKO_STATEQL_HOME;
    else process.env.PI_NEKO_STATEQL_HOME = previousHome;
    rmSync(data.root, { recursive: true, force: true });
  }
});

test("locks writes and warns when StateQL reports OUTCOME_UNKNOWN", async () => {
  const runtimeFactory: NonNullable<Parameters<typeof nekoStateQL>[1]> = (sessionId) => ({
    sessionId,
    async close() {},
    async execute(command) {
      assert.equal(command.command, "exec");
      return {
        ok: false as const,
        command_id: "cmd_unknown",
        session_id: "stateql-session",
        error: {
          code: "OUTCOME_UNKNOWN",
          message: "Write outcome could not be proven.",
          retryable: false,
          executed: true,
        },
        meta: { duration_ms: 1 },
      };
    },
  });
  const { harness, write, writeCommand } = setup("unknown-session", runtimeFactory);
  await harness.emit("session_start", { reason: "startup" });
  await writeCommand.handler("write", harness.ctx);

  const result = parsed(await write.execute(
    "unknown",
    { command: "exec", sql: "UPDATE jobs SET claimed = 1 WHERE id = ?", params: [42] },
    undefined,
    undefined,
    harness.ctx,
  ));
  assert.equal(result.error.code, "OUTCOME_UNKNOWN");
  assert.ok(!harness.state.activeTools.includes("neko_stateql_write"));
  assert.match(harness.statuses.get("neko-stateql-outcome") ?? "", /outcome unknown/);
  assert.match(harness.notifications.at(-1)?.message ?? "", /Read mode restored/);
  await assert.rejects(
    write.execute("blocked", { command: "exec", sql: "UPDATE jobs SET claimed = 1 WHERE id = ?", params: [43] }, undefined, undefined, harness.ctx),
    /in read mode/,
  );
});

test("reviews and commits a durable transaction after runtime restart", async () => {
  const data = fixture();
  const previousHome = process.env.PI_NEKO_STATEQL_HOME;
  process.env.PI_NEKO_STATEQL_HOME = data.home;
  const first = setup("transaction-session");
  try {
    await first.harness.emit("session_start", { reason: "startup" });
    await first.writeCommand.handler("write", first.harness.ctx);
    await first.write.execute("connect", { command: "connect", target: data.database }, undefined, undefined, first.harness.ctx);
    await first.write.execute("begin", { command: "transaction.begin" }, undefined, undefined, first.harness.ctx);
    await first.write.execute(
      "stage",
      { command: "exec", sql: "UPDATE users SET status = ? WHERE id = ?", params: ["reviewed", 1] },
      undefined,
      undefined,
      first.harness.ctx,
    );
    await first.harness.emit("session_shutdown", { reason: "quit" });

    const resumed = setup("transaction-session");
    await resumed.harness.emit("session_start", { reason: "resume" });
    await resumed.writeCommand.handler("write", resumed.harness.ctx);
    const committed = parsed(await resumed.write.execute(
      "commit",
      { command: "transaction.commit" },
      undefined,
      undefined,
      resumed.harness.ctx,
    ));
    assert.equal(committed.ok, true);
    assert.match(resumed.harness.confirmations.at(-1)?.message ?? "", /Transaction: tx_/);
    assert.match(resumed.harness.confirmations.at(-1)?.message ?? "", /Pending writes: 1/);

    const queried = parsed(await resumed.read.execute(
      "verify",
      { command: "query", sql: "SELECT status FROM users WHERE id = ?", params: [1], cache: "bypass" },
      undefined,
      undefined,
      resumed.harness.ctx,
    ));
    assert.deepEqual(queried.data.preview, [{ status: "reviewed" }]);
    await resumed.harness.emit("session_shutdown", { reason: "quit" });
  } finally {
    await first.harness.emit("session_shutdown", { reason: "quit" });
    if (previousHome === undefined) delete process.env.PI_NEKO_STATEQL_HOME;
    else process.env.PI_NEKO_STATEQL_HOME = previousHome;
    rmSync(data.root, { recursive: true, force: true });
  }
});

test("declined and headless write-mode requests fail closed", async () => {
  const declined = setup("declined-session");
  await declined.harness.emit("session_start", { reason: "startup" });
  declined.harness.state.confirmationResults.push(false);
  await assert.rejects(
    declined.writeCommand.handler("write", declined.harness.ctx),
    /declined; nothing was executed/,
  );
  assert.ok(!declined.harness.state.activeTools.includes("neko_stateql_write"));

  const headless = setup("headless-session");
  await headless.harness.emit("session_start", { reason: "startup" });
  (headless.harness.ctx as any).hasUI = false;
  await assert.rejects(
    headless.writeCommand.handler("write", headless.harness.ctx),
    /requires interactive confirmation/,
  );
  assert.ok(!headless.harness.state.activeTools.includes("neko_stateql_write"));

  const reset = setup("reset-session");
  await reset.harness.emit("session_start", { reason: "startup" });
  await reset.writeCommand.handler("write", reset.harness.ctx);
  assert.ok(reset.harness.state.activeTools.includes("neko_stateql_write"));
  await reset.harness.emit("session_start", { reason: "resume" });
  assert.ok(!reset.harness.state.activeTools.includes("neko_stateql_write"));
  await assert.rejects(
    reset.write.execute("reset-lock", { command: "transaction.begin" }, undefined, undefined, reset.harness.ctx),
    /in read mode/,
  );
});
