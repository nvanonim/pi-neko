# Neko StateQL

[Back to README](../README.md)

Neko StateQL is an independent integration for [`@fadhilp/stateql@1.1.0`](https://github.com/FadhilP/stateql/releases/tag/v1.1.0), created and maintained by [FadhilP](https://github.com/FadhilP). It is not affiliated with or endorsed by the StateQL author. StateQL is distributed under the MIT License. The included `neko-stateql` skill adapts the [official StateQL skill](https://github.com/FadhilP/stateql/blob/v1.1.0/skills/stateql/SKILL.md) to Neko's guarded tools; the upstream shell-oriented skill is not automatically loaded.

The runtime invokes the dependency's packaged Rust executable directly, without a shell or global `stql` lookup. Query statements and positional parameters travel through JSONL stdin. State lives in `~/.pi/agent/state/neko-stateql-v1/` by default, separate from Pylon and the previous TypeScript integration. `PI_CODING_AGENT_DIR` changes the agent directory; `PI_NEKO_STATEQL_HOME` explicitly overrides the StateQL directory. The wrapper sets child-process `STQL_HOME` and `STQL_SESSION` internally, so a global `STQL_HOME` export is unnecessary.

## Profiles and credentials

Prefer saved profiles, including existing OS-keyring-backed profiles. The agent supplies only the profile name:

```json
{
  "command": "connect",
  "profile": "ab-sit"
}
```

The read tool explicitly forces read-only access, even for a saved read-write profile. Environment-backed profiles remain supported: `secret_env` contains the variable name, never its value. For example, `ab-sit` can reference `AB_DB_SIT`, while `ab-uat` references `AB_DB_UAT`. Those variables must be available to Pi when it starts. Never paste a password or credential URL into chat, tool arguments, or logs, and never echo a credential variable.

To store a password in the OS keyring instead, run the following **yourself in a separate terminal**, from the pi-neko checkout after installing its pinned dependencies. The URL below deliberately contains no password; replace only its nonsecret host/user/database details:

```bash
cd /absolute/path/to/pi-neko
STQL_HOME="$HOME/.pi/agent/state/neko-stateql-v1" \
  node ./node_modules/@fadhilp/stateql/bin/stql.js \
  profile add ab-sit 'postgresql://user@sit-host/database?sslmode=verify-full' \
  --ask-password
```

Use `--force` only when intentionally replacing an existing `ab-sit` profile. If you configured a different agent or StateQL home, use that exact v1 path instead. StateQL displays a masked native password dialog and stores the password in the OS keyring; on macOS this is Keychain. The model-facing tools do not expose password-dialog setup. Subsequent connections use the same profile name without supplying `AB_DB_SIT`. Remove obsolete credential exports yourself only after the new profile works; never print them for verification.

StateQL's keyring service is shared across state homes and indexed by profile name. Adding, replacing, or removing a same-named profile can affect another StateQL installation's saved password; Neko includes this warning in profile mutation confirmations. The versioned home isolates state files, not keyring accounts. Existing env-file profiles are supported only when their environment variable is already set, so Neko can review the endpoint without reading the file.

Keyring storage prevents routine password exposure in tool output, but it is not a security sandbox against processes running as your OS user. Use a database-side read-only account for normal company work. Review TLS settings when migrating: the Rust CLI's behavior differs from the TypeScript version, so do not silently downgrade verified company connections to plaintext or insufficient certificate verification.

SQL, parameters, returned rows, and stored results may enter Pi history and model-provider context. Treat the v1 state directory as database data; do not commit, publish, or casually synchronize it.

## Reads and writes

Queries bind values with a positional `params` array: PostgreSQL uses `$1`, `$2`, and so on; SQLite/MySQL use `?`. Named parameter objects are no longer supported. Results are flat JSON with a `handle`, `columns`, and `rows` arrays in column order, rather than the old `data.preview` envelope. Reuse handles with `rows`, `filter`, and `summarize`. Query previews default to 10 rows and accept at most 50; the adapter caps stored query results at 10,000 rows and requests at most 38,000 output bytes. Narrow queries/pages rather than cutting JSON output.

Writes require two levels of approval: `/neko-stateql write` enables the write tool for the current session, then each operation receives its own interactive confirmation. Use `expect_rows` when the affected row count is known and `idempotency_key` for retryable individual writes. Unbounded and destructive approvals remain independent. Return to `/neko-stateql read` when finished. `OUTCOME_UNKNOWN` immediately returns to read mode; never retry automatically or assume rollback.

The `atomic` command accepts at most 20 SQL write objects in `statements`, with optional supported `isolation`. Each statement can include positional `params`, `expect_rows`, `idempotency_key`, and destructive/unbounded flags. Review the entire batch and confirm per-statement overrides. The runtime executes one `pipe --atomic` transaction; there is no transaction left open across tool calls. Pending receipts are not proof of commit. MongoDB/Redis atomic batches and MySQL DDL are unsupported; MySQL nontransactional tables cannot guarantee rollback. MongoDB row-count checks are pre-counts, not transactional guarantees, and Redis does not support `expect_rows`.

This lock governs Neko's tools only. Pi's shell and other database clients retain your OS permissions; do not use them to bypass confirmations. Remote PostgreSQL/MySQL/MongoDB/Redis operation and keyring behavior need environment-specific validation; SQLite checks do not prove company database compatibility.

## Migrating from StateQL 0.18.0

The new CLI is not a drop-in TypeScript API replacement. `cache`, `plan`, `apply`, staged transaction commands, and named parameters are removed. Use explicit operation review, `expect_rows`, and bounded `atomic` SQL writes instead. `profile.replace` requires the complete replacement source and access policy, rather than a partial profile update.

Keep `~/.pi/agent/state/neko-stateql/` untouched for rollback. The new default is the separate `neko-stateql-v1` directory. The adapter refuses a home containing legacy `state.sqlite` rather than triggering an implicit migration. Do not point the new binary at the live legacy home. Any copied-state import must use a consistent backup that includes committed WAL state, not a lone copy of an active SQLite file.

The simplest move for an existing environment-backed `ab-sit` is to recreate only its metadata in the v1 home. After `/neko-stateql write`, ask the agent to perform this confirmed local profile operation:

```json
{
  "command": "profile.add",
  "name": "ab-sit",
  "secret_env": "AB_DB_SIT",
  "read_only": true
}
```

This preserves the friendly name and environment reference without reading or copying its secret, and deliberately stores a read-only default. Return to `/neko-stateql read`, then explicitly connect with `neko_stateql` and verify read-only access. After that works, optionally convert the same name to Keychain storage using the user-only command above. Do not replace an existing v1 profile without reviewing it first.

Old result handles, history, receipts, plans, and pending transactions are not automatically moved. Re-query when needed; never replay pending writes. Report any migration `notice` fields. To roll back, restore the old dependency/code and use the untouched legacy home; never run the old runtime against the v1 home.
