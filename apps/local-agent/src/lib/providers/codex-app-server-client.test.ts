import { describe, expect, it, vi } from "vitest";
import {
  createCodexAppServerClient,
  type CodexAppServerListen,
  type CodexAppServerNotification,
  type CodexAppServerState,
} from "./codex-app-server-client";

const state: CodexAppServerState = {
  processKey: "codex:one",
  generation: 1,
  pid: 42,
  bindingFingerprint: "a".repeat(64),
  model: "gpt-5.6-terra",
  reasoningEffort: "high",
  transport: "websocket",
  endpoint: "ws://127.0.0.1:63570",
  protocolVersion: "codex-cli 0.154.0",
  status: "starting",
  lastNotificationAt: null,
  pendingRequestCount: 0,
  stderrSummary: null,
  lastErrorCode: null,
};

describe("Codex app-server native client", () => {
  it("initializes the server before exposing it as ready", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "start_codex_app_server") return state;
      if (command === "request_codex_app_server") return { userAgent: "codex" };
      return undefined;
    });
    const listen = vi.fn(async () => vi.fn());
    const client = createCodexAppServerClient({ invoke, listen, processKey: "codex:one" });

    await expect(client.start({ cwd: "/work", executable: "codex" })).resolves.toMatchObject({ status: "ready" });
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "start_codex_app_server",
      "request_codex_app_server",
      "notify_codex_app_server",
    ]);
    expect(invoke).toHaveBeenNthCalledWith(2, "request_codex_app_server", expect.objectContaining({
      processKey: "codex:one",
      method: "initialize",
      params: expect.objectContaining({
        capabilities: { experimentalApi: true, requestAttestation: false },
      }),
    }));
    expect(invoke).toHaveBeenNthCalledWith(3, "notify_codex_app_server", expect.objectContaining({
      processKey: "codex:one",
      method: "initialized",
    }));
  });

  it("filters notifications by process key and forwards matching events", async () => {
    const handlers = new Map<string, (event: { payload: CodexAppServerNotification }) => void>();
    const invoke = vi.fn(async () => state);
    const listen = vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
      handlers.set(event, handler as (event: { payload: CodexAppServerNotification }) => void);
      return vi.fn();
    }) as unknown as CodexAppServerListen;
    const client = createCodexAppServerClient({ invoke, listen, processKey: "codex:one" });
    const received: CodexAppServerNotification[] = [];
    const unsubscribe = await client.subscribe((notification) => received.push(notification));

    handlers.get("codex_app_server_notification")?.({ payload: { ...state, method: "thread/started", params: {}, receivedAtMs: 1 } as unknown as CodexAppServerNotification });
    handlers.get("codex_app_server_notification")?.({ payload: { ...state, processKey: "codex:two", method: "thread/started", params: {}, receivedAtMs: 2 } as unknown as CodexAppServerNotification });
    expect(received).toHaveLength(1);
    expect(received[0]?.processKey).toBe("codex:one");
    unsubscribe();
  });

  it("normalizes native transport errors to a stable provider code", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "start_codex_app_server") return state;
      throw "provider_transport_error: socket closed";
    });
    const listen = vi.fn(async () => vi.fn());
    const client = createCodexAppServerClient({ invoke, listen, processKey: "codex:one" });

    await expect(client.request("turn/start", {})).rejects.toMatchObject({
      code: "provider_transport_error",
      message: "socket closed",
    });
  });

  it("responds to a server request through the native bridge", async () => {
    const invoke = vi.fn(async () => undefined);
    const listen = vi.fn(async () => vi.fn());
    const client = createCodexAppServerClient({ invoke, listen, processKey: "codex:one" });

    await client.respond(7, { decision: "decline" });

    expect(invoke).toHaveBeenCalledWith("respond_codex_app_server", {
      processKey: "codex:one",
      requestId: 7,
      result: { decision: "decline" },
    });
  });

  it("allows the app-server to restart after a process failure", async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    let starts = 0;
    const invoke = vi.fn(async (command: string) => {
      if (command === "start_codex_app_server") {
        starts += 1;
        return { ...state, generation: starts };
      }
      if (command === "request_codex_app_server") return { userAgent: "codex" };
      return undefined;
    });
    const listen = vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
      handlers.set(event, handler);
      return vi.fn();
    }) as unknown as CodexAppServerListen;
    const client = createCodexAppServerClient({ invoke, listen, processKey: "codex:one" });

    await client.start({ cwd: "/work", executable: "codex" });
    handlers.get("codex_app_server_state")?.({ payload: { ...state, status: "failed", lastErrorCode: "provider_process_exit" } });
    await client.start({ cwd: "/work", executable: "codex" });

    expect(starts).toBe(2);
  });

  it("projects native app-server state to diagnostic subscribers", async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    const invoke = vi.fn(async () => state);
    const listen = vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
      handlers.set(event, handler);
      return vi.fn();
    }) as unknown as CodexAppServerListen;
    const client = createCodexAppServerClient({ invoke, listen, processKey: "codex:one" });
    const received: CodexAppServerState[] = [];
    const unsubscribe = await client.subscribeState((next) => received.push(next));

    handlers.get("codex_app_server_state")?.({ payload: { ...state, status: "ready", lastNotificationAt: 12 } });

    expect(received).toEqual([expect.objectContaining({ model: "gpt-5.6-terra", reasoningEffort: "high", status: "ready", lastNotificationAt: 12 })]);
    unsubscribe();
  });
});
