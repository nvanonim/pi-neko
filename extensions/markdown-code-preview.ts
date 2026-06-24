import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";

type CodeToken = {
  type: "code";
  text: string;
  lang?: string;
};

type MarkdownInstance = {
  theme: {
    codeBlock: (text: string) => string;
    codeBlockBorder: (text: string) => string;
    highlightCode?: (code: string, lang?: string) => string[];
    codeBlockIndent?: string;
  };
};

type RenderToken = (
  this: MarkdownInstance,
  token: { type: string },
  width: number,
  nextTokenType?: string,
  styleContext?: unknown,
) => string[];

type PatchState = "patched-now" | "already-patched" | "unsupported";

declare global {
  // eslint-disable-next-line no-var
  var __piNekoMarkdownCodePreviewPatched: boolean | undefined;
}

function patchMarkdownCodeBlocks(): PatchState {
  const proto = Markdown.prototype as unknown as { renderToken?: RenderToken };
  const original = proto.renderToken;
  if (globalThis.__piNekoMarkdownCodePreviewPatched) {
    return "already-patched";
  }
  if (typeof original !== "function") {
    return "unsupported";
  }

  proto.renderToken = function patchedRenderToken(token, width, nextTokenType, styleContext) {
    if (token.type !== "code") {
      return original.call(this, token, width, nextTokenType, styleContext);
    }

    const code = token as CodeToken;
    const indent = this.theme.codeBlockIndent ?? "  ";
    const language = code.lang?.trim();
    const lines: string[] = [];

    lines.push(this.theme.codeBlockBorder(language ? `╭─ ${language}` : "╭─ code"));

    const highlightedLines = this.theme.highlightCode
      ? this.theme.highlightCode(code.text, code.lang)
      : code.text.split("\n").map((line) => this.theme.codeBlock(line));

    for (const line of highlightedLines) {
      lines.push(`${this.theme.codeBlockBorder("│")} ${indent}${line}`);
    }

    lines.push(this.theme.codeBlockBorder("╰─"));

    if (nextTokenType && nextTokenType !== "space") {
      lines.push("");
    }

    return lines;
  };

  globalThis.__piNekoMarkdownCodePreviewPatched = true;
  return "patched-now";
}

export default function (pi: ExtensionAPI) {
  let patchState = patchMarkdownCodeBlocks();

  pi.registerCommand("markdown-code-preview", {
    description: "Show markdown code blocks as preview blocks instead of raw fences",
    handler: async (_args, ctx) => {
      if (patchState === "unsupported") patchState = patchMarkdownCodeBlocks();

      if (patchState === "unsupported") {
        ctx.ui.notify("Markdown code preview unsupported in this Pi version", "warning");
        return;
      }

      ctx.ui.notify("Markdown code preview enabled", "info");
    },
  });
}
