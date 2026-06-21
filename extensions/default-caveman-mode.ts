import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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

function loadCavemanSkill(): { prompt: string; source: string } {
  const candidates = [
    join(homedir(), ".agents", "skills", "caveman", "SKILL.md"),
    join(homedir(), ".pi", "agent", "skills", "caveman", "SKILL.md"),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const skill = stripFrontmatter(readFileSync(path, "utf8"));
    return {
      source: path,
      prompt: [
        "Default response style: caveman skill, always active.",
        "Apply the installed caveman skill instructions below.",
        "Default intensity for this pi extension: ultra.",
        "User can override with normal/verbose/stop caveman requests.",
        "",
        skill,
      ].join("\n"),
    };
  }

  return { source: "fallback built-in prompt", prompt: FALLBACK_PROMPT };
}

export default function (pi: ExtensionAPI) {
  let enabled = true;
  let level: CavemanLevel = "ultra";
  const loaded = loadCavemanSkill();

  pi.on("before_agent_start", (event) => {
    if (!enabled) return;

    return {
      systemPrompt: [
        event.systemPrompt,
        loaded.prompt,
        `Current caveman intensity: ${level}.`,
      ].join("\n\n"),
    };
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
        `Caveman default: ${enabled ? level : "off"} (${loaded.source})`,
        "info",
      );
    },
  });
}
