import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

function preferredThinking(provider: string, id: string): ThinkingLevel | null {
  const modelId = id.toLowerCase();
  const providerId = provider.toLowerCase();

  if (providerId === "deepseek" && (modelId === "deepseek-v4-pro" || modelId === "deepseek-v4-flash")) {
    return "high";
  }

  if (providerId === "openai-codex" && modelId.startsWith("gpt-")) {
    return "medium";
  }

  return null;
}

export default function (pi: ExtensionAPI) {
  pi.on("model_select", (event, ctx) => {
    const desired = preferredThinking(event.model.provider, event.model.id);
    if (!desired) return;
    if (pi.getThinkingLevel() === desired) return;

    pi.setThinkingLevel(desired);

    if (ctx.hasUI) {
      ctx.ui.notify(
        `Thinking default: ${event.model.provider}/${event.model.id} → ${desired}`,
        "info",
      );
    }
  });
}
