import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import {
  addCustomAnswer,
  allAnswered,
  createAskUserState,
  currentAnswer,
  normalizeQuestions,
  removeCustomAnswer,
  resultAnswers,
  toggleOption,
  validateQuestions,
  type AskUserAnswer,
  type AskUserDetails,
  type AskUserQuestion,
} from "../lib/ask-user-state.ts";
import {
  ASK_USER_RELAY_ENV,
  requestAskUserRelay,
  startAskUserRelay,
  type AskUserRelayServer,
} from "../lib/ask-user-relay.ts";

const OptionSchema = Type.Object({
  label: Type.String({ description: "Display label, 1-5 words. Put recommended choice first and suffix it with (Recommended)." }),
  description: Type.String({ description: "One short sentence explaining this choice's impact or tradeoff." }),
});

const QuestionSchema = Type.Object({
  id: Type.String({ description: "Stable lowercase snake_case identifier for this answer." }),
  header: Type.String({ description: "Short UI label, at most 30 characters." }),
  question: Type.String({ description: "One concise user-facing question." }),
  options: Type.Array(OptionSchema, { minItems: 2, maxItems: 4, description: "2-4 meaningful choices. Do not add Other; UI adds it when allowed." }),
  multiple: Type.Optional(Type.Boolean({ description: "Allow selecting multiple choices. Defaults to false." })),
  allowCustom: Type.Optional(Type.Boolean({ description: "Allow a custom typed answer. Defaults to true." })),
});

const AskUserParams = Type.Object({
  questions: Type.Array(QuestionSchema, {
    minItems: 1,
    maxItems: 3,
    description: "1-3 material decisions. Ask only after exploring facts the repository can answer.",
  }),
}, { additionalProperties: false });

type AskUserInput = Static<typeof AskUserParams>;

const TOOL_DESCRIPTION = `Ask the user 1-3 material, non-discoverable questions during execution. Use only after exploring facts the repository or system can answer.

Use ask_user when:
- A preference or tradeoff materially changes implementation.
- A destructive, security, billing, or production decision needs explicit direction.
- A required secret, account identifier, or business value cannot be inferred.

Do not use ask_user for permission questions such as whether to proceed or run tests. Do not ask facts you can discover by reading files, searching the repository, or inspecting configuration.

For each question provide 2-4 mutually meaningful options. Put your recommended option first and suffix its label with (Recommended). The UI can add a custom answer automatically.`;

function answerText(answer: AskUserAnswer): string {
  return [...answer.values, ...answer.custom].join(", ");
}

type DisplayChoice =
  | { kind: "option"; label: string; description: string }
  | { kind: "newCustom"; label: string; description: string }
  | { kind: "customAnswer"; label: string; description: string; value: string };

function addWrapped(lines: string[], width: number, prefix: string, text: string): void {
  const prefixWidth = visibleWidth(prefix);
  if (prefixWidth >= width) {
    lines.push(...wrapTextWithAnsi(prefix + text, width));
    return;
  }
  const wrapped = wrapTextWithAnsi(text, width - prefixWidth);
  const continuation = " ".repeat(prefixWidth);
  for (const [index, line] of wrapped.entries()) {
    lines.push(`${index === 0 ? prefix : continuation}${line}`);
  }
}

function formatResult(details: AskUserDetails) {
  if (details.cancelled) {
    return { content: [{ type: "text" as const, text: "User cancelled ask_user." }], details };
  }
  const text = details.answers.map((answer) => `${answer.id}: ${answerText(answer)}`).join("\n");
  return { content: [{ type: "text" as const, text }], details };
}

export default function askUser(pi: ExtensionAPI) {
  const tool = defineTool({
    name: "ask_user",
    label: "Ask User",
    description: TOOL_DESCRIPTION,
    promptSnippet: "Ask the user 1-3 material implementation questions with choices, multi-select, and custom answers.",
    promptGuidelines: [
      "Use ask_user only after exploring repository-discoverable facts and only for material non-discoverable decisions.",
      "For ask_user, provide 2-4 meaningful options, place a recommended option first, and do not ask permission questions such as whether to proceed or run tests.",
    ],
    parameters: AskUserParams,
    executionMode: "sequential",

    async execute(_toolCallId: string, params: AskUserInput, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
      const questions = normalizeQuestions(params.questions);
      const errors = validateQuestions(questions);
      if (errors.length > 0) {
        throw new Error(`ask_user validation failed: ${errors.join("; ")}`);
      }

      if (ctx.mode !== "tui") {
        const relayAddress = process.env[ASK_USER_RELAY_ENV];
        if (!relayAddress) throw new Error("ask_user requires an interactive TUI");
        return formatResult(await requestAskUserRelay(relayAddress, questions, signal));
      }

      if (signal?.aborted) throw new Error("ask_user cancelled");
      let cancelPrompt: (() => void) | undefined;
      const onAbort = () => cancelPrompt?.();
      signal?.addEventListener("abort", onAbort, { once: true });

      const result = await ctx.ui.custom<AskUserDetails | undefined>((tui, theme, _keybindings, done) => {
        let state = createAskUserState();
        let editorVisible = false;
        let cachedLines: string[] | undefined;
        let cachedWidth: number | undefined;
        const editorTheme: EditorTheme = {
          borderColor: (text) => theme.fg("accent", text),
          selectList: {
            selectedPrefix: (text) => theme.fg("accent", text),
            selectedText: (text) => theme.fg("accent", text),
            description: (text) => theme.fg("muted", text),
            scrollInfo: (text) => theme.fg("dim", text),
            noMatch: (text) => theme.fg("warning", text),
          },
        };
        const editor = new Editor(tui, editorTheme);

        const refresh = () => {
          cachedLines = undefined;
          cachedWidth = undefined;
          tui.requestRender();
        };
        const finish = (cancelled: boolean) => {
          done({ questions, answers: resultAnswers(state, questions), cancelled });
        };
        cancelPrompt = () => finish(true);
        if (signal?.aborted) cancelPrompt();
        const activeQuestion = () => questions[state.tab];
        const isReview = () => state.tab === questions.length;
        const options = (question: AskUserQuestion): DisplayChoice[] => {
          const answer = currentAnswer(state, question.id);
          return [
            ...question.options.map((option) => ({ ...option, kind: "option" as const })),
            ...(question.multiple
              ? answer.custom.map((value) => ({
                  kind: "customAnswer" as const,
                  label: `Custom: ${value}`,
                  description: "Remove this custom answer.",
                  value,
                }))
              : []),
            ...(question.allowCustom
              ? [{ kind: "newCustom" as const, label: "Type your own answer", description: "Provide a custom response." }]
              : []),
          ];
        };
        const advance = () => {
          const question = activeQuestion();
          if (questions.length === 1 && question && !question.multiple) {
            finish(false);
            return;
          }
          if (state.tab < questions.length - 1) {
            state = { ...state, tab: state.tab + 1, optionIndex: 0, editing: false };
          } else {
            state = { ...state, tab: questions.length, optionIndex: 0, editing: false };
          }
          refresh();
        };

        editor.onSubmit = (value) => {
          const question = activeQuestion();
          if (!question) return;
          if (!value.trim()) return;
          state = addCustomAnswer(state, question, value);
          editor.setText("");
          editorVisible = false;
          state = { ...state, editing: false };
          if (!question.multiple) advance();
          else refresh();
        };

        const handleInput = (data: string) => {
          if (editorVisible) {
            if (matchesKey(data, Key.escape)) {
              editor.setText("");
              editorVisible = false;
              state = { ...state, editing: false };
              refresh();
              return;
            }
            editor.handleInput(data);
            refresh();
            return;
          }

          if (matchesKey(data, Key.escape)) {
            finish(true);
            return;
          }

          if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
            state = { ...state, tab: (state.tab + 1) % (questions.length + 1), optionIndex: 0, editing: false };
            refresh();
            return;
          }
          if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
            state = { ...state, tab: (state.tab - 1 + questions.length + 1) % (questions.length + 1), optionIndex: 0, editing: false };
            refresh();
            return;
          }

          if (isReview()) {
            if (matchesKey(data, Key.enter) && allAnswered(state, questions)) finish(false);
            return;
          }

          const question = activeQuestion();
          if (!question) return;
          const choices = options(question);
          if (matchesKey(data, Key.up)) {
            state = { ...state, optionIndex: (state.optionIndex - 1 + choices.length) % choices.length };
            refresh();
            return;
          }
          if (matchesKey(data, Key.down)) {
            state = { ...state, optionIndex: (state.optionIndex + 1) % choices.length };
            refresh();
            return;
          }

          const selected = choices[state.optionIndex];
          if (!selected) return;
          if (matchesKey(data, Key.space) || matchesKey(data, Key.enter)) {
            if (selected.kind === "newCustom") {
              editorVisible = true;
              state = { ...state, editing: true };
              refresh();
              return;
            }
            if (selected.kind === "customAnswer") {
              state = removeCustomAnswer(state, question, selected.value);
              refresh();
              return;
            }
            state = toggleOption(state, question, selected.label);
            if (!question.multiple) advance();
            else refresh();
          }
        };

        const render = (width: number): string[] => {
          if (cachedLines && cachedWidth === width) return cachedLines;
          const renderWidth = Math.max(1, width);
          const lines: string[] = [theme.fg("accent", "─".repeat(renderWidth))];
          const review = isReview();
          const tabs = questions.map((question, index) => {
            const answered = currentAnswer(state, question.id);
            const marker = answered.values.length || answered.custom.length ? "■" : "□";
            const text = ` ${marker} ${question.header} `;
            return index === state.tab
              ? theme.bg("selectedBg", theme.fg("text", text))
              : theme.fg(marker === "■" ? "success" : "muted", text);
          });
          const submit = ` ✓ Submit `;
          tabs.push(review ? theme.bg("selectedBg", theme.fg("text", submit)) : theme.fg(allAnswered(state, questions) ? "success" : "dim", submit));
          addWrapped(lines, renderWidth, " ", tabs.join(" "));
          lines.push("");

          if (review) {
            addWrapped(lines, renderWidth, " ", theme.fg("accent", theme.bold("Review answers")));
            lines.push("");
            for (const question of questions) {
              const answer = currentAnswer(state, question.id);
              addWrapped(lines, renderWidth, " ", theme.fg("muted", `${question.header}: `) + theme.fg("text", answerText(answer) || "Unanswered"));
            }
            lines.push("");
            addWrapped(lines, renderWidth, " ", theme.fg(allAnswered(state, questions) ? "success" : "warning", allAnswered(state, questions) ? "Enter submit · Tab/←→ change answers · Esc cancel" : "Answer every question before submitting"));
          } else {
            const question = activeQuestion()!;
            const choices = options(question);
            addWrapped(lines, renderWidth, " ", theme.fg("text", question.question));
            lines.push("");
            for (const [index, choice] of choices.entries()) {
              const selected = index === state.optionIndex;
              const answer = currentAnswer(state, question.id);
              const checked = choice.kind === "option"
                ? answer.values.includes(choice.label)
                : choice.kind === "customAnswer";
              const toggleable = question.multiple && choice.kind !== "newCustom";
              const prefix = selected ? theme.fg("accent", "> ") : "  ";
              const marker = toggleable ? (checked ? "[x] " : "[ ] ") : "";
              addWrapped(lines, renderWidth, prefix, theme.fg(selected ? "accent" : "text", `${index + 1}. ${marker}${choice.label}`));
              addWrapped(lines, renderWidth, "     ", theme.fg("muted", choice.description));
            }
            if (editorVisible) {
              lines.push("");
              addWrapped(lines, renderWidth, " ", theme.fg("muted", "Your answer:"));
              for (const line of editor.render(Math.max(1, renderWidth - 2))) lines.push(` ${line}`);
            }
            lines.push("");
            const help = editorVisible
              ? "Enter to save · Esc to return"
              : question.multiple
                ? "↑↓ select · Space toggle · Tab review · Esc cancel"
                : "↑↓ select · Enter confirm · Tab review · Esc cancel";
            addWrapped(lines, renderWidth, " ", theme.fg("dim", help));
          }
          lines.push(theme.fg("accent", "─".repeat(renderWidth)));
          cachedLines = lines;
          cachedWidth = width;
          return lines;
        };

        return {
          render,
          invalidate: () => {
            cachedLines = undefined;
            cachedWidth = undefined;
          },
          handleInput,
        };
      }).finally(() => signal?.removeEventListener("abort", onAbort));

      const details: AskUserDetails = result ?? { questions, answers: [], cancelled: true };
      return formatResult(details);
    },

    renderCall(args: AskUserInput, theme) {
      const count = args.questions?.length ?? 0;
      const headers = args.questions?.map((question) => question.header).join(", ") ?? "";
      return new Text(
        theme.fg("toolTitle", theme.bold("ask_user ")) + theme.fg("muted", `${count} question${count === 1 ? "" : "s"}${headers ? ` (${headers})` : ""}`),
        0,
        0,
      );
    },

    renderResult(result, _options, theme) {
      const details = result.details as AskUserDetails | undefined;
      if (!details) {
        const content = result.content[0];
        return new Text(content?.type === "text" ? theme.fg("error", content.text) : "", 0, 0);
      }
      if (details.cancelled) return new Text(theme.fg("warning", "Cancelled"), 0, 0);
      return new Text(
        details.answers.map((answer) => theme.fg("success", "✓ ") + theme.fg("accent", `${answer.id}: `) + theme.fg("muted", answerText(answer))).join("\n"),
        0,
        0,
      );
    },
  });

  pi.registerTool(tool);

  let relay: AskUserRelayServer | undefined;
  let previousRelayAddress: string | undefined;
  let relayQueue: Promise<void> = Promise.resolve();

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    previousRelayAddress = process.env[ASK_USER_RELAY_ENV];
    relay = await startAskUserRelay((questions, signal) => {
      const pending = relayQueue.then(async () => {
        const result = await tool.execute("ask-user-relay", { questions }, signal, undefined, ctx);
        return result.details;
      });
      relayQueue = pending.then(() => undefined, () => undefined);
      return pending;
    });
    process.env[ASK_USER_RELAY_ENV] = relay.address;
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (ctx.mode !== "tui" || !relay) return;
    const address = relay.address;
    await relay.close();
    relay = undefined;
    if (process.env[ASK_USER_RELAY_ENV] === address) {
      if (previousRelayAddress === undefined) delete process.env[ASK_USER_RELAY_ENV];
      else process.env[ASK_USER_RELAY_ENV] = previousRelayAddress;
    }
  });
}
