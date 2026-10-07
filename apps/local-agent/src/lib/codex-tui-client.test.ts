import { describe, expect, it, vi } from "vitest";

import {
  createCodexTuiClient,
  type CodexTuiClient,
  type CodexTuiInvoke,
  type CodexTuiListen,
  type CodexTuiOutputEvent,
} from "./codex-tui-client";

const session = {
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

function createClient() {
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  const invoke = vi.fn(async (command: string): Promise<unknown> => {
    if (command === "list_codex_tui_sessions") return [session];
    if (command === "attach_codex_tui") return { session, replayBase64: "YQ==" };
    return session;
  });
  const listen = vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    handlers.set(event, handler);
    return () => handlers.delete(event);
  });
  return {
    client: createCodexTuiClient({
      invoke: invoke as CodexTuiInvoke,
      listen: listen as CodexTuiListen,
    }),
    handlers,
    invoke,
    listen,
  };
}

describe("Codex TUI renderer client", () => {
  it("validates list responses and forwards only output for the requested session", async () => {
    const { client, handlers } = createClient();
    const output: CodexTuiOutputEvent[] = [];
    await client.subscribeOutput((event) => output.push(event));

    await expect(client.list()).resolves.toEqual([expect.objectContaining({ sessionId: "session_1" })]);
    handlers.get("codex_tui_output")?.({
      payload: { sessionId: "session_1", stream: "stdout", deltaBase64: "YQ==", receivedAtMs: 11 },
    });
    handlers.get("codex_tui_output")?.({
      payload: { sessionId: "session_1", stream: "stderr", deltaBase64: "Yg==", receivedAtMs: 12 },
    });

    expect(output).toEqual([
      { sessionId: "session_1", deltaBase64: "YQ==" },
      { sessionId: "session_1", deltaBase64: "Yg==" },
    ]);
  });

  it("rejects malformed native session responses", async () => {
    const client = createCodexTuiClient({
      invoke: vi.fn(async (): Promise<unknown> => [{ sessionId: "session_1" }]) as CodexTuiInvoke,
      listen: vi.fn(async (_event: string, _handler: (event: { payload: unknown }) => void) => vi.fn()) as CodexTuiListen,
    });
    await expect(client.list()).rejects.toThrow("Codex TUI session is invalid");
  });

  it("sends scoped control and terminal commands through the native bridge", async () => {
    const { client, invoke } = createClient();
    await client.write("session_1", "YQ==");
    await client.resize("session_1", 30, 100);
    await client.acquire("session_1");
    await client.release("session_1");
    await client.close("session_1");

    expect(invoke).toHaveBeenCalledWith("write_codex_tui", {
      sessionId: "session_1",
      deltaBase64: "YQ==",
    });
    expect(invoke).toHaveBeenCalledWith("resize_codex_tui", {
      sessionId: "session_1",
      rows: 30,
      cols: 100,
    });
    expect(invoke).toHaveBeenCalledWith("acquire_codex_tui_control", { sessionId: "session_1" });
    expect(invoke).toHaveBeenCalledWith("release_codex_tui_control", { sessionId: "session_1" });
    expect(invoke).toHaveBeenCalledWith("close_codex_tui", { sessionId: "session_1" });
  });
});
