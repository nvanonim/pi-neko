import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";

type ReviewSource = "edit" | "write" | "bash-detected";
type EditorName = "auto" | "zed" | "vscode" | "codium" | "custom" | "report";

type EditorConfig = {
  editor?: EditorName;
  command?: string;
  args?: string[];
};

type FileReview = {
  path: string;
  displayPath: string;
  source: ReviewSource;
  beforePath?: string;
  afterPath?: string;
  changed: boolean;
  ambiguous?: boolean;
};

type ReviewManifest = {
  id: string;
  cwd: string;
  sessionFile?: string;
  prompt: string;
  startedAt: string;
  settledAt: string;
  files: FileReview[];
  reportPath: string;
};

type ActiveReview = {
  id: string;
  cwd: string;
  root: string;
  prompt: string;
  startedAt: string;
  sessionFile?: string;
  files: Map<string, FileReview>;
  gitBefore: Map<string, string> | null;
};

const REVIEW_ROOT = join(getAgentDir(), "change-reviews");
const CONFIG_PATH = join(getAgentDir(), "change-review.json");
const WIDGET_ID = "pi-change-review";
const MAX_PROMPT_LENGTH = 120;
const EDITOR_NAMES = new Set<EditorName>(["auto", "zed", "vscode", "codium", "custom", "report"]);

function sessionFile(ctx: ExtensionContext): string | undefined {
  return (ctx.sessionManager as ExtensionContext["sessionManager"] & { getSessionFile?: () => string | undefined }).getSessionFile?.();
}

export function reportOpenLaunch(reportPath: string): { command: string; args: string[] } {
  if (process.platform === "darwin") return { command: "open", args: [reportPath] };
  if (process.platform === "win32") return { command: "cmd", args: ["/c", "start", "", reportPath] };
  return { command: "xdg-open", args: [reportPath] };
}

function shortPrompt(prompt: string): string {
  const flat = prompt.replace(/\s+/g, " ").trim();
  return flat.length > MAX_PROMPT_LENGTH ? `${flat.slice(0, MAX_PROMPT_LENGTH - 1)}…` : flat || "(no text prompt)";
}

function safeName(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function reviewId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

function normalizePath(cwd: string, input: string): string {
  return resolve(cwd, input.startsWith("@") ? input.slice(1) : input);
}

function snapshotDir(root: string, path: string): string {
  const extension = extname(path);
  const label = basename(path, extension).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 48) || "file";
  return join(root, "files", `${safeName(path)}-${label}`);
}

async function readOrEmpty(path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Buffer.alloc(0);
    throw error;
  }
}

async function writeSnapshot(path: string, contents: Buffer): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, contents);
}

function snapshotName(path: string, side: "before" | "after"): string {
  const extension = extname(path) || ".txt";
  return `${side}${extension}`;
}

export function buildEditorLaunches(
  editor: Exclude<EditorName, "auto">,
  files: Array<Pick<FileReview, "beforePath" | "afterPath">>,
  reportPath: string,
  config: EditorConfig = {},
): Array<{ command: string; args: string[] }> {
  const diffs = files.filter((file) => file.beforePath && file.afterPath) as Array<
    Required<Pick<FileReview, "beforePath" | "afterPath">>
  >;

  if (editor === "report" || diffs.length === 0) return [reportOpenLaunch(reportPath)];
  if (editor === "zed") return [{ command: "zed", args: diffs.flatMap((file) => ["--diff", file.beforePath, file.afterPath]) }];
  if (editor === "vscode" || editor === "codium") {
    const command = editor === "vscode" ? "code" : "codium";
    return diffs.map((file) => ({ command, args: ["--reuse-window", "--diff", file.beforePath, file.afterPath] }));
  }
  if (editor === "custom" && config.command) {
    const args = config.args ?? ["{before}", "{after}"];
    return diffs.map((file) => ({
      command: config.command!,
      args: args.map((arg) => arg.replaceAll("{before}", file.beforePath).replaceAll("{after}", file.afterPath).replaceAll("{report}", reportPath)),
    }));
  }
  return [reportOpenLaunch(reportPath)];
}

async function commandExists(pi: ExtensionAPI, command: string): Promise<boolean> {
  try {
    const result = await pi.exec(command, ["--version"], { timeout: 2_000 });
    return result.code === 0;
  } catch {
    return false;
  }
}

async function chooseEditor(pi: ExtensionAPI, config: EditorConfig): Promise<Exclude<EditorName, "auto">> {
  const wanted = config.editor ?? "auto";
  if (wanted !== "auto") return wanted;
  if (await commandExists(pi, "zed")) return "zed";
  if (await commandExists(pi, "code")) return "vscode";
  if (await commandExists(pi, "codium")) return "codium";
  return "report";
}

export function validConfig(input: unknown): EditorConfig {
  if (!input || typeof input !== "object") return {};
  const data = input as Record<string, unknown>;
  return {
    ...(typeof data.editor === "string" && EDITOR_NAMES.has(data.editor as EditorName) ? { editor: data.editor as EditorName } : {}),
    ...(typeof data.command === "string" && data.command.trim() ? { command: data.command } : {}),
    ...(Array.isArray(data.args) && data.args.every((arg) => typeof arg === "string") ? { args: data.args as string[] } : {}),
  };
}

async function loadConfig(cwd: string, ctx: ExtensionContext): Promise<EditorConfig> {
  const projectConfig = join(cwd, ".pi", "change-review.json");
  const paths = [CONFIG_PATH, ...(ctx.isProjectTrusted() ? [projectConfig] : [])];
  let result: EditorConfig = {};

  for (const path of paths) {
    try {
      const raw = JSON.parse(await readFile(path, "utf8"));
      const data = validConfig(raw);
      if (raw && typeof raw === "object" && Object.keys(data).length !== Object.keys(raw as object).length && ctx.hasUI) {
        ctx.ui.notify(`Pi review ignored invalid config values: ${path}`, "warning");
      }
      result = { ...result, ...data };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && ctx.hasUI) {
        ctx.ui.notify(`Pi review ignored invalid config: ${path}`, "warning");
      }
    }
  }
  return result;
}

async function gitStatus(pi: ExtensionAPI): Promise<Map<string, string> | null> {
  try {
    const result = await pi.exec("git", ["status", "--porcelain=v1", "-z"], { timeout: 3_000 });
    if (result.code !== 0) return null;
    const changes = new Map<string, string>();
    for (const record of result.stdout.split("\0")) {
      if (record.length >= 4) changes.set(record.slice(3), record.slice(0, 2));
    }
    return changes;
  } catch {
    return null;
  }
}

function renderReport(manifest: ReviewManifest): string {
  const lines = [
    `# Pi change review ${manifest.id}`,
    "",
    `**Prompt:** ${manifest.prompt}`,
    "",
    `**Started:** ${manifest.startedAt}`,
    `**Settled:** ${manifest.settledAt}`,
    "",
    "## Files",
    "",
  ];
  if (manifest.files.length === 0) lines.push("No tracked file changes.");
  for (const file of manifest.files) {
    const note = file.ambiguous ? " — Bash-detected; attribution/diff may be incomplete" : "";
    lines.push(`- \`${file.displayPath}\` (${file.source})${note}`);
  }
  lines.push("", "## Review", "", "Open diffs with `/pi-review open`. Snapshot pairs are stored beside this report.", "");
  return lines.join("\n");
}

async function readManifest(root: string, id: string): Promise<ReviewManifest | undefined> {
  try {
    return JSON.parse(await readFile(join(root, id, "review.json"), "utf8")) as ReviewManifest;
  } catch {
    return undefined;
  }
}

export function selectReviewId(ids: string[], requested: string | undefined): string | undefined {
  if (!requested || requested === "latest") return ids[0];
  return ids.includes(requested) ? requested : undefined;
}

async function listReviewIds(root: string): Promise<string[]> {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export default function (pi: ExtensionAPI) {
  let active: ActiveReview | undefined;
  let latest: ReviewManifest | undefined;

  function reviewStore(ctx: ExtensionContext): string {
    // Session scope prevents a review from another Pi conversation in the same
    // project from becoming this session's implicit "latest" review.
    return join(REVIEW_ROOT, safeName(ctx.cwd), safeName(sessionFile(ctx) ?? `ephemeral-${process.pid}`));
  }

  async function approvedReviewId(store: string, requested: string | undefined): Promise<string | undefined> {
    const ids = await listReviewIds(store);
    const selected = selectReviewId(ids, requested);
    if (requested && requested !== "latest") return selected;

    for (const id of ids) {
      const manifest = await readManifest(store, id);
      if (manifest && manifest.files.length > 0) return id;
    }
    return undefined;
  }

  async function snapshotBefore(review: ActiveReview, source: "edit" | "write", input: unknown): Promise<void> {
    const candidate = (input as { path?: unknown })?.path;
    if (typeof candidate !== "string") return;
    const path = normalizePath(review.cwd, candidate);
    if (review.files.has(path)) return;

    const directory = snapshotDir(review.root, path);
    const beforePath = join(directory, snapshotName(path, "before"));
    const afterPath = join(directory, snapshotName(path, "after"));
    await writeSnapshot(beforePath, await readOrEmpty(path));
    review.files.set(path, {
      path,
      displayPath: relative(review.cwd, path) || basename(path),
      source,
      beforePath,
      afterPath,
      changed: false,
    });
  }

  async function finalize(ctx: ExtensionContext): Promise<void> {
    const review = active;
    active = undefined;
    if (!review) return;

    for (const file of review.files.values()) {
      if (!file.afterPath || !file.beforePath) continue;
      const after = await readOrEmpty(file.path);
      await writeSnapshot(file.afterPath, after);
      const before = await readFile(file.beforePath);
      file.changed = !before.equals(after);
    }

    const gitAfter = await gitStatus(pi);
    if (review.gitBefore && gitAfter) {
      for (const [path, status] of gitAfter) {
        if (review.gitBefore.get(path) === status || review.files.has(resolve(review.cwd, path))) continue;
        review.files.set(resolve(review.cwd, path), {
          path: resolve(review.cwd, path),
          displayPath: path,
          source: "bash-detected",
          changed: true,
          ambiguous: true,
        });
      }
    }

    const root = join(reviewStore(ctx), review.id);
    const files = Array.from(review.files.values()).filter((file) => file.changed);
    // Conversational prompts with no file mutations must not replace the latest
    // usable review with an empty report that can only open as Markdown.
    if (files.length === 0) {
      await rm(review.root, { recursive: true, force: true });
      return;
    }
    const manifest: ReviewManifest = {
      id: review.id,
      cwd: review.cwd,
      ...(review.sessionFile ? { sessionFile: review.sessionFile } : {}),
      prompt: shortPrompt(review.prompt),
      startedAt: review.startedAt,
      settledAt: new Date().toISOString(),
      files,
      reportPath: join(root, "report.md"),
    };
    await mkdir(root, { recursive: true });
    await writeFile(manifest.reportPath, renderReport(manifest));
    await writeFile(join(root, "review.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    latest = manifest;

    if (ctx.hasUI && files.length > 0) {
      ctx.ui.notify(`Pi review: ${files.length} file${files.length === 1 ? "" : "s"} changed — /pi-review open`, "info");
      ctx.ui.setWidget(WIDGET_ID, [`Pi review #${review.id.slice(-8)} · ${files.length} file${files.length === 1 ? "" : "s"} · /pi-review open`], { placement: "belowEditor" });
    }
  }

  async function openReview(id: string | undefined, ctx: ExtensionContext): Promise<void> {
    const store = reviewStore(ctx);
    const targetId = await approvedReviewId(store, id === "latest" || !id ? latest?.id : id);
    const manifest = targetId ? await readManifest(store, targetId) : undefined;
    if (!manifest) {
      ctx.ui.notify("Pi review not found. Use /pi-review list.", "warning");
      return;
    }
    const config = await loadConfig(ctx.cwd, ctx);
    const editor = await chooseEditor(pi, config);
    const launches = buildEditorLaunches(editor, manifest.files, manifest.reportPath, config);
    for (const launch of launches) {
      try {
        const result = await pi.exec(launch.command, launch.args, { timeout: 10_000 });
        if (result.code !== 0) throw new Error(result.stderr || `exit ${result.code}`);
      } catch (error) {
        ctx.ui.notify(`Pi review could not open ${launch.command}: ${String(error)}`, "error");
        return;
      }
    }
    ctx.ui.notify(`Opened Pi review ${manifest.id.slice(-8)} in ${editor}`, "info");
  }

  pi.on("session_start", async (_event, ctx) => {
    const ids = await listReviewIds(reviewStore(ctx));
    latest = ids[0] ? await readManifest(reviewStore(ctx), ids[0]) : undefined;
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    await finalize(ctx);
    if (ctx.hasUI) ctx.ui.setWidget(WIDGET_ID, undefined);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    await finalize(ctx);
    const id = reviewId();
    const root = join(reviewStore(ctx), id);
    active = {
      id,
      cwd: ctx.cwd,
      root,
      prompt: event.prompt,
      startedAt: new Date().toISOString(),
      sessionFile: sessionFile(ctx),
      files: new Map(),
      gitBefore: await gitStatus(pi),
    };
  });

  pi.on("tool_execution_start", async (event) => {
    if (!active) return;
    if (event.toolName === "edit" || event.toolName === "write") {
      await snapshotBefore(active, event.toolName, event.args);
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    await finalize(ctx);
  });

  const reviewCommand = {
    description: "Review files changed by the latest Pi prompt",
    handler: async (args: string, ctx: ExtensionContext) => {
      const [action = "open", id] = (args.trim() || "open").split(/\s+/, 2);
      const store = reviewStore(ctx);
      if (action === "open") return openReview(id, ctx);
      if (action === "list") {
        const ids = await listReviewIds(store);
        ctx.ui.notify(ids.length ? `Pi reviews:\n${ids.slice(0, 12).join("\n")}` : "No Pi reviews saved.", "info");
        return;
      }
      if (action === "status") {
        const targetId = await approvedReviewId(store, latest?.id);
        const manifest = targetId ? await readManifest(store, targetId) : undefined;
        ctx.ui.notify(manifest ? `Latest review: ${manifest.files.length} files\n${manifest.prompt}` : "No Pi reviews saved.", "info");
        return;
      }
      if (action === "report") {
        const targetId = await approvedReviewId(store, id === "latest" || !id ? latest?.id : id);
        const manifest = targetId ? await readManifest(store, targetId) : undefined;
        if (!manifest) return ctx.ui.notify("Pi review not found.", "warning");
        const launch = reportOpenLaunch(manifest.reportPath);
        await pi.exec(launch.command, launch.args, { timeout: 10_000 });
        return;
      }
      if (action === "clear") {
        const target = id ?? "latest";
        if (target === "all") {
          const ok = !ctx.hasUI || await ctx.ui.confirm("Clear Pi reviews?", "Delete all saved Pi review snapshots?");
          if (!ok) return;
          await rm(store, { recursive: true, force: true });
          latest = undefined;
          ctx.ui.setWidget(WIDGET_ID, undefined);
          return ctx.ui.notify("Cleared all Pi reviews.", "info");
        }
        const targetId = await approvedReviewId(store, target === "latest" ? latest?.id : target);
        if (!targetId) return ctx.ui.notify("No Pi review to clear.", "warning");
        await rm(join(store, targetId), { recursive: true, force: true });
        if (latest?.id === targetId) latest = undefined;
        return ctx.ui.notify(`Cleared Pi review ${targetId.slice(-8)}.`, "info");
      }
      ctx.ui.notify("Usage: /review [open|list|status|report|clear] [latest|id|all]", "warning");
    },
  };
  pi.registerCommand("review", reviewCommand);
  pi.registerCommand("pi-review", reviewCommand);

}
