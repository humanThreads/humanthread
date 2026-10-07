import { AGENT_BUILD_VERSION } from "../build-version";
import type { ReasoningEffort } from "@humanthread/shared";

export type CodexAppServerState = {
  processKey: string;
  generation: number;
  pid: number;
  bindingFingerprint: string;
  model: string | null;
  reasoningEffort: string | null;
  transport: "websocket" | "unix" | "stdio";
  endpoint: string | null;
  protocolVersion: string | null;
  status: "starting" | "ready" | "failed" | "stopped" | string;
  lastNotificationAt: number | null;
  pendingRequestCount: number;
  stderrSummary: string | null;
  lastErrorCode: string | null;
};

export type CodexAppServerNotification = {
  processKey: string;
  generation: number;
  method: string;
  params: unknown;
  requestId?: string | number | null;
  receivedAtMs: number;
};

export type CodexAppServerResponseError = {
  code: number;
  message: string;
  data?: unknown;
};

export type CodexAppServerStartInput = {
  cwd: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  executable?: string;
  environmentRefs?: string[];
  environmentOverrides?: Record<string, string>;
  credentialContext?: {
    deploymentOrigin: string;
    userId: string;
    credentialRef: string;
  } | null;
  isolationContext?: { deploymentOrigin: string; userId: string };
  checklistMcp?: { url: string; headers: Record<string, string> };
};

type NativeInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export type CodexAppServerListen = <T>(
  event: string,
  handler: (event: { payload: T }) => void,
) => Promise<() => void>;

export type CodexAppServerClient = {
  readonly processKey: string;
  start(input: CodexAppServerStartInput): Promise<CodexAppServerState>;
  request(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): Promise<void>;
  respond(requestId: string | number, result?: unknown, error?: CodexAppServerResponseError): Promise<void>;
  cancel(threadId: string, turnId?: string): Promise<void>;
  stop(): Promise<void>;
  states(): Promise<CodexAppServerState[]>;
  subscribe(handler: (notification: CodexAppServerNotification) => void): Promise<() => void>;
  subscribeState(handler: (state: CodexAppServerState) => void): Promise<() => void>;
};

type ProviderError = Error & { code: string };

function providerError(error: unknown, fallbackCode = "provider_transport_error"): ProviderError {
  if (error && typeof error === "object") {
    const code = Reflect.get(error, "code");
    const message = Reflect.get(error, "message");
    if (typeof code === "string" && typeof message === "string") {
      return Object.assign(new Error(message.slice(0, 512) || code), { code });
    }
  }
  const text = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "Codex app-server transport failed";
  const match = /^([a-z][a-z0-9_]{2,63}):\s*(.*)$/u.exec(text.trim());
  return Object.assign(new Error((match?.[2] || text).slice(0, 512)), {
    code: match?.[1] ?? fallbackCode,
  });
}

function isState(value: unknown): value is CodexAppServerState {
  if (!value || typeof value !== "object") return false;
  return typeof Reflect.get(value, "processKey") === "string"
    && typeof Reflect.get(value, "generation") === "number"
    && Number.isSafeInteger(Reflect.get(value, "generation"))
    && typeof Reflect.get(value, "pid") === "number"
    && Number.isSafeInteger(Reflect.get(value, "pid"))
    && typeof Reflect.get(value, "bindingFingerprint") === "string"
    && (typeof Reflect.get(value, "model") === "string" || Reflect.get(value, "model") === null)
    && (typeof Reflect.get(value, "reasoningEffort") === "string" || Reflect.get(value, "reasoningEffort") === null)
    && ["websocket", "unix", "stdio"].includes(Reflect.get(value, "transport") as string)
    && (typeof Reflect.get(value, "endpoint") === "string" || Reflect.get(value, "endpoint") === null)
    && (typeof Reflect.get(value, "protocolVersion") === "string" || Reflect.get(value, "protocolVersion") === null)
    && typeof Reflect.get(value, "status") === "string"
    && (typeof Reflect.get(value, "lastNotificationAt") === "number" || Reflect.get(value, "lastNotificationAt") === null)
    && typeof Reflect.get(value, "pendingRequestCount") === "number"
    && Number.isSafeInteger(Reflect.get(value, "pendingRequestCount"))
    && (typeof Reflect.get(value, "stderrSummary") === "string" || Reflect.get(value, "stderrSummary") === null)
    && (typeof Reflect.get(value, "lastErrorCode") === "string" || Reflect.get(value, "lastErrorCode") === null);
}

function parseState(value: unknown): CodexAppServerState {
  if (!isState(value)) throw Object.assign(new Error("Codex app-server state is invalid"), { code: "provider_protocol_error" });
  return {
    processKey: value.processKey,
    generation: value.generation,
    pid: value.pid,
    bindingFingerprint: value.bindingFingerprint,
    model: value.model,
    reasoningEffort: value.reasoningEffort,
    transport: value.transport,
    endpoint: value.endpoint,
    protocolVersion: value.protocolVersion,
    status: value.status,
    lastNotificationAt: value.lastNotificationAt,
    pendingRequestCount: value.pendingRequestCount,
    stderrSummary: value.stderrSummary,
    lastErrorCode: value.lastErrorCode,
  };
}

function isNotification(value: unknown): value is CodexAppServerNotification {
  if (!value || typeof value !== "object") return false;
  return typeof Reflect.get(value, "processKey") === "string"
    && typeof Reflect.get(value, "generation") === "number"
    && typeof Reflect.get(value, "method") === "string"
    && typeof Reflect.get(value, "receivedAtMs") === "number"
    && Reflect.has(value, "params");
}

export function createCodexAppServerClient(dependencies: {
  invoke: NativeInvoke;
  listen: CodexAppServerListen;
  processKey: string;
}): CodexAppServerClient {
  const notificationHandlers = new Set<(notification: CodexAppServerNotification) => void>();
  const stateHandlers = new Set<(state: CodexAppServerState) => void>();
  let unlistenNotification: (() => void) | null = null;
  let unlistenState: (() => void) | null = null;
  let listenersPromise: Promise<void> | null = null;
  let startPromise: Promise<CodexAppServerState> | null = null;
  let latestState: CodexAppServerState | null = null;

  const ensureListeners = async (): Promise<void> => {
    if (listenersPromise) return listenersPromise;
    listenersPromise = (async () => {
      const [notificationUnlisten, stateUnlisten] = await Promise.all([
        dependencies.listen<unknown>("codex_app_server_notification", ({ payload }) => {
          if (!isNotification(payload) || payload.processKey !== dependencies.processKey) return;
          for (const handler of [...notificationHandlers]) {
            try { handler(payload); } catch { /* observers cannot break the transport */ }
          }
        }),
        dependencies.listen<unknown>("codex_app_server_state", ({ payload }) => {
          if (!isState(payload) || payload.processKey !== dependencies.processKey) return;
          const nextState = parseState(payload);
          const previousState = latestState;
          latestState = nextState;
          if (
            (nextState.status === "failed" || nextState.status === "stopped")
            && (previousState === null || previousState.generation === nextState.generation)
          ) {
            startPromise = null;
          }
          for (const handler of [...stateHandlers]) {
            try { handler(latestState); } catch { /* observers cannot break the transport */ }
          }
        }),
      ]);
      unlistenNotification = notificationUnlisten;
      unlistenState = stateUnlisten;
    })();
    try {
      await listenersPromise;
    } catch (error) {
      listenersPromise = null;
      throw providerError(error, "provider_transport_error");
    }
  };

  const request = async (method: string, params: unknown): Promise<unknown> => {
    if (!method.trim() || method.length > 256 || /[\u0000-\u001F\u007F]/u.test(method)) {
      throw Object.assign(new Error("Codex app-server method is invalid"), { code: "provider_protocol_error" });
    }
    try {
      return await dependencies.invoke("request_codex_app_server", {
        processKey: dependencies.processKey,
        method,
        params,
      });
    } catch (error) {
      throw providerError(error);
    }
  };

  const notify = async (method: string, params?: unknown): Promise<void> => {
    if (!method.trim() || method.length > 256 || /[\u0000-\u001F\u007F]/u.test(method)) {
      throw Object.assign(new Error("Codex app-server method is invalid"), { code: "provider_protocol_error" });
    }
    try {
      await dependencies.invoke("notify_codex_app_server", {
        processKey: dependencies.processKey,
        method,
        params: params === undefined ? null : params,
      });
    } catch (error) {
      throw providerError(error);
    }
  };

  const respond = async (
    requestId: string | number,
    result?: unknown,
    error?: CodexAppServerResponseError,
  ): Promise<void> => {
    const validRequestId = (typeof requestId === "string" && requestId.length > 0)
      || (typeof requestId === "number" && Number.isSafeInteger(requestId) && requestId >= 0);
    if (!validRequestId || (result === undefined) === (error === undefined)) {
      throw Object.assign(new Error("Codex app-server response is invalid"), { code: "provider_protocol_error" });
    }
    if (error !== undefined && (
      !Number.isSafeInteger(error.code)
      || typeof error.message !== "string"
      || error.message.length === 0
      || error.message.length > 512
    )) {
      throw Object.assign(new Error("Codex app-server response error is invalid"), { code: "provider_protocol_error" });
    }
    try {
      await dependencies.invoke("respond_codex_app_server", {
        processKey: dependencies.processKey,
        requestId,
        ...(result === undefined ? {} : { result }),
        ...(error === undefined ? {} : { error }),
      });
    } catch (caught) {
      throw providerError(caught);
    }
  };

  return {
    processKey: dependencies.processKey,
    async start(input) {
      if (startPromise) return startPromise;
      startPromise = (async () => {
        await ensureListeners();
        const started = parseState(await dependencies.invoke("start_codex_app_server", {
          input: {
            processKey: dependencies.processKey,
            cwd: input.cwd,
            ...(input.model === undefined ? {} : { model: input.model }),
            ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
            executable: input.executable ?? "codex",
            environmentRefs: input.environmentRefs ?? [],
            environmentOverrides: input.environmentOverrides ?? {},
            ...(input.credentialContext === undefined ? {} : { credentialContext: input.credentialContext }),
            ...(input.isolationContext === undefined ? {} : { isolationContext: input.isolationContext }),
            ...(input.checklistMcp === undefined ? {} : { checklistMcp: input.checklistMcp }),
          },
        }));
        latestState = started;
        await request("initialize", {
          clientInfo: {
            name: "humanthread-desktop",
            title: "HumanThread Desktop",
            version: AGENT_BUILD_VERSION,
          },
          capabilities: {
            experimentalApi: true,
            requestAttestation: false,
          },
        });
        await notify("initialized");
        const ready = { ...started, status: "ready" as const };
        latestState = ready;
        return ready;
      })();
      try {
        return await startPromise;
      } catch (error) {
        startPromise = null;
        throw providerError(error, "provider_start_error");
      }
    },
    request,
    notify,
    respond,
    async cancel(threadId, turnId) {
      try {
        await dependencies.invoke("cancel_codex_app_server", {
          processKey: dependencies.processKey,
          threadId,
          ...(turnId === undefined ? {} : { turnId }),
        });
      } catch (error) {
        throw providerError(error);
      }
    },
    async stop() {
      try {
        await dependencies.invoke("stop_codex_app_server", { processKey: dependencies.processKey });
      } catch (error) {
        throw providerError(error);
      } finally {
        unlistenNotification?.();
        unlistenState?.();
        unlistenNotification = null;
        unlistenState = null;
        listenersPromise = null;
        startPromise = null;
        latestState = null;
      }
    },
    async states() {
      try {
        const value = await dependencies.invoke("list_codex_app_servers");
        if (!Array.isArray(value)) throw new Error("Codex app-server state list is invalid");
        return value.map(parseState).filter((entry) => entry.processKey === dependencies.processKey);
      } catch (error) {
        throw providerError(error, "provider_protocol_error");
      }
    },
    async subscribe(handler) {
      await ensureListeners();
      notificationHandlers.add(handler);
      return () => { notificationHandlers.delete(handler); };
    },
    async subscribeState(handler) {
      await ensureListeners();
      stateHandlers.add(handler);
      return () => { stateHandlers.delete(handler); };
    },
  };
}
