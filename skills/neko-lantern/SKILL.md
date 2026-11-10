---
name: neko-lantern
description: Optional Lantern CLI workflow for exploring large or unfamiliar codebases, finding definitions and callers, outlining long files, and investigating change impact. Use on demand when indexed navigation would help; fall back to rg and read if Lantern is unavailable.
---

# Neko Lantern

Original pi-neko guidance for [Lantern](https://github.com/FadhilP/lantern), maintained by FadhilP. This skill does not bundle Lantern or copy its upstream skill. Command examples target 0.4.1, distributed as the official `@fadhilp/lantern@0.4.1` npm package with prebuilt binaries. When the user requests installation, use `npm install -g @fadhilp/lantern@0.4.1`; no Rust build is required on supported platforms.

## Availability and scope

- Check `lantern --version` through bash once before first use in a session. If missing or incompatible, use `rg` and the `read` tool instead. Do not install software automatically or repeatedly retry a missing executable.
- Do not index at session startup. Use Lantern only when the task needs repository discovery or change-impact investigation. Known-file edits, small projects, and precise text searches often need only `read` or `rg`.
- The first search can build an expensive local index. For a large repository, explain that cost before starting. Source content is stored in the user's data directory even though the repository itself is not modified by queries.
- Honor project confidentiality and exclusions. Check `.lanternignore` and applicable ignore rules before indexing sensitive workspaces. Do not assume Git-tracked secrets are excluded. Ask before indexing when sensitive paths cannot safely be excluded without a project decision.
- Query results may enter Pi history and the selected model provider's context. Request only relevant code; never dump credentials or an index database into chat.

## Discovery workflow

Run in the target project directory, or pass `-C <project-directory>`. Use bash to invoke the CLI and start with a bounded output budget:

```bash
lantern symbols UserService --max-bytes 8K
lantern symbols UserService.createUser --body --limit 3 --max-bytes 8K
lantern refs createUser --limit 20 --max-bytes 8K
lantern graph createUser --direction callers --depth 1 --max-bytes 8K
lantern outline src/main/java/example/UserService.java --max-bytes 8K
lantern code 'Transactional' --path '*.java' --context 3 --max-bytes 8K
```

- Definitions: use `symbols`; add `--body` to inspect implementation and preceding annotations/comments. Bodies are capped at 100 lines, so read the remaining source before treating a long implementation as fully reviewed.
- File structure: use `outline`, then `read` only the relevant ranges.
- Call sites and impact: use `refs` and shallow `graph`, then verify important matches against actual source.
- Text, fields, SQL, configuration, or strings: use `code` or `rg`. `code` is literal and case-insensitive by default; add `--regex` or `--case-sensitive` deliberately.
- File names: use `git ls-files` or `find`; Lantern is not a file-name search tool.
- Paging: follow returned cursors with the same query and flags. If the index changes and invalidates a cursor, restart the query instead of guessing a cursor.
- Empty results: inspect hints and try an appropriate alternative. No results is not proof that a feature or dependency does not exist.

## Freshness and correctness

Normal queries refresh the index. For a short chain with no intervening edits, subsequent queries may use `--stale-ok`. After edits, branch changes, generated-code changes, or any uncertainty, run the next query without `--stale-ok`.

References and graphs resolve by name, not compiler/type identity. Overloaded methods and unrelated methods with the same name can be ambiguous. Java call and implementation references are supported in the reviewed version, but Java type/import references require text search. Spring injection, reflection, proxies, configuration, and generated code need separate inspection.

Use Lantern to gather evidence for a plan or review, not to certify semantic correctness. Continue using the existing todo workflow, tests, compiler, and review tools. Do not add a wrapper, background watcher, persistent process, or compulsory Lantern step just to use this skill.
