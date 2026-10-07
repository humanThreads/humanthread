import { describe, expect, it, vi } from "vitest";

import { createWorkerPlatformApi } from "./worker-platform-api";

describe("Linux Worker platform API", () => {
  it("uses the bootstrap token only for registration and the short-lived session for claims", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({
        poolId: "a".repeat(32), sessionId: "b".repeat(32), sessionToken: "htwps_session", expiresAt: "2026-08-24T08:15:00.000Z",
      }))
      .mockResolvedValueOnce(Response.json({ ok: true, result: { assignment: null } }));
    const api = createWorkerPlatformApi({
      platformUrl: "http://localhost:3000/",
      poolToken: "htwp_bootstrap_value",
      fetch,
    });

    const session = await api.register({ instanceId: "worker-1", poolName: "disaster-gpu", capabilities: { gpu: true, humanthreadEnvironmentConfigurationVersion: 7 }, requestedConcurrency: 2 });
    await api.claim(session);

    expect(fetch).toHaveBeenNthCalledWith(1, "http://localhost:3000/api/worker-pools/register", expect.objectContaining({
      headers: expect.objectContaining({ "x-worker-pool-token": "htwp_bootstrap_value" }),
      body: JSON.stringify({ instanceId: "worker-1", poolName: "disaster-gpu", capabilities: { gpu: true, humanthreadEnvironmentConfigurationVersion: 7 }, requestedConcurrency: 2 }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, "http://localhost:3000/api/worker-pools/claim", expect.objectContaining({
      headers: expect.objectContaining({ "x-worker-pool-session": "htwps_session" }),
      body: JSON.stringify({ poolId: "a".repeat(32), acceptAssignments: true }),
    }));
    expect(JSON.stringify(fetch.mock.calls[1])).not.toContain("htwp_bootstrap_value");
  });

  it("将 validation assignment 作为独立协议解析并仅发送确认", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({
        poolId: "a".repeat(32), sessionId: "b".repeat(32), sessionToken: "htwps_session", expiresAt: "2026-08-24T08:15:00.000Z",
      }))
      .mockResolvedValueOnce(Response.json({ ok: true, result: { assignment: { id: "c".repeat(32), kind: "worker_validation", sideEffect: false } } }))
      .mockResolvedValueOnce(Response.json({ ok: true, result: { completed: true, sideEffect: false } }));
    const api = createWorkerPlatformApi({ platformUrl: "http://localhost:3000", poolToken: "htwp_bootstrap_value", fetch });
    const session = await api.register({ instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1 });
    const claimed = await api.claim(session);

    expect(claimed.assignment).toEqual({ id: "c".repeat(32), kind: "worker_validation", sideEffect: false });
    if (!claimed.assignment || !("kind" in claimed.assignment) || claimed.assignment.kind !== "worker_validation") throw new Error("expected validation assignment");
    if (!api.acknowledgeValidationChallenge) throw new Error("validation acknowledgement unavailable");
    await api.acknowledgeValidationChallenge(session, claimed.assignment);
    expect(fetch).toHaveBeenNthCalledWith(3,
      `http://localhost:3000/api/worker-pools/validation-challenges/${"c".repeat(32)}/acknowledge`,
      expect.objectContaining({
        headers: expect.objectContaining({ "x-worker-pool-session": "htwps_session" }),
        body: JSON.stringify({ poolId: "a".repeat(32) }),
      }),
    );
  });

  it("keeps a taskless direct LiveSession when no business assignment is available", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({
        poolId: "a".repeat(32), sessionId: "b".repeat(32), sessionToken: "htwps_session", expiresAt: "2026-08-24T08:15:00.000Z",
      }))
      .mockResolvedValueOnce(Response.json({
        ok: true,
        result: {
          assignment: null,
          liveSession: {
            sessionId: "d".repeat(32),
            kind: "worker",
            target: { type: "worker_pool", workerPoolId: "a".repeat(32), displayName: "ht-agnet" },
            projectId: "project_1",
            taskId: null,
            executionPolicy: "direct",
            relayUrl: `ws://localhost:3000/live-session/execution?sessionId=${"d".repeat(32)}`,
            authorization: "lst1.payload.signature",
            initialCols: 120,
            initialRows: 36,
            runtime: {
              endpoint: "https://model.example.com/v1",
              apiKey: "worker-model-key",
              model: "gpt-5.6-sol",
              reasoningEffort: "high",
            },
          },
        },
      }));
    const api = createWorkerPlatformApi({ platformUrl: "http://localhost:3000", poolToken: "htwp_bootstrap_value", fetch });
    const session = await api.register({ instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1 });

    await expect(api.claim(session)).resolves.toMatchObject({
      assignment: null,
      liveSession: { sessionId: "d".repeat(32), executionPolicy: "direct" },
    });
  });

  it("serializes concurrent lifecycle events before sending the terminal result", async () => {
    let resolveFirstEvent: ((response: Response) => void) | undefined;
    let resolveSecondEvent: ((response: Response) => void) | undefined;
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({
        poolId: "a".repeat(32), sessionId: "b".repeat(32), sessionToken: "htwps_session", expiresAt: "2026-08-24T08:15:00.000Z",
      }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFirstEvent = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveSecondEvent = resolve; }))
      .mockResolvedValueOnce(Response.json({ ok: true, result: { completed: true } }));
    const api = createWorkerPlatformApi({ platformUrl: "http://localhost:3000", poolToken: "htwp_bootstrap_value", fetch });
    const session = await api.register({ instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1 });
    const event = (eventType: string, sequence: number) => ({
      agentRunId: "agent_run_1", loopRunId: "loop_run_1", loopNodeRunId: "node_run_1", loopNodeAttemptId: "attempt_1",
      attemptNo: 1, leaseGeneration: 2, sequence, eventType, occurredAt: "2026-08-24T08:00:00.000Z", payloadSummary: {},
    });
    const result = {
      agentRunId: "agent_run_1", loopRunId: "loop_run_1", loopNodeRunId: "node_run_1", loopNodeAttemptId: "attempt_1", attemptNo: 1, leaseGeneration: 2,
      result: { outcome: "success" as const, output: {}, artifactRefs: [], effectReceipts: [] },
    };

    const first = api.reportEvent(session, event("worker.app_server.notification", 1));
    const second = api.reportEvent(session, event("worker.stage.completed", 2));
    const completed = api.reportResult(session, result);

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    resolveFirstEvent?.(Response.json({ ok: true, result: { acceptedThroughSequence: 1 } }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(fetch.mock.calls.slice(1).map(([, init]) => JSON.parse(String((init as RequestInit).body)))).toMatchObject([
      { events: [{ sequence: 1, eventType: "worker.app_server.notification" }] },
      { events: [{ sequence: 2, eventType: "worker.stage.completed" }] },
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);
    resolveSecondEvent?.(Response.json({ ok: true, result: { acceptedThroughSequence: 2 } }));
    await Promise.all([first, second, completed]);

    expect(fetch.mock.calls.slice(1).map(([, init]) => JSON.parse(String((init as RequestInit).body)))).toMatchObject([
      { events: [{ sequence: 1, eventType: "worker.app_server.notification" }] },
      { events: [{ sequence: 2, eventType: "worker.stage.completed" }] },
      { result: { outcome: "success" } },
    ]);
  });

  it("preserves a persisted lifecycle sequence when replaying without a prior claim", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true, result: { acceptedThroughSequence: 5 } }));
    const api = createWorkerPlatformApi({ platformUrl: "http://localhost:3000", poolToken: "htwp_bootstrap_value", fetch });
    const session = { poolId: "a".repeat(32), sessionToken: "htwps_session" };
    const event = (sequence: number) => ({
      agentRunId: "agent_run_1", loopRunId: "loop_run_1", loopNodeRunId: "node_run_1", loopNodeAttemptId: "attempt_1",
      attemptNo: 1, leaseGeneration: 2, sequence, eventType: "worker.stage.completed", occurredAt: "2026-08-24T08:00:00.000Z", payloadSummary: {},
    });

    await api.reportEvent(session, event(4));
    await api.reportEvent(session, event(5));

    expect(fetch.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)))).toMatchObject([
      { events: [{ sequence: 4 }] },
      { events: [{ sequence: 5 }] },
    ]);
  });
});

describe("Linux Worker platform API request deadlines", () => {
  it("aborts a platform request that never responds so the tick loop cannot wedge", async () => {
    // A hung TCP connection previously blocked the worker's tick loop forever:
    // there was no timeout anywhere, so the process stayed alive but stopped
    // heartbeating and never claimed again. Every platform request must carry an
    // abort signal so a stalled request surfaces as a retryable failure.
    const seenSignals: Array<AbortSignal | undefined> = [];
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      const signal = init?.signal ?? undefined;
      seenSignals.push(signal);
      // Mirrors a black-holed connection: the response never arrives, and only
      // the abort signal settles the promise (exactly what undici does).
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
        });
      });
    });
    const api = createWorkerPlatformApi({
      platformUrl: "http://localhost:3000",
      poolToken: "htwp_bootstrap_value",
      fetch: fetch as unknown as typeof globalThis.fetch,
      requestTimeoutMs: 50,
    });

    await expect(api.register({ instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1 }))
      .rejects.toMatchObject({ code: "provider_transport_timeout" });
    expect(seenSignals[0]).toBeInstanceOf(AbortSignal);
  });

  it("keeps the default timeout generous enough for a slow platform", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({
      poolId: "a".repeat(32), sessionId: "b".repeat(32), sessionToken: "htwps_session", expiresAt: "2026-08-24T08:15:00.000Z",
    }));
    const api = createWorkerPlatformApi({
      platformUrl: "http://localhost:3000",
      poolToken: "htwp_bootstrap_value",
      fetch,
    });

    await expect(api.register({ instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1 })).resolves.toBeTruthy();
  });
});

describe("Linux Worker platform API session liveness", () => {
  it("reports a session gone when the platform returns 404", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({
        poolId: "a".repeat(32), sessionId: "b".repeat(32), sessionToken: "htwps_session", expiresAt: "2026-08-24T08:15:00.000Z",
      }))
      .mockResolvedValueOnce(Response.json({ ok: false, errorCode: "live_session_not_found" }, { status: 404 }));
    const api = createWorkerPlatformApi({ platformUrl: "http://localhost:3000", poolToken: "htwp_bootstrap_value", fetch });
    const session = await api.register({ instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1 });

    await expect(api.isSessionActive!(session, "d".repeat(32))).resolves.toBe(false);
  });

  it("reports a session active while the platform still returns it", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({
        poolId: "a".repeat(32), sessionId: "b".repeat(32), sessionToken: "htwps_session", expiresAt: "2026-08-24T08:15:00.000Z",
      }))
      .mockResolvedValueOnce(Response.json({ ok: true, result: { active: true } }));
    const api = createWorkerPlatformApi({ platformUrl: "http://localhost:3000", poolToken: "htwp_bootstrap_value", fetch });
    const session = await api.register({ instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1 });

    await expect(api.isSessionActive!(session, "d".repeat(32))).resolves.toBe(true);
  });

  it("treats a transport failure as still-active rather than ending a live session", async () => {
    // A transient network error is not evidence the session ended; returning
    // false here would tear down a healthy TUI.
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({
        poolId: "a".repeat(32), sessionId: "b".repeat(32), sessionToken: "htwps_session", expiresAt: "2026-08-24T08:15:00.000Z",
      }))
      .mockRejectedValueOnce(new Error("network down"));
    const api = createWorkerPlatformApi({ platformUrl: "http://localhost:3000", poolToken: "htwp_bootstrap_value", fetch });
    const session = await api.register({ instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1 });

    await expect(api.isSessionActive!(session, "d".repeat(32))).resolves.toBe(true);
  });
});
