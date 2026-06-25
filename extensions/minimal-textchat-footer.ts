/**
 * Minimal Textchat Footer Extension
 *
 * Replaces pi's built-in footer with a single minimalist row.
 * Design: transparent / no filled powerline blocks, blue/cyan accent, muted › separators.
 *
 * Segments: π · model · thinking · cwd · git(branch+dirty) · context% · $cost
 *
 * Commands:
 *   /textchat-footer on|off|toggle
 *   /git-changes show|hide|toggle
 *
 * Shortcut:
 *   alt+g or f2 toggles changed-files widget
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { basename } from "node:path";

// ── helpers ────────────────────────────────────────────────────────────────

function formatK(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1_000_000)}M`;
}

function formatCost(total: number): string {
  if (total >= 100) return `$${total.toFixed(0)}`;
  if (total >= 1) return `$${total.toFixed(2)}`;
  return `$${total.toFixed(3)}`;
}

function shortModel(name: string, id: string): string {
  let n = name || id || "?";
  if (n.startsWith("Claude ")) n = n.slice(7);
  if (n.length > 24) n = n.slice(0, 22) + "…";
  return n;
}

const THINKING_LABELS: Record<string, string> = {
  minimal: "min",
  low: "low",
  medium: "med",
  high: "high",
  xhigh: "xhigh",
};

interface GitDirty {
  staged: number;
  unstaged: number;
  untracked: number;
}

interface GitChange {
  status: string;
  path: string;
}

type GitChangeKind = "staged" | "unstaged" | "untracked";

function parseGitStatus(output: string): GitChange[] {
  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => ({
      status: line.slice(0, 2),
      path: line.slice(3),
    }));
}

function changeKind(status: string): GitChangeKind {
  const x = status[0] ?? " ";
  const y = status[1] ?? " ";
  if (x === "?" && y === "?") return "untracked";
  if (x !== " ") return "staged";
  if (y !== " ") return "unstaged";
  return "unstaged";
}

function statusLabel(status: string): string {
  const x = status[0] ?? " ";
  const y = status[1] ?? " ";
  if (x === "?" && y === "?") return "??";
  if (x !== " ") return `+${x}`;
  if (y !== " ") return `*${y}`;
  return status.trim() || "--";
}

// ── extension ──────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let enabled = true; // default on

  // mutable caches – reset on session reload
  let gitDirty: GitDirty | null = null;
  let gitDirtyTimer: ReturnType<typeof setInterval> | null = null;
  let tuiRef: { requestRender(): void } | null = null;
  let contextWindow = 200_000;
  let changesWidgetVisible = false;
  let lastUi: { setWidget: (k: string, v: string[] | ((tui: { requestRender(): void }, theme: Theme) => Component) | undefined, options?: { placement?: "aboveEditor" | "belowEditor" }) => void; notify: (message: string, type: "info" | "warning" | "error") => void } | null = null;

  async function refreshGitDirty(): Promise<void> {
    try {
      const result = await pi.exec("git", ["status", "--porcelain"], {
        timeout: 3000,
      });
      if (result.code !== 0) {
        gitDirty = null;
        tuiRef?.requestRender();
        return;
      }
      const changes = parseGitStatus(result.stdout);
      let staged = 0;
      let unstaged = 0;
      let untracked = 0;
      for (const line of result.stdout.split("\n").filter((l) => l.length > 0)) {
        const x = line[0] ?? " ";
        const y = line[1] ?? " ";
        if (x === "?" && y === "?") {
          untracked++;
          continue;
        }
        if (x !== " ") staged++;
        if (y !== " ") unstaged++;
      }
      gitDirty = { staged, unstaged, untracked };
      if (changesWidgetVisible) updateChangesWidget(changes);
      tuiRef?.requestRender();
    } catch {
      gitDirty = null;
      tuiRef?.requestRender();
    }
  }

  function startGitDirtyPolling(): void {
    if (gitDirtyTimer) return;
    void refreshGitDirty();
    gitDirtyTimer = setInterval(() => void refreshGitDirty(), 30_000);
  }

  function stopGitDirtyPolling(): void {
    if (gitDirtyTimer) {
      clearInterval(gitDirtyTimer);
      gitDirtyTimer = null;
    }
    gitDirty = null;
  }

  function updateChangesWidget(changes: GitChange[]): void {
    if (!lastUi) return;

    lastUi.setWidget(
      "git-changes",
      (_tui, theme) => ({
        invalidate() {},
        render(width: number): string[] {
          const max = 20;
          const staged = changes.filter((c) => changeKind(c.status) === "staged").length;
          const unstaged = changes.filter((c) => changeKind(c.status) === "unstaged").length;
          const untracked = changes.filter((c) => changeKind(c.status) === "untracked").length;
          const header = [
            theme.fg("accent", "git changes"),
            theme.fg("success", `+${staged}`),
            theme.fg("warning", `*${unstaged}`),
            theme.fg("muted", `?${untracked}`),
            theme.fg("dim", "• alt+g/f2 hide"),
          ].join(" ");

          if (changes.length === 0) {
            return [truncateToWidth(`${theme.fg("success", "✓ git clean")} ${theme.fg("dim", "• alt+g/f2 hide")}`, width)];
          }

          const lines = [truncateToWidth(header, width)];
          for (const change of changes.slice(0, max)) {
            const kind = changeKind(change.status);
            const color = kind === "staged" ? "success" : kind === "unstaged" ? "warning" : "muted";
            const icon = kind === "staged" ? "●" : kind === "unstaged" ? "○" : "?";
            const label = statusLabel(change.status).padEnd(2);
            const text = `${theme.fg(color, `${icon} ${label}`)} ${change.path}`;
            lines.push(truncateToWidth(text, width));
          }
          if (changes.length > max) {
            lines.push(theme.fg("dim", `… ${changes.length - max} more`));
          }
          return lines;
        },
      }),
      { placement: "belowEditor" },
    );
  }

  async function refreshChangesWidget(): Promise<void> {
    if (!lastUi) return;
    try {
      const result = await pi.exec("git", ["status", "--porcelain"], { timeout: 3000 });
      if (result.code !== 0) {
        lastUi.setWidget("git-changes", ["git: not a repo"], { placement: "belowEditor" });
        return;
      }
      updateChangesWidget(parseGitStatus(result.stdout));
    } catch (error) {
      lastUi.setWidget("git-changes", [`git: failed to read status (${String(error)})`], { placement: "belowEditor" });
    }
  }

  function hideChangesWidget(): void {
    changesWidgetVisible = false;
    lastUi?.setWidget("git-changes", undefined);
  }

  async function showChangesWidget(): Promise<void> {
    changesWidgetVisible = true;
    await refreshChangesWidget();
  }

  async function toggleChangesWidget(): Promise<void> {
    if (changesWidgetVisible) hideChangesWidget();
    else await showChangesWidget();
  }

  // Publish reactive data via extension statuses so the footer render closure
  // can pick up model / thinking-level changes without reinstalling the footer.
  function publishStatuses(ctx: {
    ui: { setStatus: (k: string, v: string | undefined) => void };
    model?: { name?: string; id: string } | null;
  }): void {
    if (ctx.model) {
      ctx.ui.setStatus(
        "min-footer-model",
        shortModel(ctx.model.name ?? "", ctx.model.id),
      );
    } else {
      ctx.ui.setStatus("min-footer-model", undefined);
    }
    contextWindow = ctx.model?.contextWindow ?? 200_000;
    const level: string = pi.getThinkingLevel?.() ?? "off";
    ctx.ui.setStatus("min-footer-thinking", level);
  }

  function clearStatuses(ctx: {
    ui: { setStatus: (k: string, v: string | undefined) => void };
  }): void {
    ctx.ui.setStatus("min-footer-model", undefined);
    ctx.ui.setStatus("min-footer-thinking", undefined);
  }

  // Install the custom footer.  Called once per session when enabled.
  function installFooter(ctx: {
    ui: { setFooter(factory: (tui: { requestRender(): void }, theme: Theme, footerData: ReadonlyFooterDataProvider) => Component & { dispose?: () => void }): void };
    cwd: string;
    sessionManager: {
      getBranch(): Array<{ type: string; message?: any }>;
    };
    getContextUsage?: () => { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
  }): void {
    ctx.ui.setFooter((tui, theme, footerData) => {
      tuiRef = tui;

      const unsub = footerData.onBranchChange(() => {
        void refreshGitDirty();
        tui.requestRender();
      });

      return {
        dispose() {
          tuiRef = null;
          unsub();
          stopGitDirtyPolling();
        },

        invalidate() {
          gitDirty = null;
        },

        render(width: number): string[] {
          const statuses: ReadonlyMap<string, string> =
            footerData.getExtensionStatuses();

          // ── build segments ──────────────────────────────────────────
          const segs: string[] = [];

          // π icon
          segs.push(theme.fg("accent", "π"));

          // model (reactive via published status)
          const modelName = statuses.get("min-footer-model");
          if (modelName) {
            segs.push(modelName);
          }

          // thinking level (reactive via published status)
          const thinkingLevel =
            statuses.get("min-footer-thinking") ?? "off";
          if (thinkingLevel !== "off") {
            const label = THINKING_LABELS[thinkingLevel] ?? thinkingLevel;
            segs.push(theme.fg("dim", `think:${label}`));
          }

          // cwd basename
          segs.push(
            theme.fg("accent", basename(ctx.cwd || process.cwd())),
          );

          // git branch + dirty indicators
          const branch: string | null = footerData.getGitBranch();
          if (branch) {
            let gitText = branch;
            if (gitDirty) {
              const parts: string[] = [];
              if (gitDirty.staged > 0)
                parts.push(theme.fg("success", `+${gitDirty.staged}`));
              if (gitDirty.unstaged > 0)
                parts.push(
                  theme.fg("warning", `*${gitDirty.unstaged}`),
                );
              if (gitDirty.untracked > 0)
                parts.push(
                  theme.fg("muted", `?${gitDirty.untracked}`),
                );
              if (parts.length > 0) gitText += " " + parts.join(" ");
            }
            segs.push(theme.fg("warning", gitText));
          }

          // Use Pi's live context estimate for context usage. Do not sum
          // assistant usage.input across turns: that double-counts repeated
          // context and can exceed 100% even when current context is fine.
          const usage = ctx.getContextUsage?.();
          const usageWindow = usage?.contextWindow ?? contextWindow;
          const pctText = usage?.percent == null ? "?" : (Math.round(usage.percent * 10) / 10).toString();
          segs.push(theme.fg("muted", `${pctText}%/${formatK(usageWindow)}`));

          // scan branch for default-on tracked cost (real usage.cost.total, not speculative)
          let totalCost = 0;
          for (const e of ctx.sessionManager.getBranch()) {
            if (
              e.type === "message" &&
              e.message?.role === "assistant"
            ) {
              const m = e.message as AssistantMessage;
              if (
                m.usage?.cost &&
                typeof m.usage.cost.total === "number" &&
                Number.isFinite(m.usage.cost.total)
              ) {
                totalCost += m.usage.cost.total;
              }
            }
          }

          // default‑on tracked cost (real usage.cost.total, not speculative)
          segs.push(theme.fg("muted", formatCost(totalCost)));

          // ── join with muted separators ──────────────────────────────
          const sep = theme.fg("dim", " › ");
          let line = segs.join(sep);

          if (visibleWidth(line) > width) {
            line = truncateToWidth(line, width);
          }

          return [line];
        },
      };
    });
  }

  // ── lifecycle ─────────────────────────────────────────────────────────

  pi.on("session_start", (_event, ctx) => {
    if (!enabled) return;
    if (!ctx.hasUI) return;

    lastUi = ctx.ui;
    publishStatuses(ctx);
    installFooter(ctx);
    startGitDirtyPolling();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) {
      clearStatuses(ctx);
      ctx.ui.setWidget("git-changes", undefined);
    }
    stopGitDirtyPolling();
    tuiRef = null;
    lastUi = null;
  });

  pi.on("model_select", (_event, ctx) => {
    if (!enabled) return;
    publishStatuses(ctx);
    tuiRef?.requestRender();
  });

  pi.on("thinking_level_select", (_event, ctx) => {
    if (!enabled) return;
    publishStatuses(ctx);
    tuiRef?.requestRender();
  });

  // ── command ────────────────────────────────────────────────────────────

  pi.registerCommand("textchat-footer", {
    description: "Toggle minimal textchat footer on|off|toggle",
    handler: async (args, ctx) => {
      const sub = (args ?? "").trim().toLowerCase();
      if (sub === "on") enabled = true;
      else if (sub === "off") enabled = false;
      else if (sub === "toggle") enabled = !enabled;
      else enabled = !enabled;

      if (enabled) {
        if (ctx.hasUI) {
          lastUi = ctx.ui;
          publishStatuses(ctx);
          installFooter(ctx);
          startGitDirtyPolling();
        }
        ctx.ui.notify("Minimal textchat footer enabled", "info");
      } else {
        if (ctx.hasUI) {
          ctx.ui.setFooter(undefined);
          ctx.ui.setWidget("git-changes", undefined);
          clearStatuses(ctx);
          stopGitDirtyPolling();
        }
        ctx.ui.notify("Minimal textchat footer disabled", "info");
      }
    },
  });

  pi.registerCommand("git-changes", {
    description: "Show changed files widget: show|hide|toggle",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      lastUi = ctx.ui;
      const sub = (args ?? "toggle").trim().toLowerCase();
      if (sub === "show") await showChangesWidget();
      else if (sub === "hide") hideChangesWidget();
      else if (sub === "toggle" || sub === "") await toggleChangesWidget();
      else ctx.ui.notify("Usage: /git-changes show|hide|toggle", "warning");
    },
  });

  async function toggleChangesWidgetShortcut(ctx: { hasUI: boolean; ui: NonNullable<typeof lastUi> }): Promise<void> {
    if (!ctx.hasUI) return;
    lastUi = ctx.ui;
    await toggleChangesWidget();
  }

  pi.registerShortcut("alt+g", {
    description: "Toggle git changed-files widget",
    handler: toggleChangesWidgetShortcut,
  });

  pi.registerShortcut("f2", {
    description: "Toggle git changed-files widget",
    handler: toggleChangesWidgetShortcut,
  });
}
