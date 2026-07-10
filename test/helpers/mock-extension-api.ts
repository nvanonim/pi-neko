import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type Handler = (event: any, ctx: ExtensionContext) => unknown | Promise<unknown>;

type MockModel = {
  provider: string;
  id: string;
  name?: string;
  contextWindow?: number;
};

export interface MockExtensionHarness {
  api: ExtensionAPI;
  ctx: ExtensionContext;
  handlers: Map<string, Handler[]>;
  commands: Map<string, any>;
  tools: Map<string, any>;
  shortcuts: Map<string, any>;
  notifications: Array<{ message: string; type: string }>;
  widgets: Map<string, unknown>;
  statuses: Map<string, string>;
  appendedEntries: Array<{ customType: string; data: unknown }>;
  execCalls: Array<{ command: string; args: string[]; options: unknown }>;
  thinkingChanges: string[];
  state: {
    branch: any[];
    contextEntries: any[];
    model: MockModel | undefined;
    thinkingLevel: string;
    oauthProviders: Set<string>;
    footerFactory: any;
    execResult: { stdout: string; stderr: string; code: number; killed: boolean };
  };
  emit(type: string, event?: Record<string, unknown>): Promise<unknown[]>;
}

export function createMockExtensionHarness(): MockExtensionHarness {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  const shortcuts = new Map<string, any>();
  const notifications: Array<{ message: string; type: string }> = [];
  const widgets = new Map<string, unknown>();
  const statuses = new Map<string, string>();
  const appendedEntries: Array<{ customType: string; data: unknown }> = [];
  const execCalls: Array<{ command: string; args: string[]; options: unknown }> = [];
  const thinkingChanges: string[] = [];

  const state = {
    branch: [] as any[],
    contextEntries: [] as any[],
    model: undefined as MockModel | undefined,
    thinkingLevel: "off",
    oauthProviders: new Set<string>(),
    footerFactory: undefined as any,
    execResult: { stdout: "", stderr: "", code: 0, killed: false },
  };

  const ui = {
    notify(message: string, type: string) {
      notifications.push({ message, type });
    },
    setWidget(key: string, value: unknown) {
      if (value === undefined) widgets.delete(key);
      else widgets.set(key, value);
    },
    setStatus(key: string, value: string | undefined) {
      if (value === undefined) statuses.delete(key);
      else statuses.set(key, value);
    },
    setFooter(factory: unknown) {
      state.footerFactory = factory;
    },
    theme: createIdentityTheme(),
  };

  const ctxObject: Record<string, any> = {
    ui,
    mode: "tui",
    hasUI: true,
    cwd: "/tmp/project",
    sessionManager: {
      getBranch: () => state.branch,
      buildContextEntries: () => state.contextEntries,
    },
    modelRegistry: {
      isUsingOAuth: (model: MockModel) => state.oauthProviders.has(model.provider),
    },
    getContextUsage: () => ({ tokens: 1000, contextWindow: state.model?.contextWindow ?? 200_000, percent: 0.5 }),
    isIdle: () => true,
    isProjectTrusted: () => true,
    signal: undefined,
    abort() {},
    hasPendingMessages: () => false,
    shutdown() {},
    compact() {},
    getSystemPrompt: () => "system",
  };
  Object.defineProperty(ctxObject, "model", { enumerable: true, get: () => state.model });
  const ctx = ctxObject as ExtensionContext;

  const apiObject: Record<string, any> = {
    on(type: string, handler: Handler) {
      const current = handlers.get(type) ?? [];
      current.push(handler);
      handlers.set(type, current);
    },
    registerCommand(name: string, options: unknown) {
      commands.set(name, options);
    },
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    registerShortcut(key: string, options: unknown) {
      shortcuts.set(key, options);
    },
    appendEntry(customType: string, data: unknown) {
      appendedEntries.push({ customType, data });
    },
    getThinkingLevel: () => state.thinkingLevel,
    setThinkingLevel(level: string) {
      if (state.thinkingLevel === level) return;
      state.thinkingLevel = level;
      thinkingChanges.push(level);
    },
    async exec(command: string, args: string[], options: unknown) {
      execCalls.push({ command, args, options });
      return state.execResult;
    },
  };
  const api = apiObject as ExtensionAPI;

  return {
    api,
    ctx,
    handlers,
    commands,
    tools,
    shortcuts,
    notifications,
    widgets,
    statuses,
    appendedEntries,
    execCalls,
    thinkingChanges,
    state,
    async emit(type: string, event: Record<string, unknown> = {}) {
      const results: unknown[] = [];
      for (const handler of handlers.get(type) ?? []) {
        results.push(await handler({ type, ...event }, ctx));
      }
      return results;
    },
  };
}

export function createIdentityTheme(): any {
  const style = (_name: string, text: string) => text;
  return {
    fg: style,
    bg: style,
    bold: (text: string) => text,
    italic: (text: string) => text,
    strikethrough: (text: string) => text,
    underline: (text: string) => text,
  };
}

export function createFooterData(
  branch: string | null = "main",
  statuses: ReadonlyMap<string, string> = new Map(),
) {
  const listeners = new Set<() => void>();
  return {
    getGitBranch: () => branch,
    getExtensionStatuses: () => statuses,
    onBranchChange(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
