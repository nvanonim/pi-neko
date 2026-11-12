# pi-neko

Personal extensions and skills for [Pi](https://pi.dev), packaged for reuse across machines.

## Install

Requires Pi and Node.js **22.19.0 or newer**.

```bash
pi install git:github.com/nvanonim/pi-neko
# Or select a branch, tag, or commit:
pi install git:github.com/nvanonim/pi-neko@main
```

Restart Pi or run `/reload` after installing or updating.

For a local checkout:

```bash
pi -e .
# Or keep it installed:
pi install /absolute/path/to/pi-neko
```

## Included

| Extension | Purpose | Main commands |
|---|---|---|
| `minimal-textchat-footer` | Compact Git, model, context, and billing information | `/textchat-footer`, `/git-changes` |
| `model-thinking-defaults` | Preferred thinking levels for selected models | Automatic |
| `pi-change-review` | Prompt-scoped snapshots and native editor diffs; VS Code first | `/review`, `/pi-review` |
| `markdown-code-preview` | Cleaner code blocks and copy support | `/markdown-code-preview`, `/copy-code` |
| `agent-todo-widget` | Agent-managed todos and visible plan progress | `/todos` |
| `ask-user` | Interactive questions, including relayed child-agent questions | Agent tool: `ask_user` |
| `neko-stateql` | Read-only database access with explicitly enabled, confirmed writes | `/neko-stateql status\|read\|write` |

### Bundled skill

[`neko-stateql`](docs/stateql.md) installs automatically with pi-neko and teaches use of our guarded database tools. Its runtime is included; invoke `/skill:neko-stateql`.

### Optional Lantern discovery

Use Lantern's **official global skill**, not a pi-neko copy. Install the CLI and skill separately using the [Lantern setup guide](docs/lantern.md#install-cli-and-official-skill). Then invoke `/skill:lantern`. Neither is bundled with pi-neko.

`default-caveman-mode` source and tests remain for rollback but are **disabled by default**. Ponytail is an optional external package, not a bundled replacement.

## Guides

- [Extensions and commands](docs/extensions.md): footer, reviews, clipboard setup, todos, questions, and disabled Caveman behavior.
- [StateQL](docs/stateql.md): profiles, Keychain/environment credentials, write approvals, data exposure, and v1 migration.
- [Lantern](docs/lantern.md): installation, work-project suitability, confidentiality, and discovery limitations.
- [Optional packages](docs/optional-packages.md): pinned Ponytail setup and rollback, web/browser tools, delegation, Guard, and Verify.

**Company work:** database results and code returned by tools may enter Pi history and model-provider context. Review your organization's policy and each guide's storage and security notes before use.

## Credits

pi-neko builds on [Pi](https://pi.dev) and uses or recommends these independent projects. Credit belongs to their authors and contributors; each project retains its own license.

- [StateQL](https://github.com/FadhilP/stateql), [Lantern](https://github.com/FadhilP/lantern), and [Pi Guard / Pi Verify](https://github.com/FadhilP/pi-conductor/tree/v0.10.2) — [FadhilP](https://github.com/FadhilP).
- [Ponytail](https://github.com/DietrichGebert/ponytail) — [Dietrich Gebert](https://github.com/DietrichGebert).
- [pi-web-access](https://github.com/nicobailon/pi-web-access) — [Nico Bailon](https://github.com/nicobailon).
- [pi-fork](https://github.com/elpapi42/pi-fork) — [elpapi42](https://github.com/elpapi42).
- [pi-agent-browser-native](https://github.com/fitchmultz/pi-agent-browser-native) — [Mitch Fultz](https://github.com/fitchmultz).
- [agent-browser](https://github.com/vercel-labs/agent-browser) — [Vercel Labs](https://github.com/vercel-labs).
- [Caveman](https://github.com/JuliusBrussee/caveman) — [JuliusBrussee](https://github.com/JuliusBrussee); our optional integration is currently disabled.

StateQL is a bundled runtime dependency. The other projects above are optional external tools/packages or retained integration references, not bundled dependencies. See the [optional-package guide](docs/optional-packages.md) for setup.

## Development

```bash
npm install
npm run check
```

`check` runs strict TypeScript checking and Node's native TypeScript test suite.

Repository code lives in `extensions/`, shared helpers in `lib/`, skills in `skills/`, and tests in `test/`. Detailed user documentation lives in `docs/`.

Only entrypoints explicitly listed in `package.json` under `pi.extensions` load by default. Add new enabled extensions there. Skills use `skills/<name>/SKILL.md`; future prompt templates and themes belong in `prompts/` and `themes/`, with manifest entries added as needed.
