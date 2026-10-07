import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { createLiveRelayServer, type LiveRelayServer } from "./server";

const running: LiveRelayServer[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});

describe("live relay WebSocket server", () => {
  it("serves health without exposing terminal content", async () => {
    const relay = createLiveRelayServer({ port: 0, authorize: () => true });
    running.push(relay);
    const { port } = await relay.listen();
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: "humanthread-live-relay" });
  });

  it("keeps a viewer read-only until it claims control", async () => {
    const relay = createLiveRelayServer({ port: 0, authorize: () => true });
    running.push(relay);
    const { port } = await relay.listen();
    const sessionId = "a".repeat(32);
    relay.router.registerSession({ sessionId, firstSequence: 0, lastSequence: 0 });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/live-session/control?sessionId=${sessionId}`);
    const hello = waitForMessage(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });

    await expect(hello).resolves.toMatchObject({ type: "server.hello", protocol: 1 });
    socket.close();
  });

  it("rejects control claim, input and resize on a viewer-scoped connection", async () => {
    const relay = createLiveRelayServer({
      port: 0,
      authorize: ({ request }) => new URL(request.url ?? "/", "http://relay.local").searchParams.get("scope") === "viewer",
    });
    running.push(relay);
    const { port } = await relay.listen();
    const sessionId = "1".repeat(32);
    relay.router.registerSession({ sessionId, firstSequence: 0, lastSequence: 0 });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/live-session/control?sessionId=${sessionId}&scope=viewer`);
    const received: Array<Record<string, unknown>> = [];
    socket.on("message", (data, isBinary) => {
      if (!isBinary) received.push(JSON.parse(data.toString()) as Record<string, unknown>);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    await waitForMessageOfType(socket, "server.hello", received);

    socket.send(JSON.stringify({ type: "control.claim" }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(received.some((message) => message.type === "control.claimed")).toBe(false);
  });

  it("sends the latest phase to a viewer and keeps it out of the output sequence", async () => {
    const relay = createLiveRelayServer({ port: 0, authorize: () => true });
    running.push(relay);
    const { port } = await relay.listen();
    const sessionId = "2".repeat(32);
    relay.router.registerSession({ sessionId, firstSequence: 0, lastSequence: 5 });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/live-session/control?sessionId=${sessionId}`);
    const received: Array<Record<string, unknown>> = [];
    socket.on("message", (data, isBinary) => {
      if (!isBinary) received.push(JSON.parse(data.toString()) as Record<string, unknown>);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    await waitForMessageOfType(socket, "server.hello", received);

    relay.router.publishPhase(sessionId, {
      phase: "git.fetch",
      status: "running",
      startedAt: "2026-09-30T00:00:00.000Z",
      finishedAt: null,
      code: null,
      summary: null,
      attemptNo: 1,
      leaseGeneration: 2,
    });
    await waitForMessageOfType(socket, "server.phase", received);

    expect(received).toContainEqual(expect.objectContaining({ type: "server.phase", phase: "git.fetch" }));
    expect(relay.router.session(sessionId)?.lastSequence).toBe(5);
    socket.close();
  });

  it("tells a control client whether the execution target is already connected", async () => {
    const relay = createLiveRelayServer({ port: 0, authorize: () => true });
    running.push(relay);
    const { port } = await relay.listen();
    const sessionId = "f".repeat(32);
    const execution = new WebSocket(`ws://127.0.0.1:${port}/live-session/execution?sessionId=${sessionId}`);
    await new Promise<void>((resolve, reject) => {
      execution.once("open", resolve);
      execution.once("error", reject);
    });

    const control = new WebSocket(`ws://127.0.0.1:${port}/live-session/control?sessionId=${sessionId}`);
    const hello = waitForMessage(control);
    await new Promise<void>((resolve, reject) => {
      control.once("open", resolve);
      control.once("error", reject);
    });

    await expect(hello).resolves.toMatchObject({ type: "server.hello", targetOnline: true });
    control.close();
    execution.close();
  });

  it("accepts a server.phase text frame from the execution side without changing the output sequence", async () => {
    const relay = createLiveRelayServer({ port: 0, authorize: () => true });
    running.push(relay);
    const { port } = await relay.listen();
    const sessionId = "3".repeat(32);
    const execution = new WebSocket(`ws://127.0.0.1:${port}/live-session/execution?sessionId=${sessionId}`);
    await new Promise<void>((resolve, reject) => {
      execution.once("open", resolve);
      execution.once("error", reject);
    });

    execution.send(JSON.stringify({
      type: "server.phase",
      phase: {
        phase: "git.fetch",
        status: "succeeded",
        startedAt: "2026-09-30T00:00:00.000Z",
        finishedAt: "2026-09-30T00:00:05.000Z",
        code: null,
        summary: "远端引用已同步",
        attemptNo: 1,
        leaseGeneration: 2,
      },
    }));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(relay.router.latestPhase(sessionId)).toMatchObject({ phase: "git.fetch", status: "succeeded" });
    expect(relay.router.session(sessionId)?.lastSequence).toBe(0);
    expect(execution.readyState).toBe(WebSocket.OPEN);
    execution.close();
  });

  it("drops an invalid phase frame without closing the execution socket", async () => {
    const relay = createLiveRelayServer({ port: 0, authorize: () => true });
    running.push(relay);
    const { port } = await relay.listen();
    const sessionId = "4".repeat(32);
    const execution = new WebSocket(`ws://127.0.0.1:${port}/live-session/execution?sessionId=${sessionId}`);
    await new Promise<void>((resolve, reject) => {
      execution.once("open", resolve);
      execution.once("error", reject);
    });

    execution.send(JSON.stringify({
      type: "server.phase",
      phase: {
        phase: "git.fetch",
        status: "running",
        startedAt: "2026-09-30T00:00:00.000Z",
        finishedAt: null,
        code: null,
        summary: "\u001b[31mred\u001b[0m",
        attemptNo: 1,
        leaseGeneration: 2,
      },
    }));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(relay.router.latestPhase(sessionId)).toBeNull();
    expect(execution.readyState).toBe(WebSocket.OPEN);
    execution.close();
  });

  it("rejects websocket upgrades without a valid relay ticket", async () => {
    const relay = createLiveRelayServer({ port: 0, authorize: () => false });
    running.push(relay);
    const { port } = await relay.listen();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/live-session/control?sessionId=${"b".repeat(32)}`);

    await expect(new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    })).rejects.toThrow();
  });

  it("fails closed when no authorization hook is configured", async () => {
    const relay = createLiveRelayServer({ port: 0 });
    running.push(relay);
    const { port } = await relay.listen();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/live-session/execution?sessionId=${"c".repeat(32)}`);

    await expect(new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    })).rejects.toThrow();
  });

  it("accepts the execution side before any control connection exists", async () => {
    const relay = createLiveRelayServer({ port: 0, authorize: () => true });
    running.push(relay);
    const { port } = await relay.listen();
    const sessionId = "d".repeat(32);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/live-session/execution?sessionId=${sessionId}`);

    await expect(new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    })).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(relay.router.session(sessionId)?.executionConnectionId).not.toBeNull();
    socket.close();
  });

  it("keeps the execution input route when control attaches afterwards", async () => {
    const relay = createLiveRelayServer({ port: 0, authorize: () => true });
    running.push(relay);
    const { port } = await relay.listen();
    const sessionId = "e".repeat(32);
    const execution = new WebSocket(`ws://127.0.0.1:${port}/live-session/execution?sessionId=${sessionId}`);
    const received: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve, reject) => {
      execution.once("open", () => resolve());
      execution.once("error", reject);
    });
    execution.on("message", (data, isBinary) => {
      if (!isBinary) received.push(JSON.parse(data.toString()) as Record<string, unknown>);
    });

    const control = new WebSocket(`ws://127.0.0.1:${port}/live-session/control?sessionId=${sessionId}`);
    await new Promise<void>((resolve, reject) => {
      control.once("open", () => resolve());
      control.once("error", reject);
    });
    control.send(JSON.stringify({ type: "control.claim" }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    control.send(JSON.stringify({ type: "control.input", bytesBase64: Buffer.from("ls\r").toString("base64") }));
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(received).toContainEqual(expect.objectContaining({
      type: "control.input",
      bytesBase64: Buffer.from("ls\r").toString("base64"),
    }));
    control.close();
    execution.close();
  });
});

function waitForMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data, isBinary) => {
      if (isBinary) return reject(new Error("Expected a text frame"));
      resolve(JSON.parse(data.toString()) as Record<string, unknown>);
    });
  });
}

async function waitForMessageOfType(
  socket: WebSocket,
  type: string,
  received: Array<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const existing = received.find((message) => message.type === type);
  if (existing) return existing;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`Timed out waiting for ${type}`));
    }, 2_000);
    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) return;
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      if (message.type !== type) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}
