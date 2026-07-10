import assert from "node:assert/strict";
import test from "node:test";

import defaultCavemanMode from "../extensions/default-caveman-mode.ts";
import { createMockExtensionHarness } from "./helpers/mock-extension-api.ts";

function markerFrom(result: any): string {
  const content = result?.message?.content;
  assert.equal(typeof content, "string");
  const marker = content.match(/\[pi-neko:caveman-source:v1:[a-f0-9]+\]/)?.[0];
  assert.ok(marker);
  return marker;
}

test("injects source when active context has no matching marker", async () => {
  const harness = createMockExtensionHarness();
  defaultCavemanMode(harness.api);

  const [result] = await harness.emit("before_agent_start", { systemPrompt: "base" });

  assert.ok((result as any).message);
  assert.match((result as any).systemPrompt, /Always-on skill reminder/);
});

test("does not duplicate source while marker remains in active context", async () => {
  const harness = createMockExtensionHarness();
  defaultCavemanMode(harness.api);
  const [first] = await harness.emit("before_agent_start", { systemPrompt: "base" });
  const marker = markerFrom(first);
  harness.state.contextEntries = [{ type: "custom_message", content: marker }];

  const [second] = await harness.emit("before_agent_start", { systemPrompt: "base" });

  assert.equal((second as any).message, undefined);
});

test("reinjects source when compaction removes marker from active context", async () => {
  const harness = createMockExtensionHarness();
  defaultCavemanMode(harness.api);
  const [first] = await harness.emit("before_agent_start", { systemPrompt: "base" });
  const marker = markerFrom(first);
  harness.state.branch = [{ type: "custom_message", content: marker }];
  harness.state.contextEntries = [{ type: "compaction", summary: "Earlier context" }];

  const [second] = await harness.emit("before_agent_start", { systemPrompt: "base" });

  assert.ok((second as any).message);
});

test("reinjects on a tree branch without the marker", async () => {
  const harness = createMockExtensionHarness();
  defaultCavemanMode(harness.api);
  harness.state.contextEntries = [{ type: "message", message: { role: "user", content: "branched" } }];

  const [result] = await harness.emit("before_agent_start", { systemPrompt: "base" });

  assert.ok((result as any).message);
});

test("ignores stale marker from a different skill hash", async () => {
  const harness = createMockExtensionHarness();
  defaultCavemanMode(harness.api);
  harness.state.contextEntries = [
    { type: "custom_message", content: "[pi-neko:caveman-source:v1:deadbeef]" },
  ];

  const [result] = await harness.emit("before_agent_start", { systemPrompt: "base" });

  assert.ok((result as any).message);
  assert.doesNotMatch((result as any).message.content, /v1:deadbeef/);
});
