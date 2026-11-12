# Lantern code discovery

[Back to README](../README.md)

[Lantern](https://github.com/FadhilP/lantern), maintained by [FadhilP](https://github.com/FadhilP), is an optional, read-only code discovery CLI. Use its official `lantern` skill globally in Pi. There is no custom Lantern extension or duplicated Lantern skill in pi-neko; the CLI and upstream skill are installed separately.

## Does it fit work projects?

**Yes, as an optional navigation aid—not as an authority on correctness.** It is most useful when repeatedly exploring large/unfamiliar repositories, locating definitions and callers, or reviewing which definitions changed. For this small TypeScript extension repository, `rg` and `read` are usually sufficient. Larger Java/Spring services can benefit more from its indexed navigation.

Lantern 1.1.0 supports 13 grammars, including Java, JavaScript, TypeScript/TSX, and Python; text search also covers SQL, configuration, and documentation. Its reference and call-graph resolution is name-based. Overloads, same-named methods, Spring dependency injection, proxies, reflection, and generated implementations still require source inspection, compiler checks, and tests. Java import/general type references are not comprehensive.

The project publishes performance measurements on the VS Code repository, but those are upstream measurements, not a guarantee for this repository or your company code. Initial indexing and disk space are real costs; measure on an approved project before making Lantern part of a routine.

## Install CLI and official skill

Reviewed baseline: [Lantern 1.1.0](https://github.com/FadhilP/lantern/releases/tag/v1.1.0). Install only when wanted. The official npm package includes the skill; copy it into Pi's global skills directory once per machine:

```bash
npm install -g @fadhilp/lantern@1.1.0
lantern --version
mkdir -p "$HOME/.pi/agent/skills/lantern"
cp "$(npm root -g)/@fadhilp/lantern/skills/lantern/SKILL.md" \
  "$HOME/.pi/agent/skills/lantern/SKILL.md"
```

If you only want the skill before installing the CLI, download the same pinned upstream file:

```bash
mkdir -p "$HOME/.pi/agent/skills/lantern"
curl --fail --location \
  https://raw.githubusercontent.com/FadhilP/lantern/v1.1.0/skills/lantern/SKILL.md \
  --output "$HOME/.pi/agent/skills/lantern/SKILL.md"
```

These commands replace an existing global `lantern` skill, so review any local edits first. Run `/reload` or start a fresh Pi session, then invoke `/skill:lantern`. Updating the CLI does not automatically update a copied skill; re-copy the matching upstream version after reviewing an upgrade.

Node.js 18+ is enough for the launcher; Pi's requirement already satisfies it. The official npm package includes prebuilt Linux x64/arm64 glibc/musl, macOS x64/arm64, and Windows x64/arm64 binaries. No Rust/C++ build tools are required on those platforms. Its install script links the native command; with scripts disabled, a Node.js launcher runs it instead. The multi-platform npm artifact is sizeable (about 220 MB unpacked for this release).

Ensure npm's executable directory is on `PATH`, then restart Pi if its environment changed. Installing pi-neko alone does not install Lantern or its global skill. Without the executable, continue using `rg` and `read` rather than installing software automatically. Review release changes before changing the pin. Existing 0.4.1 users should verify command/output differences rather than assume compatibility: 1.1.0 defaults to compact text; scripts should request `--json`.

## Company-code checklist

Put shared company-specific instructions in `~/.pi/agent/AGENTS.md` once rather than copying them into every repository or editing the upstream skill. Keep actual secrets out of that file. Instructions do not enforce exclusions; use `.lanternignore` where a repository needs specific indexing exclusions.

Before the first indexed query:

1. Confirm company policy allows local source indexing and sending selected source snippets to the configured model provider. Local indexing is not permission to disclose code.
2. Review the actual Git root, checked-out submodules, `.gitignore`, and `.lanternignore`. Git mode includes tracked files plus nonignored untracked files. A tracked secret is not automatically protected by `.gitignore`.
3. Exclude credentials, customer exports, private keys, and unnecessary fixtures before indexing. Example `.lanternignore` rules, to adapt to the project:

   ```gitignore
   **/.env*
   **/*.pem
   **/*.key
   **/secrets/**
   **/customer-exports/**
   ```

4. Choose a company-approved local index location, outside personal cloud-sync directories. `LANTERN_HOME` or `--home` overrides the default. On macOS the default is `~/Library/Application Support/lantern`; Linux uses `$XDG_DATA_HOME/lantern` or `~/.local/share/lantern`, and Windows uses `%LOCALAPPDATA%\lantern`.
5. Treat the index and its backups as company source data. Lantern's file exclusions are not a security sandbox. Removing an exclusion does not erase existing backups; re-excluding a file is not a universal secure-erasure guarantee.

Queries do not write into the repository, but indexed queries create/update a SQLite index outside it. Starting in a subdirectory narrows results; it does not mean only that subdirectory is indexed. Outside Git, initial indexing requires an explicit `lantern index <folder>`; do not point it at your entire home or code directory casually.

**`lantern changes` is separate:** it reads a Git diff without an index. Do not assume `.lanternignore` governs this command. Narrow the requested paths and consider whether changed tracked configuration or untracked files contain secrets before requesting diff output. Results from any command may enter Pi history/model context.

## Useful commands

Run in the intended project or pass `-C /path/to/project`:

```bash
lantern symbols BillingService --kind class --max-bytes 8K
lantern symbols BillingService.createInvoice --body --limit 3 --max-bytes 8K
lantern refs createInvoice --kind call --limit 20 --max-bytes 8K
lantern graph createInvoice --direction callers --depth 1 --max-bytes 8K
lantern outline src/main/java/example/BillingService.java --max-bytes 8K
lantern code 'Transactional' --path '*.java' --context 3 --max-bytes 8K
lantern changes main...HEAD --path src --max-bytes 8K
lantern changes main...HEAD --diff BillingService.createInvoice --path src --max-bytes 8K
```

The first indexed query in a Git repository can build an expensive index. `changes` needs no index. For successive indexed queries with no intervening edits, add `--stale-ok` after the first refresh; omit it after edits or branch switches. Follow cursors rather than cutting output. Definition bodies stop at 100 lines, and long lines may be shortened, so read original source before treating a truncated implementation as fully reviewed.

## Sources and validation

- [Official CLI reference](https://github.com/FadhilP/lantern/blob/v1.1.0/docs/cli.md)
- [Architecture and indexing behavior](https://github.com/FadhilP/lantern/blob/v1.1.0/docs/architecture.md)
- [Official agent skill](https://github.com/FadhilP/lantern/blob/v1.1.0/skills/lantern/SKILL.md)

The guidance was checked against 1.1.0 documentation/source and npm metadata. It is not a benchmark or compliance approval for a company repository. No company repository was indexed to prepare this guide.
