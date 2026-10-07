import { describe, expect, it, vi } from "vitest";

import { createWorkerLiveSessionConnector } from "./live-session-connector";

// Mirrors the `ws` lifecycle: sockets start CONNECTING (0) and only become
// OPEN (1) once the handshake completes, which is the race the connector must
// absorb instead of rejecting terminal output.
function fakeSocket() {
  const sent: Array<string | Uint8Array> = [];
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const socket = {
    readyState: 0,
    send(value: string | Uint8Array) { sent.push(value); },
    close: vi.fn(() => { socket.readyState = 3; }),
    on(event: string, listener: (...args: unknown[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return socket;
    },
    emit(event: string, ...args: unknown[]) {
      if (event === "open") socket.readyState = 1;
      if (event === "close") socket.readyState = 3;
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  };
  return { socket, sent };
}

function baseInput(sessionId: string, socket: ReturnType<typeof fakeSocket>["socket"], extra: Record<string, unknown> = {}) {
  return {
    relayUrl: "wss://localhost:3000/live-session/execution",
    sessionId,
    workerPoolSessionToken: "htwps_session",
    connect: (() => {
      queueMicrotask(() => socket.emit("open"));
      return socket;
    }) as never,
    heartbeatMs: 60_000,
    now: () => new Date("2026-09-24T00:00:00.000Z"),
    onInput: vi.fn(),
    initialConnectTimeoutMs: 1_000,
    reconnectDelayMs: 5,
    ...extra,
  };
}

describe("Worker live session connector", () => {
  it("publishes phase frames as server.phase text without touching terminal bytes", async () => {
    const { socket, sent } = fakeSocket();
    const connector = createWorkerLiveSessionConnector(baseInput("1".repeat(32), socket));
    await connector.start();

    await connector.publishPhase({
      phase: "git.fetch",
      status: "running",
      startedAt: "2026-09-24T00:00:00.000Z",
      finishedAt: null,
      code: null,
      summary: "正在同步远端引用",
    });

    const frames = sent
      .filter((value): value is string => typeof value === "string")
      .map((value) => JSON.parse(value) as Record<string, unknown>);
    expect(frames).toContainEqual(expect.objectContaining({
      type: "server.phase",
      phase: expect.objectContaining({ phase: "git.fetch", status: "running" }),
    }));
    expect(sent.some((value) => typeof value !== "string")).toBe(false);
  });

  it("drops a phase frame when the relay is offline instead of buffering display state as terminal bytes", async () => {
    const { socket, sent } = fakeSocket();
    socket.readyState = 3;
    const connector = createWorkerLiveSessionConnector(baseInput("2".repeat(32), socket, {
      connect: (() => socket) as never,
    }));
    await connector.start().catch(() => undefined);

    await connector.publishPhase({
      phase: "git.fetch",
      status: "failed",
      startedAt: "2026-09-24T00:00:00.000Z",
      finishedAt: "2026-09-24T00:00:01.000Z",
      code: "fetch_failed",
      summary: null,
    });

    expect(connector.bufferedBytes?.()).toBe(0);
    expect(sent.some((value) => typeof value !== "string")).toBe(false);
  });

  it("never writes terminal bytes while reporting phases", async () => {
    const { socket, sent } = fakeSocket();
    const connector = createWorkerLiveSessionConnector(baseInput("3".repeat(32), socket));
    await connector.start();

    await connector.publishPhase({
      phase: "worktree.prepare",
      status: "running",
      startedAt: "2026-09-24T00:00:00.000Z",
      finishedAt: null,
      code: null,
      summary: "worktree.create",
    });
    await connector.publishPhase({
      phase: "worktree.prepare",
      status: "succeeded",
      startedAt: "2026-09-24T00:00:00.000Z",
      finishedAt: "2026-09-24T00:00:01.000Z",
      code: null,
      summary: "worktree.create",
    });

    expect(sent.every((value) => typeof value === "string")).toBe(true);
  });

  it("forwards viewer terminal geometry to the execution side while controlling", async () => {
    const { socket } = fakeSocket();
    const onResize = vi.fn();
    const connector = createWorkerLiveSessionConnector(baseInput("e".repeat(32), socket, { onResize }));

    await connector.start();
    socket.emit("message", JSON.stringify({ type: "control.claimed" }));
    socket.emit("message", JSON.stringify({ type: "control.resize", rows: 24, cols: 80 }));

    expect(onResize).toHaveBeenCalledWith({ rows: 24, cols: 80 });
  });

  it("uses the worker pool session as outbound relay authentication", async () => {
    const { socket, sent } = fakeSocket();
    const connect = vi.fn(() => socket);
    const connector = createWorkerLiveSessionConnector({
      relayUrl: "wss://localhost:3000/live-session/execution",
      sessionId: "a".repeat(32),
      workerPoolSessionToken: "htwps_session",
      connect: connect as never,
      heartbeatMs: 1_000,
      now: () => new Date("2026-09-24T00:00:00.000Z"),
      onInput: vi.fn(),
    });

    const started = connector.start();
    socket.emit("open");
    await started;
    await connector.heartbeat();

    expect(connect).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ "x-worker-pool-session": "htwps_session" }),
    }));
    expect(sent.some((value) => typeof value === "string" && value.includes("execution.heartbeat"))).toBe(true);
    await connector.close();
  });

  it("resolves start only after the relay handshake completed", async () => {
    const { socket } = fakeSocket();
    let opened = false;
    const connector = createWorkerLiveSessionConnector(baseInput("f".repeat(32), socket, {
      connect: (() => {
        setTimeout(() => { opened = true; socket.emit("open"); }, 10);
        return socket;
      }) as never,
    }));

    await connector.start();

    // Starting must not resolve before the handshake: otherwise the first PTY
    // bytes race the socket and reject on a path nobody can catch.
    expect(opened).toBe(true);
    expect(connector.state()).toBe("online");
    await connector.close();
  });

  it("fails the handshake with a typed error when the relay never opens", async () => {
    const { socket } = fakeSocket();
    const connector = createWorkerLiveSessionConnector(baseInput("b".repeat(32), socket, {
      connect: (() => socket) as never,
      initialConnectTimeoutMs: 20,
    }));

    await expect(connector.start()).rejects.toMatchObject({ code: "internal_connector_offline" });
    await connector.close();
  });

  it("buffers terminal bytes while the relay is offline instead of rejecting the output path", async () => {
    const { socket, sent } = fakeSocket();
    const connector = createWorkerLiveSessionConnector(baseInput("e".repeat(32), socket, {
      reconnectDelayMs: 60_000,
    }));

    await connector.start();
    socket.emit("close");
    await expect(connector.publish(Buffer.from("late output"))).resolves.toBeUndefined();
    expect(connector.state()).toBe("reconnecting");
    expect(sent.filter((value) => typeof value !== "string")).toHaveLength(0);
  });

  it("flushes buffered terminal bytes once the relay reconnects", async () => {
    const { socket, sent } = fakeSocket();
    const connector = createWorkerLiveSessionConnector(baseInput("c".repeat(32), socket));

    await connector.start();
    socket.emit("close");
    await connector.publish(Buffer.from("late output"));
    expect(sent.filter((value) => typeof value !== "string")).toHaveLength(0);

    socket.emit("open");
    await vi.waitFor(() => {
      expect(sent.filter((value) => typeof value !== "string")).toHaveLength(1);
    });
    expect(Buffer.from(sent.find((value) => typeof value !== "string") as Uint8Array).toString()).toBe("late output");
    await connector.close();
  });

  it("drops the oldest buffered bytes instead of growing without bound", async () => {
    const { socket } = fakeSocket();
    const connector = createWorkerLiveSessionConnector(baseInput("d".repeat(32), socket, {
      maxBufferedBytes: 8,
      reconnectDelayMs: 60_000,
    }));

    await connector.start();
    socket.emit("close");
    await connector.publish(Buffer.from("12345678"));
    await connector.publish(Buffer.from("abcdefgh"));
    expect(connector.bufferedBytes?.()).toBe(8);
    await connector.close();
  });

  it("keeps the execution socket healthy when viewer input fails", async () => {
    const { socket } = fakeSocket();
    const inputErrors: unknown[] = [];
    const connector = createWorkerLiveSessionConnector(baseInput("a".repeat(32), socket, {
      onInput: vi.fn(async () => { throw Object.assign(new Error("Worker TUI session is not running"), { code: "provider_tui_detached" }); }),
      onInputError: (error: unknown) => { inputErrors.push(error); },
    }));

    await connector.start();
    socket.emit("message", JSON.stringify({ type: "control.claimed" }), false);
    socket.emit("message", JSON.stringify({
      type: "control.input",
      bytesBase64: Buffer.from("ls\r").toString("base64"),
    }), false);

    await vi.waitFor(() => expect(inputErrors).toHaveLength(1));
    expect(connector.state()).toBe("online");
    await connector.close();
  });

  it("stops reconnecting after the session is closed", async () => {
    const { socket } = fakeSocket();
    const connector = createWorkerLiveSessionConnector(baseInput("a".repeat(32), socket));

    await connector.start();
    await connector.close();
    socket.emit("close");
    await connector.publish(Buffer.from("after close"));

    expect(connector.state()).toBe("closed");
    expect(connector.bufferedBytes?.()).toBe(0);
  });
});
