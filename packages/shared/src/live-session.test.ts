import { describe, expect, it } from "vitest";

import {
  createLiveSessionInputSchema,
  LIVE_SESSION_TICKET_KINDS,
  liveSessionDispatchSchema,
  liveSessionViewerTicketSchema,
  liveSessionViewSchema,
} from "./live-session";

const baseSession = {
  id: "a".repeat(32),
  kind: "worker" as const,
  surface: "web" as const,
  spaceId: "space_1",
  projectId: "project_1",
  taskId: "task_1",
  executionPolicy: "loop" as const,
  target: { type: "worker_pool" as const, workerPoolId: "b".repeat(32), displayName: "ht-agent" },
  targetDisplayName: "ht-agent",
  businessRun: { type: "loop_run" as const, id: "loop_run_1" },
  status: "running" as const,
  controlState: "viewer" as const,
  journal: { status: "ready" as const, retentionDays: 30, firstSequence: 0, lastSequence: 4 },
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:01:00.000Z",
};

describe("LiveSession contracts", () => {
  it("accepts a taskless direct Agent session targeting an online device", () => {
    expect(createLiveSessionInputSchema.parse({
      commandId: "a".repeat(32),
      kind: "agent",
      surface: "web",
      spaceId: "space:company:demo",
      projectId: null,
      taskId: null,
      executionPolicy: "direct",
      target: { type: "agent_device", deviceId: "device_1" },
      initialCols: 120,
      initialRows: 36,
    })).toMatchObject({ kind: "agent", target: { type: "agent_device" } });
  });

  it("requires a Worker project and resolved pool while keeping its task optional", () => {
    const result = createLiveSessionInputSchema.safeParse({
      commandId: "b".repeat(32),
      kind: "worker",
      surface: "desktop",
      spaceId: "space:company:demo",
      projectId: null,
      taskId: null,
      executionPolicy: "direct",
      target: { type: "worker_pool" },
      initialCols: 120,
      initialRows: 36,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(["projectId"]);
    }
  });

  it("accepts a taskless direct Worker session for a selected project", () => {
    expect(createLiveSessionInputSchema.parse({
      commandId: "b".repeat(32),
      kind: "worker",
      surface: "web",
      spaceId: "space:company:demo",
      projectId: "project_1",
      taskId: null,
      executionPolicy: "direct",
      target: { type: "worker_pool" },
      initialCols: 120,
      initialRows: 36,
    })).toMatchObject({ kind: "worker", projectId: "project_1", taskId: null });
  });

  it("accepts a Loop session before the platform has created its business run", () => {
    const result = createLiveSessionInputSchema.safeParse({
      commandId: "c".repeat(32),
      kind: "agent",
      surface: "desktop",
      spaceId: "space:company:demo",
      projectId: "project_1",
      taskId: "task_1",
      executionPolicy: "loop",
      target: { type: "agent_device", deviceId: "device_1" },
      initialCols: 120,
      initialRows: 36,
    });

    expect(result.success).toBe(true);
  });

  it("never accepts an ended state in the active session view", () => {
    const result = liveSessionViewSchema.safeParse({
      id: "d".repeat(32),
      kind: "agent",
      surface: "web",
      spaceId: "space:company:demo",
      projectId: null,
      taskId: null,
      executionPolicy: "direct",
      target: { type: "agent_device", deviceId: "device_1", displayName: "Mac Studio" },
      targetDisplayName: "Mac Studio",
      businessRun: null,
      status: "ended",
      controlState: "detached",
      journal: { status: "ready", retentionDays: 30, firstSequence: 0, lastSequence: 4 },
      createdAt: "2026-09-24T00:00:00.000Z",
      updatedAt: "2026-09-24T00:01:00.000Z",
    });

    expect(result.success).toBe(false);
  });

  it("describes the Loop attempt bound to an active execution session", () => {
    expect(liveSessionViewSchema.parse({
      ...baseSession,
      loopAttempt: {
        loopRunId: "loop_run_1",
        loopNodeRunId: "node_run_1",
        loopNodeAttemptId: "attempt_1",
        attemptNo: 1,
        leaseGeneration: 1,
      },
    }).loopAttempt).toMatchObject({ loopNodeRunId: "node_run_1" });
  });

  it("keeps the ticket kind catalog and viewer ticket payload closed", () => {
    expect(LIVE_SESSION_TICKET_KINDS).toEqual(["control", "execution", "viewer"]);
    expect(liveSessionViewerTicketSchema.parse({
      kind: "viewer",
      token: "lst1.payload.signature",
      expiresAt: "2026-09-30T00:01:00.000Z",
    })).toMatchObject({ kind: "viewer" });
    expect(liveSessionViewerTicketSchema.safeParse({
      kind: "control",
      token: "lst1.payload.signature",
      expiresAt: "2026-09-30T00:01:00.000Z",
    }).success).toBe(false);
    expect(liveSessionViewerTicketSchema.safeParse({
      kind: "viewer",
      token: "lst1.payload.signature",
      expiresAt: "2026-09-30T00:01:00.000Z",
      extra: true,
    }).success).toBe(false);
  });

  it("describes one execution dispatch without terminal content", () => {
    expect(liveSessionDispatchSchema.parse({
      sessionId: "e".repeat(32),
      kind: "worker",
      target: { type: "worker_pool", workerPoolId: "f".repeat(32), displayName: "ht-agnet" },
      projectId: "project_1",
      taskId: "task_1",
      executionPolicy: "direct",
      relayUrl: "ws://localhost:3000/live-session/execution",
      authorization: "lst1.payload.signature",
      initialCols: 120,
      initialRows: 36,
    })).toMatchObject({ sessionId: "e".repeat(32), kind: "worker" });
  });

  it("preserves the platform-resolved Worker runtime in a direct dispatch", () => {
    const dispatch = liveSessionDispatchSchema.parse({
      sessionId: "e".repeat(32),
      kind: "worker",
      target: { type: "worker_pool", workerPoolId: "f".repeat(32), displayName: "ht-agnet" },
      projectId: "project_1",
      taskId: null,
      executionPolicy: "direct",
      relayUrl: "ws://localhost:3000/live-session/execution",
      authorization: "lst1.payload.signature",
      initialCols: 120,
      initialRows: 36,
      runtime: {
        endpoint: "https://model.example.com/v1",
        apiKey: "model-key",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
      },
    });

    expect(dispatch.runtime).toEqual({
      endpoint: "https://model.example.com/v1",
      apiKey: "model-key",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    });
  });
});

describe("live session model selection", () => {
  const base = {
    commandId: "a".repeat(32),
    kind: "worker" as const,
    surface: "web" as const,
    spaceId: "space_1",
    projectId: "project_1",
    taskId: null,
    executionPolicy: "direct" as const,
    target: { type: "worker_pool" as const },
    businessRunId: null,
    initialCols: 120,
    initialRows: 36,
  };

  it("accepts an omitted selection so existing callers keep working", () => {
    expect(createLiveSessionInputSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a complete selection", () => {
    const parsed = createLiveSessionInputSchema.safeParse({
      ...base,
      modelSelection: {
        siteId: "b".repeat(32),
        model: "gpt-5.6-terra",
        reasoningEffort: "high",
      },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.modelSelection).toEqual({
      siteId: "b".repeat(32),
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
    });
  });

  it("treats an omitted selection as absent rather than rejecting the call", () => {
    const parsed = createLiveSessionInputSchema.parse(base);
    // Both absent and null mean "use the resolved default"; callers may send
    // either without changing behaviour.
    expect(parsed.modelSelection ?? null).toBeNull();
    expect(createLiveSessionInputSchema.parse({ ...base, modelSelection: null }).modelSelection).toBeNull();
  });

  it("rejects a non-md5 site id and an unknown reasoning effort", () => {
    expect(createLiveSessionInputSchema.safeParse({
      ...base,
      modelSelection: { siteId: "not-md5", model: "m", reasoningEffort: "high" },
    }).success).toBe(false);
    expect(createLiveSessionInputSchema.safeParse({
      ...base,
      modelSelection: { siteId: "b".repeat(32), model: "m", reasoningEffort: "turbo" },
    }).success).toBe(false);
  });

  it("rejects control characters in the model name", () => {
    expect(createLiveSessionInputSchema.safeParse({
      ...base,
      modelSelection: {
        siteId: "b".repeat(32),
        model: "bad\u001bmodel",
        reasoningEffort: "high",
      },
    }).success).toBe(false);
  });

  it("carries the selection on a dispatch and defaults the view field to null", () => {
    const dispatch = liveSessionDispatchSchema.safeParse({
      sessionId: "c".repeat(32),
      kind: "worker",
      target: { type: "worker_pool", workerPoolId: "d".repeat(32), displayName: "ht-agnet" },
      projectId: "project_1",
      taskId: null,
      executionPolicy: "direct",
      relayUrl: "ws://localhost:3000/live-session/execution",
      authorization: "ticket",
      initialCols: 120,
      initialRows: 36,
      modelSelection: { siteId: "b".repeat(32), model: "gpt-5.6-terra", reasoningEffort: "high" },
    });
    expect(dispatch.success).toBe(true);
    expect(dispatch.success && dispatch.data.modelSelection).toEqual({
      siteId: "b".repeat(32),
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
    });
  });
});
