# pi-neko

Personal [pi](https://pi.dev) agent package repo.

This repo bundles my pi extensions so they can be installed on other machines with `pi install`.

## Included extensions

- `minimal-textchat-footer` — replaces the default footer with a compact text footer.
  - Dirty markers beside the branch: `+N` staged, `*N` unstaged, `?N` untracked.
  - Command: `/textchat-footer on|off|toggle`
  - Changed files widget: `/git-changes show|hide|toggle`
  - Shortcut: `alt+g` or `f2` toggles changed-files widget (`option+g` on macOS if terminal sends Option as Meta)
- `model-thinking-defaults` — automatically sets preferred thinking levels for selected models.
- `markdown-code-preview` — renders markdown code blocks as preview-style blocks instead of visible triple-backtick fences.
  - Command: `/markdown-code-preview` checks/enables the patch.
  - Code block headers show `copy: /copy-code <id>`; run that command to copy raw code.
  - Preview uses a subtle blue/cyan-tinted code-line background instead of left/right border glyphs, so mouse selection does not copy `│` characters.
  - Note: patches Pi's internal Markdown renderer, so Pi upgrades may require updates.
- `agent-todo-widget` — gives the agent a `manage_todo_list` tool and shows plan progress above the editor.
  - Command: `/todos show|hide|toggle|clear|status`
- `default-caveman-mode` — loads the installed `caveman` skill once, then applies a tiny reminder every turn, defaulting to ultra.
  - Reads `~/.agents/skills/caveman/SKILL.md` first, then `~/.pi/agent/skills/caveman/SKILL.md`.
  - Reinjects full skill source only when its hidden marker is missing (for example after compaction/branching or skill updates).
  - Command: `/caveman-default on|off|lite|full|ultra|status`

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

## Repo layout

```text
.
├── package.json          # pi package manifest
├── extensions/           # extension entrypoints loaded by pi
│   ├── agent-todo-widget.ts
│   ├── default-caveman-mode.ts
│   ├── markdown-code-preview.ts
│   ├── minimal-textchat-footer.ts
│   └── model-thinking-defaults.ts
└── README.md
```

## Adding more pi resources

Put future resources in conventional directories and add them to `package.json` if needed:

- `extensions/` for `.ts` / `.js` pi extensions
- `skills/` for skill folders containing `SKILL.md`
- `prompts/` for prompt templates
- `themes/` for theme `.json` files
