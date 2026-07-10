import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type CavemanLevel = "lite" | "full" | "ultra";

const FALLBACK_PROMPT = [
  "Respond in ultra-compressed caveman token-saver mode.",
  "Maximum brevity. Fragments OK. Preserve technical accuracy.",
  "Use normal code, paths, commands, and exact API names.",
  "Only include essentials: result, changed files, commands, blockers.",
  "If user asks for normal/verbose/explain more, obey user for that response.",
].join("\n");

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

function hashText(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 8);
}

function loadCavemanSkill(): { prompt: string; source: string; hash: string } {
  const candidates = [
    join(homedir(), ".agents", "skills", "caveman", "SKILL.md"),
    join(homedir(), ".pi", "agent", "skills", "caveman", "SKILL.md"),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const skill = stripFrontmatter(readFileSync(path, "utf8"));
    return { source: path, prompt: skill, hash: hashText(skill) };
  }

  return { source: "fallback built-in prompt", prompt: FALLBACK_PROMPT, hash: hashText(FALLBACK_PROMPT) };
}

export default function (pi: ExtensionAPI) {
  let enabled = true;
  let level: CavemanLevel = "ultra";
  const loaded = loadCavemanSkill();
  const marker = `[pi-neko:caveman-source:v1:${loaded.hash}]`;

  function contentHasMarker(content: unknown): boolean {
    if (typeof content === "string") return content.includes(marker);
    if (!Array.isArray(content)) return false;
    return content.some((part) => part?.type === "text" && typeof part.text === "string" && part.text.includes(marker));
  }

  function activeContextHasSource(ctx: { sessionManager: { buildContextEntries(): Array<any> } }): boolean {
    for (const entry of ctx.sessionManager.buildContextEntries()) {
      if (entry.type === "custom_message") {
        if (contentHasMarker(entry.content)) return true;
        if (entry.details?.marker === marker) return true;
      }
      if (entry.type === "message") {
        if (contentHasMarker(entry.message?.content)) return true;
        if (entry.message?.details?.marker === marker) return true;
      }
    }
    return false;
  }

  function sourceMessage() {
    return {
      customType: "pi-neko-caveman-source",
      display: false,
      content: [
        `${marker}`,
        "Loaded caveman skill source for default-caveman-mode.",
        "Apply this source only when the current system prompt contains the matching always-on reminder marker.",
        "If the reminder is absent, treat this source as inactive reference material.",
        `Source: ${loaded.source}`,
        "",
        loaded.prompt,
        "",
        `End ${marker}. Reminder required for activation.`,
      ].join("\n"),
      details: { marker, source: loaded.source, hash: loaded.hash },
    };
  }

  function reminder(): string {
    return [
      "Always-on skill reminder: apply loaded caveman skill source " + marker + ".",
      `Current caveman intensity: ${level}.`,
      "Preserve exact code/API/path/error text. No tool-call narration.",
      "Use Auto-Clarity for safety warnings, destructive confirmations, and ambiguous multi-step instructions.",
      "User override: normal/verbose/stop caveman.",
    ].join(" ");
  }

  pi.on("before_agent_start", (event, ctx) => {
    if (!enabled) return;

    const result: { systemPrompt: string; message?: ReturnType<typeof sourceMessage> } = {
      systemPrompt: [event.systemPrompt, reminder()].join("\n\n"),
    };

    if (!activeContextHasSource(ctx)) {
      result.message = sourceMessage();
    }

    return result;
  });

  pi.registerCommand("caveman-default", {
    description: "Control default caveman mode: on|off|lite|full|ultra|status",
    handler: async (args, ctx) => {
      const sub = (args ?? "").trim().toLowerCase();

      if (sub === "on") enabled = true;
      else if (sub === "off") enabled = false;
      else if (sub === "lite" || sub === "full" || sub === "ultra") {
        level = sub;
        enabled = true;
      } else if (sub === "status" || sub === "") {
        // report below
      } else {
        ctx.ui.notify("Usage: /caveman-default on|off|lite|full|ultra|status", "warning");
        return;
      }

      ctx.ui.notify(
        `Caveman default: ${enabled ? level : "off"} (${loaded.source}, ${loaded.hash})`,
        "info",
      );
    },
  });
}
