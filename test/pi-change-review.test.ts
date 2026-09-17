import assert from "node:assert/strict";
import test from "node:test";
import { buildEditorLaunches, chooseEditor, editorProbeArgs, reportOpenLaunch, selectReviewId, validConfig } from "../extensions/pi-change-review.ts";

const files = [
  { beforePath: "/tmp/review/before/a.ts", afterPath: "/work/a.ts" },
  { beforePath: "/tmp/review/before/b.ts", afterPath: "/work/b.ts" },
];

test("probes Zed with --help for macOS compatibility", () => {
  assert.deepEqual(editorProbeArgs("zed"), ["--help"]);
});

test("selects Zed before VS Code and Codium", async () => {
  const calls: string[] = [];
  const selected = await chooseEditor({}, async (command) => {
    calls.push(command);
    return command === "zed";
  });
  assert.equal(selected, "zed");
  assert.deepEqual(calls, ["zed"]);
});

test("falls back through editor priority after unavailable probes", async () => {
  const calls: string[] = [];
  const selected = await chooseEditor({}, async (command) => {
    calls.push(command);
    return command === "codium";
  });
  assert.equal(selected, "codium");
  assert.deepEqual(calls, ["zed", "code", "codium"]);
});

test("uses report when every editor probe fails", async () => {
  assert.equal(await chooseEditor({}, async () => false), "report");
});

test("honors explicitly configured editor without probing", async () => {
  let probes = 0;
  assert.equal(await chooseEditor({ editor: "vscode" }, async () => {
    probes += 1;
    return true;
  }), "vscode");
  assert.equal(probes, 0);
});

test("builds one Linux Zed launch with every diff pair", () => {
  assert.deepEqual(buildEditorLaunches("zed", files, "/tmp/review/report.md", {}, "linux"), [
    {
      command: "zed",
      args: [
        "--diff", "/tmp/review/before/a.ts", "/work/a.ts",
        "--diff", "/tmp/review/before/b.ts", "/work/b.ts",
      ],
    },
  ]);
});

test("launches macOS Zed through open so Pi cannot kill it on timeout", () => {
  assert.deepEqual(buildEditorLaunches("zed", files, "/tmp/review/report.md", {}, "darwin"), [
    {
      command: "open",
      args: [
        "-a", "Zed", "--args",
        "--diff", "/tmp/review/before/a.ts", "/work/a.ts",
        "--diff", "/tmp/review/before/b.ts", "/work/b.ts",
      ],
    },
  ]);
});

test("builds one VS Code invocation per diff pair", () => {
  assert.deepEqual(buildEditorLaunches("vscode", files, "/tmp/review/report.md"), [
    { command: "code", args: ["--reuse-window", "--diff", "/tmp/review/before/a.ts", "/work/a.ts"] },
    { command: "code", args: ["--reuse-window", "--diff", "/tmp/review/before/b.ts", "/work/b.ts"] },
  ]);
});

test("uses the custom command template for each diff", () => {
  assert.deepEqual(
    buildEditorLaunches("custom", files, "/tmp/review/report.md", {
      command: "my-editor",
      args: ["compare", "{before}", "{after}", "--report={report}"],
    }),
    [
      {
        command: "my-editor",
        args: ["compare", "/tmp/review/before/a.ts", "/work/a.ts", "--report=/tmp/review/report.md"],
      },
      {
        command: "my-editor",
        args: ["compare", "/tmp/review/before/b.ts", "/work/b.ts", "--report=/tmp/review/report.md"],
      },
    ],
  );
});

test("opens the report when no structured diff is available", () => {
  assert.deepEqual(buildEditorLaunches("zed", [{ beforePath: undefined, afterPath: undefined }], "/tmp/review/report.md", {}, "darwin"), [
    reportOpenLaunch("/tmp/review/report.md"),
  ]);
});

test("uses report fallback for incomplete custom configuration", () => {
  assert.deepEqual(buildEditorLaunches("custom", files, "/tmp/review/report.md"), [
    reportOpenLaunch("/tmp/review/report.md"),
  ]);
});

test("accepts only an existing review ID", () => {
  const ids = ["2026-03-01-a1b2c3d4"];
  assert.equal(selectReviewId(ids, undefined), ids[0]);
  assert.equal(selectReviewId(ids, "latest"), ids[0]);
  assert.equal(selectReviewId(ids, "../../outside"), undefined);
  assert.equal(selectReviewId(ids, ids[0]), ids[0]);
});

test("drops malformed editor configuration values", () => {
  assert.deepEqual(validConfig({ editor: "custom", command: "viewer", args: "bad" }), {
    editor: "custom",
    command: "viewer",
  });
  assert.deepEqual(validConfig({ editor: "not-an-editor", command: 1, args: ["ok", 2] }), {});
});
