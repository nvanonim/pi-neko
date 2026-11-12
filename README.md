# pi-neko

Personal [pi](https://pi.dev) agent package repo.

This repo bundles my pi extensions so they can be installed on other machines with `pi install`.

## Included extensions

- `minimal-textchat-footer` — replaces the default footer with a compact text footer.
  - Dirty markers beside the branch: `+N` staged, `*N` unstaged, `?N` untracked. Files with both index and worktree changes count in both totals.
  - Billing segment shows provider-reported `$cost` for API-key models and `subs` for OAuth/subscription models.
  - Command: `/textchat-footer on|off|toggle`
  - Changed files widget: `/git-changes show|hide|toggle`
  - Shortcut: `alt+g` or `f2` toggles changed-files widget (`option+g` on macOS if terminal sends Option as Meta)
- `model-thinking-defaults` — enforces preferred thinking levels for selected models, including the model restored at session startup. Startup changes are silent; interactive model changes notify when the level changes.
- `pi-change-review` — saves prompt-scoped before/after snapshots for Pi `edit` and `write` calls, then opens native diffs in Zed, VS Code, Codium, or a custom editor.
  - Commands: `/review open|list|status|report|clear [latest|id|all]` (`/pi-review` remains an alias).
  - Storage: `~/.pi/agent/change-reviews/`, scoped to the current Pi session; no project files, commits, or stashes are created.
  - Editor selection prefers VS Code (`code`), then falls back to Zed (`zed`), Codium (`codium`), and finally the Markdown report when no editor is available. Each editor CLI must be in `PATH`. On macOS, install VS Code's `code` command through the Command Palette: `Shell Command: Install 'code' command in PATH`.
  - Or configure `~/.pi/agent/change-review.json` / trusted `.pi/change-review.json`:
    ```json
    { "editor": "custom", "command": "my-editor", "args": ["--diff", "{before}", "{after}"] }
    ```
  - Bash-only changes are detected through Git status but marked ambiguous; exact attribution is for Pi `edit` and `write` calls.
- `markdown-code-preview` — renders markdown code blocks as preview-style blocks instead of visible triple-backtick fences.
  - Command: `/markdown-code-preview` checks/enables the patch.
  - Code block headers show `copy: /copy-code <id>`; run that command to copy raw code.
  - Linux clipboard support uses `wl-copy`, `xclip`, or `xsel`; Wayland users can install `wl-clipboard` when OSC52 is unsupported (`sudo apt install wl-clipboard` on Ubuntu/Zorin).
  - Preview uses a subtle blue/cyan-tinted code-line background instead of left/right border glyphs, so mouse selection does not copy `│` characters.
  - Note: patches Pi's internal Markdown renderer, so Pi upgrades may require updates.
- `agent-todo-widget` — gives the agent a `manage_todo_list` tool and shows plan progress above the editor.
  - Command: `/todos show|hide|toggle|clear|status`
- `ask-user` — gives the agent an `ask_user` question box for material, non-discoverable decisions.
  - Supports 1–3 questions, multiple-choice selection, optional multi-select, custom answers, review, and cancellation.
  - Direct use is TUI-only. Child Pi processes (including `pi-fork` JSON workers) inherit a private local relay and show their questions in the parent TUI; standalone print, JSON, and RPC calls still reject rather than inventing an answer.
  - Concurrent child questions are queued so only one parent dialog owns terminal input at a time.
  - Use it after repository exploration for decisions that materially change work; do not use it for permission questions or facts the agent can discover.
- `neko-stateql` — provides namespaced, stateful database access through [StateQL](https://github.com/FadhilP/stateql), created and maintained by [FadhilP](https://github.com/FadhilP).
  - `neko_stateql` handles read-only connections, bounded SQL/MongoDB/Redis reads, catalog inspection, and durable result handles.
  - `neko_stateql_write` handles individually confirmed writes, profile changes, and bounded atomic SQL batches. Every Pi session starts in read mode.
  - Command: `/neko-stateql status|read|write`
  - Uses the packaged Rust CLI from `@fadhilp/stateql@1.1.0`; no global `stql` installation is required. Requires Node.js 22.19.0 or newer for Pi.

## Ponytail instead of Caveman

The package manifest explicitly lists enabled extensions. `extensions/default-caveman-mode.ts` is disabled by default; its source and tests remain available for rollback. `/caveman-default` is unavailable while the extension is disabled. Installing or updating pi-neko does not enable it automatically.

Use the official [Ponytail](https://github.com/DietrichGebert/ponytail) package by [Dietrich Gebert](https://github.com/DietrichGebert), which already provides a native Pi extension and six skills. No pi-neko wrapper or copied upstream code is needed. Install it separately on each machine:

```bash
pi install npm:@dietrichgebert/ponytail@5.2.0
```

Start a fresh Pi session after installing. Use `/ponytail status`, `/ponytail full`, or `/ponytail off`; `/ponytail default full` saves the default for future sessions. The pinned version will not advance automatically; review and deliberately change the pin when upgrading.

For a Ponytail-only setup, also disable separately installed `caveman`, `caveman-commit`, `caveman-review`, `caveman-compress`, `caveman-help`, `caveman-stats`, and `cavecrew` skills through `pi config`. These personal resources are outside this repository and are not disabled by its manifest. Keep them installed for a reversible trial. `pi config` records resource exclusions in personal settings; those exclusions must be repeated on other machines.

To roll back, remove Ponytail with `pi remove npm:@dietrichgebert/ponytail@5.2.0`, restore `./extensions/default-caveman-mode.ts` to `pi.extensions` in `package.json`, and re-enable the desired personal skills. Start a fresh session so previously loaded instructions do not linger.

## Neko StateQL

Neko StateQL is an independent integration for [`@fadhilp/stateql@1.1.0`](https://github.com/FadhilP/stateql/releases/tag/v1.1.0), created and maintained by [FadhilP](https://github.com/FadhilP). It is not affiliated with or endorsed by the StateQL author. StateQL is distributed under the MIT License. The included `neko-stateql` skill adapts the [official StateQL skill](https://github.com/FadhilP/stateql/blob/v1.1.0/skills/stateql/SKILL.md) to Neko's guarded tools; the upstream shell-oriented skill is not automatically loaded.

The runtime invokes the dependency's packaged Rust executable directly, without a shell or global `stql` lookup. Query statements and positional parameters travel through JSONL stdin. State lives in `~/.pi/agent/state/neko-stateql-v1/` by default, separate from Pylon and the previous TypeScript integration. `PI_CODING_AGENT_DIR` changes the agent directory; `PI_NEKO_STATEQL_HOME` explicitly overrides the StateQL directory. The wrapper sets child-process `STQL_HOME` and `STQL_SESSION` internally, so a global `STQL_HOME` export is unnecessary.

### Profiles and credentials

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

### Reads and writes

Queries bind values with a positional `params` array: PostgreSQL uses `$1`, `$2`, and so on; SQLite/MySQL use `?`. Named parameter objects are no longer supported. Results are flat JSON with a `handle`, `columns`, and `rows` arrays in column order, rather than the old `data.preview` envelope. Reuse handles with `rows`, `filter`, and `summarize`. Query previews default to 10 rows and accept at most 50; the adapter caps stored query results at 10,000 rows and requests at most 38,000 output bytes. Narrow queries/pages rather than cutting JSON output.

Writes require two levels of approval: `/neko-stateql write` enables the write tool for the current session, then each operation receives its own interactive confirmation. Use `expect_rows` when the affected row count is known and `idempotency_key` for retryable individual writes. Unbounded and destructive approvals remain independent. Return to `/neko-stateql read` when finished. `OUTCOME_UNKNOWN` immediately returns to read mode; never retry automatically or assume rollback.

The `atomic` command accepts at most 20 SQL write objects in `statements`, with optional supported `isolation`. Each statement can include positional `params`, `expect_rows`, `idempotency_key`, and destructive/unbounded flags. Review the entire batch and confirm per-statement overrides. The runtime executes one `pipe --atomic` transaction; there is no transaction left open across tool calls. Pending receipts are not proof of commit. MongoDB/Redis atomic batches and MySQL DDL are unsupported; MySQL nontransactional tables cannot guarantee rollback. MongoDB row-count checks are pre-counts, not transactional guarantees, and Redis does not support `expect_rows`.

This lock governs Neko's tools only. Pi's shell and other database clients retain your OS permissions; do not use them to bypass confirmations. Remote PostgreSQL/MySQL/MongoDB/Redis operation and keyring behavior need environment-specific validation; SQLite checks do not prove company database compatibility.

### Migrating from StateQL 0.18.0

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

## Install on another PC

After pushing this repo to GitHub or another git host:

```bash
pi install git:github.com/nvanonim/pi-neko
# or pin a branch/tag/commit
pi install git:github.com/nvanonim/pi-neko@main
```

For local testing from this checkout:

```bash
pi -e .
# or install locally
pi install /absolute/path/to/pi-neko
```

Then restart pi or run:

```text
/reload
```

## Recommended optional packages

These are not bundled by `pi-neko` because Pi packages do not have an "optional dependency" install prompt. Bundling them would force-load third-party extensions for every install. Install them separately when you want the extra tools:

```bash
# Web/search/fetch tools and librarian skill
pi install npm:pi-web-access

# Fork child Pi agents for noisy investigation/review without polluting main context
pi install git:github.com/elpapi42/pi-fork

# Browser automation for frontend QA, screenshots, interaction, and authenticated pages
npm install -g agent-browser@0.29.1
pi install npm:pi-agent-browser-native
```

After installing optional packages, restart Pi or run `/reload`.

- `pi-web-access` — adds web access utilities and research skills.
- `pi-fork` — delegates noisy exploration, review, debugging, and planning to child Pi agents while keeping the main session cleaner. Good for MVP or big-feature work.
- `pi-agent-browser-native` — adds the `agent_browser` tool for real browser sessions. Requires the separate `agent-browser` CLI on `PATH`.

### Lantern code discovery (optional)

The included `neko-lantern` skill provides original, on-demand guidance for [Lantern](https://github.com/FadhilP/lantern), maintained by [FadhilP](https://github.com/FadhilP). It does not bundle the executable or copy upstream code/skills. The existing `pi.skills` manifest makes the skill available in every session that loads pi-neko, across projects. Invoke `/skill:neko-lantern` explicitly when needed, or let the agent select it for code discovery.

Use it for unfamiliar/large codebases, definition bodies, file outlines, callers, and change-impact investigation. It is not compulsory for every task and does not index projects at startup. If `lantern` is missing, the agent falls back to `rg` and `read`.

Reviewed baseline: Lantern 0.4.1, available as the official [`@fadhilp/lantern`](https://www.npmjs.com/package/@fadhilp/lantern) npm package. Install the pinned CLI separately with Node.js 18+ (Pi's Node.js requirement already satisfies this):

```bash
npm install -g @fadhilp/lantern@0.4.1
lantern --version
```

The package includes prebuilt binaries for Linux (x64/arm64, glibc/musl), macOS (x64/arm64), and Windows (x64/arm64); Rust and C++ build tools are not needed on these platforms. The install script points the global command at the native binary; with install scripts disabled, a small Node.js launcher runs it instead. Ensure npm's global executable directory is on `PATH`, then restart Pi so it inherits any `PATH` changes. Installing pi-neko alone does not install the CLI. Reload Pi after adding the skill. The version is pinned; review updates before changing it.

Lantern stores indexed source content outside the repository. Review ignore rules and `.lanternignore` before indexing sensitive projects; results may enter Pi history/model context. Initial indexing can be costly. Normal queries refresh; use `--stale-ok` only between queries with no file changes. Name-based references/call graphs are discovery hints, not compiler-accurate analysis or a replacement for tests.

### Pi Guard and Pi Verify (optional)

[Pi Guard](https://github.com/FadhilP/pi-conductor/tree/v0.10.2/pi-guard), maintained by [FadhilP](https://github.com/FadhilP), adds confirmation gates for known destructive shell operations and protects sensitive workspace paths used by Pi's `write` and `edit` tools. [Pi Verify](https://github.com/FadhilP/pi-conductor/tree/v0.10.2/pi-verify) runs bounded, detected project checks after code changes.

Both ship inside Pi Conductor. To avoid loading Conductor extensions that overlap with `pi-neko`, add this filtered, pinned entry to the `packages` array in `~/.pi/agent/settings.json` instead of installing the bundle unfiltered:

```json
{
  "source": "git:github.com/FadhilP/pi-conductor@v0.10.2",
  "extensions": [
    "pi-guard/extensions/pi-guard.ts",
    "pi-verify/extensions/pi-verify.ts"
  ],
  "skills": [],
  "prompts": [],
  "themes": []
}
```

Restart Pi or run `/reload`. Use `/guard` to inspect Guard session counters. Agents call `verify({ scope: "changed" | "project", checks?: string[] })`; it runs `git diff --check` for dirty worktrees, then declared checks. Maven projects with `pom.xml` use `./mvnw test` when a wrapper exists; this does not replace project-specific `./mvnw verify`, Sonar, or integration checks. Pi Guard is defense-in-depth, not a sandbox or complete shell parser; review commands before approving them.

## Repo layout

```text
.
├── package.json          # pi package manifest and development scripts
├── package-lock.json     # pinned development toolchain
├── tsconfig.json         # strict extension/test typechecking
├── extensions/           # only manifest-listed entrypoints load by default
│   ├── agent-todo-widget.ts
│   ├── ask-user.ts
│   ├── default-caveman-mode.ts # disabled; retained for rollback
│   ├── markdown-code-preview.ts
│   ├── minimal-textchat-footer.ts
│   ├── model-thinking-defaults.ts
│   ├── neko-stateql.ts
│   └── pi-change-review.ts
├── lib/                  # shared extension runtime and state helpers
├── skills/
│   ├── neko-lantern/     # optional on-demand code discovery guidance
│   └── neko-stateql/     # StateQL workflow and safety guidance
├── test/                 # Node test suite and Pi API mocks
└── README.md
```

## Development

```bash
npm install
npm run check
```

`npm run check` runs strict TypeScript checking plus Node's native TypeScript test suite.

## Adding more pi resources

Put future resources in conventional directories and add them to `package.json` if needed:

- `extensions/` for `.ts` / `.js` pi extensions; add enabled entrypoints explicitly to `pi.extensions`
- `skills/` for skill folders containing `SKILL.md`
- `prompts/` for prompt templates
- `themes/` for theme `.json` files
