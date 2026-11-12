# Included extensions

[Back to README](../README.md)

Only entrypoints listed in [`package.json`](../package.json) load by default. External packages are described in [optional packages](optional-packages.md).

## Compact footer

`minimal-textchat-footer` replaces Pi's footer with compact text.

- Dirty markers beside the branch: `+N` staged, `*N` unstaged, `?N` untracked. Files with both index and worktree changes count in both totals.
- Billing shows provider-reported `$cost` for API-key models and `subs` for OAuth/subscription models.
- `/textchat-footer on|off|toggle` controls the footer.
- `/git-changes show|hide|toggle` controls the changed-files widget.
- `alt+g` or `f2` toggles that widget (`option+g` on macOS if the terminal sends Option as Meta).

## Model thinking defaults

`model-thinking-defaults` enforces preferred thinking levels for selected models, including the model restored at session startup. Startup changes are silent; interactive model changes notify when the level changes.

## Prompt-scoped change review

`pi-change-review` saves before/after snapshots for Pi `edit` and `write` calls, then opens native diffs in VS Code, Zed, Codium, or a custom editor.

```text
/review open|list|status|report|clear [latest|id|all]
```

`/pi-review` remains an alias. Snapshots live under `~/.pi/agent/change-reviews/`, scoped to the current Pi session. No project files, commits, or stashes are created.

Automatic editor priority is VS Code (`code`), Zed (`zed`), Codium (`codium`), then the Markdown report. Editor CLIs must be in `PATH`. On macOS, install VS Code's CLI through the Command Palette: `Shell Command: Install 'code' command in PATH`.

Override selection in `~/.pi/agent/change-review.json` or trusted `.pi/change-review.json`:

```json
{ "editor": "custom", "command": "my-editor", "args": ["--diff", "{before}", "{after}"] }
```

Bash-only changes are detected through Git status but marked ambiguous. Exact attribution is for Pi `edit` and `write` calls.

## Markdown code preview

`markdown-code-preview` renders code blocks without visible triple-backtick fences. A subtle blue/cyan background replaces border glyphs, so mouse selection does not copy `│` characters.

- `/markdown-code-preview` checks and enables the patch.
- Code headers show `copy: /copy-code <id>`; run that command to copy raw code.
- Linux clipboard support uses `wl-copy`, `xclip`, or `xsel`. Wayland users can install `wl-clipboard` when OSC52 is unsupported (`sudo apt install wl-clipboard` on Ubuntu/Zorin).

This extension patches Pi's internal Markdown renderer; Pi upgrades may require updates.

## Todo widget

`agent-todo-widget` gives the agent a `manage_todo_list` tool and shows plan progress above the editor.

```text
/todos show|hide|toggle|clear|status
```

## User questions

`ask-user` gives the agent an `ask_user` question box for material, non-discoverable decisions. It supports 1–3 questions, multiple-choice selection, optional multi-select, custom answers, review, and cancellation.

Direct use is TUI-only. Child Pi processes, including `pi-fork` JSON workers, inherit a private local relay and show questions in the parent TUI. Standalone print, JSON, and RPC calls reject rather than invent an answer. Concurrent child questions are queued so one parent dialog owns terminal input at a time.

Use it after repository exploration for decisions that materially change the work, not for permission questions or facts the agent can discover.

## Database access

`neko-stateql` provides `neko_stateql` reads and `neko_stateql_write` for individually confirmed writes, profile changes, and bounded atomic SQL batches. Every session starts in read mode.

```text
/neko-stateql status|read|write
```

It uses the packaged Rust CLI from `@fadhilp/stateql@1.1.0`, maintained by [FadhilP](https://github.com/FadhilP); no global `stql` installation is required. See the [StateQL guide](stateql.md) for credentials, data exposure, safety controls, and migration.

## Retained but disabled: Caveman

`extensions/default-caveman-mode.ts` is not listed in the enabled manifest. Its source and tests remain for rollback, but `/caveman-default` is unavailable while disabled. Installing or updating pi-neko does not enable it automatically.

It loads `~/.agents/skills/caveman/SKILL.md` before `~/.pi/agent/skills/caveman/SKILL.md`, injects the full source when its marker is missing from active context, and applies a small reminder each turn. When enabled, its command is `/caveman-default on|off|lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra|status`.

See [Ponytail setup and Caveman rollback](optional-packages.md#ponytail-instead-of-caveman) before changing the active workflow.
