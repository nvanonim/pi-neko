---
name: neko-stateql
description: Use StateQL by FadhilP through pi-neko for safe stateful access to SQLite, PostgreSQL, MySQL, MongoDB, and Redis, with read mode by default and explicitly enabled writes.
---

# Neko StateQL

Use `neko_stateql` for database reads. Use `neko_stateql_write` only after the user explicitly requests a database change and enables write mode with `/neko-stateql write`.

This integration is built on [@fadhilp/stateql](https://github.com/FadhilP/stateql), created and maintained by [FadhilP](https://github.com/FadhilP).

## Credentials and data exposure

- Never ask the user to paste credentials into chat or tool arguments.
- For remote databases, pass an environment variable name through `secret_env`. The variable must contain the complete database URL.
- Prefer database accounts whose server-side permissions are read-only for inspection work.
- Treat SQL, parameters, returned rows, and durable StateQL results as sensitive. They may enter Pi session history and be sent to the selected model provider.
- Select only needed columns. Avoid secrets, tokens, password hashes, personal data, and large payloads unless the user explicitly needs them.

Example connection input:

```json
{
  "command": "connect",
  "secret_env": "COMPANY_DATABASE_URL"
}
```

The read tool forces the connection to read-only. Never provide the environment variable's value.

StateQL profiles can persist a friendly database name, environment-variable name, and access policy without storing the URL credential. For example, save `company-sit` with `COMPANY_SIT_DATABASE_URL` and `company-uat` with `COMPANY_UAT_DATABASE_URL`, then connect later with `{ "command": "connect", "profile": "company-sit" }`. Creating or changing a profile mutates durable local configuration, so it uses the confirmed write tool. Keep saved company profiles read-only unless the user explicitly needs a reusable write profile.

## Read workflow

1. Connect through a profile, `secret_env`, or a credential-free SQLite path.
2. Inspect status or catalog objects before guessing schema names.
3. Parameterize values instead of interpolating them into SQL.
4. Add a stable `ORDER BY` when paging or comparing results.
5. Apply a database-side `LIMIT` whenever the task does not require the full result.
6. Reuse returned handles with `rows`, `filter`, `count`, or `columns` instead of rerunning the query.
7. Request narrow pages. Query previews and tool output are intentionally bounded.
8. Treat TTL-based cache hits from remote databases as non-authoritative. Use `cache: "bypass"` when freshness matters.

SQL example:

```json
{
  "command": "query",
  "sql": "SELECT id, name FROM users WHERE status = ? ORDER BY id LIMIT 50",
  "params": ["active"],
  "cache": "bypass"
}
```

Use `mongo.query` only with MongoDB read operations such as `find` and `aggregate`. Use `redis.query` only for Redis read commands. StateQL performs the final database-specific classification.

## Write workflow

Every Pi session starts in read mode. Do not ask the agent to work around the write lock, and never invoke `stql`, database CLIs, or database drivers through shell to bypass it. The lock governs Neko StateQL tools; it is defense-in-depth, not a process sandbox. Server-side database permissions remain authoritative. When the user explicitly requests a change:

1. Ask the user to run `/neko-stateql write` if write mode is not enabled.
2. Connect through `neko_stateql_write` when a read-write connection is required.
3. Prefer `plan` followed by a reviewed `apply` for consequential changes.
4. Include an `idempotency_key` when a write may be retried.
5. Keep mutations bounded by primary keys or similarly precise predicates.
6. Use `allow_unbounded` or `allow_destructive` only when required by the intended operation. Each override receives independent confirmation.
7. Review the returned receipt or operation handle after execution.
8. Encourage `/neko-stateql read` when write work is complete.

Every write receives interactive confirmation even in write mode. Never reinterpret write mode as approval for a specific operation.

If StateQL returns `OUTCOME_UNKNOWN`, stop. The extension immediately returns to read mode. Do not retry, do not add replay flags, and do not assume rollback. Inspect authoritative database state and ask the user for direction before the user explicitly enables write mode again.

## Durable state

Neko StateQL stores its machine-local state under `~/.pi/agent/state/neko-stateql/` by default. `PI_CODING_AGENT_DIR` changes the agent directory, and `PI_NEKO_STATEQL_HOME` can override the StateQL directory explicitly. This state may contain materialized database rows and history. Never commit, sync, or publish it without treating it as database data.

Handles are opaque strings. Pass them back unchanged; do not infer ordering or meaning from their format.
