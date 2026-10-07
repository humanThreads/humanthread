import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  CodexAppServerNotification,
  CodexAppServerState,
} from "./codex-app-server";
import {
  createCodexTuiBroker,
  type CodexTuiSessionInput,
} from "./codex-tui-broker";
import { prepareCodexTuiViewerHome } from "./codex-tui-viewer-home";

const sessionInput: Omit<CodexTuiSessionInput, "windowId"> = {
  sessionId: "session_1",
  runId: "run_1",
  taskId: "task_1",
  projectId: "project_1",
  nodeKey: "develop",
  processKey: "codex-daemon:test",
  threadId: "thread_1",
  cwd: "/workspace",
  model: "model_1",
};

const baseState: CodexAppServerState = {
  processKey: sessionInput.processKey,
  generation: 1,
  pid: 42,
  bindingFingerprint: "binding",
  model: "model_1",
  reasoningEffort: "high",
  transport: "unix",
  endpoint: "unix:///tmp/codex.sock",
  protocolVersion: "codex-cli 0.154.0",
  status: "ready",
  lastNotificationAt: null,
  pendingRequestCount: 0,
  stderrSummary: null,
  lastErrorCode: null,
};

function fakeAppServer() {
  const requests: Array<{ method: string; params: unknown }> = [];
  let notificationHandler: ((notification: CodexAppServerNotification) => void) | null = null;
  const state: CodexAppServerState = baseState;
  return {
    requests,
    state: vi.fn(() => state),
    request: vi.fn(async (processKey: string, method: string, params: unknown) => {
      requests.push({ method, params });
      return {};
    }),
    subscribe: vi.fn((handler: (notification: CodexAppServerNotification) => void) => {
      notificationHandler = handler;
      return () => { notificationHandler = null; };
    }),
    emit(method: string, params: unknown) {
      notificationHandler?.({
        processKey: sessionInput.processKey,
        generation: 1,
        method,
        params,
        requestId: null,
        receivedAtMs: 10,
      });
    },
  };
}

describe("Codex TUI broker", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("creates a viewer home without copying provider credentials", () => {
    const root = mkdtempSync(join(tmpdir(), "humanthread-tui-home-"));
    temporaryDirectories.push(root);

    const home = prepareCodexTuiViewerHome(root);

    expect(readFileSync(join(home, "config.toml"), "utf8")).toBe(
      "check_for_update_on_startup = false\n",
    );
    expect(() => readFileSync(join(home, "auth.json"), "utf8")).toThrow();
  });

  it("only spawns the fixed resume template and scrubs credentials from the viewer", async () => {
    const appServer = fakeAppServer();
    const broker = createCodexTuiBroker({
      appServer,
      executable: "/usr/local/bin/codex",
      viewerHome: "/tmp/viewer-home",
      now: () => 10,
      createProcessHandle: () => "process_1",
    });
    broker.register(sessionInput);

    await broker.spawn({ ...sessionInput, windowId: 7 });

    expect(appServer.requests[0]).toMatchObject({
      method: "process/spawn",
      params: expect.objectContaining({
        command: [
          "/usr/local/bin/codex",
          "resume",
          "thread_1",
          "--remote",
          "unix:///tmp/codex.sock",
          "--cd",
          "/workspace",
          "-m",
          "model_1",
        ],
        env: expect.objectContaining({
          CODEX_HOME: "/tmp/viewer-home",
          OPENAI_API_KEY: null,
          OPENAI_BASE_URL: null,
          OPENAI_ORGANIZATION: null,
          OPENAI_PROJECT: null,
          TERM: "xterm-256color",
        }),
        tty: true,
      }),
    });
  });

  it("launches the viewer with the session model instead of the CLI default", async () => {
    const appServer = fakeAppServer();
    const broker = createCodexTuiBroker({
      appServer,
      executable: "/usr/local/bin/codex",
      viewerHome: "/tmp/viewer-home",
      now: () => 10,
      createProcessHandle: () => "process_1",
    });
    broker.register(sessionInput);

    await broker.spawn({ ...sessionInput, windowId: 7 });

    // Without an explicit model the TUI falls back to Codex's own default, so
    // the terminal would display a different model than the selected one.
    const spawn = appServer.requests[0] as { params: { command: string[] } };
    expect(spawn.params.command).toEqual(expect.arrayContaining(["-m", "model_1"]));
  });

  it("allows only one controller and rejects stdin from a viewer", async () => {
    const appServer = fakeAppServer();
    const broker = createCodexTuiBroker({
      appServer,
      executable: "codex",
      viewerHome: "/tmp/viewer-home",
      createProcessHandle: () => "process_1",
    });
    broker.register(sessionInput);
    await broker.spawn({ ...sessionInput, windowId: 7 });

    expect(broker.acquire("session_1", 7).controlState).toBe("controller");
    await expect(broker.write("session_1", 8, Buffer.from("a").toString("base64")))
      .rejects.toThrow("Codex TUI control lease is required");
    expect(broker.acquire("session_1", 8).controllerWindowId).toBe(8);
  });

  it("bounds replay bytes and keeps the session after the TUI exits", async () => {
    const appServer = fakeAppServer();
    const broker = createCodexTuiBroker({
      appServer,
      executable: "codex",
      viewerHome: "/tmp/viewer-home",
      maxBufferBytes: 8,
      createProcessHandle: () => "process_1",
    });
    broker.register(sessionInput);
    await broker.spawn({ ...sessionInput, windowId: 7 });

    appServer.emit("process/outputDelta", {
      processHandle: "process_1",
      stream: "stdout",
      deltaBase64: Buffer.from("1234567890").toString("base64"),
      capReached: false,
    });
    appServer.emit("process/exited", {
      processHandle: "process_1",
      exitCode: 0,
      stdout: "",
      stderr: "",
      stdoutCapReached: false,
      stderrCapReached: false,
    });

    expect(broker.list()[0]).toMatchObject({ status: "detached", bufferBytes: 8 });
    expect(Buffer.from(broker.attach("session_1", 8).replayBase64, "base64").toString()).toBe("34567890");
  });

  it("re-spawns the PTY on reattach while keeping the same thread", async () => {
    const appServer = fakeAppServer();
    let handles = 0;
    const broker = createCodexTuiBroker({
      appServer,
      executable: "codex",
      viewerHome: "/tmp/viewer-home",
      createProcessHandle: () => `process_${++handles}`,
    });
    broker.register(sessionInput);
    await broker.spawn({ ...sessionInput, windowId: 7 });
    appServer.emit("process/exited", {
      processHandle: "process_1",
      exitCode: 0,
      stdout: "",
      stderr: "",
      stdoutCapReached: false,
      stderrCapReached: false,
    });
    expect(broker.list()[0]).toMatchObject({ status: "detached", threadId: "thread_1" });

    const reattached = await broker.reattach("session_1", 8);

    expect(reattached).toMatchObject({ status: "running", threadId: "thread_1" });
    expect(appServer.requests.filter(({ method }) => method === "process/spawn")).toHaveLength(2);
    expect(appServer.requests.at(-1)?.params).toMatchObject({
      command: expect.arrayContaining(["resume", "thread_1"]),
    });
  });

  it("fails closed and marks interrupted when the daemon generation changes", async () => {
    const appServer = fakeAppServer();
    let generation = 1;
    appServer.state.mockImplementation(() => ({
      ...baseState,
      generation,
    }));
    const broker = createCodexTuiBroker({
      appServer,
      executable: "codex",
      viewerHome: "/tmp/viewer-home",
      createProcessHandle: () => "process_1",
    });
    broker.register(sessionInput);
    await broker.spawn({ ...sessionInput, windowId: 7 });
    generation = 2;

    await expect(broker.reattach("session_1", 7)).rejects.toThrow(
      "Codex daemon generation changed",
    );
    expect(broker.list()[0]).toMatchObject({ status: "interrupted" });
  });

  it("does not let a completed AgentRun resume its TUI", async () => {
    const appServer = fakeAppServer();
    const broker = createCodexTuiBroker({
      appServer,
      executable: "codex",
      viewerHome: "/tmp/viewer-home",
      createProcessHandle: () => "process_1",
    });
    broker.register(sessionInput);
    await broker.spawn({ ...sessionInput, windowId: 7 });

    await broker.freeze("session_1");

    expect(broker.list()[0]).toMatchObject({ status: "completed" });
    await expect(broker.reattach("session_1", 7)).rejects.toThrow(
      "Codex TUI session is complete",
    );
  });
});
