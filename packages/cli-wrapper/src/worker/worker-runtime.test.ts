import { describe, expect, it, vi } from "vitest";

import {
  createWorkerRuntime,
  type LinuxWorkerAssignment,
} from "./worker-runtime";
import type { WorkerWorktreePhaseEvent } from "./worker-worktree";

const assignment: LinuxWorkerAssignment = {
  agentRunId: "agent_run_1",
  loopRunId: "loop_run_1",
  loopNodeRunId: "loop_node_run_1",
  loopNodeAttemptId: "loop_attempt_1",
  attemptNo: 1,
  leaseGeneration: 2,
  acceptedThroughSequence: 0,
  prompt: "Implement the assigned change",
  executionSnapshot: {
    version: 1,
    workerPoolId: "a".repeat(32),
    repository: {
      url: "https://git.example.com/acme/project.git",
      branch: "task/2026-HUMANTHR1",
      branchPolicy: { allowedBranches: ["task/*"] },
    },
  model: {
      provider: "codex",
      siteId: "b".repeat(32),
      endpoint: "https://configured.example.com/v1",
      apiKeyReference: "c".repeat(32),
      model: "configured-model",
    reasoningEffort: "high",
  },
  resources: { gpu: true, unityBuild: true },
  deliveryPolicy: { requireGitDelivery: true },
  grants: [],
    logPolicy: { redactCredentials: true },
  },
  executionCredentials: { apiKey: "configured-key" },
};

const deliveredWorktree = {
  cwd: "/state/worktrees/agent_run_1",
  inspectDelivery: vi.fn().mockResolvedValue({
    branch: "task/2026-HUMANTHR1",
    baseCommit: "b".repeat(40),
    headCommit: "a".repeat(40),
    remoteHeadCommit: "a".repeat(40),
    commits: [{ sha: "a".repeat(40), subject: "Implement task" }],
    changedFiles: ["apps/web/src/app/page.tsx"],
    clean: true,
  }),
};

/**
 * Execution-phase events are persisted alongside lifecycle events so the Loop
 * page can rebuild its phase summary after reload. Assertions about lifecycle
 * ordering filter them out instead of pinning the whole interleaved stream.
 */
function lifecycleEventTypes(reportEvent: { mock: { calls: unknown[][] } }): string[] {
  return reportEvent.mock.calls
    .map((call) => (call[1] as { eventType: string }).eventType)
    .filter((eventType) => eventType !== "loop.node.execution_phase_changed");
}

describe("Linux Worker runtime", () => {
  it("starts the live-session connector before worktree preparation and reports ordered phases", async () => {
    const order: string[] = [];
    const phases: Array<{ phase: string; status: string }> = [];
    const connector = {
      start: vi.fn(async () => { order.push("connector.start"); }),
      heartbeat: vi.fn(async () => undefined),
      publish: vi.fn(async () => undefined),
      publishPhase: vi.fn(async (phase: { phase: string; status: string }) => { phases.push(phase); }),
      attachInputHandlers: vi.fn(),
      attachReplayHandler: vi.fn(),
      publishReplayChunk: vi.fn(),
      publishReplayState: vi.fn(),
      close: vi.fn(async () => undefined),
      state: () => "online" as const,
    };
    const onLiveSession = vi.fn().mockResolvedValue({ close: vi.fn().mockResolvedValue(undefined) });
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          liveSession: {
            sessionId: "d".repeat(32),
            relayUrl: "ws://localhost:3000/live-session/execution",
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
        } }),
        reportEvent: vi.fn().mockResolvedValue(undefined),
        reportResult: vi.fn().mockResolvedValue(undefined),
        heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      createLiveSessionConnector: vi.fn(() => connector),
      prepareWorktree: vi.fn(async (input: {
        reportPhase?: (event: WorkerWorktreePhaseEvent) => void | Promise<void>;
      }) => {
        order.push("prepareWorktree");
        await input.reportPhase?.({ phase: "git.fetch", status: "succeeded" });
        await input.reportPhase?.({ phase: "worktree.prepare", status: "succeeded", action: "reuse" });
        await input.reportPhase?.({ phase: "checkout.verify", status: "succeeded" });
        return deliveredWorktree;
      }),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined),
        request: vi.fn()
          .mockResolvedValueOnce({ thread: { id: "thread_live_1" } })
          .mockResolvedValueOnce({ turn: { id: "turn_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => {
          onNotification = listener;
          return () => undefined;
        }),
        stop: vi.fn().mockResolvedValue(undefined),
        endpoint: () => "ws://127.0.0.1:32123",
      }),
      onLiveSession,
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onLiveSession).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(phases.some((phase) => phase.phase === "app_server.start")).toBe(true));

    expect(order[0]).toBe("connector.start");
    expect(order).toContain("prepareWorktree");
    expect(order.indexOf("connector.start")).toBeLessThan(order.indexOf("prepareWorktree"));
    const phaseNames = phases.map((phase) => phase.phase);
    expect(phaseNames.indexOf("repository.configuration_check")).toBeLessThan(phaseNames.indexOf("git.fetch"));
    expect(phaseNames.indexOf("git.fetch")).toBeLessThan(phaseNames.indexOf("worktree.prepare"));
    expect(phaseNames.indexOf("worktree.prepare")).toBeLessThan(phaseNames.indexOf("checkout.verify"));
    expect(phaseNames.indexOf("checkout.verify")).toBeLessThan(phaseNames.indexOf("app_server.start"));

    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: {} } } });
    await runtime.drain();
    await execution;
  });

  it("persists each execution phase transition so the Loop page can reload it", async () => {
    const phases: Array<{ phase: string; status: string; startedAt: string; finishedAt: string | null }> = [];
    const lifecycleEvents: Array<{ eventType: string; payloadSummary: unknown }> = [];
    const connector = {
      start: vi.fn(async () => undefined),
      heartbeat: vi.fn(async () => undefined),
      publish: vi.fn(async () => undefined),
      publishPhase: vi.fn(async (phase: { phase: string; status: string; startedAt: string; finishedAt: string | null }) => {
        phases.push(phase);
      }),
      attachInputHandlers: vi.fn(),
      attachReplayHandler: vi.fn(),
      publishReplayChunk: vi.fn(),
      publishReplayState: vi.fn(),
      close: vi.fn(async () => undefined),
      state: () => "online" as const,
    };
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          liveSession: {
            sessionId: "d".repeat(32),
            relayUrl: "ws://localhost:3000/live-session/execution",
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
        } }),
        reportEvent: vi.fn(async (_session, event: { eventType: string; payloadSummary: unknown }) => {
          lifecycleEvents.push({ eventType: event.eventType, payloadSummary: event.payloadSummary });
        }),
        reportResult: vi.fn().mockResolvedValue(undefined),
        heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      createLiveSessionConnector: vi.fn(() => connector),
      prepareWorktree: vi.fn(async (input: {
        reportPhase?: (event: WorkerWorktreePhaseEvent) => void | Promise<void>;
      }) => {
        await input.reportPhase?.({ phase: "git.fetch", status: "running" });
        await input.reportPhase?.({ phase: "git.fetch", status: "succeeded" });
        return deliveredWorktree;
      }),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined),
        request: vi.fn()
          .mockResolvedValueOnce({ thread: { id: "thread_live_1" } })
          .mockResolvedValueOnce({ turn: { id: "turn_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => {
          onNotification = listener;
          return () => undefined;
        }),
        stop: vi.fn().mockResolvedValue(undefined),
        endpoint: () => "ws://127.0.0.1:32123",
      }),
      onLiveSession: vi.fn().mockResolvedValue({ close: vi.fn().mockResolvedValue(undefined) }),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(
      lifecycleEvents.filter((event) => event.eventType === "loop.node.execution_phase_changed").length,
    ).toBeGreaterThanOrEqual(4));
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: {} } } });
    await runtime.drain();
    await execution;

    const durablePhases = lifecycleEvents
      .filter((event) => event.eventType === "loop.node.execution_phase_changed")
      .map((event) => event.payloadSummary as { phase: string; status: string });
    // The relay frame is display-only; without this durable event the attempt
    // snapshot stays null and the Loop page always renders "无阶段记录".
    expect(durablePhases).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: "repository.configuration_check", status: "succeeded" }),
      expect.objectContaining({ phase: "git.fetch", status: "running" }),
      expect.objectContaining({ phase: "git.fetch", status: "succeeded" }),
      expect.objectContaining({ phase: "app_server.start", status: "succeeded" }),
    ]));
    expect(phases.length).toBeGreaterThan(0);
  });

  it("stops persisting phase events once a lifecycle event is only queued for replay", async () => {
    // A phase event must not advance the platform's monotonic event fence past
    // a lifecycle event that is still sitting in the outbox, otherwise the
    // replayed lifecycle evidence is rejected as stale.
    const reportedEventTypes: string[] = [];
    const reportEvent = vi.fn(async (_session: unknown, event: { eventType: string }) => {
      reportedEventTypes.push(event.eventType);
      if (event.eventType === "worker.app_server.started") {
        throw Object.assign(new Error("platform unavailable"), { code: "provider_transport_error" });
      }
    });
    const outbox = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockResolvedValue([]),
      acknowledge: vi.fn().mockResolvedValue(undefined),
    };
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment }),
        reportEvent,
        reportResult: vi.fn().mockResolvedValue(undefined),
        heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox,
      prepareWorktree: vi.fn().mockResolvedValue(deliveredWorktree),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined),
        request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
      now: () => new Date("2026-08-24T08:00:00.000Z"),
    });

    await runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: {} } } });
    await runtime.drain();

    const firstFailureIndex = reportedEventTypes.indexOf("worker.app_server.started");
    expect(firstFailureIndex).toBeGreaterThanOrEqual(0);
    // Nothing after the transport failure may reach the platform directly; the
    // outbox-owned lifecycle events carry the rest of the stream.
    expect(reportedEventTypes.slice(firstFailureIndex + 1)).not.toContain("loop.node.execution_phase_changed");
    expect(outbox.enqueue).toHaveBeenCalled();
  });

  it("keeps executing when the live-session connector cannot connect", async () => {
    const connector = {
      start: vi.fn(async () => { throw Object.assign(new Error("relay offline"), { code: "internal_connector_offline" }); }),
      heartbeat: vi.fn(async () => undefined),
      publish: vi.fn(async () => undefined),
      publishPhase: vi.fn(async () => undefined),
      attachInputHandlers: vi.fn(),
      attachReplayHandler: vi.fn(),
      publishReplayChunk: vi.fn(),
      publishReplayState: vi.fn(),
      close: vi.fn(async () => undefined),
      state: () => "reconnecting" as const,
    };
    const reportResult = vi.fn().mockResolvedValue(undefined);
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          liveSession: {
            sessionId: "e".repeat(32),
            relayUrl: "ws://localhost:3000/live-session/execution",
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
        } }),
        reportEvent: vi.fn().mockResolvedValue(undefined),
        reportResult,
        heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      createLiveSessionConnector: vi.fn(() => connector),
      prepareWorktree: vi.fn().mockResolvedValue(deliveredWorktree),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined),
        request: vi.fn()
          .mockResolvedValueOnce({ thread: { id: "thread_degraded_1" } })
          .mockResolvedValueOnce({ turn: { id: "turn_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => {
          queueMicrotask(() => listener({ method: "turn/completed", params: { turn: { status: "completed", result: {} } } }));
          return () => undefined;
        }),
        stop: vi.fn().mockResolvedValue(undefined),
        endpoint: () => "ws://127.0.0.1:32123",
      }),
      onLiveSession: vi.fn().mockResolvedValue({ close: vi.fn().mockResolvedValue(undefined) }),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(reportResult).toHaveBeenCalled());
    await runtime.drain();
    await execution;
    expect(reportResult).toHaveBeenCalled();
  });

  it("uploads generated review HTML and reports its storage key as an Artifact reference", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    const uploadArtifact = vi.fn().mockResolvedValue({
      storageKey: `loop-review-artifacts/${"b".repeat(32)}/${"a".repeat(32)}.html`,
      relativePath: "generated/reviews/chapter-plan.html",
    });
    const collectReviewArtifacts = vi.fn().mockResolvedValue([
      { relativePath: "generated/reviews/chapter-plan.html", content: "<html>review</html>" },
      { relativePath: "generated/reports/ignored.html", content: "<html>ignored</html>" },
    ]);
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          executionSnapshot: { ...assignment.executionSnapshot, deliveryPolicy: { requireGitDelivery: false } },
        } }),
        reportEvent: vi.fn().mockResolvedValue(undefined), reportResult, heartbeat: vi.fn().mockResolvedValue(undefined),
        uploadArtifact,
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue("/state/worktree"),
      collectReviewArtifacts,
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined), request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: { summary: "done" } } } });
    await runtime.drain();
    await execution;

    expect(uploadArtifact).toHaveBeenCalledTimes(1);
    expect(uploadArtifact).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      agentRunId: "agent_run_1",
      loopRunId: "loop_run_1",
      loopNodeRunId: "loop_node_run_1",
      loopNodeAttemptId: "loop_attempt_1",
      attemptNo: 1,
      leaseGeneration: 2,
      relativePath: "generated/reviews/chapter-plan.html",
      content: "<html>review</html>",
    }));
    expect(reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: expect.objectContaining({
        artifactRefs: [`loop-review-artifacts/${"b".repeat(32)}/${"a".repeat(32)}.html`],
      }),
    }));
  });

  it("确认无副作用 challenge 而不创建 worktree、模型会话或业务事件", async () => {
    const acknowledgeValidationChallenge = vi.fn().mockResolvedValue(undefined);
    const prepareWorktree = vi.fn();
    const appServer = vi.fn();
    const reportEvent = vi.fn();
    const reportResult = vi.fn();
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: { id: "c".repeat(32), kind: "worker_validation", sideEffect: false } }),
        acknowledgeValidationChallenge,
        reportEvent,
        reportResult,
        heartbeat: vi.fn(),
      },
      outbox: { enqueue: vi.fn(), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn() },
      prepareWorktree,
      appServer,
    });

    await runtime.tick();

    expect(acknowledgeValidationChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ sessionToken: "htwps_session" }),
      { id: "c".repeat(32), kind: "worker_validation", sideEffect: false },
    );
    expect(prepareWorktree).not.toHaveBeenCalled();
    expect(appServer).not.toHaveBeenCalled();
    expect(reportEvent).not.toHaveBeenCalled();
    expect(reportResult).not.toHaveBeenCalled();
  });

  it("registers Kubernetes runtime and task group metadata for replica aggregation", async () => {
    const register = vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" });
    const runtime = createWorkerRuntime({
      config: {
        instanceId: "ht-agnet-7b9c5d6f8-abcde",
        runtime: "kubernetes",
        taskGroupName: "ht-agnet",
        capabilities: {},
        requestedConcurrency: 1,
        stateDirectory: "/state",
      },
      api: {
        register,
        claim: vi.fn().mockResolvedValue({ assignment: null }),
        reportEvent: vi.fn(),
        reportResult: vi.fn(),
        heartbeat: vi.fn(),
      },
      outbox: { enqueue: vi.fn(), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn() },
      prepareWorktree: vi.fn(),
      appServer: vi.fn(),
    });

    await runtime.tick();

    expect(register).toHaveBeenCalledWith({
      instanceId: "ht-agnet-7b9c5d6f8-abcde",
      runtime: "kubernetes",
      taskGroupName: "ht-agnet",
      capabilities: {},
      requestedConcurrency: 1,
    });
  });

  it("drops stale assignment outbox records so they cannot block newer assignments", async () => {
    const staleEvent = {
      ...assignment,
      agentRunId: "agent_run_stale",
      loopRunId: "loop_run_old",
      loopNodeRunId: "loop_node_old",
      loopNodeAttemptId: "loop_attempt_old",
    };
    const staleRecord = {
      id: "outbox-stale-event",
      type: "event",
      createdAt: "2026-08-24T08:00:00.000Z",
      payload: {
        event: {
          agentRunId: staleEvent.agentRunId,
          loopRunId: staleEvent.loopRunId,
          loopNodeRunId: staleEvent.loopNodeRunId,
          loopNodeAttemptId: staleEvent.loopNodeAttemptId,
          attemptNo: 1,
          leaseGeneration: 1,
          sequence: 1,
          eventType: "worker.stage.completed",
          occurredAt: "2026-08-24T08:00:00.000Z",
          payloadSummary: {},
        },
      },
    };
    const acknowledge = vi.fn().mockResolvedValue(undefined);
    const reportEvent = vi.fn().mockRejectedValue(Object.assign(new Error("stale"), { code: "stale_lease" }));
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: null }),
        reportEvent,
        reportResult: vi.fn(),
        heartbeat: vi.fn(),
      },
      outbox: {
        enqueue: vi.fn(),
        read: vi.fn().mockResolvedValue([staleRecord]),
        acknowledge,
      },
      prepareWorktree: vi.fn(),
      appServer: vi.fn(),
    });

    await runtime.tick();

    expect(reportEvent).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenCalledWith(["outbox-stale-event"]);
  });

  it("reports registering until the platform has issued a Worker session", async () => {
    let completeRegistration: ((session: { poolId: string; sessionToken: string }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockImplementation(() => new Promise((resolve) => { completeRegistration = resolve; })),
        claim: vi.fn().mockResolvedValue({ assignment: null }),
        reportEvent: vi.fn(), reportResult: vi.fn(), heartbeat: vi.fn(),
      },
      outbox: { enqueue: vi.fn(), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn() },
      prepareWorktree: vi.fn(), appServer: vi.fn(),
    });

    const tick = runtime.tick();
    await vi.waitFor(() => expect(runtime.state()).toBe("registering"));
    completeRegistration?.({ poolId: "a".repeat(32), sessionToken: "htwps_session" });
    await tick;

    expect(runtime.state()).toBe("idle");
  });

  it("executes a claimed assignment from its immutable snapshot and reports a redacted lifecycle", async () => {
    const register = vi.fn().mockResolvedValue({
      poolId: "a".repeat(32),
      sessionToken: "htwps_session",
    });
    const reportEvent = vi.fn().mockResolvedValue(undefined);
    const reportResult = vi.fn().mockResolvedValue(undefined);
    const prepareWorktree = vi.fn().mockResolvedValue({
      ...deliveredWorktree,
      gitEnvironment: {
        GIT_ASKPASS: "/state/git-askpass.sh",
        GIT_TERMINAL_PROMPT: "0",
        HT_GIT_USERNAME: "worker-user",
        HT_GIT_TOKEN: "git-token-value",
      },
    });
    const start = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn()
      .mockResolvedValueOnce({ thread: { id: "thread_1" } })
      .mockResolvedValueOnce({ turn: { id: "turn_1" } });
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const subscribe = vi.fn().mockImplementation((listener) => {
      onNotification = listener;
      return () => undefined;
    });
    const outbox = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockResolvedValue([]),
      acknowledge: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = createWorkerRuntime({
      config: {
        instanceId: "worker-1",
        capabilities: { gpu: true },
        requestedConcurrency: 1,
        stateDirectory: "/state",
      },
      api: {
        register,
        claim: vi.fn().mockResolvedValue({ assignment }),
        reportEvent,
        reportResult,
        heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox,
      prepareWorktree,
      appServer: () => ({ start, request, subscribe, stop: vi.fn().mockResolvedValue(undefined) }),
      now: () => new Date("2026-08-24T08:00:00.000Z"),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({ method: "item/agentMessage/delta", params: { delta: "git-token-value" } });
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: { changed: true } } } });
    await runtime.drain();
    await execution;

    expect(prepareWorktree).toHaveBeenCalledWith({
      agentRunId: "agent_run_1",
      repository: assignment.executionSnapshot.repository,
      workspaceKey: assignment.loopRunId,
    });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: "https://configured.example.com/v1",
      apiKey: "configured-key",
      model: "configured-model",
      reasoningEffort: "high",
      sessionId: "agent_run_1",
      cwd: "/state/worktrees/agent_run_1",
      gitEnvironment: expect.objectContaining({
        GIT_ASKPASS: "/state/git-askpass.sh",
        GIT_TERMINAL_PROMPT: "0",
        HT_GIT_TOKEN: "git-token-value",
      }),
    }));
    expect(request).toHaveBeenCalledWith("thread/start", expect.objectContaining({
      cwd: "/state/worktrees/agent_run_1",
      model: "configured-model",
      sandbox: "danger-full-access",
    }));
    expect(request).toHaveBeenCalledWith("turn/start", expect.objectContaining({
      threadId: "thread_1",
      sandboxPolicy: { type: "dangerFullAccess" },
      approvalPolicy: "never",
    }));
    expect(reportEvent).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: "htwps_session" }), expect.objectContaining({ eventType: "worker.stage.started" }));
    // Execution-phase events are interleaved with the lifecycle events; assert
    // the lifecycle order on its own so the durable phase mirroring added for
    // the Loop page does not make this contract brittle.
    expect(lifecycleEventTypes(reportEvent)).toEqual([
      "worker.assignment.claimed",
      "worker.stage.started",
      "worker.app_server.started",
      "worker.stage.completed",
      "worker.cleanup.started",
      "worker.cleanup.completed",
    ]);
    expect(reportEvent.mock.calls.map(([, event]) => event.sequence)).toEqual(
      reportEvent.mock.calls.map((_, index) => index + 1),
    );
    expect(reportResult).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: "htwps_session" }), expect.objectContaining({
      agentRunId: "agent_run_1",
      result: expect.objectContaining({
        outcome: "success",
        output: expect.objectContaining({
          appServer: { changed: true },
          delivery: expect.objectContaining({
            required: true,
            evidence: expect.objectContaining({ changedFiles: ["apps/web/src/app/page.tsx"] }),
          }),
        }),
      }),
    }));
    expect(JSON.stringify(outbox.enqueue.mock.calls)).not.toContain("configured-key");
    expect(JSON.stringify(reportEvent.mock.calls)).not.toContain("git-token-value");
  });

  it("does not persist raw app-server notifications", async () => {
    const reportEvent = vi.fn().mockResolvedValue(undefined);
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment }),
        reportEvent,
        reportResult: vi.fn().mockResolvedValue(undefined),
        heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue(deliveredWorktree),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined),
        request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({ method: "item/agentMessage/delta", params: { delta: "one token" } });
    onNotification?.({ method: "item/commandExecution/outputDelta", params: { delta: "more output" } });
    onNotification?.({ method: "item/agentMessage/completed", params: { message: "final message" } });
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: {} } } });
    await runtime.drain();
    await execution;

    expect(lifecycleEventTypes(reportEvent)).toEqual([
      "worker.assignment.claimed",
      "worker.stage.started",
      "worker.app_server.started",
      "worker.stage.completed",
      "worker.cleanup.started",
      "worker.cleanup.completed",
    ]);
  });

  it("ignores a transient app-server error notification and waits for the retried turn to complete", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          executionSnapshot: { ...assignment.executionSnapshot, deliveryPolicy: { requireGitDelivery: false } },
        } }),
        reportEvent: vi.fn().mockResolvedValue(undefined), reportResult, heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue("/state/worktree"),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined), request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    // Codex emits this notification for a retryable stream disconnect and then
    // keeps retrying the same turn. The Worker must not treat it as terminal.
    onNotification?.({
      method: "error",
      params: {
        willRetry: true,
        error: { message: "stream disconnected before completion: Upstream service temporarily unavailable" },
      },
    });
    await Promise.resolve();
    expect(reportResult).not.toHaveBeenCalled();
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: { recovered: true } } } });
    await runtime.drain();
    await execution;

    expect(reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: expect.objectContaining({
        outcome: "success",
        output: expect.objectContaining({ appServer: { recovered: true } }),
      }),
    }));
  });

  it("treats an app-server error notification with willRetry=false as terminal", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          executionSnapshot: { ...assignment.executionSnapshot, deliveryPolicy: { requireGitDelivery: false } },
        } }),
        reportEvent: vi.fn().mockResolvedValue(undefined), reportResult, heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue("/state/worktree"),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined), request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({
      method: "error",
      params: { willRetry: false, error: { code: "invalid_request", message: "upstream rejected the request" } },
    });
    await runtime.drain();
    await execution;

    expect(reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: expect.objectContaining({
        outcome: "failure",
        output: expect.objectContaining({ errorCode: "provider_error" }),
      }),
    }));
  });

  it("persists the completed assistant message when turn completion has no result", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          executionSnapshot: { ...assignment.executionSnapshot, deliveryPolicy: { requireGitDelivery: false } },
        } }),
        reportEvent: vi.fn().mockResolvedValue(undefined), reportResult, heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue("/state/worktree"),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined), request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({ method: "item/agentMessage/completed", params: { message: "需求摘要与验收标准" } });
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: null } } });
    await runtime.drain();
    await execution;

    expect(reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: expect.objectContaining({
        outcome: "success",
        output: expect.objectContaining({ appServer: "需求摘要与验收标准" }),
      }),
    }));
  });

  it("captures the final assistant message from app-server v2 item events", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          executionSnapshot: { ...assignment.executionSnapshot, deliveryPolicy: { requireGitDelivery: false } },
        } }),
        reportEvent: vi.fn().mockResolvedValue(undefined), reportResult, heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue("/state/worktree"),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined), request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({ method: "item/agentMessage/delta", params: { delta: "已完" } });
    onNotification?.({ method: "item/agentMessage/delta", params: { delta: "成准备" } });
    onNotification?.({ method: "item/completed", params: { item: { type: "agentMessage", text: "已完成准备" } } });
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: null } } });
    await runtime.drain();
    await execution;

    expect(reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: expect.objectContaining({
        outcome: "success",
        output: expect.objectContaining({ appServer: "已完成准备" }),
      }),
    }));
  });

  it("falls back to streamed assistant deltas when the completed item is missing", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          executionSnapshot: { ...assignment.executionSnapshot, deliveryPolicy: { requireGitDelivery: false } },
        } }),
        reportEvent: vi.fn().mockResolvedValue(undefined), reportResult, heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue("/state/worktree"),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined), request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({ method: "item/agentMessage/delta", params: { delta: "流式" } });
    onNotification?.({ method: "item/agentMessage/delta", params: { delta: "消息" } });
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: null } } });
    await runtime.drain();
    await execution;

    expect(reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: expect.objectContaining({
        outcome: "success",
        output: expect.objectContaining({ appServer: "流式消息" }),
      }),
    }));
  });

  it("fails a completed turn that provides neither a result nor a final assistant message", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          executionSnapshot: { ...assignment.executionSnapshot, deliveryPolicy: { requireGitDelivery: false } },
        } }),
        reportEvent: vi.fn().mockResolvedValue(undefined), reportResult, heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue("/state/worktree"),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined), request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: null } } });
    await runtime.drain();
    await execution;

    expect(reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: expect.objectContaining({
        outcome: "failure",
        output: expect.objectContaining({ errorCode: "empty_terminal_result" }),
      }),
    }));
  });

  it("does not treat assistant JSON as an authoritative runtime checklist", async () => {
    const reportEvent = vi.fn().mockResolvedValue(undefined);
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment }), reportEvent,
        reportResult: vi.fn().mockResolvedValue(undefined), heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue(deliveredWorktree),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined), request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    });
    const execution = runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    const message = "```json\n" + JSON.stringify({ humanThreadChecklist: [{ id: "inspect", title: "Inspect", status: "not_started", evidenceRefs: [] }] }) + "\n```";
    onNotification?.({ method: "item/agentMessage/delta", params: { delta: message } });
    onNotification?.({ method: "item/agentMessage/completed", params: { message } });
    onNotification?.({ method: "item/agentMessage/completed", params: { message } });
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: {} } } });
    await runtime.drain();
    await execution;
    expect(reportEvent.mock.calls.map(([, event]) => event.eventType)).not.toContain("loop.checklist.created");
  });

  it("attaches a LiveSession only after the Codex thread exists", async () => {
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const onLiveSession = vi.fn().mockResolvedValue({ close: vi.fn().mockResolvedValue(undefined) });
    const request = vi.fn()
      .mockResolvedValueOnce({ thread: { id: "thread_live_1" } })
      .mockResolvedValueOnce({ turn: { id: "turn_1" } });
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          liveSession: {
            sessionId: "d".repeat(32),
            relayUrl: "ws://localhost:3000/live-session/execution",
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
        } }),
        reportEvent: vi.fn().mockResolvedValue(undefined),
        reportResult: vi.fn().mockResolvedValue(undefined),
        heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue(deliveredWorktree),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined),
        request,
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
        endpoint: () => "ws://127.0.0.1:32123",
      }),
      onLiveSession,
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onLiveSession).toHaveBeenCalledOnce());
    expect(onLiveSession).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "thread_live_1",
      assignment: expect.objectContaining({ liveSession: expect.objectContaining({ sessionId: "d".repeat(32) }) }),
    }));
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: {} } } });
    await runtime.drain();
    await execution;
  });

  it("starts a taskless direct Worker LiveSession without reporting a business result", async () => {
    const onDirectLiveSession = vi.fn().mockResolvedValue({ close: vi.fn().mockResolvedValue(undefined) });
    const request = vi.fn().mockResolvedValue({ thread: { id: "thread_direct_worker" } });
    const reportResult = vi.fn().mockResolvedValue(undefined);
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({
          assignment: null,
          liveSession: {
            sessionId: "d".repeat(32),
            kind: "worker",
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
        }),
        reportEvent: vi.fn().mockResolvedValue(undefined),
        reportResult,
        heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn(),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined),
        request,
        subscribe: vi.fn().mockReturnValue(() => undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        endpoint: () => "ws://127.0.0.1:32123",
      }),
      ensureDirectory: vi.fn().mockResolvedValue(undefined),
      onDirectLiveSession,
    });

    await runtime.tick();
    await vi.waitFor(() => expect(onDirectLiveSession).toHaveBeenCalledOnce());

    expect(onDirectLiveSession).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({ sessionId: "d".repeat(32), executionPolicy: "direct" }),
      threadId: "thread_direct_worker",
    }));
    expect(reportResult).not.toHaveBeenCalled();
    await runtime.drain();
    const handle = await onDirectLiveSession.mock.results[0]?.value;
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it("keeps stdio for plain runs and asks for WebSocket only when a TUI attaches", async () => {
    const transports: Array<"stdio" | "websocket" | undefined> = [];
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment }),
        reportEvent: vi.fn().mockResolvedValue(undefined),
        reportResult: vi.fn().mockResolvedValue(undefined),
        heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue(deliveredWorktree),
      appServer: (options) => {
        transports.push(options?.transport);
        return {
          start: vi.fn().mockResolvedValue(undefined),
          request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
          subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
          stop: vi.fn().mockResolvedValue(undefined),
        };
      },
      now: () => new Date("2026-08-24T08:00:00.000Z"),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: {} } } });
    await runtime.drain();
    await execution;

    expect(transports).toEqual([undefined]);
  });

  it("starts Codex with only the current lease checklist MCP and synchronizes its server sequence", async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const currentSequence = vi.fn().mockResolvedValue(9);
    const request = vi.fn().mockResolvedValue({ thread: { id: "thread_1" } });
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          checklistMcp: { url: "https://platform.example.com/api/worker-pools/assignments/agent_run_1/checklist-mcp" },
        } }),
        reportEvent: vi.fn().mockResolvedValue(undefined), reportResult: vi.fn().mockResolvedValue(undefined),
        heartbeat: vi.fn().mockResolvedValue(undefined), currentSequence,
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue(deliveredWorktree),
      appServer: () => ({
        start, request, subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }), stop: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: {} } } });
    await runtime.drain();
    await execution;

    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      checklistMcp: {
        url: "https://platform.example.com/api/worker-pools/assignments/agent_run_1/checklist-mcp",
        headers: {
          "x-worker-pool-session": "htwps_session",
          "x-humanthread-worker-pool": "a".repeat(32),
        },
      },
    }));
    expect(request.mock.calls.find(([method]) => method === "turn/start")?.[1]).toMatchObject({
      input: [{ text: expect.stringContaining(assignment.prompt) }],
    });
    expect(currentSequence).toHaveBeenCalledOnce();
  });

  it("sends the checklist execution contract when a checklist MCP is available", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    const start = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue({ thread: { id: "thread_1" } });
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          checklistMcp: { url: "https://platform.example.com/checklist" },
          executionSnapshot: { ...assignment.executionSnapshot, deliveryPolicy: { requireGitDelivery: false } },
        } }),
        reportEvent: vi.fn().mockResolvedValue(undefined), reportResult, heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue("/state/worktree"),
      appServer: () => ({
        start, request,
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
      now: () => new Date("2026-08-24T08:00:00.000Z"),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: {} } } });
    await runtime.drain();
    await execution;

    expect(request.mock.calls.find(([method]) => method === "turn/start")?.[1]).toMatchObject({
      input: [{ text: expect.stringContaining("create_runtime_checklist") }],
    });
    expect(reportResult).toHaveBeenCalled();
  });

  it("reports a failed stage when the agent declares the stage blocked", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          executionSnapshot: { ...assignment.executionSnapshot, deliveryPolicy: { requireGitDelivery: false } },
        } }),
        reportEvent: vi.fn().mockResolvedValue(undefined), reportResult, heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue("/state/worktree"),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined), request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    // The chapter stages must not report success when the agent says it could
    // not do the work: this run advanced eight nodes while producing nothing.
    onNotification?.({
      method: "turn/completed",
      params: {
        turn: {
          status: "completed",
          result: {
            status: "NEEDS_CLARIFICATION",
            issueType: "UPSTREAM_CONFIRMATION_AND_AUDIT_INPUTS_MISSING",
            summary: "POLISH_CHAPTER cannot start: the CH-019 to CH-021 plan remains awaiting_confirmation.",
            confidence: 1,
            evidence: [],
            artifacts: [],
            checkpoint: null,
          },
        },
      },
    });
    await runtime.drain();
    await execution;

    expect(reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: expect.objectContaining({
        outcome: "failure",
        failure: expect.objectContaining({
          status: "NEEDS_CLARIFICATION",
          code: "UPSTREAM_CONFIRMATION_AND_AUDIT_INPUTS_MISSING",
        }),
      }),
    }));
  });

  it("reports a failed stage when the agent declares it inside a fenced stage result", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          executionSnapshot: { ...assignment.executionSnapshot, deliveryPolicy: { requireGitDelivery: false } },
        } }),
        reportEvent: vi.fn().mockResolvedValue(undefined), reportResult, heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue("/state/worktree"),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined), request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    // Stage agents report through a fenced stage-result block inside their
    // final message. The Worker previously forwarded only the prose and
    // reported success, so a blocked stage still advanced the Loop.
    onNotification?.({
      method: "turn/completed",
      params: {
        turn: {
          status: "completed",
          result: [
            "`POLISH_CHAPTER` cannot proceed.",
            "",
            "```json",
            JSON.stringify({
              status: "NEEDS_CLARIFICATION",
              issueType: "UPSTREAM_CONFIRMATION_AND_AUDIT_INPUTS_MISSING",
              summary: "CH-019 to CH-021 have no drafts, independent reviews, or chapter audits.",
              confidence: 1,
              evidence: [],
              artifacts: [],
              checkpoint: null,
            }),
            "```",
          ].join("\n"),
        },
      },
    });
    await runtime.drain();
    await execution;

    expect(reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: expect.objectContaining({
        outcome: "failure",
        failure: expect.objectContaining({
          status: "NEEDS_CLARIFICATION",
          code: "UPSTREAM_CONFIRMATION_AND_AUDIT_INPUTS_MISSING",
        }),
      }),
    }));
  });

  it("reports a failed delivery when Codex ends without a pushed task commit", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment }),
        reportEvent: vi.fn().mockResolvedValue(undefined), reportResult, heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue({
        cwd: "/state/worktrees/agent_run_1",
        inspectDelivery: vi.fn().mockResolvedValue({
          branch: "task/2026-HUMANTHR1",
          baseCommit: "b".repeat(40),
          headCommit: "b".repeat(40),
          remoteHeadCommit: "b".repeat(40),
          commits: [],
          changedFiles: [],
          clean: true,
        }),
      }),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined), request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }), stop: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: {} } } });
    await runtime.drain();
    await execution;
    expect(reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: expect.objectContaining({
        outcome: "failure",
        output: { errorCode: "delivery_no_changes", message: "Codex completed without a committed task change on the task branch" },
        failure: expect.objectContaining({ code: "delivery_no_changes" }),
      }),
    }));
  });

  it("preserves a redacted provider diagnostic when Codex reports a failed turn", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment }),
        reportEvent: vi.fn().mockResolvedValue(undefined), reportResult, heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue({ cwd: "/state/worktrees/agent_run_1", inspectDelivery: vi.fn() }),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined), request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }), stop: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({
      method: "turn/completed",
      params: {
        turn: {
          status: "failed",
          error: {
            code: "rate_limit_exceeded",
            httpStatus: 429,
            message: "upstream rejected configured-key",
            requestId: "req_123",
          },
        },
      },
    });
    await runtime.drain();
    await execution;

    expect(reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: expect.objectContaining({
        output: expect.objectContaining({
          errorCode: "provider_error",
          providerDiagnostic: {
            code: "rate_limit_exceeded",
            httpStatus: 429,
            message: "upstream rejected [redacted]",
            requestId: "req_123",
          },
        }),
      }),
    }));
  });

  it("keeps the assignment lease alive while the worktree is still being prepared", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    let releasePrepare: () => void = () => undefined;
    const prepareGate = new Promise<void>((resolve) => { releasePrepare = resolve; });
    const runtime = createWorkerRuntime({
      config: {
        instanceId: "worker-1",
        capabilities: {},
        requestedConcurrency: 1,
        stateDirectory: "/state",
        heartbeatIntervalMs: 5,
      },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          executionSnapshot: { ...assignment.executionSnapshot, deliveryPolicy: { requireGitDelivery: false } },
        } }),
        reportEvent: vi.fn().mockResolvedValue(undefined),
        reportResult,
        heartbeat,
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      // A slow clone must not let the 60s lease expire before app-server start,
      // which is where the old code began heartbeating.
      prepareWorktree: vi.fn().mockImplementation(async () => {
        await prepareGate;
        return "/state/worktree";
      }),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined), request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
      now: () => new Date("2026-08-24T08:00:00.000Z"),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(heartbeat.mock.calls.length).toBeGreaterThanOrEqual(2));
    releasePrepare();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: {} } } });
    await runtime.drain();
    await execution;

    expect(reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: expect.objectContaining({ outcome: "success" }),
    }));
  });

  it("uploads only the review pages the stage declared, not every page in the shared checkout", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    const uploadArtifact = vi.fn().mockImplementation(async (_session, input) => ({ storageKey: `key:${input.relativePath}` }));
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          executionSnapshot: { ...assignment.executionSnapshot, deliveryPolicy: { requireGitDelivery: false } },
        } }),
        reportEvent: vi.fn().mockResolvedValue(undefined), reportResult, heartbeat: vi.fn().mockResolvedValue(undefined),
        uploadArtifact,
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue("/state/worktree"),
      // A shared task branch accumulates every earlier batch's review page.
      collectReviewArtifacts: vi.fn().mockResolvedValue([
        { relativePath: "generated/reviews/TASK-1000-chapter-plan.html", content: "<html>old</html>" },
        { relativePath: "generated/reviews/TASK-1001-chapter-plan.html", content: "<html>current</html>" },
        { relativePath: "generated/reviews/index.html", content: "<html>index</html>" },
      ]),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined), request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({
      method: "turn/completed",
      params: {
        turn: {
          status: "completed",
          result: [
            "Plan refreshed.",
            "",
            "```json",
            JSON.stringify({
              execId: "main",
              status: "SUCCESS",
              issueType: "PLAN_CHAPTER_COMPLETE",
              summary: "Plan refreshed for TASK-1001.",
              confidence: 0.98,
              evidence: ["working/current/volume-001-batch-019-021/chapter-plan.yaml"],
              artifacts: ["generated/reviews/TASK-1001-chapter-plan.html"],
              checkpoint: null,
            }),
            "```",
          ].join("\n"),
        },
      },
    });
    await runtime.drain();
    await execution;

    const uploaded = uploadArtifact.mock.calls.map(([, input]) => input.relativePath);
    expect(uploaded).toEqual(["generated/reviews/TASK-1001-chapter-plan.html"]);
    expect(reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: expect.objectContaining({
        outcome: "success",
        artifactRefs: ["key:generated/reviews/TASK-1001-chapter-plan.html"],
      }),
    }));
  });

  it("degrades a review-artifact upload failure instead of failing the completed turn", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    const reportEvent = vi.fn().mockResolvedValue(undefined);
    const onExecutionFailure = vi.fn();
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          executionSnapshot: { ...assignment.executionSnapshot, deliveryPolicy: { requireGitDelivery: false } },
        } }),
        reportEvent,
        reportResult,
        heartbeat: vi.fn().mockResolvedValue(undefined),
        uploadArtifact: vi.fn().mockRejectedValue(Object.assign(new Error("EACCES"), { code: "review_artifact_upload_failed" })),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue("/state/worktree"),
      collectReviewArtifacts: vi.fn().mockResolvedValue([
        { relativePath: "generated/reviews/chapter-plan.html", content: "<html>review</html>" },
      ]),
      onExecutionFailure,
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined), request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: { summary: "done" } } } });
    await runtime.drain();
    await execution;

    // The Codex turn genuinely succeeded; only the optional review page upload
    // failed. That must stay a successful assignment with a degradation notice.
    expect(onExecutionFailure).not.toHaveBeenCalled();
    expect(reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: expect.objectContaining({ outcome: "success" }),
    }));
    expect(reportEvent.mock.calls.map(([, event]) => event.eventType)).toContain("worker.review_artifact.degraded");
  });

  it("does not inspect or push Git delivery for a stage that does not require it", async () => {
    const inspectDelivery = vi.fn();
    const reportResult = vi.fn().mockResolvedValue(undefined);
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          executionSnapshot: {
            ...assignment.executionSnapshot,
            deliveryPolicy: { requireGitDelivery: false },
          },
        } }),
        reportEvent: vi.fn().mockResolvedValue(undefined), reportResult, heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue({ cwd: "/state/worktrees/prepare", inspectDelivery }),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined), request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }), stop: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const execution = runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: {} } } });
    await runtime.drain();
    await execution;

    expect(inspectDelivery).not.toHaveBeenCalled();
    expect(reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: expect.objectContaining({
        outcome: "success",
        output: expect.objectContaining({ delivery: { required: false, evidence: null } }),
      }),
    }));
  });

  it("persists later lifecycle records and the result after a notification transport failure", async () => {
    // Fail the first `worker.stage.completed` delivery: that is the boundary
    // this test pins. Filtering by event type keeps it independent of how many
    // execution-phase events precede it.
    let failedOnce = false;
    const reportEvent = vi.fn(async (_session, event: { eventType: string }) => {
      if (event.eventType === "worker.stage.completed" && !failedOnce) {
        failedOnce = true;
        throw Object.assign(new Error("platform unavailable"), { code: "provider_transport_error" });
      }
    });
    const reportResult = vi.fn().mockResolvedValue(undefined);
    const outbox = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockResolvedValue([]),
      acknowledge: vi.fn().mockResolvedValue(undefined),
    };
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment }),
        reportEvent,
        reportResult,
        heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox,
      prepareWorktree: vi.fn().mockResolvedValue(deliveredWorktree),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined),
        request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
      now: () => new Date("2026-08-24T08:00:00.000Z"),
    });

    await runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({ method: "item/agentMessage/delta", params: { delta: "progress" } });
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: {} } } });
    await runtime.drain();

    expect(lifecycleEventTypes(reportEvent)).toEqual([
      "worker.assignment.claimed",
      "worker.stage.started",
      "worker.app_server.started",
      "worker.stage.completed",
    ]);
    expect(reportResult).not.toHaveBeenCalled();
    const queued = outbox.enqueue.mock.calls.map(([{ type, payload }]) => ({
      type,
      eventType: (payload as { event?: { eventType?: string } }).event?.eventType,
      sequence: (payload as { event?: { sequence?: number } }).event?.sequence,
    }));
    expect(queued
      .filter(({ eventType }) => eventType !== "loop.node.execution_phase_changed")
      .map(({ type, eventType }) => ({ type, eventType }))).toEqual([
      { type: "event", eventType: "worker.stage.completed" },
      { type: "event", eventType: "worker.cleanup.started" },
      { type: "event", eventType: "worker.cleanup.completed" },
      { type: "result", eventType: undefined },
    ]);
    // Sequences must stay strictly monotonic across the whole stream, phase
    // events included, because the platform fences appends on them.
    const sequences = queued.flatMap(({ sequence }) => sequence === undefined ? [] : [sequence]);
    expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
    expect(new Set(sequences).size).toBe(sequences.length);
  });

  it("keeps a completed turn pending and replays its terminal result after a transient platform rejection", async () => {
    const reportResult = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("platform rejected checklist closure"), { code: "validation_failed" }))
      .mockResolvedValueOnce(undefined);
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    const stored: Array<{ id: string; type: string; payload: unknown; createdAt: string }> = [];
    const outbox = {
      enqueue: vi.fn().mockImplementation(async ({ type, payload }) => {
        stored.push({ id: `outbox-${stored.length + 1}`, type, payload, createdAt: "2026-08-24T08:00:00.000Z" });
      }),
      read: vi.fn().mockImplementation(async () => [...stored]),
      acknowledge: vi.fn().mockImplementation(async (ids: readonly string[]) => {
        for (const id of ids) {
          const index = stored.findIndex((record) => record.id === id);
          if (index >= 0) stored.splice(index, 1);
        }
      }),
    };
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValueOnce({ assignment }).mockResolvedValue({ assignment: null }),
        reportEvent: vi.fn().mockResolvedValue(undefined),
        reportResult,
        heartbeat,
      },
      outbox,
      prepareWorktree: vi.fn().mockResolvedValue(deliveredWorktree),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined),
        request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    });

    await runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: {} } } });
    await vi.waitFor(() => expect(stored.map((record) => record.type)).toEqual(["result"]));

    expect(stored.map((record) => record.type)).toEqual(["result"]);
    expect(runtime.state()).not.toBe("degraded");

    await runtime.tick();

    expect(heartbeat).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agentRunId: "agent_run_1" }));
    expect(reportResult).toHaveBeenCalledTimes(2);
    expect(stored).toEqual([]);
  });

  it("degrades instead of falsely accepting a terminal result when its durable outbox is unavailable", async () => {
    const onExecutionFailure = vi.fn();
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment }),
        reportEvent: vi.fn().mockResolvedValue(undefined),
        reportResult: vi.fn().mockRejectedValue(Object.assign(new Error("platform unavailable"), { code: "provider_transport_error" })),
        heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: {
        enqueue: vi.fn().mockImplementation(async ({ type }) => {
          if (type === "result") throw Object.assign(new Error("state volume is read-only"), { code: "worker_state_unavailable" });
        }),
        read: vi.fn().mockResolvedValue([]),
        acknowledge: vi.fn().mockResolvedValue(undefined),
      },
      prepareWorktree: vi.fn().mockResolvedValue(deliveredWorktree),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined),
        request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
      onExecutionFailure,
    });

    await runtime.tick();
    await vi.waitFor(() => expect(onNotification).toBeTypeOf("function"));
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: {} } } });

    await vi.waitFor(() => expect(runtime.state()).toBe("degraded"));
    expect(onExecutionFailure).toHaveBeenCalledWith(expect.objectContaining({
      agentRunId: "agent_run_1",
      code: "worker_outbox_unavailable",
    }));
    await runtime.drain();
  });

  it("rejects an incomplete execution snapshot instead of falling back to machine configuration", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    const reportEvent = vi.fn().mockResolvedValue(undefined);
    const onExecutionFailure = vi.fn();
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          executionSnapshot: { ...assignment.executionSnapshot, model: { ...assignment.executionSnapshot.model, model: "" } },
        } }),
        reportEvent,
        reportResult,
        heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn(),
      appServer: vi.fn(),
      onExecutionFailure,
      now: () => new Date("2026-08-24T08:00:00.000Z"),
    });

    await runtime.tick();
    await runtime.drain();

    expect(reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: expect.objectContaining({
        outcome: "failure",
        failure: expect.objectContaining({ code: "configuration_required" }),
      }),
    }));
    expect(lifecycleEventTypes(reportEvent)).toEqual([
      "worker.assignment.claimed",
      "worker.stage.failed",
      "worker.cleanup.started",
      "worker.cleanup.completed",
    ]);
    expect(reportEvent.mock.invocationCallOrder.at(-1)).toBeLessThan(reportResult.mock.invocationCallOrder[0]!);
    expect(onExecutionFailure).toHaveBeenCalledWith({
      agentRunId: "agent_run_1",
      code: "configuration_required",
      summary: "Linux Worker assignment has no complete immutable Codex configuration",
    });
  });

  it("rejects an assignment addressed to another Worker instance before checkout", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    const prepareWorktree = vi.fn();
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-01", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          executionSnapshot: { ...assignment.executionSnapshot, workerInstanceId: "worker-02" },
        } }),
        reportEvent: vi.fn().mockResolvedValue(undefined),
        reportResult,
        heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree,
      appServer: vi.fn(),
      now: () => new Date("2026-08-24T08:00:00.000Z"),
    });

    await runtime.tick();
    await runtime.drain();

    expect(prepareWorktree).not.toHaveBeenCalled();
    expect(reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: expect.objectContaining({
        outcome: "failure",
        failure: expect.objectContaining({ code: "worker_affinity_mismatch" }),
      }),
    }));
  });

  it("rejects a malformed provider endpoint before preparing a worktree", async () => {
    const prepareWorktree = vi.fn();
    const reportResult = vi.fn().mockResolvedValue(undefined);
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({ assignment: {
          ...assignment,
          executionSnapshot: {
            ...assignment.executionSnapshot,
            model: { ...assignment.executionSnapshot.model, endpoint: "https://codex.example.com/v1?tenant=other" },
          },
        } }),
        reportEvent: vi.fn().mockResolvedValue(undefined),
        reportResult,
        heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree,
      appServer: vi.fn(),
      now: () => new Date("2026-08-24T08:00:00.000Z"),
    });

    await runtime.tick();
    await runtime.drain();

    expect(prepareWorktree).not.toHaveBeenCalled();
    expect(reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: expect.objectContaining({
        failure: expect.objectContaining({ code: "configuration_required" }),
      }),
    }));
  });

  it("never starts a second GPU assignment above the Worker resource limit", async () => {
    const second = { ...assignment, agentRunId: "agent_run_2", loopNodeAttemptId: "loop_attempt_2" };
    const reportResult = vi.fn().mockResolvedValue(undefined);
    let firstNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: {
        instanceId: "worker-1", capabilities: { gpu: true }, requestedConcurrency: 2,
        resourceLimits: { gpuConcurrency: 1, unityBuildConcurrency: 1 }, stateDirectory: "/state",
      },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValueOnce({ assignment }).mockResolvedValueOnce({ assignment: second }),
        reportEvent: vi.fn().mockResolvedValue(undefined), reportResult, heartbeat: vi.fn().mockResolvedValue(undefined),
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue(deliveredWorktree),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined), request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { firstNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
      now: () => new Date("2026-08-24T08:00:00.000Z"),
    });

    await runtime.tick();
    await vi.waitFor(() => expect(firstNotification).toBeTypeOf("function"));
    await runtime.tick();

    await vi.waitFor(() => expect(reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      agentRunId: "agent_run_2",
      result: expect.objectContaining({ failure: expect.objectContaining({ code: "resource_concurrency_unavailable" }) }),
    })));
    firstNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: {} } } });
    await runtime.drain();
  });

  it("re-registers after an expired Worker session instead of remaining degraded", async () => {
    const register = vi.fn()
      .mockResolvedValueOnce({ poolId: "a".repeat(32), sessionToken: "htwps_expired" })
      .mockResolvedValueOnce({ poolId: "a".repeat(32), sessionToken: "htwps_refreshed" });
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register,
        claim: vi.fn().mockRejectedValueOnce(Object.assign(new Error("Worker pool session is invalid"), { code: "worker_pool_unauthorized" })).mockResolvedValueOnce({ assignment: null }),
        reportEvent: vi.fn(), reportResult: vi.fn(), heartbeat: vi.fn(),
      },
      outbox: { enqueue: vi.fn(), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn() },
      prepareWorktree: vi.fn(), appServer: vi.fn(),
    });

    await runtime.tick();
    await runtime.tick();

    expect(register).toHaveBeenCalledTimes(2);
    expect(runtime.state()).toBe("idle");
  });

  it("refreshes an expired session while a turn is running so the result retains its lease", async () => {
    const initialSession = { poolId: "a".repeat(32), sessionToken: "htwps_initial" };
    const refreshedSession = { poolId: "a".repeat(32), sessionToken: "htwps_refreshed" };
    const register = vi.fn().mockResolvedValueOnce(initialSession).mockResolvedValueOnce(refreshedSession);
    const heartbeat = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error("Worker pool session is invalid"), { code: "worker_pool_unauthorized" }))
      .mockResolvedValue(undefined);
    const reportResult = vi.fn().mockResolvedValue(undefined);
    let onNotification: ((event: { method: string; params: unknown }) => void) | undefined;
    const runtime = createWorkerRuntime({
      config: {
        instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state",
        heartbeatIntervalMs: 1,
      },
      api: {
        register,
        claim: vi.fn().mockResolvedValue({ assignment }),
        reportEvent: vi.fn().mockResolvedValue(undefined),
        reportResult,
        heartbeat,
      },
      outbox: { enqueue: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn().mockResolvedValue(deliveredWorktree),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined),
        request: vi.fn().mockResolvedValue({ thread: { id: "thread_1" } }),
        subscribe: vi.fn().mockImplementation((listener) => { onNotification = listener; return () => undefined; }),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    });

    await runtime.tick();
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(2));
    onNotification?.({ method: "turn/completed", params: { turn: { status: "completed", result: {} } } });
    await runtime.drain();

    expect(reportResult).toHaveBeenCalledWith(refreshedSession, expect.objectContaining({
      result: expect.objectContaining({ outcome: "success" }),
    }));
  });

  it("uses bounded exponential retry timing when the platform transport is unavailable", async () => {
    let clock = new Date("2026-08-24T08:00:00.000Z");
    const claim = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("platform unavailable"), { code: "provider_transport_error" }))
      .mockResolvedValue({ assignment: null });
    const runtime = createWorkerRuntime({
      config: { instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1, stateDirectory: "/state" },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }), claim,
        reportEvent: vi.fn(), reportResult: vi.fn(), heartbeat: vi.fn(),
      },
      outbox: { enqueue: vi.fn(), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn() },
      prepareWorktree: vi.fn(), appServer: vi.fn(), now: () => clock,
    });

    await runtime.tick();
    clock = new Date("2026-08-24T08:00:00.999Z");
    await runtime.tick();
    clock = new Date("2026-08-24T08:00:01.000Z");
    await runtime.tick();

    expect(claim).toHaveBeenCalledTimes(2);
    expect(runtime.state()).toBe("idle");
  });
});

describe("Direct Worker LiveSession lifetime", () => {
  function directSessionRuntime(input: {
    isSessionActive?: (session: unknown, sessionId: string) => Promise<boolean>;
    close: () => Promise<void>;
  }) {
    return createWorkerRuntime({
      config: {
        instanceId: "worker-1",
        capabilities: {},
        requestedConcurrency: 1,
        stateDirectory: "/state",
        directSessionLivenessIntervalMs: 5,
      },
      api: {
        register: vi.fn().mockResolvedValue({ poolId: "a".repeat(32), sessionToken: "htwps_session" }),
        claim: vi.fn().mockResolvedValue({
          assignment: null,
          liveSession: {
            sessionId: "d".repeat(32),
            kind: "worker",
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
        }),
        reportEvent: vi.fn().mockResolvedValue(undefined),
        reportResult: vi.fn().mockResolvedValue(undefined),
        heartbeat: vi.fn().mockResolvedValue(undefined),
        ...(input.isSessionActive ? { isSessionActive: input.isSessionActive } : {}),
      } as never,
      outbox: { enqueue: vi.fn(), read: vi.fn().mockResolvedValue([]), acknowledge: vi.fn().mockResolvedValue(undefined) },
      prepareWorktree: vi.fn(),
      appServer: () => ({
        start: vi.fn().mockResolvedValue(undefined),
        request: vi.fn().mockResolvedValue({ thread: { id: "thread_direct_worker" } }),
        subscribe: vi.fn().mockReturnValue(() => undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        endpoint: () => "ws://127.0.0.1:32123",
      }),
      ensureDirectory: vi.fn().mockResolvedValue(undefined),
      // `wait()` only settles once the runtime closes the handle, so these tests
      // prove the runtime drove teardown rather than the test doing it.
      onDirectLiveSession: vi.fn().mockImplementation(async () => {
        let release: (() => void) | null = null;
        const stopped = new Promise<void>((resolve) => { release = resolve; });
        return {
          wait: () => stopped,
          close: async () => {
            await input.close();
            release?.();
          },
        };
      }),
    });
  }

  it("tears the TUI down once the platform session is no longer active", async () => {
    // Observed in production: a TUI outlived its ended session and held the
    // worker's only concurrency slot, so the worker looked idle while never
    // claiming again.
    let closed = false;
    const close = vi.fn(async () => { closed = true; });
    const isSessionActive = vi.fn().mockResolvedValue(false);
    const runtime = directSessionRuntime({ isSessionActive, close });

    await runtime.tick();
    await vi.waitFor(() => expect(closed).toBe(true), { timeout: 2_000 });

    expect(isSessionActive).toHaveBeenCalledWith(
      expect.objectContaining({ poolId: "a".repeat(32) }),
      "d".repeat(32),
    );
    await runtime.drain();
  });

  it("keeps the TUI alive while the platform session is still active", async () => {
    let closed = false;
    const close = vi.fn(async () => { closed = true; });
    const runtime = directSessionRuntime({
      isSessionActive: vi.fn().mockResolvedValue(true),
      close,
    });

    await runtime.tick();
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(closed).toBe(false);
  });

  it("does not poll liveness when the platform API cannot report it", async () => {
    let closed = false;
    const close = vi.fn(async () => { closed = true; });
    const runtime = directSessionRuntime({ close });

    await runtime.tick();
    await new Promise((resolve) => setTimeout(resolve, 40));

    // Without the capability the runtime keeps the previous behaviour rather
    // than guessing that a live session is gone.
    expect(closed).toBe(false);
  });
});
