import assert from "node:assert/strict";
import test from "node:test";

import agentTodoWidget from "../extensions/agent-todo-widget.ts";
import { createIdentityTheme, createMockExtensionHarness } from "./helpers/mock-extension-api.ts";

function setup() {
  const harness = createMockExtensionHarness();
  agentTodoWidget(harness.api);
  const tool = harness.tools.get("manage_todo_list");
  assert.ok(tool);
  return { harness, tool };
}

test("uses Google-compatible string enums for operation and status", () => {
  const { tool } = setup();
  const schema = tool.parameters as any;

  assert.deepEqual(schema.properties.operation.enum, ["read", "write"]);
  assert.equal(schema.properties.operation.anyOf, undefined);
  assert.deepEqual(
    schema.properties.todoList.items.properties.status.enum,
    ["not-started", "in-progress", "completed"],
  );
  assert.equal(schema.properties.todoList.items.properties.status.anyOf, undefined);
});

test("writes and reads a valid todo list", async () => {
  const { harness, tool } = setup();
  const todoList = [
    { id: 1, title: "Fix schema", description: "Use StringEnum", status: "in-progress" },
  ];

  const written = await tool.execute("write-1", { operation: "write", todoList }, undefined, undefined, harness.ctx);
  const read = await tool.execute("read-1", { operation: "read" }, undefined, undefined, harness.ctx);

  assert.deepEqual(written.details.todos, todoList);
  assert.deepEqual(read.details.todos, todoList);
  assert.equal(harness.appendedEntries.length, 1);
});

test("missing todoList throws a real tool error and preserves state", async () => {
  const { harness, tool } = setup();
  const original = [
    { id: 1, title: "Keep state", description: "Must survive failed write", status: "not-started" },
  ];
  await tool.execute("write-1", { operation: "write", todoList: original }, undefined, undefined, harness.ctx);

  await assert.rejects(
    tool.execute("write-2", { operation: "write" }, undefined, undefined, harness.ctx),
    /todoList is required for write operation/,
  );
  const read = await tool.execute("read-1", { operation: "read" }, undefined, undefined, harness.ctx);
  assert.deepEqual(read.details.todos, original);
});

test("renders Pi error results that have no custom details", () => {
  const { tool } = setup();
  const component = tool.renderResult(
    {
      content: [{ type: "text", text: "todoList is required for write operation" }],
      details: undefined,
    },
    { expanded: false, isPartial: false },
    createIdentityTheme(),
  );

  assert.match(component.render(120).join("\n"), /todoList is required for write operation/);
});

test("invalid todo data throws and preserves state", async () => {
  const { harness, tool } = setup();
  const original = [
    { id: 1, title: "Keep state", description: "Must survive validation", status: "completed" },
  ];
  await tool.execute("write-1", { operation: "write", todoList: original }, undefined, undefined, harness.ctx);

  await assert.rejects(
    tool.execute(
      "write-2",
      {
        operation: "write",
        todoList: [
          { id: 1.5, title: "", description: "", status: "invalid" },
          { id: 1.5, title: "Duplicate", description: "Duplicate id", status: "completed" },
        ],
      },
      undefined,
      undefined,
      harness.ctx,
    ),
    /id must be a positive integer.*title is required.*description is required.*status must be/,
  );
  const read = await tool.execute("read-1", { operation: "read" }, undefined, undefined, harness.ctx);
  assert.deepEqual(read.details.todos, original);
});
