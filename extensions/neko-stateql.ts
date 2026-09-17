import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  ReadToolSchema,
  WriteToolSchema,
  toReadBatch,
  toWriteBatch,
  type ReadToolInput,
  type StateQLToolInput,
  type WriteToolInput,
} from "../lib/neko-stateql/commands.ts";
import { responseResult, safeError } from "../lib/neko-stateql/output.ts";
import { NekoStateQLRuntime } from "../lib/neko-stateql/runtime.ts";
import {
  assertCredentialInputSafe,
  confirmReadConnection,
  confirmWrite,
  connectionReview,
  operationSummary,
  requireConfirmation,
  type ConnectionSourceDetails,
} from "../lib/neko-stateql/safety.ts";

const READ_TOOL = "neko_stateql";
const WRITE_TOOL = "neko_stateql_write";
const WRITE_COMMAND = "neko-stateql";

const READ_DESCRIPTION = `Read databases through StateQL by FadhilP, using isolated durable state managed by pi-neko. Supports read-only connections, parameterized SQL, bounded MongoDB/Redis reads, catalog inspection, and reusable result handles. Connections are forced read-only. Use secret_env for credential-bearing remote URLs. SQL, parameters, and returned rows may enter Pi history and model-provider context. Output is capped at 40 KB.`;

const WRITE_DESCRIPTION = `Perform explicitly approved database writes through StateQL by FadhilP. This tool is inactive and blocked until the user runs /neko-stateql write in the current Pi session. Write mode never bypasses per-operation confirmation or StateQL safeguards. Prefer plan before apply, use idempotency keys for retryable writes, and never retry OUTCOME_UNKNOWN automatically.`;

function sessionId(ctx: ExtensionContext): string {
  const id = ctx.sessionManager.getSessionId();
  if (!id) throw new Error("Neko StateQL requires a stable Pi session identity");
  return id;
}

function activeWithoutWrite(pi: ExtensionAPI): string[] {
  return pi.getActiveTools().filter((name) => name !== WRITE_TOOL);
}

type StateQLRuntime = Pick<NekoStateQLRuntime, "sessionId" | "execute" | "close">;
type StateQLRuntimeFactory = (sessionId: string) => StateQLRuntime;

export default function nekoStateQL(
  pi: ExtensionAPI,
  createRuntime: StateQLRuntimeFactory = (id) => new NekoStateQLRuntime(id),
) {
  let runtime: StateQLRuntime | undefined;
  let writesUnlocked = false;
  const planSummaries = new Map<string, string>();

  const getRuntime = async (ctx: ExtensionContext): Promise<StateQLRuntime> => {
    const id = sessionId(ctx);
    if (runtime?.sessionId !== id) {
      await runtime?.close();
      runtime = createRuntime(id);
    }
    return runtime;
  };

  const execute = async (
    input: StateQLToolInput,
    command: ReturnType<typeof toReadBatch> | ReturnType<typeof toWriteBatch>,
    signal: AbortSignal | undefined,
    ctx: ExtensionContext,
  ) => {
    try {
      const response = await (await getRuntime(ctx)).execute(command, signal);
      if (!response.ok && response.error.code === "OUTCOME_UNKNOWN") {
        writesUnlocked = false;
        if (input.handle) planSummaries.delete(input.handle);
        pi.setActiveTools(activeWithoutWrite(pi));
        ctx.ui.setStatus("neko-stateql-outcome", "StateQL write outcome unknown — inspect database state");
        ctx.ui.notify("StateQL write outcome is unknown. Read mode restored; inspect authoritative database state before enabling write mode again.", "error");
      }
      if (response.ok && ["plan", "mongo.plan", "redis.plan"].includes(input.command)) {
        const planId = (response.data as { plan_id?: unknown }).plan_id;
        if (typeof planId === "string") planSummaries.set(planId, operationSummary(input));
      }
      if (response.ok && input.command === "apply" && input.handle) planSummaries.delete(input.handle);
      return responseResult(response, input);
    } catch (error) {
      throw safeError(error, input);
    }
  };

  const connectionContext = async (
    input: StateQLToolInput,
    ctx: ExtensionContext,
    signal?: AbortSignal,
  ): Promise<string | undefined> => {
    let profile: ConnectionSourceDetails | undefined;
    const profileName = input.profile
      ?? (["profile.update", "profile.remove"].includes(input.command) ? input.name : undefined);
    if (profileName) {
      const shown = await (await getRuntime(ctx)).execute(
        { command: "profile.show", name: profileName },
        signal,
        "system",
        true,
      );
      if (!shown.ok) throw new Error(`Cannot review StateQL profile ${profileName}: ${shown.error.message}`);
      profile = shown.data as ConnectionSourceDetails;
    }
    return connectionReview(input, profile);
  };

  const transactionContext = async (
    input: WriteToolInput,
    ctx: ExtensionContext,
    signal?: AbortSignal,
  ): Promise<string> => {
    const status = await (await getRuntime(ctx)).execute(
      { command: "transaction.status", ...(input.handle ? { handle: input.handle } : {}) },
      signal,
      "system",
      true,
    );
    if (!status.ok) throw new Error(`Cannot review StateQL transaction: ${status.error.message}`);
    const data = status.data as {
      transaction_id: string;
      state: string;
      statements: number;
      pending_writes: number;
      owner_actor_id: string;
      isolation_level: string;
    };
    return [
      `Transaction: ${data.transaction_id}`,
      `State: ${data.state}`,
      `Statements: ${data.statements}`,
      `Pending writes: ${data.pending_writes}`,
      `Isolation: ${data.isolation_level}`,
      `Owner: ${data.owner_actor_id}`,
    ].join("\n");
  };

  const readTool = defineTool({
    name: READ_TOOL,
    label: "Neko StateQL",
    description: READ_DESCRIPTION,
    promptSnippet: "Safely query SQLite, PostgreSQL, MySQL, MongoDB, or Redis through read-only StateQL connections and durable handles.",
    promptGuidelines: [
      "Use neko_stateql for database reads; prefer secret_env, parameterized values, stable ORDER BY, database-side LIMIT, and reusable handles.",
      "Never put database credentials in neko_stateql arguments or chat. Returned database data may be sent to the selected model provider.",
      "Use neko_stateql_write only after the user explicitly requests a write and enables it with /neko-stateql write.",
      "Never invoke stql, database CLIs, or database drivers through shell to bypass Neko StateQL write locking or confirmations.",
    ],
    parameters: ReadToolSchema,
    executionMode: "sequential",

    async execute(_toolCallId, input: ReadToolInput, signal, onUpdate, ctx) {
      const command = toReadBatch(input);
      assertCredentialInputSafe(input);
      if (input.command === "connect" || input.command === "disconnect") {
        const context = input.command === "connect" ? await connectionContext(input, ctx, signal) : undefined;
        await confirmReadConnection(input, ctx, signal, context);
      }
      onUpdate?.({
        content: [{ type: "text", text: `Running Neko StateQL ${input.command}...` }],
        details: { command: input.command },
      });
      return execute(input, command, signal, ctx);
    },
  });

  const writeTool = defineTool({
    name: WRITE_TOOL,
    label: "Neko StateQL Write",
    description: WRITE_DESCRIPTION,
    promptSnippet: "Run user-enabled, individually confirmed StateQL plans, writes, profile changes, and transactions.",
    promptGuidelines: [
      "Use neko_stateql_write only for database changes explicitly requested by the user; prefer plan before apply and include idempotency_key when retries are plausible.",
      "Never retry a StateQL OUTCOME_UNKNOWN write. Inspect database state and ask the user for direction before enabling write mode again.",
    ],
    parameters: WriteToolSchema,
    executionMode: "sequential",

    async execute(_toolCallId, input: WriteToolInput, signal, onUpdate, ctx) {
      if (!writesUnlocked) throw new Error(`Neko StateQL is in read mode. User must run /${WRITE_COMMAND} write.`);
      const command = toWriteBatch(input);
      assertCredentialInputSafe(input);
      let reviewContext: string | undefined;
      if (input.command === "apply") {
        reviewContext = input.handle ? planSummaries.get(input.handle) : undefined;
        if (!reviewContext) {
          throw new Error("Neko StateQL can only apply a plan created and reviewed in the current Pi session. Create the plan again.");
        }
      } else if (["connect", "profile.add", "profile.update", "profile.remove"].includes(input.command)) {
        reviewContext = await connectionContext(input, ctx, signal);
        if (input.command === "connect") reviewContext = `Requested access: read-write${reviewContext ? `\n${reviewContext}` : ""}`;
      } else if (["transaction.commit", "transaction.rollback"].includes(input.command)) {
        reviewContext = await transactionContext(input, ctx, signal);
      }
      await confirmWrite(input, ctx, signal, reviewContext);
      if (!writesUnlocked) throw new Error("Neko StateQL writes were locked before execution; nothing was executed.");
      onUpdate?.({
        content: [{ type: "text", text: `Running confirmed Neko StateQL ${input.command}...` }],
        details: { command: input.command },
      });
      return execute(input, command, signal, ctx);
    },
  });

  pi.registerTool(readTool);
  pi.registerTool(writeTool);

  pi.registerCommand(WRITE_COMMAND, {
    description: "Show or switch Neko StateQL read/write mode for this Pi session",
    getArgumentCompletions(prefix: string) {
      const choices = ["status", "read", "write"];
      const matches = choices.filter((value) => value.startsWith(prefix.trim().toLowerCase()));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase() || "status";
      if (action === "status") {
        ctx.ui.notify(`Neko StateQL mode: ${writesUnlocked ? "write" : "read"}`, "info");
        return;
      }
      if (action === "write") {
        if (writesUnlocked) {
          ctx.ui.notify("Neko StateQL already in write mode for this session", "info");
          return;
        }
        await requireConfirmation(
          ctx,
          "Enable Neko StateQL write mode",
          "Enable the neko_stateql_write tool for this Pi session? Every write still requires a separate confirmation. New sessions start in read mode.",
        );
        writesUnlocked = true;
        ctx.ui.setStatus("neko-stateql-outcome", undefined);
        pi.setActiveTools([...new Set([...pi.getActiveTools(), WRITE_TOOL])]);
        ctx.ui.setStatus("neko-stateql-writes", "StateQL write mode");
        ctx.ui.notify("Neko StateQL write mode enabled for this session", "warning");
        return;
      }
      if (action === "read") {
        writesUnlocked = false;
        pi.setActiveTools(activeWithoutWrite(pi));
        ctx.ui.setStatus("neko-stateql-writes", undefined);
        ctx.ui.notify("Neko StateQL read mode enabled", "info");
        return;
      }
      throw new Error(`Usage: /${WRITE_COMMAND} status|read|write`);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    await runtime?.close();
    runtime = undefined;
    writesUnlocked = false;
    planSummaries.clear();
    pi.setActiveTools(activeWithoutWrite(pi));
    ctx.ui.setStatus("neko-stateql-writes", undefined);
    ctx.ui.setStatus("neko-stateql-outcome", undefined);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    writesUnlocked = false;
    planSummaries.clear();
    pi.setActiveTools(activeWithoutWrite(pi));
    ctx.ui.setStatus("neko-stateql-writes", undefined);
    ctx.ui.setStatus("neko-stateql-outcome", undefined);
    await runtime?.close();
    runtime = undefined;
  });
}
