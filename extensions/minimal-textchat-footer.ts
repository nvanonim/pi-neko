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

// ── extension ──────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let enabled = true; // default on

  // mutable caches – reset on session reload
  let gitDirty: GitDirty | null = null;
  let gitDirtyTimer: ReturnType<typeof setInterval> | null = null;
  let tuiRef: { requestRender(): void } | null = null;
  let contextWindow = 200_000;

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
      const lines = result.stdout.split("\n").filter((l) => l.length > 0);
      let staged = 0;
      let unstaged = 0;
      let untracked = 0;
      for (const line of lines) {
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

          // scan branch once for both context usage and tracked cost
          let inputTokens = 0;
          let totalCost = 0;
          for (const e of ctx.sessionManager.getBranch()) {
            if (
              e.type === "message" &&
              e.message?.role === "assistant"
            ) {
              const m = e.message as AssistantMessage;
              if (m.usage && typeof m.usage.input === "number" && Number.isFinite(m.usage.input)) {
                inputTokens += m.usage.input;
              }
              if (
                m.usage?.cost &&
                typeof m.usage.cost.total === "number" &&
                Number.isFinite(m.usage.cost.total)
              ) {
                totalCost += m.usage.cost.total;
              }
            }
          }
          const pct =
            contextWindow > 0 ? Math.round((inputTokens / contextWindow) * 1000) / 10 : 0;
          segs.push(theme.fg("muted", `${pct}%/${formatK(contextWindow)}`));

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

    publishStatuses(ctx);
    installFooter(ctx);
    startGitDirtyPolling();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) clearStatuses(ctx);
    stopGitDirtyPolling();
    tuiRef = null;
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
          publishStatuses(ctx);
          installFooter(ctx);
          startGitDirtyPolling();
        }
        ctx.ui.notify("Minimal textchat footer enabled", "info");
      } else {
        if (ctx.hasUI) {
          ctx.ui.setFooter(undefined);
          clearStatuses(ctx);
          stopGitDirtyPolling();
        }
        ctx.ui.notify("Minimal textchat footer disabled", "info");
      }
    },
  });
}
