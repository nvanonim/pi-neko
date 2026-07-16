import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import askUser from "../extensions/ask-user.ts";
import {
  addCustomAnswer,
  allAnswered,
  createAskUserState,
  normalizeQuestions,
  removeCustomAnswer,
  resultAnswers,
  toggleOption,
  validateQuestions,
} from "../lib/ask-user-state.ts";
import { createIdentityTheme, createMockExtensionHarness } from "./helpers/mock-extension-api.ts";

const rawQuestions = [
  {
    id: "platforms",
    header: "Platforms",
    question: "Which platforms should launch first?",
    options: [
      { label: "Web (Recommended)", description: "Fastest route to users." },
      { label: "iOS", description: "Native Apple experience." },
    ],
    multiple: true,
  },
  {
    id: "storage",
    header: "Storage",
    question: "Which storage should we use?",
    options: [
      { label: "PostgreSQL (Recommended)", description: "Fits relational data." },
      { label: "SQLite", description: "Minimizes deployment complexity." },
    ],
  },
];

function setup() {
  const harness = createMockExtensionHarness();
  askUser(harness.api);
  const tool = harness.tools.get("ask_user");
  assert.ok(tool);
  return { harness, tool };
}

test("normalizes optional behavior and validates question limits", () => {
  const questions = normalizeQuestions(rawQuestions);

  assert.equal(questions[0]?.multiple, true);
  assert.equal(questions[0]?.allowCustom, true);
  assert.equal(questions[1]?.multiple, false);
  assert.deepEqual(validateQuestions(questions), []);

  const invalid = normalizeQuestions([
    {
      ...rawQuestions[0]!,
      id: "Bad ID",
      header: "x".repeat(31),
      options: [
        { label: "duplicate", description: "" },
        { label: "duplicate", description: "Valid duplicate label." },
      ],
    },
  ]);
  assert.match(validateQuestions(invalid).join("\n"), /lowercase snake_case/);
  assert.match(validateQuestions(invalid).join("\n"), /header must contain 1 to 30 characters/);
  assert.match(validateQuestions(invalid).join("\n"), /duplicate label duplicate/);
});

test("multi-select toggles choices and retains a custom answer", () => {
  const questions = normalizeQuestions(rawQuestions);
  const platforms = questions[0]!;
  let state = createAskUserState();

  state = toggleOption(state, platforms, "Web (Recommended)");
  state = toggleOption(state, platforms, "iOS");
  state = addCustomAnswer(state, platforms, "Desktop");
  assert.deepEqual(resultAnswers(state, [platforms]), [
    { id: "platforms", values: ["Web (Recommended)", "iOS"], custom: ["Desktop"] },
  ]);

  state = toggleOption(state, platforms, "iOS");
  assert.deepEqual(resultAnswers(state, [platforms])[0]?.values, ["Web (Recommended)"]);

  state = removeCustomAnswer(state, platforms, "Desktop");
  assert.deepEqual(resultAnswers(state, [platforms])[0]?.custom, []);
});

test("single-choice and custom answers replace earlier choices", () => {
  const questions = normalizeQuestions(rawQuestions);
  const storage = questions[1]!;
  let state = createAskUserState();

  state = toggleOption(state, storage, "PostgreSQL (Recommended)");
  state = toggleOption(state, storage, "SQLite");
  assert.deepEqual(resultAnswers(state, [storage]), [
    { id: "storage", values: ["SQLite"], custom: [] },
  ]);

  state = addCustomAnswer(state, storage, "DynamoDB");
  assert.deepEqual(resultAnswers(state, [storage]), [
    { id: "storage", values: [], custom: ["DynamoDB"] },
  ]);
});

test("requires every question before final submission", () => {
  const questions = normalizeQuestions(rawQuestions);
  let state = createAskUserState();
  state = toggleOption(state, questions[0]!, "Web (Recommended)");
  assert.equal(allAnswered(state, questions), false);
  state = toggleOption(state, questions[1]!, "PostgreSQL (Recommended)");
  assert.equal(allAnswered(state, questions), true);
});

test("modal keyboard flow selects multiple answers then submits review", async () => {
  const { harness, tool } = setup();
  harness.state.customPending = true;
  const pending = tool.execute("ask-1", { questions: rawQuestions }, undefined, undefined, harness.ctx);
  await Promise.resolve();

  harness.state.customComponent.handleInput(" ");
  harness.state.customComponent.handleInput("\x1b[B");
  harness.state.customComponent.handleInput(" ");
  harness.state.customComponent.handleInput("\t");
  harness.state.customComponent.handleInput("\r");
  assert.match(harness.state.customComponent.render(120).join("\n"), /Tab\/←→ change answers/);
  harness.state.customComponent.handleInput("\r");
  const result = await pending;

  assert.deepEqual(result.details.answers, [
    { id: "platforms", values: ["Web (Recommended)", "iOS"], custom: [] },
    { id: "storage", values: ["PostgreSQL (Recommended)"], custom: [] },
  ]);
});

test("multi-select modal removes a saved custom answer", async () => {
  const { harness, tool } = setup();
  harness.state.customPending = true;
  const question = [{ ...rawQuestions[0]!, options: rawQuestions[0]!.options }];
  const pending = tool.execute("ask-1", { questions: question }, undefined, undefined, harness.ctx);
  await Promise.resolve();

  harness.state.customComponent.handleInput("\x1b[B");
  harness.state.customComponent.handleInput("\x1b[B");
  harness.state.customComponent.handleInput("\r");
  harness.state.customComponent.handleInput("Desktop");
  harness.state.customComponent.handleInput("\r");
  assert.match(harness.state.customComponent.render(120).join("\n"), /Custom: Desktop/);

  harness.state.customComponent.handleInput(" ");
  assert.doesNotMatch(harness.state.customComponent.render(120).join("\n"), /Custom: Desktop/);
  harness.state.customComponent.handleInput("\x1b");
  const result = await pending;
  assert.equal(result.details.cancelled, true);
});

test("single-choice modal submits immediately and accepts custom text", async () => {
  const { harness, tool } = setup();
  harness.state.customPending = true;
  const question = [{
    id: "storage",
    header: "Storage",
    question: "Which storage should we use?",
    options: rawQuestions[1]!.options,
  }];
  const pending = tool.execute("ask-1", { questions: question }, undefined, undefined, harness.ctx);
  await Promise.resolve();

  harness.state.customComponent.handleInput("\x1b[B");
  harness.state.customComponent.handleInput("\x1b[B");
  harness.state.customComponent.handleInput("\r");
  harness.state.customComponent.handleInput("DynamoDB");
  harness.state.customComponent.handleInput("\r");
  const result = await pending;

  assert.deepEqual(result.details.answers, [
    { id: "storage", values: [], custom: ["DynamoDB"] },
  ]);
});

test("returns selected answers from the interactive UI", async () => {
  const { harness, tool } = setup();
  harness.state.customResult = {
    questions: normalizeQuestions(rawQuestions),
    answers: [
      { id: "platforms", values: ["Web (Recommended)", "iOS"], custom: [] },
      { id: "storage", values: [], custom: ["DynamoDB"] },
    ],
    cancelled: false,
  };

  const result = await tool.execute("ask-1", { questions: rawQuestions }, undefined, undefined, harness.ctx);

  assert.match(result.content[0]?.text ?? "", /platforms: Web \(Recommended\), iOS/);
  assert.match(result.content[0]?.text ?? "", /storage: DynamoDB/);
  assert.equal(result.details.cancelled, false);
});

test("modal rendering respects narrow terminal widths", async () => {
  const { harness, tool } = setup();
  harness.state.customResult = { questions: normalizeQuestions(rawQuestions), answers: [], cancelled: true };

  await tool.execute("ask-1", { questions: rawQuestions }, undefined, undefined, harness.ctx);

  harness.state.customComponent.render(100);
  const lines = harness.state.customComponent.render(18) as string[];
  assert.ok(lines.length > 0);
  assert.ok(lines.every((line) => visibleWidth(line) <= 18));
});

test("returns cancellation without inventing an answer", async () => {
  const { harness, tool } = setup();
  harness.state.customResult = undefined;

  const result = await tool.execute("ask-1", { questions: rawQuestions }, undefined, undefined, harness.ctx);

  assert.equal(result.details.cancelled, true);
  assert.deepEqual(result.details.answers, []);
  assert.match(result.content[0]?.text ?? "", /cancelled/);
});

test("throws for invalid requests and non-TUI execution", async () => {
  const { harness, tool } = setup();
  await assert.rejects(
    tool.execute("ask-1", { questions: [{ ...rawQuestions[0]!, options: [rawQuestions[0]!.options[0]!] }] }, undefined, undefined, harness.ctx),
    /ask_user validation failed/,
  );

  (harness.ctx as any).mode = "print";
  await assert.rejects(
    tool.execute("ask-2", { questions: rawQuestions }, undefined, undefined, harness.ctx),
    /requires an interactive TUI/,
  );
});

test("renders cancellation, answers, and tool-error fallback", () => {
  const { tool } = setup();
  const theme = createIdentityTheme();
  const cancelled = tool.renderResult(
    { content: [{ type: "text", text: "User cancelled ask_user." }], details: { questions: [], answers: [], cancelled: true } },
    { expanded: false, isPartial: false },
    theme,
  );
  const failure = tool.renderResult(
    { content: [{ type: "text", text: "ask_user requires an interactive TUI" }], details: undefined },
    { expanded: false, isPartial: false },
    theme,
  );

  assert.match(cancelled.render(12).join("\n"), /Cancelled/);
  assert.match(failure.render(80).join("\n"), /interactive TUI/);
});
