import type { CodexTuiSessionInput, CodexTuiSessionView } from "../../electron/lib/codex-tui-broker";

export type CodexTuiInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
export type CodexTuiListen = <T>(
  event: string,
  handler: (event: { payload: T }) => void,
) => Promise<() => void>;

export interface CodexTuiSession extends CodexTuiSessionView {
  attached: boolean;
}

export interface CodexTuiOutputEvent {
  sessionId: string;
  deltaBase64: string;
}

export interface CodexTuiClient {
  register(input: Omit<CodexTuiSessionInput, "windowId">): Promise<void>;
  start(input: Omit<CodexTuiSessionInput, "windowId">): Promise<CodexTuiSession>;
  unregister(sessionId: string): Promise<void>;
  list(): Promise<CodexTuiSession[]>;
  spawn(input: Omit<CodexTuiSessionInput, "windowId">): Promise<{ session: CodexTuiSession; replayBase64: string }>;
  attach(sessionId: string): Promise<{ session: CodexTuiSession; replayBase64: string }>;
  reattach(sessionId: string): Promise<CodexTuiSession>;
  detach(sessionId: string): Promise<CodexTuiSession>;
  write(sessionId: string, deltaBase64: string): Promise<void>;
  resize(sessionId: string, rows: number, cols: number): Promise<void>;
  acquire(sessionId: string): Promise<CodexTuiSession>;
  release(sessionId: string): Promise<CodexTuiSession>;
  close(sessionId: string): Promise<void>;
  subscribeOutput(handler: (input: CodexTuiOutputEvent) => void): Promise<() => void>;
  subscribeState(handler: (session: CodexTuiSession) => void): Promise<() => void>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function parseSession(value: unknown): CodexTuiSession {
  const session = record(value);
  const status = session?.status;
  const controlState = session?.controlState;
  if (
    !session
    || typeof session.sessionId !== "string"
    || typeof session.runId !== "string"
    || !isNullableString(session.taskId)
    || !isNullableString(session.projectId)
    || !isNullableString(session.nodeKey)
    || typeof session.processKey !== "string"
    || typeof session.threadId !== "string"
    || typeof session.cwd !== "string"
    || !isNullableString(session.model)
    || !["starting", "running", "detached", "interrupted"].includes(status as string)
    || !["viewer", "controller", "detached"].includes(controlState as string)
    || !(typeof session.controllerWindowId === "number" || session.controllerWindowId === null)
    || typeof session.attachedCount !== "number"
    || !Number.isSafeInteger(session.attachedCount)
    || !(typeof session.lastActivityAtMs === "number" || session.lastActivityAtMs === null)
    || typeof session.bufferBytes !== "number"
    || !Number.isSafeInteger(session.bufferBytes)
    || typeof session.attached !== "boolean"
  ) {
    throw new Error("Codex TUI session is invalid");
  }
  return session as unknown as CodexTuiSession;
}

function parseAttachResponse(value: unknown): { session: CodexTuiSession; replayBase64: string } {
  const response = record(value);
  if (!response || typeof response.replayBase64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/u.test(response.replayBase64)) {
    throw new Error("Codex TUI attach response is invalid");
  }
  return { session: parseSession(response.session), replayBase64: response.replayBase64 };
}

function parseSessionList(value: unknown): CodexTuiSession[] {
  if (!Array.isArray(value)) throw new Error("Codex TUI session list is invalid");
  return value.map(parseSession);
}

export function createCodexTuiClient(dependencies: {
  invoke: CodexTuiInvoke;
  listen: CodexTuiListen;
}): CodexTuiClient {
  const outputHandlers = new Set<(input: CodexTuiOutputEvent) => void>();
  const stateHandlers = new Set<(session: CodexTuiSession) => void>();
  let listenersPromise: Promise<void> | null = null;
  let unsubscribeOutput: (() => void) | null = null;
  let unsubscribeState: (() => void) | null = null;

  async function ensureListeners(): Promise<void> {
    if (listenersPromise) return listenersPromise;
    listenersPromise = (async () => {
      const [stopOutput, stopState] = await Promise.all([
        dependencies.listen<unknown>("codex_tui_output", ({ payload }) => {
          const event = record(payload);
          if (
            !event
            || typeof event.sessionId !== "string"
            || typeof event.deltaBase64 !== "string"
          ) return;
          for (const handler of [...outputHandlers]) {
            try { handler({ sessionId: event.sessionId, deltaBase64: event.deltaBase64 }); } catch { /* observers cannot break the stream */ }
          }
        }),
        dependencies.listen<unknown>("codex_tui_state", ({ payload }) => {
          let session: CodexTuiSession;
          try { session = parseSession(payload); } catch { return; }
          for (const handler of [...stateHandlers]) {
            try { handler(session); } catch { /* observers cannot break the stream */ }
          }
        }),
      ]);
      unsubscribeOutput = stopOutput;
      unsubscribeState = stopState;
    })();
    try {
      await listenersPromise;
    } catch (error) {
      listenersPromise = null;
      throw error;
    }
  }

  return {
    async register(input) {
      await dependencies.invoke("register_codex_tui_session", { ...input });
    },
    async start(input) {
      return parseSession(await dependencies.invoke("start_codex_tui_session", { ...input }));
    },
    async unregister(sessionId) {
      await dependencies.invoke("unregister_codex_tui_session", { sessionId });
    },
    async list() {
      return parseSessionList(await dependencies.invoke("list_codex_tui_sessions"));
    },
    async spawn(input) {
      return parseAttachResponse(await dependencies.invoke("spawn_codex_tui", { ...input }));
    },
    async attach(sessionId) {
      return parseAttachResponse(await dependencies.invoke("attach_codex_tui", { sessionId }));
    },
    async reattach(sessionId) {
      return parseSession(await dependencies.invoke("reattach_codex_tui", { sessionId }));
    },
    async detach(sessionId) {
      return parseSession(await dependencies.invoke("detach_codex_tui", { sessionId }));
    },
    async write(sessionId, deltaBase64) {
      await dependencies.invoke("write_codex_tui", { sessionId, deltaBase64 });
    },
    async resize(sessionId, rows, cols) {
      await dependencies.invoke("resize_codex_tui", { sessionId, rows, cols });
    },
    async acquire(sessionId) {
      return parseSession(await dependencies.invoke("acquire_codex_tui_control", { sessionId }));
    },
    async release(sessionId) {
      return parseSession(await dependencies.invoke("release_codex_tui_control", { sessionId }));
    },
    async close(sessionId) {
      await dependencies.invoke("close_codex_tui", { sessionId });
    },
    async subscribeOutput(handler) {
      await ensureListeners();
      outputHandlers.add(handler);
      return () => { outputHandlers.delete(handler); };
    },
    async subscribeState(handler) {
      await ensureListeners();
      stateHandlers.add(handler);
      return () => { stateHandlers.delete(handler); };
    },
  };
}
