---
name: neko-stateql
description: Use StateQL by FadhilP through pi-neko for safe stateful access to SQLite, PostgreSQL, MySQL, MongoDB, and Redis, with read mode by default and explicitly enabled writes.
---

# Neko StateQL

Use `neko_stateql` for database reads. Use `neko_stateql_write` only after the user explicitly requests a database change and enables write mode with `/neko-stateql write`. `/neko-stateql read` disables writes, and `/neko-stateql status` reports the mode.

This integration uses the Rust CLI in [@fadhilp/stateql 1.1.0](https://github.com/FadhilP/stateql/releases/tag/v1.1.0), created and maintained by [FadhilP](https://github.com/FadhilP). The [official skill](https://github.com/FadhilP/stateql/blob/v1.1.0/skills/stateql/SKILL.md) and its references describe upstream behavior. This skill adapts that guidance to Neko's guarded tools; do not load upstream shell examples as permission to bypass them.

## Credentials and data exposure

- Never ask the user to paste credentials into chat or tool arguments, and never echo a credential environment variable.
- Prefer a saved profile, including an existing OS-keyring-backed profile. StateQL reads its password internally; Neko tools accept the profile name, not the password.
- Environment-backed profiles remain supported. Pass only an environment variable name through `secret_env`; the variable must contain the complete database URL.
- Native password setup is a user-only operation in a separate terminal. The user can run the packaged CLI's `profile add ... --ask-password` command with the v1 `STQL_HOME`. The model-facing tools do not expose password dialogs. Do not run that command for the user or capture its dialog output.
- The OS keyring reduces accidental exposure, but it is not a sandbox against processes running as the same OS user. Server-side database permissions remain authoritative. Prefer a database-side read-only account for inspection work.
- Keyring accounts are shared across StateQL homes by profile name. Adding, replacing, or removing a profile can affect a same-named saved password in another installation; read the profile mutation confirmation carefully.
- For existing env-file profiles, set their environment variable before starting Pi. Neko refuses connections whose endpoint would otherwise require reading the env file.
- Review TLS settings before connecting to company databases. The CLI's TLS behavior differs from the old TypeScript runtime; never silently replace verified TLS with plaintext or a mode that does not verify the server identity.
- Treat SQL, parameters, returned rows, and durable results as sensitive. They may enter Pi history and be sent to the selected model provider. Select only the columns needed for the task.

Connect by saved name:

```json
{
  "command": "connect",
  "profile": "ab-sit"
}
```

The read tool forces read-only access even when the profile was saved read-write. Saving or replacing a profile changes local configuration and therefore uses the confirmed write tool. Keep company profiles read-only by default.

## Read workflow

1. Connect through a profile, `secret_env`, or a credential-free SQLite path.
2. List catalog objects with `objects.list`; inspect one with `object.describe` and its `name`.
3. Bind values through a positional `params` array. PostgreSQL uses `$1`, `$2`, and so on; SQLite and MySQL use `?`. Named parameter objects are unsupported.
4. Use a stable `ORDER BY` when paging or comparing results. Add a database-side `LIMIT` when a complete result is not needed.
5. Reuse the returned handle with `rows`, `filter`, or `summarize`. Do not rerun a query just to see more rows.
6. Use `rows` with `limit: 0` for metadata, or `columns` to project a smaller page. Use `summarize` for column statistics.
7. Read `next_offset` or `next_cursor` and pass it back unchanged. These are not interchangeable.
8. StateQL 1.1.0 has no query cache. A new query is a new database read; a stored handle is a snapshot, not live data.

PostgreSQL example:

```json
{
  "command": "query",
  "sql": "SELECT id, name FROM users WHERE status = $1 ORDER BY id LIMIT 50",
  "params": ["active"]
}
```

Responses are native, flat JSON. `columns` gives the field order, and each entry in `rows` is an array in that order:

```json
{"ok":true,"handle":"r_example","total":2,"columns":["id","name"],"types":["integer","text"],"rows":[[1,"Ada"],[2,"Grace"]]}
```

Query previews default to 10 rows and accept at most 50. The adapter caps stored query results at 10,000 rows and asks StateQL for at most 38,000 output bytes. The final tool response is also bounded. Request narrower queries or pages instead of truncating JSON with shell tools.

`filter` uses SQLite predicates and `?` placeholders over stored rows, regardless of the source database. Use typed JSON numbers in `params`; PostgreSQL `numeric` and MySQL `DECIMAL` may be exact strings, so cast explicitly when numeric comparison is intended.

Use `mongo.query` with a StateQL MongoDB read-command object, and `redis.query` with a Redis command/argument object. Their matching write commands are `mongo.exec` and `redis.exec`. StateQL remains responsible for database-specific classification and restrictions.

## Write workflow

Every Pi session starts in read mode. Never invoke `stql`, database CLIs, or database drivers through shell to bypass Neko's write lock or confirmations. This lock governs Neko's tools only; it is defense-in-depth, not a process sandbox.

When the user explicitly requests a change:

1. Ask the user to run `/neko-stateql write` if write mode is disabled.
2. Connect through `neko_stateql_write` when read-write access is required.
3. Review the complete intended change before execution. `plan`, `apply`, and staged transaction commands no longer exist.
4. Use a precise selector and `expect_rows` when the affected row count is known. For supported SQL writes, a mismatch rolls the write back. MongoDB pre-count checks are not transactional; Redis does not support this check.
5. Include an `idempotency_key` when an individual write may be retried.
6. Request destructive/unbounded overrides only for the intended operation. Each required approval is independent; it is not a workaround for an error.
7. Inspect `affected_rows`, status, and the returned write handle. Use `receipt` for the write record.
8. Encourage `/neko-stateql read` when write work is complete.

For multiple SQL writes that must succeed together, use `atomic` with a `statements` array of at most 20 SQL write objects. Each statement accepts `sql`, positional `params`, `expect_rows`, `idempotency_key`, `allow_unbounded`, and `allow_destructive`. The batch can set `isolation` to `read-committed`, `repeatable-read`, or `serializable` where supported. Review the entire batch and obtain independent per-statement override approvals before execution.

Atomic writes use one CLI `pipe --atomic` transaction, not a transaction held open across tool calls. MongoDB/Redis atomic batches and MySQL DDL are unsupported. MySQL nontransactional tables cannot provide rollback guarantees. Pending statement receipts are not proof of commit; require the final committed response. Do not blindly retry a batch.

Every write still requires interactive confirmation in write mode. If StateQL returns `OUTCOME_UNKNOWN`, stop: the extension returns to read mode. Do not retry, add replay flags, or assume rollback. Inspect authoritative database state and ask the user for direction before write mode is enabled again.

## Profiles and migration

The default v1 home is `~/.pi/agent/state/neko-stateql-v1/`. `PI_CODING_AGENT_DIR` changes the agent directory; `PI_NEKO_STATEQL_HOME` explicitly overrides the StateQL directory. The adapter sets `STQL_HOME` and a stable `STQL_SESSION` for each child process without changing the parent environment.

The old `~/.pi/agent/state/neko-stateql/` remains untouched for rollback. Do not point the new CLI at that live legacy home. The adapter refuses homes containing `state.sqlite` to prevent implicit migration. Back up old state consistently before any separate copied-state import; do not copy a live SQLite database file without its committed WAL state.

To preserve an environment-backed `ab-sit` profile, recreate only its metadata in the v1 home using the confirmed write tool:

```json
{
  "command": "profile.add",
  "name": "ab-sit",
  "secret_env": "AB_DB_SIT",
  "read_only": true
}
```

The password/URL remains in `AB_DB_SIT`, not the profile. Use `profile.replace` only after reviewing an existing profile and supplying its complete replacement source and policy. Later, the user may convert the same name to a Keychain-backed profile through the packaged CLI. Do not read or copy the credential value during migration.

Old result handles, plans, history, receipts, and pending transactions are not automatically migrated. Never replay pending writes. Tell the user about migration `notice` fields. Treat both state directories as database data: do not commit, publish, or sync them casually. Handles are opaque and session-scoped; pass them back unchanged.
