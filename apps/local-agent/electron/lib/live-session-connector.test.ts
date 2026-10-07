import { describe, expect, it, vi } from "vitest";

import { createLiveSessionConnector } from "./live-session-connector";

function fakeSocket() {
  const sent: Array<string | Uint8Array> = [];
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const socket = {
    readyState: 1,
    sent,
    send(value: string | Uint8Array) { sent.push(value); },
    close: vi.fn(),
    on(event: string, listener: (...args: unknown[]) => void) {
      const current = listeners.get(event) ?? [];
      current.push(listener);
      listeners.set(event, current);
      return socket;
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  };
  return socket;
}

describe("Desktop live session connector", () => {
  it("uses an outbound WSS and sends heartbeat plus recovery metadata", async () => {
    const socket = fakeSocket();
    const connect = vi.fn(() => socket);
    const connector = createLiveSessionConnector({
      relayUrl: "wss://localhost:3000/live-session/execution",
      sessionId: "a".repeat(32),
      authorization: "Bearer device-token",
      connect: connect as never,
      heartbeatMs: 1_000,
      now: () => new Date("2026-09-24T00:00:00.000Z"),
      onControl: vi.fn(),
      onInput: vi.fn(),
    });

    await connector.start();
    socket.emit("open");
    await connector.heartbeat();

    expect(connect).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining("sessionId=" + "a".repeat(32)),
      headers: expect.objectContaining({ authorization: "Bearer device-token" }),
    }));
    expect(socket.sent.some((value) => typeof value === "string" && value.includes("execution.hello"))).toBe(true);
    expect(socket.sent.some((value) => typeof value === "string" && value.includes("execution.heartbeat"))).toBe(true);
  });

  it("routes relay input to the broker and rejects it when control is absent", async () => {
    const socket = fakeSocket();
    const onInput = vi.fn();
    const connector = createLiveSessionConnector({
      relayUrl: "wss://localhost:3000/live-session/execution",
      sessionId: "b".repeat(32),
      authorization: "Bearer device-token",
      connect: (() => socket) as never,
      heartbeatMs: 60_000,
      now: () => new Date("2026-09-24T00:00:00.000Z"),
      onControl: vi.fn(),
      onInput,
    });

    await connector.start();
    socket.emit("open");
    socket.emit("message", Buffer.from(JSON.stringify({ type: "control.input", bytesBase64: Buffer.from("abc").toString("base64") })), false);

    expect(onInput).not.toHaveBeenCalled();
  });
});
