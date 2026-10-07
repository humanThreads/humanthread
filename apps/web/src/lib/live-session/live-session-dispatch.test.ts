import { describe, expect, it, vi } from "vitest";

import {
  buildAttemptLiveSessionDispatch,
  buildLiveSessionDispatch,
  findDispatchableAgentLiveSession,
  findDispatchableWorkerLiveSession,
  findDispatchForClaimedLoop,
  loadLiveSessionDispatchForAssignment,
} from "./live-session-dispatch";
import { verifyLiveSessionTicket } from "./live-session-ticket";

const secret = "dispatch-secret-for-tests";
const sessionId = "a".repeat(32);
const now = new Date("2026-09-24T10:00:00.000Z");

describe("live session dispatch", () => {
  it("builds an attempt session dispatch without persisting or claiming control", () => {
    const dispatch = buildAttemptLiveSessionDispatch({
      session: {
        id: sessionId,
        kind: "worker",
        surface: "web",
        spaceId: "space_1",
        projectId: "project_1",
        taskId: "task_1",
        executionPolicy: "loop",
        target: {
          type: "worker_pool",
          workerPoolId: "b".repeat(32),
          displayName: "ht-agnet",
        },
        targetDisplayName: "ht-agnet",
        businessRun: { type: "loop_run", id: "loop_run_1" },
        loopAttempt: {
          loopRunId: "loop_run_1",
          loopNodeRunId: "node_run_1",
          loopNodeAttemptId: "attempt_1",
          attemptNo: 1,
          leaseGeneration: 2,
        },
        status: "starting",
        controlState: "detached",
        journal: { status: "ready", retentionDays: 30, firstSequence: 0, lastSequence: 0 },
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      executionTicket: { token: "lst1.attempt.execution" },
      relayBaseUrl: "http://localhost:3000",
    });

    expect(dispatch).toMatchObject({
      sessionId,
      authorization: "lst1.attempt.execution",
      relayUrl: expect.stringContaining(`ws://localhost:3000/live-session/execution?sessionId=${sessionId}`),
      initialCols: 120,
      initialRows: 36,
    });
  });

  it("builds an execution WSS endpoint with a one-minute execution ticket", () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = secret;
    const dispatch = buildLiveSessionDispatch({
      record: {
        id: sessionId,
        kind: "agent",
        targetType: "agent_device",
        targetDeviceId: "device_1",
        targetWorkerPoolId: null,
        projectId: null,
        taskId: null,
        businessRunType: null,
        businessRunId: null,
        targetDisplayName: "Mac Studio",
        executionPolicy: "direct",
        status: "starting",
        expiresAt: new Date("2026-09-24T10:30:00.000Z"),
      },
      relayBaseUrl: "http://localhost:3000",
      now,
    });

    expect(dispatch.relayUrl).toContain("ws://localhost:3000/live-session/execution");
    expect(verifyLiveSessionTicket({
      ticket: dispatch.authorization,
      now,
      secret,
      expectedKind: "execution",
    })).toMatchObject({ sessionId, kind: "execution" });
  });

  it("never dispatches an ended session", () => {
    expect(() => buildLiveSessionDispatch({
      record: {
        id: sessionId,
        kind: "worker",
        targetType: "worker_pool",
        targetDeviceId: null,
        targetWorkerPoolId: "b".repeat(32),
        projectId: "project_1",
        taskId: "task_1",
        businessRunType: "loop_run",
        businessRunId: "loop_1",
        targetDisplayName: "ht-agnet",
        executionPolicy: "loop",
        status: "ended",
        expiresAt: new Date("2026-09-24T10:30:00.000Z"),
      },
      relayBaseUrl: "http://localhost:3000",
      now,
    })).toThrow("Live session is not dispatchable");
  });

  it("selects only the oldest dispatchable Agent session for the claimed device", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = secret;
    const load = vi.fn().mockResolvedValue({
      id: sessionId,
      kind: "agent",
      targetType: "agent_device",
      targetDeviceId: "device_1",
      targetWorkerPoolId: null,
      projectId: null,
      taskId: null,
      businessRunType: null,
      businessRunId: null,
      status: "starting",
      expiresAt: new Date("2026-09-24T10:30:00.000Z"),
    });

    await expect(findDispatchableAgentLiveSession({
      deviceId: "device_1",
      userId: "user_1",
      now,
      relayBaseUrl: "http://localhost:3000",
      load,
    })).resolves.toMatchObject({ sessionId });
    expect(load).toHaveBeenCalledWith("device_1", "user_1", now);
  });

  it("promotes a claimed direct Agent session to running before returning its ticket", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = secret;
    const claimStarting = vi.fn().mockResolvedValue(true);
    const load = vi.fn().mockResolvedValue({
      id: sessionId,
      kind: "agent",
      targetType: "agent_device",
      targetDeviceId: "device_1",
      targetWorkerPoolId: null,
      projectId: null,
      taskId: null,
      businessRunType: null,
      businessRunId: null,
      status: "starting",
      expiresAt: new Date("2026-09-24T10:30:00.000Z"),
    });

    await findDispatchableAgentLiveSession({
      deviceId: "device_1",
      userId: "user_1",
      now,
      relayBaseUrl: "http://localhost:3000",
      load,
      claimStarting,
    });

    expect(claimStarting).toHaveBeenCalledWith(sessionId, now);
  });

  it("loads one matching dispatch for a claimed business run", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = secret;
    const load = vi.fn().mockResolvedValue({
      id: sessionId,
      kind: "worker",
      targetType: "worker_pool",
      targetDeviceId: null,
      targetWorkerPoolId: "b".repeat(32),
      projectId: "project_1",
      taskId: "task_1",
      businessRunType: "loop_run",
      businessRunId: "loop_1",
      status: "starting",
      expiresAt: new Date("2026-09-24T10:30:00.000Z"),
    });

    await expect(loadLiveSessionDispatchForAssignment({
      ownerUserId: "user_1",
      target: { type: "worker_pool", id: "b".repeat(32) },
      loopRunId: "loop_1",
      relayBaseUrl: "http://localhost:3000",
      now,
      load,
    })).resolves.toMatchObject({ sessionId });
    expect(load).toHaveBeenCalledWith({
      ownerUserId: "user_1",
      targetType: "worker_pool",
      targetId: "b".repeat(32),
      loopRunId: "loop_1",
      now,
    });
  });

  it("promotes a claimed starting session to running before returning the ticket", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = secret;
    const markRunning = vi.fn().mockResolvedValue(undefined);
    const load = vi.fn().mockResolvedValue({
      id: sessionId,
      kind: "worker",
      targetType: "worker_pool",
      targetDeviceId: null,
      targetWorkerPoolId: "b".repeat(32),
      projectId: "project_1",
      taskId: "task_1",
      businessRunType: "loop_run",
      businessRunId: "loop_1",
      status: "starting",
      expiresAt: new Date("2026-09-24T10:30:00.000Z"),
    });

    await findDispatchForClaimedLoop({
      ownerUserId: "user_1",
      target: { type: "worker_pool", id: "b".repeat(32) },
      loopRunId: "loop_1",
      relayBaseUrl: "http://localhost:3000",
      now,
      load,
      markRunning,
    });

    expect(markRunning).toHaveBeenCalledWith(sessionId, now);
  });

  it("does not re-dispatch a direct Worker session that another replica already claimed", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = secret;
    const load = vi.fn().mockResolvedValue({
      id: sessionId,
      kind: "worker",
      targetType: "worker_pool",
      targetDeviceId: null,
      targetWorkerPoolId: "b".repeat(32),
      projectId: "project_1",
      taskId: null,
      businessRunType: null,
      businessRunId: null,
      targetDisplayName: "ht-agnet",
      executionPolicy: "direct",
      status: "running",
      expiresAt: new Date("2026-09-24T10:30:00.000Z"),
    });
    const claim = vi.fn().mockResolvedValue(false);

    await expect(findDispatchableWorkerLiveSession({
      workerPoolId: "b".repeat(32),
      now,
      relayBaseUrl: "http://localhost:3000",
      load,
      claimStarting: claim,
    })).resolves.toBeNull();
    expect(claim).not.toHaveBeenCalled();
  });
  it("carries the session model selection into the Agent dispatch", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = secret;
    const load = vi.fn().mockResolvedValue({
      id: sessionId,
      kind: "agent",
      targetType: "agent_device",
      targetDeviceId: "device_1",
      targetWorkerPoolId: null,
      projectId: null,
      taskId: null,
      businessRunType: null,
      businessRunId: null,
      status: "starting",
      modelSiteId: "b".repeat(32),
      model: "picked-model",
      reasoningEffort: "medium",
      expiresAt: new Date("2026-09-24T10:30:00.000Z"),
    });

    const dispatch = await findDispatchableAgentLiveSession({
      deviceId: "device_1",
      userId: "user_1",
      now,
      relayBaseUrl: "http://localhost:3000",
      load,
    });

    expect(dispatch?.modelSelection).toEqual({
      siteId: "b".repeat(32),
      model: "picked-model",
      reasoningEffort: "medium",
    });
  });

  it("omits the selection when the session has none", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = secret;
    const load = vi.fn().mockResolvedValue({
      id: sessionId,
      kind: "agent",
      targetType: "agent_device",
      targetDeviceId: "device_1",
      targetWorkerPoolId: null,
      projectId: null,
      taskId: null,
      businessRunType: null,
      businessRunId: null,
      status: "starting",
      expiresAt: new Date("2026-09-24T10:30:00.000Z"),
    });

    const dispatch = await findDispatchableAgentLiveSession({
      deviceId: "device_1",
      userId: "user_1",
      now,
      relayBaseUrl: "http://localhost:3000",
      load,
    });

    expect(dispatch).not.toHaveProperty("modelSelection");
  });

});
