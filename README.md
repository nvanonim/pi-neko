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
- `agent-todo-widget` — gives the agent a `manage_todo_list` tool and shows plan progress above the editor.
  - Command: `/todos show|hide|toggle|clear|status`
- `default-caveman-mode` — loads the installed `caveman` skill and applies it every turn, defaulting to ultra.
  - Reads `~/.agents/skills/caveman/SKILL.md` first, then `~/.pi/agent/skills/caveman/SKILL.md`.
  - Command: `/caveman-default on|off|lite|full|ultra|status`

## Install on another PC

After pushing this repo to GitHub or another git host:

```bash
pi install git:github.com/YOUR_USER/pi-neko
# or pin a branch/tag/commit
pi install git:github.com/YOUR_USER/pi-neko@main
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

# Browser automation for frontend QA, screenshots, interaction, and authenticated pages
npm install -g agent-browser@0.29.1
pi install npm:pi-agent-browser-native
```

After installing optional packages, restart Pi or run `/reload`.

- `pi-web-access` — adds web access utilities and research skills.
- `pi-agent-browser-native` — adds the `agent_browser` tool for real browser sessions. Requires the separate `agent-browser` CLI on `PATH`.

## Repo layout

```text
.
├── package.json          # pi package manifest
├── extensions/           # extension entrypoints loaded by pi
│   ├── agent-todo-widget.ts
│   ├── default-caveman-mode.ts
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
