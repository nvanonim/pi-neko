import assert from "node:assert/strict";
import test from "node:test";

import modelThinkingDefaults from "../extensions/model-thinking-defaults.ts";
import { createMockExtensionHarness } from "./helpers/mock-extension-api.ts";

function setup() {
  const harness = createMockExtensionHarness();
  modelThinkingDefaults(harness.api);
  return harness;
}

test("silently enforces preferred thinking for startup model", async () => {
  const harness = setup();
  harness.state.model = { provider: "openai-codex", id: "gpt-5.4" };
  harness.state.thinkingLevel = "high";

  await harness.emit("session_start", { reason: "startup" });

  assert.equal(harness.state.thinkingLevel, "medium");
  assert.deepEqual(harness.thinkingChanges, ["medium"]);
  assert.equal(harness.notifications.length, 0);
});

test("applies and reports preferred thinking on model selection", async () => {
  const harness = setup();
  harness.state.thinkingLevel = "off";
  const model = { provider: "deepseek", id: "deepseek-v4-pro" };

  await harness.emit("model_select", { model, previousModel: undefined, source: "set" });

  assert.equal(harness.state.thinkingLevel, "high");
  assert.match(harness.notifications[0]?.message ?? "", /deepseek\/deepseek-v4-pro → high/);
});

test("does nothing when preferred level is already active", async () => {
  const harness = setup();
  harness.state.thinkingLevel = "medium";
  const model = { provider: "openai-codex", id: "gpt-5.5" };

  await harness.emit("model_select", { model, previousModel: undefined, source: "restore" });

  assert.deepEqual(harness.thinkingChanges, []);
  assert.deepEqual(harness.notifications, []);
});

test("does not change nonmatching models", async () => {
  const harness = setup();
  harness.state.model = { provider: "anthropic", id: "claude-sonnet" };
  harness.state.thinkingLevel = "low";

  await harness.emit("session_start", { reason: "startup" });

  assert.equal(harness.state.thinkingLevel, "low");
  assert.deepEqual(harness.thinkingChanges, []);
});
