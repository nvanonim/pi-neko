# pi-neko

Personal [pi](https://pi.dev) agent package repo.

This repo bundles my pi extensions so they can be installed on other machines with `pi install`.

## Included extensions

- `minimal-textchat-footer` — replaces the default footer with a compact text footer.
  - Command: `/textchat-footer on|off|toggle`
- `model-thinking-defaults` — automatically sets preferred thinking levels for selected models.
- `default-caveman-mode` — injects ultra-compressed caveman instructions every turn to reduce output tokens.
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

## Repo layout

```text
.
├── package.json          # pi package manifest
├── extensions/           # extension entrypoints loaded by pi
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
