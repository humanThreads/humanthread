import { describe, expect, it, vi } from "vitest";

import { LiveRelayRouter, MAX_OUTPUT_QUEUE_BYTES, parseRelayPhaseFrame } from "./router";

function attached(router: LiveRelayRouter, sessionId = "a".repeat(32)) {
  const sent: number[] = [];
  const disconnected = vi.fn();
  const viewer = router.attachViewer({
    sessionId,
    connectionId: "connection_1",
    lastSequence: 0,
    send: ({ sequence }) => sent.push(sequence),
    disconnect: disconnected,
  });
  return { viewer, sent, disconnected };
}

describe("LiveRelayRouter", () => {
  it("accepts a bounded relay phase frame and rejects unknown keys", () => {
    const frame = {
      phase: "git.fetch",
      status: "running",
      startedAt: "2026-09-30T00:00:00.000Z",
      finishedAt: null,
      code: null,
      summary: "正在同步远端引用",
      attemptNo: 1,
      leaseGeneration: 2,
    };

    expect(parseRelayPhaseFrame(frame)).toEqual(frame);
    expect(() => parseRelayPhaseFrame({ ...frame, extra: true })).toThrow(
      expect.objectContaining({ code: "live_session_invalid" }),
    );
  });

  it("rejects ANSI escape sequences, control characters and secret-bearing phase summaries", () => {
    const frame = {
      phase: "git.fetch",
      status: "running",
      startedAt: "2026-09-30T00:00:00.000Z",
      finishedAt: null,
      code: null,
      summary: "ok",
      attemptNo: 1,
      leaseGeneration: 2,
    };

    expect(() => parseRelayPhaseFrame({ ...frame, summary: "\u001b[31mred\u001b[0m" })).toThrow(
      expect.objectContaining({ code: "live_session_invalid" }),
    );
    expect(() => parseRelayPhaseFrame({ ...frame, summary: "bad\u0000value" })).toThrow(
      expect.objectContaining({ code: "live_session_invalid" }),
    );
    expect(() => parseRelayPhaseFrame({ ...frame, summary: "token=ghp_1234567890abcdefghij" })).toThrow(
      expect.objectContaining({ code: "live_session_invalid" }),
    );
    expect(() => parseRelayPhaseFrame({ ...frame, summary: "fetch https://user:pw@example.com/repo.git?token=abc" }))
      .toThrow(expect.objectContaining({ code: "live_session_invalid" }));
  });

  it("rejects a phase frame whose encoded payload exceeds 16 KiB", () => {
    const frame = {
      phase: "git.fetch",
      status: "running",
      startedAt: "2026-09-30T00:00:00.000Z",
      finishedAt: null,
      code: null,
      summary: "x".repeat(512),
      attemptNo: 1,
      leaseGeneration: 2,
    };

    expect(parseRelayPhaseFrame(frame)).toBeTruthy();
    expect(() => parseRelayPhaseFrame({ ...frame, summary: "x".repeat(524_288) })).toThrow(
      expect.objectContaining({ code: "live_session_invalid" }),
    );
  });

  it("keeps the latest phase frame without assigning it an output sequence", () => {
    const router = new LiveRelayRouter();
    const sessionId = "9".repeat(32);
    router.registerSession({ sessionId, firstSequence: 1, lastSequence: 7 });

    router.publishPhase(sessionId, {
      phase: "git.fetch",
      status: "running",
      startedAt: "2026-09-30T00:00:00.000Z",
      finishedAt: null,
      code: null,
      summary: null,
      attemptNo: 1,
      leaseGeneration: 2,
    });

    expect(router.latestPhase(sessionId)).toMatchObject({ phase: "git.fetch", status: "running" });
    expect(router.session(sessionId)?.lastSequence).toBe(7);
  });

  it("rejects control claim, input and resize from a viewer-scoped connection", () => {
    const router = new LiveRelayRouter();
    const sessionId = "8".repeat(32);
    router.registerSession({ sessionId, firstSequence: 1, lastSequence: 0 });
    router.attachViewer({
      sessionId,
      connectionId: "viewer_1",
      lastSequence: 0,
      readOnly: true,
      send: () => undefined,
      disconnect: () => undefined,
    });

    expect(() => router.claimControl(sessionId, "viewer_1"))
      .toThrow(expect.objectContaining({ code: "live_session_control_conflict" }));
    expect(() => router.writeInput(sessionId, "viewer_1", new Uint8Array([1])))
      .toThrow(expect.objectContaining({ code: "live_session_control_conflict" }));
    expect(() => router.resizeTerminal(sessionId, "viewer_1", { rows: 24, cols: 80 }))
      .toThrow(expect.objectContaining({ code: "live_session_control_conflict" }));
    expect(router.session(sessionId)?.controllerConnectionId).toBeNull();
  });

  it("does not change the controller lease when a viewer detaches", () => {
    const router = new LiveRelayRouter();
    const sessionId = "7".repeat(32);
    router.registerSession({ sessionId, firstSequence: 1, lastSequence: 0 });
    router.attachViewer({
      sessionId,
      connectionId: "controller_1",
      lastSequence: 0,
      send: () => undefined,
      disconnect: () => undefined,
    });
    router.attachViewer({
      sessionId,
      connectionId: "viewer_1",
      lastSequence: 0,
      readOnly: true,
      send: () => undefined,
      disconnect: () => undefined,
    });
    router.claimControl(sessionId, "controller_1");

    router.detachViewer(sessionId, "viewer_1");

    expect(router.session(sessionId)?.controllerConnectionId).toBe("controller_1");
  });

  it("sends the latest phase to a viewer that attaches late", () => {
    const router = new LiveRelayRouter();
    const sessionId = "6".repeat(32);
    router.registerSession({ sessionId, firstSequence: 0, lastSequence: 0 });
    router.publishPhase(sessionId, {
      phase: "worktree.prepare",
      status: "running",
      startedAt: "2026-09-30T00:00:00.000Z",
      finishedAt: null,
      code: null,
      summary: null,
      attemptNo: 1,
      leaseGeneration: 2,
    });
    const frames: Array<Record<string, unknown>> = [];
    router.attachViewer({
      sessionId,
      connectionId: "viewer_late",
      lastSequence: 0,
      readOnly: true,
      send: ({ bytes }) => frames.push(JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>),
      disconnect: () => undefined,
    });

    expect(frames).toContainEqual(expect.objectContaining({ type: "server.phase", phase: "worktree.prepare" }));
  });

  it("rejects input unless the same connection holds control", () => {
    const router = new LiveRelayRouter();
    router.registerSession({ sessionId: "a".repeat(32), firstSequence: 1, lastSequence: 0 });
    attached(router);

    try {
      router.writeInput("a".repeat(32), "connection_1", new Uint8Array([1]));
      throw new Error("Expected control conflict");
    } catch (error) {
      expect(error).toMatchObject({ code: "live_session_control_conflict" });
    }
    router.claimControl("a".repeat(32), "connection_1");
    expect(() => router.writeInput("a".repeat(32), "connection_1", new Uint8Array([1]))).not.toThrow();
  });

  it("forwards controller input to the connected execution side", () => {
    const router = new LiveRelayRouter();
    const received: Uint8Array[] = [];
    const sessionId = "d".repeat(32);
    router.registerSession({ sessionId, firstSequence: 1, lastSequence: 0 });
    router.attachInputSender(sessionId, (bytes) => received.push(bytes));
    attached(router, sessionId);
    router.claimControl(sessionId, "connection_1");

    router.writeInput(sessionId, "connection_1", new Uint8Array([7, 8]));

    expect(received.map((bytes) => [...bytes])).toEqual([[7, 8]]);
  });

  it("notifies the execution side when control is claimed and released", () => {
    const router = new LiveRelayRouter();
    const states: string[] = [];
    const sessionId = "e".repeat(32);
    router.registerSession({ sessionId, firstSequence: 1, lastSequence: 0 });
    router.attachControlSender(sessionId, (state) => states.push(state));
    attached(router, sessionId);

    router.claimControl(sessionId, "connection_1");
    router.releaseControl(sessionId, "connection_1");

    expect(states).toEqual(["claimed", "released"]);
  });

  it("forwards the controller's terminal size to the execution side", () => {
    const router = new LiveRelayRouter();
    const sizes: Array<{ rows: number; cols: number }> = [];
    const sessionId = "c".repeat(32);
    router.registerSession({ sessionId, firstSequence: 1, lastSequence: 0 });
    router.attachResizeSender(sessionId, (size) => sizes.push(size));
    attached(router, sessionId);
    router.claimControl(sessionId, "connection_1");

    // A viewer that never reports its geometry leaves the remote PTY at the
    // launch default, so the TUI paints into the wrong shape.
    router.resizeTerminal(sessionId, "connection_1", { rows: 24, cols: 80 });

    expect(sizes).toEqual([{ rows: 24, cols: 80 }]);
    expect(router.session(sessionId)?.lastSize).toEqual({ rows: 24, cols: 80 });
  });

  it("rejects a terminal size from a connection that does not hold control", () => {
    const router = new LiveRelayRouter();
    const sessionId = "b".repeat(32);
    router.registerSession({ sessionId, firstSequence: 1, lastSequence: 0 });
    router.attachResizeSender(sessionId, () => undefined);
    attached(router, sessionId);

    expect(() => router.resizeTerminal(sessionId, "connection_1", { rows: 24, cols: 80 }))
      .toThrow(expect.objectContaining({ code: "live_session_control_conflict" }));
  });

  it("rejects a discontinuous output sequence instead of inventing history", () => {
    const router = new LiveRelayRouter();
    router.registerSession({ sessionId: "b".repeat(32), firstSequence: 1, lastSequence: 2 });

    try {
      router.publishOutput("b".repeat(32), { sequence: 4, bytes: new Uint8Array([4]) });
      throw new Error("Expected replay failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "replay_unavailable" });
    }
  });

  it("drops only the slow viewer and keeps the session alive", () => {
    const router = new LiveRelayRouter();
    router.registerSession({ sessionId: "c".repeat(32), firstSequence: 1, lastSequence: 0 });
    const { disconnected } = attached(router, "c".repeat(32));

    router.publishOutput("c".repeat(32), { sequence: 1, bytes: new Uint8Array(MAX_OUTPUT_QUEUE_BYTES + 1) });

    expect(disconnected).toHaveBeenCalledWith("backpressure");
    expect(router.session("c".repeat(32))?.viewers.size).toBe(0);
  });
});

describe("LiveRelayRouter bounded replay", () => {
  it("keeps the replay buffer across an execution reconnect", () => {
    const router = new LiveRelayRouter();
    const sessionId = "d".repeat(32);
    router.registerExecution({ sessionId, connectionId: "exec_1", firstSequence: 1, lastSequence: 0 });
    router.publishOutput(sessionId, { sequence: 1, bytes: Buffer.from("before ") });
    router.publishOutput(sessionId, { sequence: 2, bytes: Buffer.from("restart") });

    router.detachExecution(sessionId, "exec_1");
    router.registerExecution({ sessionId, connectionId: "exec_2", firstSequence: 1, lastSequence: 2 });

    const received: string[] = [];
    router.attachViewer({
      sessionId,
      connectionId: "after_restart",
      lastSequence: 0,
      send: ({ bytes }) => received.push(Buffer.from(bytes).toString()),
      disconnect: vi.fn(),
    });

    // Deleting the route on disconnect wiped the only copy of the terminal
    // history, so a Worker reconnect showed the browser a permanently blank
    // terminal even though the TUI was streaming.
    expect(received.join("")).toContain("before ");
    expect(received.join("")).toContain("restart");
  });

  it("replays buffered output to a viewer that attaches after output started", () => {
    const router = new LiveRelayRouter();
    const sessionId = "f".repeat(32);
    router.registerSession({ sessionId, firstSequence: 1, lastSequence: 0 });
    router.publishOutput(sessionId, { sequence: 1, bytes: Buffer.from("hello ") });
    router.publishOutput(sessionId, { sequence: 2, bytes: Buffer.from("terminal") });

    const received: Array<{ sequence: number; text: string }> = [];
    router.attachViewer({
      sessionId,
      connectionId: "late_viewer",
      lastSequence: 0,
      send: ({ sequence, bytes }) => received.push({ sequence, text: Buffer.from(bytes).toString() }),
      disconnect: vi.fn(),
    });

    // Without replay a freshly attached browser renders nothing and the
    // terminal appears permanently blank even though the target is online.
    expect(received).toEqual([
      { sequence: 1, text: "hello " },
      { sequence: 2, text: "terminal" },
    ]);
  });

  it("resumes from the viewer cursor instead of resending everything", () => {
    const router = new LiveRelayRouter();
    const sessionId = "a".repeat(32);
    router.registerSession({ sessionId, firstSequence: 1, lastSequence: 0 });
    router.publishOutput(sessionId, { sequence: 1, bytes: Buffer.from("one") });
    router.publishOutput(sessionId, { sequence: 2, bytes: Buffer.from("two") });

    const received: number[] = [];
    router.attachViewer({
      sessionId,
      connectionId: "resuming_viewer",
      lastSequence: 1,
      send: ({ sequence }) => received.push(sequence),
      disconnect: vi.fn(),
    });

    expect(received).toEqual([2]);
  });

  it("routes journal replay bytes only to the viewer that requested them", () => {
    const router = new LiveRelayRouter();
    const sessionId = "e".repeat(32);
    router.registerSession({ sessionId, firstSequence: 1, lastSequence: 10 });
    const replayRequests: Array<{ requestId: string; afterSequence: number }> = [];
    router.attachReplaySender(sessionId, (request) => replayRequests.push(request));

    const requested: string[] = [];
    const other: string[] = [];
    router.attachViewer({
      sessionId,
      connectionId: "asker",
      lastSequence: 4,
      send: ({ bytes }) => requested.push(Buffer.from(bytes).toString()),
      sendText: vi.fn(),
      disconnect: vi.fn(),
    });
    router.attachViewer({
      sessionId,
      connectionId: "other",
      lastSequence: 10,
      send: ({ bytes }) => other.push(Buffer.from(bytes).toString()),
      sendText: vi.fn(),
      disconnect: vi.fn(),
    });

    expect(router.requestReplay({ sessionId, connectionId: "asker", requestId: "req_1", afterSequence: 4 })).toBe(true);
    expect(replayRequests).toEqual([{ requestId: "req_1", afterSequence: 4 }]);
    router.routeReplayChunk(sessionId, { requestId: "req_1", sequence: 5, bytes: Buffer.from("history") });

    expect(requested).toContain("history");
    expect(other).toEqual([]);
  });

  it("refuses a replay request when no execution connection can serve it", () => {
    const router = new LiveRelayRouter();
    const sessionId = "f".repeat(32);
    router.registerSession({ sessionId, firstSequence: 1, lastSequence: 10 });
    router.attachViewer({
      sessionId,
      connectionId: "asker",
      lastSequence: 4,
      send: vi.fn(),
      sendText: vi.fn(),
      disconnect: vi.fn(),
    });

    // With no Worker attached there is no journal to read, so the relay must
    // report the gap instead of silently pretending the history exists.
    expect(router.requestReplay({ sessionId, connectionId: "asker", requestId: "req_1", afterSequence: 4 })).toBe(false);
  });

  it("drops the oldest replayed bytes instead of growing without bound", () => {
    const router = new LiveRelayRouter();
    const sessionId = "b".repeat(32);
    router.registerSession({ sessionId, firstSequence: 1, lastSequence: 0 });
    router.publishOutput(sessionId, { sequence: 1, bytes: Buffer.alloc(MAX_OUTPUT_QUEUE_BYTES) });
    router.publishOutput(sessionId, { sequence: 2, bytes: Buffer.from("tail") });

    const received: Array<{ sequence: number; length: number }> = [];
    router.attachViewer({
      sessionId,
      connectionId: "viewer",
      lastSequence: 0,
      send: ({ sequence, bytes }) => received.push({ sequence, length: bytes.byteLength }),
      disconnect: vi.fn(),
    });

    expect(received.at(-1)).toEqual({ sequence: 2, length: 4 });
    expect(received.reduce((sum, chunk) => sum + chunk.length, 0)).toBeLessThanOrEqual(MAX_OUTPUT_QUEUE_BYTES);
  });

  it("does not replay to a viewer that is already current", () => {
    const router = new LiveRelayRouter();
    const sessionId = "c".repeat(32);
    router.registerSession({ sessionId, firstSequence: 1, lastSequence: 0 });
    router.publishOutput(sessionId, { sequence: 1, bytes: Buffer.from("done") });

    const received: number[] = [];
    router.attachViewer({
      sessionId,
      connectionId: "current_viewer",
      lastSequence: 1,
      send: ({ sequence }) => received.push(sequence),
      disconnect: vi.fn(),
    });

    expect(received).toEqual([]);
  });
});
