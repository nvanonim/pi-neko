# Optional packages

[Back to README](../README.md)

These packages are not bundled by pi-neko. Pi packages do not offer an optional-dependency install prompt, and bundling them would force-load third-party extensions for every install. Review sources and install only what you need; none are installed automatically.

## Ponytail instead of Caveman

Use the official [Ponytail](https://github.com/DietrichGebert/ponytail) package by [Dietrich Gebert](https://github.com/DietrichGebert). It already provides a native Pi extension and six skills; no pi-neko wrapper or copied upstream code is needed. Install it separately on each machine:

```bash
pi install npm:@dietrichgebert/ponytail@5.2.0
```

Start a fresh Pi session after installing. Use `/ponytail status`, `/ponytail full`, or `/ponytail off`; `/ponytail default full` saves the default for future sessions. The pinned version will not advance automatically. Review updates before deliberately changing the pin.

The pi-neko manifest explicitly lists enabled extensions. `extensions/default-caveman-mode.ts` is disabled; its source and tests remain available for rollback. `/caveman-default` is unavailable while disabled. Installing or updating pi-neko does not enable it automatically.

For a Ponytail-only setup, also disable separately installed `caveman`, `caveman-commit`, `caveman-review`, `caveman-compress`, `caveman-help`, `caveman-stats`, and `cavecrew` skills through `pi config`. These personal resources are outside this repository and are not disabled by its manifest. Keep them installed for a reversible trial. Resource exclusions are stored in personal settings and must be repeated on other machines.

### Roll back to Caveman

1. Remove Ponytail with `pi remove npm:@dietrichgebert/ponytail@5.2.0`.
2. Restore `./extensions/default-caveman-mode.ts` to `pi.extensions` in [`package.json`](../package.json).
3. Re-enable the desired personal skills through `pi config`.
4. Start a fresh session so previously loaded instructions do not linger.

## Web, delegation, and browser tools

```bash
# Web/search/fetch tools and librarian skill
pi install npm:pi-web-access

# Child Pi agents for investigation/review outside the main context
pi install git:github.com/elpapi42/pi-fork

# Browser automation for frontend QA and authenticated pages
npm install -g agent-browser@0.29.1
pi install npm:pi-agent-browser-native
```

After installing, restart Pi or run `/reload`.

- `pi-web-access` adds web access utilities and research skills.
- `pi-fork` delegates noisy exploration, review, debugging, and planning to child agents while keeping the main session cleaner. It is useful for MVP or larger-feature work.
- `pi-agent-browser-native` adds the `agent_browser` tool for real browser sessions. The separate `agent-browser` CLI must be in `PATH`.

## Lantern code discovery

Use the official `lantern` skill globally with its separately installed CLI; pi-neko does not bundle either or maintain a duplicate skill. See the [Lantern guide](lantern.md#install-cli-and-official-skill) for installation and `/skill:lantern` usage, plus work-project suitability and indexing limitations.

## Pi Guard and Pi Verify

[Pi Guard](https://github.com/FadhilP/pi-conductor/tree/v0.10.2/pi-guard), maintained by [FadhilP](https://github.com/FadhilP), adds confirmation gates for known destructive shell operations and protects sensitive workspace paths used by Pi's `write` and `edit` tools. [Pi Verify](https://github.com/FadhilP/pi-conductor/tree/v0.10.2/pi-verify) runs bounded, detected project checks after code changes.

Both ship inside Pi Conductor. To avoid loading overlapping Conductor extensions, add this filtered, pinned entry to the `packages` array in `~/.pi/agent/settings.json` instead of installing the bundle unfiltered:

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

Restart Pi or run `/reload`. Use `/guard` to inspect Guard session counters. Agents call `verify({ scope: "changed" | "project", checks?: string[] })`; it runs `git diff --check` for dirty worktrees, then declared checks.

Maven projects with `pom.xml` use `./mvnw test` when a wrapper exists. This does not replace project-specific `./mvnw verify`, Sonar, or integration checks. Pi Guard is defense-in-depth, not a sandbox or complete shell parser. Review commands before approving them.
