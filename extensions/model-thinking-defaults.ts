import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

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
  function applyPreferredThinking(
    model: { provider: string; id: string },
    ctx: ExtensionContext,
    notify: boolean,
  ): void {
    const desired = preferredThinking(model.provider, model.id);
    if (!desired || pi.getThinkingLevel() === desired) return;

    pi.setThinkingLevel(desired);

    if (notify && ctx.hasUI) {
      ctx.ui.notify(
        `Thinking default: ${model.provider}/${model.id} → ${desired}`,
        "info",
      );
    }
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.model) applyPreferredThinking(ctx.model, ctx, false);
  });

  pi.on("model_select", (event, ctx) => {
    applyPreferredThinking(event.model, ctx, true);
  });
}
