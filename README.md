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
  - Editor selection is automatic (`zed`, then `code`, then `codium`); each editor CLI must be in `PATH`. On macOS, expose Zed app CLI with `ln -s /Applications/Zed.app/Contents/MacOS/zed /opt/homebrew/bin/zed`.
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
  - `neko_stateql_write` handles confirmed plans, writes, profile changes, and transactions. Every Pi session starts in read mode.
  - Command: `/neko-stateql status|read|write`
  - Requires Node.js 22.19.0 or newer (Pi's minimum; StateQL itself requires 22.16).

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

Neko StateQL is an independent pi-neko integration for [`@fadhilp/stateql`](https://www.npmjs.com/package/@fadhilp/stateql). It is not affiliated with or endorsed by the StateQL author. StateQL is distributed under the MIT License.

Remote credentials must be supplied through environment variables, never chat or tool arguments. Set the complete database URL before starting Pi:

```bash
export COMPANY_DATABASE_URL='postgresql://user:password@host/database'
pi
```

The agent connects using only the variable name:

```json
{
  "command": "connect",
  "secret_env": "COMPANY_DATABASE_URL"
}
```

The read tool forces read-only mode. SQL, parameters, and returned rows may enter Pi history and be sent to the selected model provider. Use a database account with server-side read-only permissions for normal company work.

StateQL profiles save a friendly name, environment-variable name, and access policy without storing the credential URL. Configure environment values before starting Pi:

```bash
export COMPANY_SIT_DATABASE_URL='postgresql://user:password@sit-host/database'
export COMPANY_UAT_DATABASE_URL='postgresql://user:password@uat-host/database'
```

After `/neko-stateql write`, ask the agent to save read-only profiles such as `company-sit` using `COMPANY_SIT_DATABASE_URL` and `company-uat` using `COMPANY_UAT_DATABASE_URL`. Return to `/neko-stateql read`. Future sessions can connect using only `{ "command": "connect", "profile": "company-sit" }`. Profile configuration persists in the isolated Neko StateQL home; environment values must still be available when Pi starts.

Writes require two levels of approval: the user first runs `/neko-stateql write` for the current Pi session, then confirms each write operation. Unbounded and destructive overrides receive separate confirmations. New sessions start in read mode. An `OUTCOME_UNKNOWN` response immediately returns to read mode and must never be retried automatically.

This lock governs the Neko StateQL tools only; it is defense-in-depth, not a process sandbox. Pi's shell tool and external database clients run with the user's OS permissions. Do not use them to bypass the lock, and inject write-capable credentials only for intentional write work where practical. Server-side database permissions remain the authoritative boundary.

StateQL state is isolated from Pylon and other StateQL installations under `~/.pi/agent/state/neko-stateql/`. Set `PI_NEKO_STATEQL_HOME` to override it. Materialized rows and history may be stored there, so treat the directory as database data and do not sync or commit it.

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
