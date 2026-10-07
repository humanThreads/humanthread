import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CodexTuiClient, CodexTuiSession } from "../../lib/codex-tui-client";
import { LocalTerminalView } from "./local-terminal-view";

const terminalWrites: Uint8Array[] = [];
const terminalDataHandler: { current: ((data: string) => void) | null } = { current: null };
const fit = vi.fn();

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    loadAddon() {}
    open() {}
    write(data: Uint8Array | string) {
      terminalWrites.push(typeof data === "string" ? new TextEncoder().encode(data) : data);
    }
    onData(handler: (data: string) => void) {
      terminalDataHandler.current = handler;
      return { dispose() { terminalDataHandler.current = null; } };
    }
    dispose() {}
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = fit;
  },
}));

const session: CodexTuiSession = {
  sessionId: "session_1",
  runId: "run_1",
  taskId: "task_1",
  projectId: "project_1",
  nodeKey: "develop",
  processKey: "codex-daemon:test",
  threadId: "thread_1",
  cwd: "/workspace",
  model: "model_1",
  status: "running",
  controlState: "viewer",
  controllerWindowId: null,
  attachedCount: 1,
  lastActivityAtMs: 10,
  bufferBytes: 1,
  generation: 1,
  attached: true,
};

function createClient(): CodexTuiClient {
  return {
    register: vi.fn(async () => undefined),
    start: vi.fn(async () => session),
    unregister: vi.fn(async () => undefined),
    list: vi.fn(async () => [session]),
    spawn: vi.fn(async () => ({ session, replayBase64: "" })),
    attach: vi.fn(async () => ({ session, replayBase64: "" })),
    reattach: vi.fn(async () => session),
    detach: vi.fn(async () => session),
    write: vi.fn(async () => undefined),
    resize: vi.fn(async () => undefined),
    acquire: vi.fn(async () => ({
      ...session,
      controlState: "controller" as const,
      controllerWindowId: 7,
    })),
    release: vi.fn(async () => session),
    close: vi.fn(async () => undefined),
    subscribeOutput: vi.fn(async () => () => undefined),
    subscribeState: vi.fn(async () => () => undefined),
  };
}

describe("LocalTerminalView", () => {
  it("encodes input without relying on Node Buffer globals", async () => {
    const originalBuffer = globalThis.Buffer;
    // Sandboxed Electron renderers do not expose Node's Buffer global.
    Reflect.deleteProperty(globalThis, "Buffer");
    try {
      const client = createClient();
      render(<LocalTerminalView client={client} session={session} />);
      await screen.findByText("只读");
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "接管终端" }));
      terminalDataHandler.current?.("a");
      expect(client.write).toHaveBeenCalledWith("session_1", "YQ==");
    } finally {
      Object.defineProperty(globalThis, "Buffer", {
        configurable: true,
        writable: true,
        value: originalBuffer,
      });
    }
  });

  beforeEach(() => {
    terminalWrites.splice(0);
    terminalDataHandler.current = null;
    fit.mockClear();
  });

  it("renders in read-only mode until the user explicitly takes control", async () => {
    const client = createClient();
    const user = userEvent.setup();
    render(<LocalTerminalView client={client} session={session} />);

    expect(await screen.findByText("只读")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "接管终端" }));

    expect(client.acquire).toHaveBeenCalledWith("session_1");
    expect(await screen.findByText("已接管")).toBeInTheDocument();
  });

  it("writes terminal input only after control is acquired", async () => {
    const client = createClient();
    render(<LocalTerminalView client={client} session={session} />);
    await screen.findByText("只读");

    terminalDataHandler.current?.("a");
    expect(client.write).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "接管终端" }));
    terminalDataHandler.current?.("b");
    expect(client.write).toHaveBeenCalledWith("session_1", "Yg==");
  });

  it("re-attaches a detached thread without changing its thread id", async () => {
    const client = createClient();
    const detached = { ...session, status: "detached" as const, controlState: "detached" as const };
    const user = userEvent.setup();
    render(<LocalTerminalView client={client} session={detached} />);

    await user.click(screen.getByRole("button", { name: "重新附着" }));

    expect(client.attach).toHaveBeenCalledWith("session_1");
    expect(detached.threadId).toBe("thread_1");
  });
});
