import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

test("package enables every extension except the retained Caveman integration", () => {
  const root = new URL("../", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  const enabled = readdirSync(new URL("extensions/", root))
    .filter((name) => name.endsWith(".ts") && name !== "default-caveman-mode.ts")
    .map((name) => `./extensions/${name}`)
    .sort();

  assert.deepEqual([...manifest.pi.extensions].sort(), enabled);
  assert.doesNotThrow(() => readFileSync(new URL("extensions/default-caveman-mode.ts", root)));
  assert.doesNotThrow(() => readFileSync(new URL("test/default-caveman-mode.test.ts", root)));
});
