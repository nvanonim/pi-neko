/**
 * Agent Todo Widget Extension
 *
 * Lets the agent maintain its own structured todo list while executing plans.
 * Provides a live read-only widget above the editor plus a Copilot-style
 * `manage_todo_list` tool.
 *
 * Commands:
 *   /todos
 *   /todos show|hide|toggle|clear|status
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

type TodoStatus = "not-started" | "in-progress" | "completed";

interface TodoItem {
  id: number;
  title: string;
  description: string;
  status: TodoStatus;
}

interface TodoStateEntry {
  todos: TodoItem[];
  visible?: boolean;
}

interface TodoDetails {
  operation: "read" | "write";
  todos: TodoItem[];
  error?: string;
}

const WIDGET_ID = "agent-todo-widget";
const STATE_ENTRY_TYPE = "agent-todo-widget-state";

const TodoStatusSchema = Type.Union([
  Type.Literal("not-started"),
  Type.Literal("in-progress"),
  Type.Literal("completed"),
]);

const TodoItemSchema = Type.Object({
  id: Type.Number({
    description: "Unique sequential todo id. Use 1, 2, 3... and keep ids stable across updates.",
  }),
  title: Type.String({
    description: "Short action-oriented label shown in the UI, ideally 3-8 words.",
  }),
  description: Type.String({
    description: "Detailed notes, file paths, acceptance criteria, or why this todo exists.",
  }),
  status: TodoStatusSchema,
});

const ManageTodoListParams = Type.Object({
  operation: Type.Union([Type.Literal("read"), Type.Literal("write")], {
    description:
      "read returns the current todo list. write replaces the complete todo list; partial updates are not supported.",
  }),
  todoList: Type.Optional(
    Type.Array(TodoItemSchema, {
      description:
        "Complete todo list for write operations. Include all existing and new todos with current statuses.",
    }),
  ),
});

type ManageTodoListInput = Static<typeof ManageTodoListParams>;

const TOOL_DESCRIPTION = `Manage the agent-owned todo list for multi-step coding work. Use this tool frequently during planning and execution.

Use this tool when:
- The user asks for complex or multi-step work.
- You create an execution plan.
- You need a checkpoint for current progress.
- You are about to start the next planned step.
- You complete a step and should mark it completed immediately.

Do not use it for trivial one-step replies or purely conversational requests.

Workflow:
1. After making a plan, write a todo list with specific actionable tasks.
2. Before working on a task, write the full list with that task marked in-progress.
3. After finishing a task, write the full list with that task marked completed.
4. Keep remaining tasks not-started until work begins.
5. If unsure where work left off, read the todo list first.

Important: write operations are complete replacement. Always include every todo item, not only changed ones.`;

const SYSTEM_GUIDANCE = `Agent todo workflow is available through the manage_todo_list tool.
For multi-step tasks: create todos after planning, mark the active step in-progress before doing it, mark each step completed immediately after finishing, and read todos when resuming or unsure of progress. Avoid todos for trivial one-step tasks.`;

class TodoState {
  private todos: TodoItem[] = [];
  visible = true;

  read(): TodoItem[] {
    return this.todos.map((todo) => ({ ...todo }));
  }

  write(todos: TodoItem[]): void {
    this.todos = todos.map((todo) => ({ ...todo }));
  }

  clear(): void {
    this.todos = [];
  }

  stats(): { total: number; completed: number; inProgress: number; notStarted: number } {
    const total = this.todos.length;
    const completed = this.todos.filter((todo) => todo.status === "completed").length;
    const inProgress = this.todos.filter((todo) => todo.status === "in-progress").length;
    const notStarted = this.todos.filter((todo) => todo.status === "not-started").length;
    return { total, completed, inProgress, notStarted };
  }

  validate(todos: TodoItem[]): string[] {
    const errors: string[] = [];
    const ids = new Set<number>();
    const statuses = new Set<TodoStatus>(["not-started", "in-progress", "completed"]);

    if (!Array.isArray(todos)) return ["todoList must be an array"];

    for (let i = 0; i < todos.length; i++) {
      const todo = todos[i];
      const prefix = `Item ${i + 1}`;

      if (!todo || typeof todo !== "object") {
        errors.push(`${prefix}: must be an object`);
        continue;
      }
      if (!Number.isInteger(todo.id) || todo.id <= 0) {
        errors.push(`${prefix}: id must be a positive integer`);
      } else if (ids.has(todo.id)) {
        errors.push(`${prefix}: duplicate id ${todo.id}`);
      } else {
        ids.add(todo.id);
      }
      if (typeof todo.title !== "string" || todo.title.trim().length === 0) {
        errors.push(`${prefix}: title is required`);
      }
      if (typeof todo.description !== "string" || todo.description.trim().length === 0) {
        errors.push(`${prefix}: description is required`);
      }
      if (!statuses.has(todo.status)) {
        errors.push(`${prefix}: status must be not-started, in-progress, or completed`);
      }
    }

    return errors;
  }

  loadFromSession(ctx: ExtensionContext): void {
    this.todos = [];
    this.visible = true;

    for (const entry of ctx.sessionManager.getBranch() as Array<any>) {
      if (entry.type === "custom" && entry.customType === STATE_ENTRY_TYPE) {
        const data = entry.data as TodoStateEntry | undefined;
        if (Array.isArray(data?.todos)) this.write(data.todos);
        if (typeof data?.visible === "boolean") this.visible = data.visible;
        continue;
      }

      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg?.role !== "toolResult" || msg.toolName !== "manage_todo_list") continue;
      const details = msg.details as TodoDetails | undefined;
      if (Array.isArray(details?.todos)) this.write(details.todos);
    }
  }
}

function statusIcon(status: TodoStatus): string {
  if (status === "completed") return "✓";
  if (status === "in-progress") return "◉";
  return "○";
}

function updateWidget(state: TodoState, ctx: ExtensionContext): void {
  const todos = state.read();
  if (!ctx.hasUI || !state.visible || todos.length === 0) {
    ctx.ui.setWidget(WIDGET_ID, undefined);
    return;
  }

  ctx.ui.setWidget(WIDGET_ID, (_tui, theme) => {
    const stats = state.stats();
    const lines: string[] = [];
    lines.push(
      theme.fg("accent", "Todo List") +
        theme.fg("muted", ` — ${stats.completed}/${stats.total} completed`),
    );

    for (const todo of state.read()) {
      const icon = statusIcon(todo.status);
      const iconColor =
        todo.status === "completed" ? "success" : todo.status === "in-progress" ? "warning" : "dim";
      const titleColor =
        todo.status === "completed" ? "dim" : todo.status === "in-progress" ? "warning" : "text";
      const line =
        "  " +
        theme.fg(iconColor, icon) +
        " " +
        theme.fg("accent", `${todo.id}.`) +
        " " +
        theme.fg(titleColor, todo.title);
      lines.push(line);
    }

    return {
      render(width: number): string[] {
        return lines.map((line) => truncateToWidth(line, width));
      },
      invalidate(): void {},
    };
  });
}

function clearWidget(ctx: ExtensionContext): void {
  if (ctx.hasUI) ctx.ui.setWidget(WIDGET_ID, undefined);
}

function persist(pi: ExtensionAPI, state: TodoState): void {
  pi.appendEntry(STATE_ENTRY_TYPE, {
    todos: state.read(),
    visible: state.visible,
  } satisfies TodoStateEntry);
}

export default function (pi: ExtensionAPI) {
  const state = new TodoState();
  let currentCtx: ExtensionContext | undefined;

  function refresh(ctx?: ExtensionContext): void {
    const target = ctx ?? currentCtx;
    if (!target) return;
    currentCtx = target;
    updateWidget(state, target);
  }

  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx;
    state.loadFromSession(ctx);
    refresh(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    currentCtx = ctx;
    state.loadFromSession(ctx);
    refresh(ctx);
  });

  pi.on("turn_start", async (_event, ctx) => {
    currentCtx = ctx;
    refresh(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    currentCtx = ctx;
    refresh(ctx);
  });

  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt: `${event.systemPrompt}\n\n${SYSTEM_GUIDANCE}`,
    };
  });

  pi.registerTool({
    name: "manage_todo_list",
    label: "Todo List",
    description: TOOL_DESCRIPTION,
    promptSnippet: "Manage the agent-owned todo list for multi-step work and progress checkpoints.",
    promptGuidelines: [
      "Use manage_todo_list for multi-step tasks: create todos after planning, mark active work in-progress, and mark completed tasks immediately.",
      "Do not use manage_todo_list for trivial one-step or purely conversational requests.",
    ],
    parameters: ManageTodoListParams,

    async execute(_toolCallId, params: ManageTodoListInput, _signal, _onUpdate, ctx) {
      currentCtx = ctx;

      if (params.operation === "read") {
        const todos = state.read();
        refresh(ctx);
        return {
          content: [
            {
              type: "text" as const,
              text: todos.length > 0 ? JSON.stringify(todos, null, 2) : "No todos yet.",
            },
          ],
          details: { operation: "read", todos } satisfies TodoDetails,
        };
      }

      const todoList = params.todoList;
      if (!Array.isArray(todoList)) {
        const todos = state.read();
        return {
          content: [{ type: "text" as const, text: "Error: todoList is required for write operation." }],
          details: { operation: "write", todos, error: "todoList required" } satisfies TodoDetails,
          isError: true,
        };
      }

      const errors = state.validate(todoList as TodoItem[]);
      if (errors.length > 0) {
        const todos = state.read();
        return {
          content: [{ type: "text" as const, text: `Validation failed:\n${errors.map((e) => `- ${e}`).join("\n")}` }],
          details: { operation: "write", todos, error: errors.join("; ") } satisfies TodoDetails,
          isError: true,
        };
      }

      state.write(todoList as TodoItem[]);
      persist(pi, state);
      refresh(ctx);

      const stats = state.stats();
      const todos = state.read();
      return {
        content: [
          {
            type: "text" as const,
            text: `Todo list updated. ${stats.completed}/${stats.total} completed. Continue from the current in-progress or next not-started task.`,
          },
        ],
        details: { operation: "write", todos } satisfies TodoDetails,
      };
    },

    renderCall(args: ManageTodoListInput, theme) {
      const suffix = args.operation === "write" && args.todoList ? ` (${args.todoList.length} items)` : "";
      return new Text(theme.fg("toolTitle", theme.bold("manage_todo_list ")) + theme.fg("muted", args.operation + suffix), 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as TodoDetails | undefined;
      if (!details) return new Text("", 0, 0);
      if (details.error) return new Text(theme.fg("error", details.error), 0, 0);
      const total = details.todos.length;
      const completed = details.todos.filter((todo) => todo.status === "completed").length;
      if (total === 0) return new Text(theme.fg("dim", "No todos"), 0, 0);
      return new Text(theme.fg("success", "✓ ") + theme.fg("muted", `${completed}/${total} completed`), 0, 0);
    },
  });

  pi.registerCommand("todos", {
    description: "Show, hide, toggle, clear, or inspect agent todo widget",
    handler: async (args, ctx) => {
      currentCtx = ctx;
      const sub = (args ?? "").trim().toLowerCase();

      if (sub === "clear") {
        state.clear();
        persist(pi, state);
        clearWidget(ctx);
        ctx.ui.notify("Todo list cleared", "info");
        return;
      }

      if (sub === "hide") {
        state.visible = false;
        persist(pi, state);
        clearWidget(ctx);
        ctx.ui.notify("Todo widget hidden", "info");
        return;
      }

      if (sub === "show") {
        state.visible = true;
        persist(pi, state);
        refresh(ctx);
        ctx.ui.notify("Todo widget shown", "info");
        return;
      }

      if (sub === "toggle") {
        state.visible = !state.visible;
        persist(pi, state);
        refresh(ctx);
        ctx.ui.notify(`Todo widget ${state.visible ? "shown" : "hidden"}`, "info");
        return;
      }

      const stats = state.stats();
      if (sub === "status" || sub === "") {
        refresh(ctx);
        if (stats.total === 0) {
          ctx.ui.notify("No todos. Agent will create them for multi-step tasks.", "info");
        } else {
          ctx.ui.notify(
            `Todos: ${stats.completed}/${stats.total} completed, ${stats.inProgress} in progress, ${stats.notStarted} not started`,
            "info",
          );
        }
        return;
      }

      ctx.ui.notify("Usage: /todos [show|hide|toggle|clear|status]", "info");
    },
  });
}
