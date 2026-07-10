import assert from "node:assert/strict";
import test from "node:test";

import minimalTextchatFooter, {
  countGitChanges,
  gitChangeFlags,
  parseGitStatus,
} from "../extensions/minimal-textchat-footer.ts";
import {
  createFooterData,
  createIdentityTheme,
  createMockExtensionHarness,
} from "./helpers/mock-extension-api.ts";

const assistantEntry = (cost: number) => ({
  type: "message",
  message: {
    role: "assistant",
    usage: { cost: { total: cost } },
  },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("parses porcelain v1 -z including dual status, rename, and unusual filenames", () => {
  const output = "MM both.ts\0?? odd\nname.ts\0R  new name.ts\0old name.ts\0";
  const changes = parseGitStatus(output);

  assert.deepEqual(changes, [
    { status: "MM", path: "both.ts" },
    { status: "??", path: "odd\nname.ts" },
    { status: "R ", path: "new name.ts", originalPath: "old name.ts" },
  ]);
  assert.deepEqual(gitChangeFlags("MM"), { staged: true, unstaged: true, untracked: false });
  assert.deepEqual(countGitChanges(changes), { staged: 2, unstaged: 1, untracked: 1 });
  assert.deepEqual(parseGitStatus(""), []);
});

test("widget and footer use the same dual-status totals", async () => {
  const harness = createMockExtensionHarness();
  harness.state.execResult.stdout = "MM both.ts\0?? odd\nname.ts\0";
  minimalTextchatFooter(harness.api);

  await harness.commands.get("git-changes").handler("show", harness.ctx);

  const widgetFactory = harness.widgets.get("git-changes") as any;
  assert.equal(typeof widgetFactory, "function");
  const widget = widgetFactory({ requestRender() {} }, createIdentityTheme());
  const lines = widget.render(120);
  assert.match(lines[0], /\+1 \*1 \?1/);
  assert.match(lines[1], /\+M\/\*M.*both\.ts/);
  assert.match(lines[2], /odd\\nname\.ts/);
  assert.deepEqual(harness.execCalls[0]?.args, ["status", "--porcelain=v1", "-z"]);
});

test("renders tracked dollar cost for API-key models", async (t) => {
  const harness = createMockExtensionHarness();
  minimalTextchatFooter(harness.api);
  harness.state.model = { provider: "deepseek", id: "deepseek-v4-pro", contextWindow: 1_000_000 };
  harness.state.branch = [assistantEntry(1.25), assistantEntry(0.5)];
  t.after(async () => harness.emit("session_shutdown", { reason: "quit" }));

  await harness.emit("session_start", { reason: "startup" });
  const component = harness.state.footerFactory(
    { requestRender() {} },
    createIdentityTheme(),
    createFooterData("main", harness.statuses),
  );
  const line = component.render(160)[0];

  assert.match(line, /\$1\.75/);
  assert.doesNotMatch(line, /subs/);
});

test("renders subs without dollars for OAuth models and updates on model switch", async (t) => {
  const harness = createMockExtensionHarness();
  minimalTextchatFooter(harness.api);
  harness.state.model = { provider: "deepseek", id: "deepseek-v4-pro" };
  harness.state.branch = [assistantEntry(99.5)];
  harness.state.oauthProviders.add("openai-codex");
  t.after(async () => harness.emit("session_shutdown", { reason: "quit" }));

  await harness.emit("session_start", { reason: "startup" });
  const component = harness.state.footerFactory(
    { requestRender() {} },
    createIdentityTheme(),
    createFooterData("main", harness.statuses),
  );
  assert.match(component.render(160)[0], /\$99\.50/);

  const subscriptionModel = { provider: "openai-codex", id: "gpt-5.4", contextWindow: 272_000 };
  await harness.emit("model_select", {
    model: subscriptionModel,
    previousModel: harness.state.model,
    source: "set",
  });
  const line = component.render(160)[0];

  assert.match(line, /subs/);
  assert.doesNotMatch(line, /\$/);
});

test("late show response cannot resurrect a hidden widget", async () => {
  const harness = createMockExtensionHarness();
  const pending = deferred<{ stdout: string; stderr: string; code: number; killed: boolean }>();
  (harness.api as any).exec = () => pending.promise;
  minimalTextchatFooter(harness.api);
  const gitCommand = harness.commands.get("git-changes");

  const showing = gitCommand.handler("show", harness.ctx);
  await Promise.resolve();
  await gitCommand.handler("hide", harness.ctx);
  pending.resolve({ stdout: "?? late.txt\0", stderr: "", code: 0, killed: false });
  await showing;

  assert.equal(harness.widgets.has("git-changes"), false);
});

test("late show response cannot resurrect widget after footer disable", async () => {
  const harness = createMockExtensionHarness();
  const pending = deferred<{ stdout: string; stderr: string; code: number; killed: boolean }>();
  (harness.api as any).exec = () => pending.promise;
  minimalTextchatFooter(harness.api);
  const gitCommand = harness.commands.get("git-changes");
  const footerCommand = harness.commands.get("textchat-footer");

  const showing = gitCommand.handler("show", harness.ctx);
  await Promise.resolve();
  await footerCommand.handler("off", harness.ctx);
  pending.resolve({ stdout: "?? late.txt\0", stderr: "", code: 0, killed: false });
  await showing;

  assert.equal(harness.widgets.has("git-changes"), false);
});

test("older widget request cannot overwrite newer Git status", async () => {
  const harness = createMockExtensionHarness();
  const first = deferred<{ stdout: string; stderr: string; code: number; killed: boolean }>();
  const second = deferred<{ stdout: string; stderr: string; code: number; killed: boolean }>();
  const requests = [first, second];
  (harness.api as any).exec = () => requests.shift()!.promise;
  minimalTextchatFooter(harness.api);
  const gitCommand = harness.commands.get("git-changes");

  const firstShow = gitCommand.handler("show", harness.ctx);
  await Promise.resolve();
  const secondShow = gitCommand.handler("show", harness.ctx);
  await Promise.resolve();
  second.resolve({ stdout: "?? newest.txt\0", stderr: "", code: 0, killed: false });
  await secondShow;

  const renderWidget = () => {
    const factory = harness.widgets.get("git-changes") as any;
    return factory({ requestRender() {} }, createIdentityTheme()).render(120).join("\n");
  };
  assert.match(renderWidget(), /newest\.txt/);

  first.resolve({ stdout: "?? stale.txt\0", stderr: "", code: 0, killed: false });
  await firstShow;
  assert.match(renderWidget(), /newest\.txt/);
  assert.doesNotMatch(renderWidget(), /stale\.txt/);
});

test("older polling request cannot overwrite newer footer Git totals", async (t) => {
  const harness = createMockExtensionHarness();
  const first = deferred<{ stdout: string; stderr: string; code: number; killed: boolean }>();
  const second = deferred<{ stdout: string; stderr: string; code: number; killed: boolean }>();
  const requests = [first, second];
  (harness.api as any).exec = () => requests.shift()!.promise;
  minimalTextchatFooter(harness.api);
  harness.state.model = { provider: "deepseek", id: "deepseek-v4-pro" };
  t.after(async () => harness.emit("session_shutdown", { reason: "quit" }));

  await harness.emit("session_start", { reason: "startup" });
  let branchChanged = () => {};
  const footerData = {
    getGitBranch: () => "main",
    getExtensionStatuses: () => harness.statuses,
    onBranchChange(listener: () => void) {
      branchChanged = listener;
      return () => {};
    },
  };
  const component = harness.state.footerFactory(
    { requestRender() {} },
    createIdentityTheme(),
    footerData,
  );

  branchChanged();
  await Promise.resolve();
  second.resolve({ stdout: "MM newest.txt\0", stderr: "", code: 0, killed: false });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.match(component.render(160)[0], /main \+1 \*1/);

  first.resolve({ stdout: "?? stale.txt\0", stderr: "", code: 0, killed: false });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const line = component.render(160)[0];
  assert.match(line, /main \+1 \*1/);
  assert.doesNotMatch(line, /\?1/);
});

test("footer disable keeps widget visibility state synchronized", async () => {
  const harness = createMockExtensionHarness();
  minimalTextchatFooter(harness.api);
  const footerCommand = harness.commands.get("textchat-footer");
  const gitCommand = harness.commands.get("git-changes");

  await gitCommand.handler("show", harness.ctx);
  assert.ok(harness.widgets.has("git-changes"));

  await footerCommand.handler("off", harness.ctx);
  await footerCommand.handler("off", harness.ctx);
  assert.equal(harness.widgets.has("git-changes"), false);

  await gitCommand.handler("toggle", harness.ctx);
  assert.ok(harness.widgets.has("git-changes"));
});
