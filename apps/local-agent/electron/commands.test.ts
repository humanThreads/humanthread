import { describe, expect, it, vi } from "vitest";

import { createCommandHandlers, isAllowedWebHandoffUrl, type DesktopCommandHost } from "./commands";
import { CodexAppServerRegistry } from "./lib/codex-app-server";
import type { CodexTuiBroker, CodexTuiSessionInput } from "./lib/codex-tui-broker";
import { ManagedCommandRegistry } from "./lib/processes";
import type { LiveSessionRuntime } from "./lib/live-session-runtime";

function createFakeLiveSessions(): LiveSessionRuntime {
  return {
    publish: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    closeAll: vi.fn(async () => undefined),
    state: vi.fn(() => null),
  };
}

function createFakeTuiBroker(): CodexTuiBroker {
  const sessions = new Map<string, CodexTuiSessionInput>();
  let controllerWindowId: number | null = null;
  const view = (sessionId: string) => ({
    sessionId,
    runId: "run_1",
    taskId: null,
    projectId: null,
    nodeKey: null,
    processKey: "codex-daemon:test",
    threadId: "thread_1",
    cwd: "/workspace",
    model: "model_1",
    status: "running" as const,
    controlState: controllerWindowId === null ? "viewer" as const : "controller" as const,
    controllerWindowId,
    attachedCount: 0,
    lastActivityAtMs: 1,
    bufferBytes: 0,
    generation: 1,
  });
  return {
    register: vi.fn((input) => { sessions.set(input.sessionId, { ...input, windowId: 0 }); }),
    start: vi.fn(async (input) => view(input.sessionId)),
    unregister: vi.fn((sessionId) => { sessions.delete(sessionId); }),
    freeze: vi.fn(async () => undefined),
    list: vi.fn(() => [...sessions.keys()].map(view)),
    session: vi.fn((sessionId) => sessions.has(sessionId) ? view(sessionId) : null),
    spawn: vi.fn(async (input) => view(input.sessionId)),
    attach: vi.fn((sessionId) => ({ session: view(sessionId), replayBase64: "" })),
    reattach: vi.fn(async (sessionId) => view(sessionId)),
    detach: vi.fn((sessionId) => view(sessionId)),
    write: vi.fn(async (sessionId, windowId) => {
      if (controllerWindowId !== windowId) throw new Error("Codex TUI control lease is required");
    }),
    resize: vi.fn(async () => undefined),
    acquire: vi.fn((sessionId, windowId) => {
      controllerWindowId = windowId;
      return view(sessionId);
    }),
    release: vi.fn((sessionId, windowId) => {
      if (controllerWindowId === windowId) controllerWindowId = null;
      return view(sessionId);
    }),
    close: vi.fn(async () => undefined),
    closeAll: vi.fn(async () => undefined),
    dispose: vi.fn(),
  };
}

function createContext(options: { tui?: CodexTuiBroker } = {}) {
  const host: DesktopCommandHost = {
    send: vi.fn(),
    updateTray: vi.fn(),
    showNotification: vi.fn(async () => {}),
    openExternal: vi.fn(async () => {}),
    quitApplication: vi.fn(),
    modelFetch: vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(0),
    })),
  };
  const handlers = createCommandHandlers({
    host,
    managed: new ManagedCommandRegistry(),
    codexServers: new CodexAppServerRegistry({ send: host.send }),
    codexTui: options.tui ?? createFakeTuiBroker(),
    liveSessions: createFakeLiveSessions(),
  });
  return { host, handlers };
}

describe("desktop command handlers", () => {
  it("passes the invoking window id to the TUI broker and rejects another window write", async () => {
    const tui = createFakeTuiBroker();
    const { handlers } = createContext({ tui });
    const sessionArgs = {
      sessionId: "session_1",
      runId: "run_1",
      taskId: null,
      projectId: null,
      nodeKey: null,
      processKey: "codex-daemon:test",
      threadId: "thread_1",
      cwd: "/workspace",
      model: "model_1",
    };

    handlers.register_codex_tui_session?.(sessionArgs, { windowId: 7 });
    await handlers.spawn_codex_tui?.(sessionArgs, { windowId: 7 });
    await handlers.acquire_codex_tui_control?.({ sessionId: "session_1" }, { windowId: 7 });
    await expect(handlers.write_codex_tui?.(
      { sessionId: "session_1", deltaBase64: "YQ==" },
      { windowId: 8 },
    )).rejects.toThrow("Codex TUI control lease is required");
  });

  it("validates and updates the fixed tray menu contract", () => {
    const { host, handlers } = createContext();
    const items = [
      { id: "status", label: "已连接 · 设备已授权", enabled: false },
      { id: "current-task", label: "任务 A", enabled: true, route: "/tasks/task_1" },
      { id: "toggle-window", label: "隐藏窗口", enabled: true },
      { id: "self-check", label: "运行桌面自检", enabled: true },
      { id: "quit", label: "退出 HumanThread", enabled: true },
    ];
    expect(handlers.set_tray_menu?.({ state: { items } })).toBeNull();
    expect(host.updateTray).toHaveBeenCalledOnce();

    expect(() =>
      handlers.set_tray_menu?.({ state: { items: [...items].reverse() } }),
    ).toThrow("Tray menu items are invalid");
    expect(() =>
      handlers.set_tray_menu?.({
        state: { items: items.map((item) => item.id === "quit" ? { ...item, route: "/tasks/task_1" } : item) },
      }),
    ).toThrow("Tray menu route is invalid");
    expect(() =>
      handlers.set_tray_menu?.({
        state: { items: items.map((item) => item.id === "current-task" ? { ...item, route: "/admin" } : item) },
      }),
    ).toThrow("Tray current Task route is invalid");
  });

  it("validates native notifications and forwards the route on click", async () => {
    const { host, handlers } = createContext();
    await handlers.send_native_notification?.({
      id: "command:task_1:42",
      kind: "command_completed",
      title: "本地命令执行完成",
      body: "任务 A",
      route: "/tasks/task_1",
    });
    expect(host.showNotification).toHaveBeenCalledWith({
      id: "command:task_1:42",
      kind: "command_completed",
      title: "本地命令执行完成",
      body: "任务 A",
      route: "/tasks/task_1",
    });

    await expect(handlers.send_native_notification?.({
      id: "x",
      kind: "unknown_kind",
      title: "t",
      body: "b",
    })).rejects.toThrow("Native notification kind is invalid");
    await expect(handlers.send_native_notification?.({
      id: "loop-notification:one",
      kind: "approval",
      title: "t",
      body: "b",
      route: "/notifications?item=other&read=all&kind=all",
    })).rejects.toThrow("Native notification route is invalid");
  });

  it("only opens allowlisted web handoff URLs", async () => {
    const { host, handlers } = createContext();
    expect(isAllowedWebHandoffUrl(
      "http://localhost:3000/api/desktop/web-handoff/consume?code=abc",
      "http://localhost:3000",
    )).toBe(true);
    expect(isAllowedWebHandoffUrl(
      "https://evil.example.com/api/desktop/web-handoff/consume?code=abc",
      "http://localhost:3000",
    )).toBe(false);

    await handlers.open_web_handoff?.({
      url: "http://localhost:3000/api/desktop/web-handoff/consume?code=abc",
      deploymentUrl: "http://localhost:3000",
    });
    expect(host.openExternal).toHaveBeenCalledOnce();
    await expect(handlers.open_web_handoff?.({
      url: "https://evil.example.com/api/desktop/web-handoff/consume?code=abc",
      deploymentUrl: "http://localhost:3000",
    })).rejects.toThrow("Web handoff URL is not allowed");
  });

  it("only allows quit choices consistent with the running process state", async () => {
    const { host, handlers } = createContext();
    expect(handlers.desktop_quit_state?.({})).toEqual({
      managedRunning: false,
      externalSession: false,
    });
    await expect(handlers.quit_desktop?.({ choice: "interrupt_and_quit" })).rejects.toThrow(
      "Desktop quit choice is unavailable for the current process state",
    );
    await expect(handlers.quit_desktop?.({ choice: "quit" })).resolves.toBeNull();
    expect(host.quitApplication).toHaveBeenCalledOnce();
  });
});
