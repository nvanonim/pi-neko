import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type CavemanLevel = "lite" | "full" | "ultra";

const LEVEL_PROMPTS: Record<CavemanLevel, string> = {
  lite: [
    "Default response style: caveman-lite token-saver mode.",
    "Be concise. Short sentences. Minimal filler. Keep technical accuracy.",
    "Use normal code, paths, commands, and exact API names.",
    "Do not omit important warnings, assumptions, or next steps.",
    "If user asks for normal/verbose/explain more, obey user for that response.",
  ].join("\n"),
  full: [
    "Default response style: caveman token-saver mode.",
    "Use compressed caveman-like phrasing while preserving full technical accuracy.",
    "Prefer terse bullets/fragments over prose. No fluff.",
    "Use normal code, paths, commands, and exact API names.",
    "Do not omit important warnings, assumptions, or next steps.",
    "If user asks for normal/verbose/explain more, obey user for that response.",
  ].join("\n"),
  ultra: [
    "Default response style: ultra-compressed caveman token-saver mode.",
    "Maximum brevity. Fragments okay. Preserve technical accuracy.",
    "Use normal code, paths, commands, and exact API names.",
    "Only include essentials: result, changed files, commands, blockers.",
    "If user asks for normal/verbose/explain more, obey user for that response.",
  ].join("\n"),
};

export default function (pi: ExtensionAPI) {
  let enabled = true;
  let level: CavemanLevel = "ultra";

  pi.on("before_agent_start", (event) => {
    if (!enabled) return;

    return {
      systemPrompt: `${event.systemPrompt}\n\n${LEVEL_PROMPTS[level]}`,
    };
  });

  pi.registerCommand("caveman-default", {
    description: "Control default caveman token-saver mode: on|off|lite|full|ultra|status",
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
        `Caveman default: ${enabled ? level : "off"}`,
        "info",
      );
    },
  });
}
