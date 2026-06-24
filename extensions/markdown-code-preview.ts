import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import process from "node:process";

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

type CodeBlockCache = Map<string, { text: string; lang?: string }>;

const patchVersion = "5-brighter-accent-background";

declare global {
  // eslint-disable-next-line no-var
  var __piNekoMarkdownCodePreviewPatched: boolean | undefined;
  // eslint-disable-next-line no-var
  var __piNekoMarkdownCodePreviewPatchVersion: string | undefined;
  // eslint-disable-next-line no-var
  var __piNekoMarkdownCodeBlocks: CodeBlockCache | undefined;
}

const maxCodeBlocks = 200;
// Blue/cyan-tinted background to match the minimal footer's accent style.
// Bright enough to show on dark terminals without becoming high-contrast noise.
const codeBg = "\u001b[48;2;18;55;68m";
const resetBg = "\u001b[49m";

function codeBackground(line: string): string {
  const content = line.length > 0 ? line : " ";
  return `${codeBg}${content.replace(/\u001b\[0m/g, `\u001b[0m${codeBg}`)}${resetBg}`;
}

function getCodeBlocks(): CodeBlockCache {
  if (!globalThis.__piNekoMarkdownCodeBlocks) {
    globalThis.__piNekoMarkdownCodeBlocks = new Map();
  }
  return globalThis.__piNekoMarkdownCodeBlocks;
}

function rememberCodeBlock(code: CodeToken): string {
  const codeBlocks = getCodeBlocks();
  const id = createHash("sha1")
    .update(code.lang ?? "")
    .update("\0")
    .update(code.text)
    .digest("hex")
    .slice(0, 8);

  codeBlocks.delete(id);
  codeBlocks.set(id, { text: code.text, lang: code.lang });

  while (codeBlocks.size > maxCodeBlocks) {
    const oldest = codeBlocks.keys().next().value;
    if (!oldest) break;
    codeBlocks.delete(oldest);
  }

  return id;
}

function copyWithCommand(command: string, args: string[], text: string): boolean {
  const result = spawnSync(command, args, { input: text, stdio: ["pipe", "ignore", "ignore"] });
  return result.status === 0;
}

function copyToClipboard(text: string): "system" | "osc52" | "failed" {
  if (process.platform === "darwin" && copyWithCommand("pbcopy", [], text)) return "system";
  if (copyWithCommand("wl-copy", [], text)) return "system";
  if (copyWithCommand("xclip", ["-selection", "clipboard"], text)) return "system";
  if (copyWithCommand("xsel", ["--clipboard", "--input"], text)) return "system";
  if (process.platform === "win32" && copyWithCommand("clip.exe", [], text)) return "system";

  if (process.stdout.isTTY) {
    const encoded = Buffer.from(text, "utf8").toString("base64");
    process.stdout.write(`\u001b]52;c;${encoded}\u0007`);
    return "osc52";
  }

  return "failed";
}

function patchMarkdownCodeBlocks(): PatchState {
  const proto = Markdown.prototype as unknown as { renderToken?: RenderToken };
  const original = proto.renderToken;
  if (globalThis.__piNekoMarkdownCodePreviewPatchVersion === patchVersion) {
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
    const language = code.lang?.trim();
    const id = rememberCodeBlock(code);
    const lines: string[] = [];

    lines.push(
      this.theme.codeBlockBorder(language ? `${language}  copy: /copy-code ${id}` : `code  copy: /copy-code ${id}`),
    );

    const highlightedLines = this.theme.highlightCode
      ? this.theme.highlightCode(code.text, code.lang)
      : code.text.split("\n").map((line) => this.theme.codeBlock(line));

    for (const line of highlightedLines) {
      lines.push(codeBackground(line));
    }

    if (nextTokenType && nextTokenType !== "space") {
      lines.push("");
    }

    return lines;
  };

  globalThis.__piNekoMarkdownCodePreviewPatched = true;
  globalThis.__piNekoMarkdownCodePreviewPatchVersion = patchVersion;
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

  pi.registerCommand("copy-code", {
    description: "Copy a rendered markdown code block by id",
    getArgumentCompletions: (argumentPrefix) =>
      Array.from(getCodeBlocks().keys())
        .filter((id) => id.startsWith(argumentPrefix.trim()))
        .map((id) => ({ value: id, label: id })),
    handler: async (args, ctx) => {
      const id = args.trim();
      const block = getCodeBlocks().get(id);

      if (!id || !block) {
        ctx.ui.notify("Code block not found. Use id shown in code-block header.", "warning");
        return;
      }

      const method = copyToClipboard(block.text);
      if (method === "failed") {
        ctx.ui.notify("Clipboard unavailable. Select/copy code manually.", "warning");
        return;
      }

      ctx.ui.notify(method === "osc52" ? "Code copied via OSC52" : "Code copied", "info");
    },
  });
}
