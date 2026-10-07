import type { Prisma } from "@prisma/client";
import { resolveRunGraphSnapshot, resolveRunGraphSnapshotV2, snapshotDigest } from "@humanthread/orchestration-core";
import { runGraphSnapshotSchema } from "@humanthread/shared";
import type { LoopGraph, LoopGraphV2, RunGraphSnapshot } from "@humanthread/shared";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activateLoopNode,
  appendLoopAttemptEvents,
  buildLoopNodeAttemptId,
  buildEffectKey,
  claimPlatformLoopAttempt,
  completeLoopNode,
  createGraphLoopRun,
  parsePublishedLoopVersionGraph,
  readLoopRunProjection,
  recoverOrphanedGraphNode,
  requestRuntimeIntervention,
  reserveEffectExecution,
  resumeParentAfterChildLoop,
  resumeLoopCallback,
  resumeLoopNodeAfterConfiguration,
  resumeWaitingLoopNode,
  resolveEffectExecution,
  waitForLoopNodeConfiguration,
  waitPlatformLoopAttempt,
  buildChecklistFailureUpdates,
  buildChecklistSuccessFinalizationUpdates,
} from "./loop-runtime";
import * as loopRuntime from "./loop-runtime";
import { createPrismaClient } from "./prisma";

const now = new Date("2026-07-29T08:00:00.000Z");
const loopRuntimeTestDatabaseUrl = process.env.LOOP_RUNTIME_TEST_DATABASE_URL?.trim();
const runtimeGraph = {
  schemaVersion: 1,
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  retryPolicy: { maxRetries: 4 },
  limits: { maxStages: 4, maxRepeatCount: 2 },
  nodes: [
    { key: "start", label: "Start", type: "start" },
    { key: "implement", label: "Implement", type: "agent_action", executionTarget: "local", promptTemplate: "Implement", retryPolicy: { maxRetries: 1 } },
    { key: "next", label: "Next", type: "platform_action", executionTarget: "platform", action: "project_document.write" },
    { key: "end", label: "End", type: "end" },
  ],
  edges: [
    { id: "start-implement", source: "start", target: "implement", kind: "normal", outcome: "success" },
    { id: "edge_next", source: "implement", target: "next", kind: "normal", outcome: "success" },
    { id: "next-end", source: "next", target: "end", kind: "normal", outcome: "success" },
  ],
} satisfies LoopGraph;
const runtimeGraphV2 = {
  ...runtimeGraph,
  schemaVersion: 2,
  routingMetadata: {
    implement: { responsibility: "Implement the requested change." },
    next: { responsibility: "Continue the platform workflow." },
  },
} satisfies LoopGraphV2;
const runGraphSnapshotV2 = resolveRunGraphSnapshotV2({
  rootLoopVersionId: "loop_version_1",
  versions: [{
    loopDefinitionId: "loop_definition_1",
    loopVersionId: "loop_version_1",
    scope: "project",
    graph: runtimeGraphV2,
  }],
});
const runGraphSnapshot = {
  snapshotId: "snapshot_loop_version_1",
  graphDigest: `sha256:${"0".repeat(64)}`,
  rootLoopVersionId: "loop_version_1",
  loopVersions: [{
    loopDefinitionId: "loop_definition_1",
    loopVersionId: "loop_version_1",
    scope: "project",
    graph: {
      schemaVersion: 1,
      limits: { maxStages: 2, maxRepeatCount: 1 },
      nodes: [
        { key: "start", nodeId: "node_start", label: "Start", type: "start", offlinePolicy: "online_required" },
        { key: "end", nodeId: "node_end", label: "End", type: "end", offlinePolicy: "online_required" },
      ],
      edges: [{ id: "start-end", source: "start", target: "end", kind: "normal", outcome: "success" }],
    },
  }],
  reachableNodeIds: ["node_end", "node_start"],
} satisfies Omit<RunGraphSnapshot, "graphDigest"> & { graphDigest: string };
const parsedRunGraphSnapshot = runGraphSnapshotSchema.parse(runGraphSnapshot);

describe("runtime checklist failure finalization", () => {
  it("marks every non-terminal item failed with a bounded reason", () => {
    expect(buildChecklistFailureUpdates([
      { id: "inspect", title: "Inspect", status: "not_started", evidenceRefs: [] },
      { id: "tests", title: "Tests", status: "in_progress", evidenceRefs: ["artifacts/report.txt"] },
      { id: "done", title: "Done", status: "succeeded", evidenceRefs: [] },
    ], "provider_error")).toEqual([
      { itemId: "inspect", status: "failed", reason: "provider_error", evidenceRefs: [] },
      { itemId: "tests", status: "failed", reason: "provider_error", evidenceRefs: ["artifacts/report.txt"] },
    ]);
  });

  it("marks unresolved success items skipped when the provider omits final checklist updates", () => {
    expect(buildChecklistSuccessFinalizationUpdates([
      { id: "inspect", title: "Inspect", status: "in_progress", evidenceRefs: [] },
      { id: "tests", title: "Tests", status: "not_started", evidenceRefs: ["artifacts/tests.txt"] },
      { id: "done", title: "Done", status: "succeeded", evidenceRefs: [] },
    ])).toEqual([
      {
        itemId: "inspect",
        status: "skipped",
        reason: "Worker completed the node before the AI reported this checklist item terminal.",
        evidenceRefs: [],
      },
      {
        itemId: "tests",
        status: "skipped",
        reason: "Worker completed the node before the AI reported this checklist item terminal.",
        evidenceRefs: ["artifacts/tests.txt"],
      },
    ]);
  });
});
runGraphSnapshot.graphDigest = snapshotDigest({
  rootLoopVersionId: parsedRunGraphSnapshot.rootLoopVersionId,
  loopVersions: parsedRunGraphSnapshot.loopVersions,
});
const parentRunGraphSnapshot = resolveRunGraphSnapshot({
  rootLoopVersionId: "project_version_1",
  versions: [
    {
      loopDefinitionId: "project_definition_1",
      loopVersionId: "project_version_1",
      scope: "project",
      graph: {
        schemaVersion: 1,
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        limits: { maxStages: 3, maxRepeatCount: 2 },
        nodes: [
          { key: "start", nodeId: "project_start", label: "Start", type: "start" },
          {
            key: "develop",
            nodeId: "project_develop",
            label: "Develop",
            type: "subloop_call",
            executionTarget: "platform",
            targetLoopDefinitionId: "task_definition_1",
            targetLoopVersionId: "task_version_1",
            inputMapping: {},
            terminalOutcomeMapping: { success: "success", failure: "failure" },
          },
          { key: "end", nodeId: "project_end", label: "End", type: "end" },
        ],
        edges: [
          { id: "start-develop", source: "start", target: "develop", kind: "normal", outcome: "success" },
          { id: "develop-end", source: "develop", target: "end", kind: "normal", outcome: "success" },
        ],
      },
    },
    {
      loopDefinitionId: "task_definition_1",
      loopVersionId: "task_version_1",
      scope: "task",
      graph: runtimeGraph,
    },
  ],
});
const gateGraph = {
  schemaVersion: 1,
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  limits: { maxStages: 3, maxRepeatCount: 2 },
  nodes: [
    { key: "start", label: "Start", type: "start" },
    { key: "review", label: "Review", type: "policy_gate", executionTarget: "platform" },
    { key: "end", label: "End", type: "end" },
  ],
  edges: [
    { id: "start-review", source: "start", target: "review", kind: "normal", outcome: "success" },
    { id: "review-end", source: "review", target: "end", kind: "normal", outcome: "pass" },
    { id: "review-rework", source: "review", target: "start", kind: "feedback", outcome: "rework", maxTraversals: 2 },
  ],
} satisfies LoopGraph;
const nonGatePassGraph = {
  ...runtimeGraph,
  edges: runtimeGraph.edges.map((edge) => (
    edge.id === "edge_next" ? { ...edge, outcome: "pass" as const } : edge
  )),
} satisfies LoopGraph;

describe("graph loop runtime repositories", () => {
  it("stores Loop execution phase snapshots and attempt-bound live sessions", () => {
    const schema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
    const liveSessionSchema = schema.match(/model LiveSession \{[\s\S]*?\n\}/u)?.[0] ?? "";
    const attemptSchema = schema.match(/model LoopNodeAttempt \{[\s\S]*?\n\}/u)?.[0] ?? "";

    for (const field of [
      /loopNodeRunId\s+String\?\s+@db\.VarChar\(96\)/u,
      /loopNodeAttemptId\s+String\?\s+@db\.VarChar\(128\)/u,
      /leaseGeneration\s+Int\?/u,
      /streamMode\s+String\s+@default\("tui"\)\s+@db\.VarChar\(24\)/u,
      /autoCreated\s+Boolean\s+@default\(false\)/u,
      /activeViewerCount\s+Int\s+@default\(0\)/u,
    ]) {
      expect(liveSessionSchema).toMatch(field);
    }
    expect(liveSessionSchema).toContain("@@unique([loopNodeAttemptId, leaseGeneration, autoCreated])");

    for (const field of [
      /executionPhase\s+String\?\s+@db\.VarChar\(64\)/u,
      /executionPhaseStatus\s+String\?\s+@db\.VarChar\(24\)/u,
      /executionPhaseStartedAt\s+DateTime\?/u,
      /executionPhaseFinishedAt\s+DateTime\?/u,
      /executionPhaseCode\s+String\?\s+@db\.VarChar\(64\)/u,
      /executionPhaseSummary\s+String\?\s+@db\.VarChar\(512\)/u,
      /executionPhaseUpdatedAt\s+DateTime\?/u,
    ]) {
      expect(attemptSchema).toMatch(field);
    }
  });

  it("recovers the existing runtime intervention without applying a second state transition", async () => {
    const receipts = new Map<string, { id: string; status: string; result: unknown }>();
    const tx = {
      commandReceipt: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => receipts.get(where.id) ?? null),
        create: vi.fn(async ({ data }: { data: { id: string; status: string } }) => {
          receipts.set(data.id, { id: data.id, status: data.status, result: null });
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: { status: string; result: unknown } }) => {
          receipts.set(where.id, { id: where.id, status: data.status, result: data.result });
        }),
      },
      loopNodeAttempt: {
        findUnique: vi.fn().mockResolvedValue({
          id: "attempt_1",
          attempt: 1,
          status: "blocked",
          version: 2,
          loopNodeRunId: "node_run_1",
          loopNodeRun: {
            id: "node_run_1",
            loopRunId: "loop_run_1",
            nodeKey: "implement",
            activationNo: 1,
            attemptCount: 1,
            status: "waiting_intervention",
            version: 5,
            loopRun: {
              id: "loop_run_1",
              projectId: "project_1",
              taskId: "task_1",
              status: "waiting",
              statusReason: "intervention:manual_request",
              version: 8,
              projectionVersion: 4,
              task: { assigneeUserId: "user_1", createdById: "user_2" },
            },
          },
        }),
        updateMany: vi.fn(),
      },
      loopNodeRun: { updateMany: vi.fn() },
      loopRun: { updateMany: vi.fn() },
      workflowInteraction: {
        findUnique: vi.fn().mockResolvedValue({ id: "interaction_1", status: "open", version: 2 }),
      },
      orchestrationAggregateSequence: { upsert: vi.fn() },
      orchestrationEvent: { createMany: vi.fn() },
      outboxMessage: { createMany: vi.fn() },
    };
    const db = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    };

    for (const commandId of ["cmd_intervention_1", "cmd_intervention_2"]) {
      await expect(requestRuntimeIntervention({
        loopNodeAttemptId: "attempt_1",
        actor: { type: "user", id: "user_1" },
        commandId,
        reason: "需要补充手机 App 源码",
        occurredAt: now,
      }, { db: db as never })).resolves.toMatchObject({
        interactionId: "interaction_1",
        recovered: true,
      });
    }

    expect(tx.loopNodeAttempt.updateMany).not.toHaveBeenCalled();
    expect(tx.loopNodeRun.updateMany).not.toHaveBeenCalled();
    expect(tx.loopRun.updateMany).not.toHaveBeenCalled();
    expect(tx.orchestrationEvent.createMany).not.toHaveBeenCalled();
    expect(tx.outboxMessage.createMany).not.toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });

  it("fences the active Attempt and opens one runtime intervention atomically", async () => {
    let createdInteraction = false;
    let messageSequence = 0;
    const tx = {
      commandReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
      loopNodeAttempt: {
        findUnique: vi.fn().mockResolvedValue({
          id: "attempt_1",
          attempt: 1,
          status: "running",
          version: 1,
          loopNodeRunId: "node_run_1",
          loopNodeRun: {
            id: "node_run_1",
            loopRunId: "loop_run_1",
            nodeKey: "implement",
            activationNo: 1,
            attemptCount: 1,
            status: "running",
            version: 4,
            loopRun: {
              id: "loop_run_1",
              projectId: "project_1",
              taskId: "task_1",
              status: "running",
              statusReason: null,
              version: 7,
              projectionVersion: 3,
              task: { assigneeUserId: "user_1", createdById: "user_2" },
            },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      loopNodeRun: {
        findUnique: vi.fn().mockResolvedValue({
          id: "node_run_1",
          loopRunId: "loop_run_1",
          activationNo: 1,
          status: "waiting_intervention",
          loopRun: { id: "loop_run_1", projectId: "project_1", taskId: "task_1", status: "waiting" },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      loopRun: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      workflowInteraction: {
        findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          if ("loopNodeRunId_activationNo_kind" in where) return null;
          if (!createdInteraction) return null;
          return {
            id: "workflow-interaction:node_run_1:1:runtime_intervention",
            status: "open",
            version: 1,
            messageSequence,
          };
        }),
        create: vi.fn(async () => {
          createdInteraction = true;
          return {};
        }),
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (data.messageSequence) messageSequence += 1;
          return { count: 1 };
        }),
      },
      workflowInteractionMessage: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      workflowInteractionAttachment: { updateMany: vi.fn() },
      workflowInteractionMention: { createMany: vi.fn() },
      notificationIntent: {
        findUnique: vi.fn().mockResolvedValue(null),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      orchestrationAggregateSequence: { upsert: vi.fn().mockResolvedValue({ sequence: 1 }) },
      orchestrationEvent: { createMany: vi.fn().mockResolvedValue({ count: 4 }) },
      outboxMessage: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const db = { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };

    await expect(requestRuntimeIntervention({
      loopNodeAttemptId: "attempt_1",
      actor: { type: "user", id: "user_1" },
      commandId: "cmd_intervention_1",
      reason: "缺少手机 App 源码",
      evidence: { issueType: "MOBILE_SOURCE_UNAVAILABLE" },
      reviewPages: [{ token: "b".repeat(32), fileName: "plan.html", byteSize: 12, checksum: "c".repeat(64) }],
      occurredAt: now,
    }, { db: db as never })).resolves.toMatchObject({
      status: "open",
      version: 1,
      recovered: false,
    });

    expect(tx.loopNodeAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "blocked" }),
    }));
    // A human interaction is a normal part of execution: it parks the Attempt
    // as blocked and must not consume the node's retry budget.
    const attemptUpdate = tx.loopNodeAttempt.updateMany.mock.calls.at(0)?.[0] as { data: Record<string, unknown> };
    expect(attemptUpdate.data).not.toHaveProperty("attempt");
    const nodeUpdate = tx.loopNodeRun.updateMany.mock.calls.at(0)?.[0] as { data: Record<string, unknown> };
    expect(nodeUpdate.data).not.toHaveProperty("attemptCount");
    expect(tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "waiting_intervention" }),
    }));
    expect(tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "waiting" }),
    }));
    expect(tx.workflowInteraction.create).toHaveBeenCalledTimes(1);
    // Only proxy references are persisted; the page body stays out of the
    // platform record entirely.
    expect(tx.workflowInteraction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        policySnapshot: expect.objectContaining({
          reviewPages: [{ token: "b".repeat(32), fileName: "plan.html", byteSize: 12, checksum: "c".repeat(64) }],
        }),
      }),
    }));
    expect(tx.workflowInteractionMessage.create).toHaveBeenCalledTimes(1);
    expect(tx.commandReceipt.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "completed" }),
    }));
  });

  it("retains validated root and current-node retry policies for failure decisions", () => {
    const graph = parsePublishedLoopVersionGraph(runtimeGraph);

    expect(graph.retryPolicy).toEqual({ maxRetries: 4 });
    expect(graph.nodes.find((node) => node.key === "implement")?.retryPolicy)
      .toEqual({ maxRetries: 1 });
  });

  it("claims a platform attempt with an expiring fenced token", async () => {
    const attempt = {
      id: "attempt_platform_1",
      loopNodeRunId: "node_run_1",
      attempt: 1,
      executorType: "platform",
      status: "running",
      agentRunId: null,
      claimToken: null,
      claimExpiresAt: null,
      version: 1,
      loopNodeRun: {
        id: "node_run_1",
        loopRunId: "loop_run_1",
        nodeKey: "next",
        version: 2,
        status: "running",
        inputSnapshot: { task: "write" },
        loopRun: {
          id: "loop_run_1",
          projectId: "project_1",
          engineKind: "graph_v1",
          status: "running",
          binding: { createdByUserId: "user_1" },
          loopVersion: { graph: runtimeGraph },
        },
      },
    };
    const tx = {
      loopNodeAttempt: {
        findUnique: vi.fn().mockResolvedValue(attempt),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const db = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    };

    await expect(claimPlatformLoopAttempt({
      loopRunId: "loop_run_1",
      projectId: "project_1",
      nodeRunId: "node_run_1",
      attemptId: "attempt_platform_1",
      attemptNo: 1,
      nodeKey: "next",
      claimToken: "claim_1",
      now,
      claimExpiresAt: new Date("2026-07-29T08:01:00.000Z"),
    }, { db: db as never })).resolves.toEqual(expect.objectContaining({
      loopRunId: "loop_run_1",
      projectId: "project_1",
      actorUserId: "user_1",
      nodeRunVersion: 2,
      attemptVersion: 2,
      claimToken: "claim_1",
      node: expect.objectContaining({ key: "next", type: "platform_action" }),
    }));

    expect(tx.loopNodeAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "attempt_platform_1",
        status: "running",
        version: 1,
        OR: [{ claimToken: null }, { claimExpiresAt: { lte: now } }],
      }),
      data: expect.objectContaining({
        claimToken: "claim_1",
        version: { increment: 1 },
      }),
    }));
  });

  it("persists a platform timer wait across Attempt, NodeRun, Run, and event state", async () => {
    const fixture = createFixture({
      attemptExecutorType: "platform",
      attemptAgentRunId: null,
      nodeRunStatus: "running",
    });
    const wakeAt = new Date("2026-07-29T08:05:00.000Z");

    await expect(waitPlatformLoopAttempt({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 4,
      attemptId: "attempt_1",
      attemptNo: 1,
      attemptVersion: 1,
      claimToken: "claim_1",
      waitingReason: "timer",
      wakeAt,
      occurredAt: now,
      correlationId: "loop:loop_run_1",
      actor: { type: "system", id: "loop-platform-executor" },
    }, fixture.dependencies)).resolves.toBeUndefined();

    expect(fixture.tx.loopNodeAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "attempt_1",
        executorType: "platform",
        claimToken: "claim_1",
        claimExpiresAt: { gt: now },
      }),
      data: expect.objectContaining({
        status: "waiting",
        checkpoint: { waitingReason: "timer", wakeAt: wakeAt.toISOString() },
        claimToken: null,
      }),
    }));
    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "waiting_input", waitingReason: "timer" }),
    }));
    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "waiting", projectionVersion: { increment: 1 } }),
    }));
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ eventType: "loop.node.waiting" })],
    }));
  });

  it("persists only the hash for an authenticated callback wait", async () => {
    const fixture = createFixture({
      attemptExecutorType: "platform",
      attemptAgentRunId: null,
      nodeRunStatus: "running",
    });

    await expect(waitPlatformLoopAttempt({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 4,
      attemptId: "attempt_1",
      attemptNo: 1,
      attemptVersion: 1,
      claimToken: "claim_1",
      waitingReason: "callback",
      callbackId: "attempt_1",
      secretHash: "a".repeat(64),
      occurredAt: now,
      correlationId: "loop:loop_run_1",
      actor: { type: "system", id: "loop-platform-executor" },
    }, fixture.dependencies)).resolves.toBeUndefined();

    expect(fixture.tx.loopNodeAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "waiting",
        checkpoint: {
          waitingReason: "callback",
          callbackId: "attempt_1",
          secretHash: "a".repeat(64),
        },
      }),
    }));
  });

  it("persists a child-loop wait without callback credentials", async () => {
    const fixture = createFixture({
      attemptExecutorType: "platform",
      attemptAgentRunId: null,
      nodeRunStatus: "running",
    });

    await expect(waitPlatformLoopAttempt({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 4,
      attemptId: "attempt_1",
      attemptNo: 1,
      attemptVersion: 1,
      claimToken: "claim_1",
      waitingReason: "child_loop",
      childLoopRunId: "child_run_1",
      occurredAt: now,
      correlationId: "loop:loop_run_1",
      actor: { type: "system", id: "loop-platform-executor" },
    }, fixture.dependencies)).resolves.toBeUndefined();

    expect(fixture.tx.loopNodeAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "waiting",
        checkpoint: { waitingReason: "child_loop", childLoopRunId: "child_run_1" },
      }),
    }));
    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "waiting_input", waitingReason: "child_loop" }),
    }));
  });

  it.each([
    ["completed", "success"],
    ["succeeded", "success"],
    ["failed", "failure"],
    ["exhausted", "failure"],
    ["cancelled", "failure"],
    ["rejected", "failure"],
  ] as const)("resumes a parent once when its child becomes %s", async (childStatus, outcome) => {
    const fixture = createChildLoopResumeFixture({ childStatus });

    await expect(resumeParentAfterChildLoop({
      childLoopRunId: "child_run_1",
      occurredAt: now,
      correlationId: "loop:child_run_1",
      actor: { type: "system", id: "loop-child-resumer" },
    }, fixture.dependencies)).resolves.toEqual({ resumed: true, duplicate: false });

    expect(fixture.resume).toHaveBeenCalledWith(expect.objectContaining({
      loopRunId: "parent_run_1",
      nodeRunId: "parent_node_1",
      attemptId: "parent_attempt_1",
      commandId: `child-loop:child_run_1:${childStatus}`,
      waitingReason: "child_loop",
      childLoopRunId: "child_run_1",
      result: expect.objectContaining({
        outcome,
        output: { childLoopRunId: "child_run_1", childStatus },
      }),
    }));
  });

  it("ignores a non-terminal child and preserves duplicate completion", async () => {
    const running = createChildLoopResumeFixture({ childStatus: "running" });
    await expect(resumeParentAfterChildLoop({
      childLoopRunId: "child_run_1",
      occurredAt: now,
      correlationId: "loop:child_run_1",
      actor: { type: "system", id: "loop-child-resumer" },
    }, running.dependencies)).resolves.toEqual({ resumed: false, duplicate: false });
    expect(running.resume).not.toHaveBeenCalled();

    const duplicate = createChildLoopResumeFixture({ childStatus: "completed", duplicate: true });
    await expect(resumeParentAfterChildLoop({
      childLoopRunId: "child_run_1",
      occurredAt: now,
      correlationId: "loop:child_run_1",
      actor: { type: "system", id: "loop-child-resumer" },
    }, duplicate.dependencies)).resolves.toEqual({ resumed: false, duplicate: true });
  });

  it("copies child review Artifacts into the waiting parent result", async () => {
    const artifact = {
      id: "a".repeat(32),
      storageKey: `loop-review-artifacts/${"b".repeat(32)}/${"a".repeat(32)}.html`,
      mimeType: "text/html",
      byteSize: BigInt(4096),
      metadata: {
        fileName: "TASK-1001-chapter-plan.html",
        relativePath: "generated/reviews/TASK-1001-chapter-plan.html",
        checksum: "c".repeat(64),
        source: "agent_review",
      },
    };
    const fixture = createChildLoopResumeFixture({
      childStatus: "completed",
      reviewArtifacts: [artifact],
    });

    await expect(resumeParentAfterChildLoop({
      childLoopRunId: "child_run_1",
      occurredAt: now,
      correlationId: "loop:child_run_1",
      actor: { type: "system", id: "loop-child-resumer" },
    }, fixture.dependencies)).resolves.toEqual({ resumed: true, duplicate: false });

    expect(fixture.resume).toHaveBeenCalledWith(expect.objectContaining({
      result: {
        outcome: "success",
        output: {
          childLoopRunId: "child_run_1",
          childStatus: "completed",
          reviewArtifacts: [{
            artifactId: artifact.id,
            fileName: "TASK-1001-chapter-plan.html",
            mimeType: "text/html",
            byteSize: 4096,
            checksum: "c".repeat(64),
          }],
        },
        artifactRefs: [artifact.storageKey],
        effectReceipts: [],
      },
    }));
  });

  it("rejects a child whose parent checkpoint points at another run", async () => {
    const fixture = createChildLoopResumeFixture({
      childStatus: "completed",
      checkpointChildLoopRunId: "child_run_other",
    });

    await expect(resumeParentAfterChildLoop({
      childLoopRunId: "child_run_1",
      occurredAt: now,
      correlationId: "loop:child_run_1",
      actor: { type: "system", id: "loop-child-resumer" },
    }, fixture.dependencies)).rejects.toMatchObject({ code: "stale_lease" });
    expect(fixture.resume).not.toHaveBeenCalled();
  });

  it.each(["v1", "v2"] as const)("resumes the failed child at its last failed node for a %s snapshot without changing the waiting parent", async (snapshotVersion) => {
    expect("retryFailedChildLoop" in loopRuntime).toBe(true);
    if (!("retryFailedChildLoop" in loopRuntime)) return;

    const tx = {
      loopRun: {
        findUnique: vi.fn().mockResolvedValue({
          id: "child_run_1",
          status: "failed",
          version: 4,
          projectionVersion: 6,
          finishedAt: now,
          loopVersionId: "task_loop_version_1",
          inputSnapshot: { taskId: "task_1", taskBranch: "2026-HT100014" },
          runGraphSnapshot: {
            ...(snapshotVersion === "v2" ? { schemaVersion: 2 } : {}),
            snapshotId: "snapshot_child_1",
            graphDigest: `sha256:${"a".repeat(64)}`,
            rootLoopVersionId: "task_loop_version_1",
            reachableNodeIds: ["analyze_requirement", "write_plan"],
            loopVersions: [{
              loopDefinitionId: "task_loop_definition_1",
              loopVersionId: "task_loop_version_1",
              scope: "task",
              graph: {
                schemaVersion: snapshotVersion === "v2" ? 2 : 1,
                limits: { maxStages: 4, maxRepeatCount: 2 },
                nodes: [
                  {
                    key: "analyze_requirement",
                    nodeId: "analyze_requirement",
                    label: "Analyze",
                    type: "agent_action",
                    executionTarget: "local",
                    offlinePolicy: "local_capable",
                    ...(snapshotVersion === "v2" ? { responsibility: "Analyze", allowedRouteTargets: ["write_plan"] } : {}),
                  },
                  {
                    key: "write_plan",
                    nodeId: "write_plan",
                    label: "Plan",
                    type: "agent_action",
                    executionTarget: "local",
                    offlinePolicy: "local_capable",
                    ...(snapshotVersion === "v2" ? { responsibility: "Plan", allowedRouteTargets: ["analyze_requirement"] } : {}),
                  },
                ],
                edges: [
                  { id: "analyze-plan", source: "analyze_requirement", target: "write_plan", kind: "normal", outcome: "success" },
                  { id: "plan-analyze", source: "write_plan", target: "analyze_requirement", kind: "feedback", outcome: "rework", maxTraversals: 2 },
                ],
              },
            }],
          },
          parentLoopRunId: "parent_run_1",
          parentNodeRunId: "parent_node_1",
          parentAttemptId: "parent_attempt_1",
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      loopNodeAttempt: {
        findUnique: vi.fn().mockResolvedValue({
          id: "parent_attempt_1",
          attempt: 1,
          status: "waiting",
          version: 3,
          checkpoint: { waitingReason: "child_loop", childLoopRunId: "child_run_1" },
          loopNodeRun: {
            id: "parent_node_1",
            loopRunId: "parent_run_1",
            nodeKey: "develop",
            activationNo: 1,
            status: "waiting_input",
            version: 5,
            inputSnapshot: { taskId: "task_1" },
            loopRun: {
              id: "parent_run_1",
              engineKind: "graph_v1",
              status: "waiting",
              version: 7,
              projectionVersion: 9,
            },
          },
        }),
        count: vi.fn().mockResolvedValue(2),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      loopNodeRun: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({
            id: "child_node_analyze_1",
            loopRunId: "child_run_1",
            nodeKey: "analyze_requirement",
            activationNo: 1,
            status: "failed",
            finishedAt: now,
            inputSnapshot: { requirementSnapshot: "snapshot_1" },
          })
          .mockResolvedValueOnce({
            activationNo: 3,
            inputSnapshot: { issueType: "PREPARED" },
          })
          .mockResolvedValueOnce({
            structuredOutput: { testReport: "artifacts/test/test-report.json" },
          }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({ id: "child_node_analyze_2" }),
      },
      orchestrationAggregateSequence: { upsert: vi.fn().mockResolvedValue({ sequence: 6 }) },
      orchestrationEvent: {
        findUnique: vi.fn().mockResolvedValue(null),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      outboxMessage: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
    };
    const db = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const retryFailedChildLoop = loopRuntime.retryFailedChildLoop as (input: unknown, dependencies: unknown) => Promise<unknown>;

    await expect(retryFailedChildLoop({
      childLoopRunId: "child_run_1",
      commandId: "retry_child_1",
      occurredAt: now,
      correlationId: "loop:parent_run_1",
      actor: { type: "user", id: "user_1" },
      targetNodeId: "write_plan",
    }, { db })).resolves.toEqual({
      parentLoopRunId: "parent_run_1",
      childLoopRunId: "child_run_1",
      nodeRunId: expect.any(String),
      activationNo: 4,
      duplicate: false,
    });

    expect(tx.loopNodeAttempt.updateMany).not.toHaveBeenCalled();
    expect(tx.loopNodeRun.updateMany).not.toHaveBeenCalled();
    expect(tx.loopNodeRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        loopRunId: "child_run_1",
        nodeKey: "write_plan",
        activationNo: 4,
        status: "ready",
        inputSnapshot: { testReport: "artifacts/test/test-report.json" },
      }),
    });
    expect(tx.loopNodeRun.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { loopRunId: "child_run_1", status: "failed", finishedAt: now },
    }));
    expect(tx.loopNodeRun.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { loopRunId: "child_run_1", nodeKey: "write_plan" },
      select: { activationNo: true, inputSnapshot: true },
    }));
    expect(tx.loopNodeRun.findFirst).toHaveBeenNthCalledWith(3, expect.objectContaining({
      where: expect.objectContaining({
        loopRunId: "child_run_1",
        status: "succeeded",
        selectedEdgeId: { in: ["analyze-plan"] },
      }),
      select: { structuredOutput: true },
    }));
    expect(tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "child_run_1", status: "failed", version: 4 }),
      data: expect.objectContaining({ status: "running" }),
    }));

    tx.orchestrationEvent.findUnique.mockResolvedValue({
      payload: {
        parentLoopRunId: "parent_run_1",
        failedChildLoopRunId: "child_run_1",
        nodeRunId: "child_node_analyze_2",
        activationNo: 4,
        nodeKey: "write_plan",
      },
    });
    await expect(retryFailedChildLoop({
      childLoopRunId: "child_run_1",
      commandId: "retry_child_1",
      occurredAt: now,
      correlationId: "loop:parent_run_1",
      actor: { type: "user", id: "user_1" },
      targetNodeId: "write_plan",
    }, { db })).resolves.toEqual({
      parentLoopRunId: "parent_run_1",
      childLoopRunId: "child_run_1",
      nodeRunId: "child_node_analyze_2",
      activationNo: 4,
      duplicate: true,
    });
    expect(tx.loopNodeAttempt.updateMany).not.toHaveBeenCalled();
    expect(tx.loopNodeRun.create).toHaveBeenCalledOnce();

    await expect(retryFailedChildLoop({
      childLoopRunId: "child_run_other",
      commandId: "retry_child_1",
      occurredAt: now,
      correlationId: "loop:parent_run_1",
      actor: { type: "user", id: "user_1" },
    }, { db })).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("returns the persisted retry after a concurrent stale write loses", async () => {
    expect("retryFailedChildLoop" in loopRuntime).toBe(true);
    if (!("retryFailedChildLoop" in loopRuntime)) return;
    const replayTx = {
      orchestrationEvent: {
        findUnique: vi.fn().mockResolvedValue({
          payload: {
            parentLoopRunId: "parent_run_1",
            childLoopRunId: "child_run_1",
            nodeRunId: "child_node_2",
            activationNo: 2,
          },
        }),
      },
    };
    const db = {
      $transaction: vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error("stale"), { code: "stale_lease" }))
        .mockImplementationOnce(async (callback: (tx: typeof replayTx) => Promise<unknown>) => callback(replayTx)),
    };
    const retryFailedChildLoop = loopRuntime.retryFailedChildLoop as (input: unknown, dependencies: unknown) => Promise<unknown>;

    await expect(retryFailedChildLoop({
      childLoopRunId: "child_run_1",
      commandId: "retry_child_concurrent",
      occurredAt: now,
      correlationId: "loop:parent_run_1",
      actor: { type: "user", id: "user_1" },
    }, { db })).resolves.toEqual({
      parentLoopRunId: "parent_run_1",
      childLoopRunId: "child_run_1",
      nodeRunId: "child_node_2",
      activationNo: 2,
      duplicate: true,
    });
  });

  it("resumes a due timer once and treats the same command as an idempotent replay", async () => {
    const fixture = createFixture({
      attemptExecutorType: "platform",
      attemptAgentRunId: null,
      attemptStatus: "waiting",
      attemptCheckpoint: { waitingReason: "timer", wakeAt: "2026-07-29T07:59:00.000Z" },
      nodeRunStatus: "waiting_input",
      runStatus: "waiting",
    });
    const input = waitingResumeInput({
      commandId: "timer:attempt_1:2026-07-29T07:59:00.000Z",
      waitingReason: "timer",
    });

    await expect(resumeWaitingLoopNode(input, fixture.dependencies)).resolves.toEqual({
      completed: true,
      duplicate: false,
    });
    await expect(resumeWaitingLoopNode(input, fixture.dependencies)).resolves.toEqual({
      completed: false,
      duplicate: true,
    });

    expect(fixture.snapshot()).toMatchObject({
      attemptStatus: "succeeded",
      nodeRunStatus: "succeeded",
      loopRunStatus: "running",
      orchestrationEventCount: 1,
    });
  });

  it("rolls back waiting completion when the durable event outbox append fails", async () => {
    const fixture = createFixture({
      attemptExecutorType: "platform",
      attemptAgentRunId: null,
      attemptStatus: "waiting",
      attemptCheckpoint: { waitingReason: "timer", wakeAt: "2026-07-29T07:59:00.000Z" },
      nodeRunStatus: "waiting_input",
      runStatus: "waiting",
    });
    fixture.failNextOutbox();

    await expect(resumeWaitingLoopNode(waitingResumeInput({
      commandId: "timer:attempt_1:2026-07-29T07:59:00.000Z",
      waitingReason: "timer",
    }), fixture.dependencies)).rejects.toThrow("Injected outbox failure");

    expect(fixture.snapshot()).toEqual({
      agentRunStatus: "running",
      attemptStatus: "waiting",
      nodeRunStatus: "waiting_input",
      loopRunStatus: "waiting",
      orchestrationEventCount: 0,
    });
  });

  it("requires the stored one-time callback hash before resuming", async () => {
    const fixture = createFixture({
      attemptExecutorType: "platform",
      attemptAgentRunId: null,
      attemptStatus: "waiting",
      attemptCheckpoint: {
        waitingReason: "callback",
        callbackId: "attempt_1",
        secretHash: "a".repeat(64),
      },
      nodeRunStatus: "waiting_input",
      runStatus: "waiting",
    });

    await expect(resumeWaitingLoopNode(waitingResumeInput({
      commandId: "callback_command_bad",
      waitingReason: "callback",
      callbackId: "attempt_1",
      secretHash: "b".repeat(64),
    }), fixture.dependencies)).rejects.toMatchObject({ code: "policy_denied" });
    expect(fixture.snapshot()).toMatchObject({
      attemptStatus: "waiting",
      nodeRunStatus: "waiting_input",
      loopRunStatus: "waiting",
      orchestrationEventCount: 0,
    });

    await expect(resumeWaitingLoopNode(waitingResumeInput({
      commandId: "callback_command_1",
      waitingReason: "callback",
      callbackId: "attempt_1",
      secretHash: "a".repeat(64),
    }), fixture.dependencies)).resolves.toEqual({ completed: true, duplicate: false });
  });

  it("authenticates callback replays and rejects a new command after completion", async () => {
    const fixture = createFixture({
      attemptExecutorType: "platform",
      attemptAgentRunId: null,
      attemptStatus: "waiting",
      attemptCheckpoint: {
        waitingReason: "callback",
        callbackId: "attempt_1",
        secretHash: "a".repeat(64),
      },
      nodeRunStatus: "waiting_input",
      runStatus: "waiting",
    });
    const completed = waitingResumeInput({
      commandId: "callback_command_1",
      waitingReason: "callback",
      callbackId: "attempt_1",
      secretHash: "a".repeat(64),
    });

    await expect(resumeWaitingLoopNode(completed, fixture.dependencies)).resolves.toEqual({
      completed: true,
      duplicate: false,
    });
    await expect(resumeWaitingLoopNode({
      ...completed,
      secretHash: "b".repeat(64),
    }, fixture.dependencies)).rejects.toMatchObject({ code: "policy_denied" });
    await expect(resumeWaitingLoopNode(completed, fixture.dependencies)).resolves.toEqual({
      completed: false,
      duplicate: true,
    });
    await expect(resumeWaitingLoopNode({
      ...completed,
      commandId: "callback_command_2",
    }, fixture.dependencies)).rejects.toMatchObject({ code: "stale_lease" });

    expect(fixture.snapshot()).toMatchObject({
      attemptStatus: "succeeded",
      nodeRunStatus: "succeeded",
      loopRunStatus: "running",
      orchestrationEventCount: 1,
    });
  });

  it("resolves a public callback id to its fenced waiting identity", async () => {
    const resume = vi.fn().mockResolvedValue({ completed: true, duplicate: false });
    const db = {
      loopNodeAttempt: {
        findUnique: vi.fn().mockResolvedValue({
          id: "attempt_1",
          attempt: 2,
          version: 4,
          loopNodeRun: {
            id: "node_run_1",
            loopRunId: "loop_run_1",
            version: 6,
          },
        }),
      },
    };

    await expect(resumeLoopCallback({
      loopRunId: "loop_run_1",
      callbackId: "attempt_1",
      commandId: "callback_command_1",
      secretHash: "a".repeat(64),
      result: { outcome: "success", output: { approved: true }, artifactRefs: [], effectReceipts: [] },
      occurredAt: now,
      correlationId: "loop:loop_run_1",
      actor: { type: "system", id: "loop-callback" },
    }, { db: db as never, resume })).resolves.toEqual({ completed: true, duplicate: false });

    expect(resume).toHaveBeenCalledWith(expect.objectContaining({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 6,
      attemptId: "attempt_1",
      attemptNo: 2,
      attemptVersion: 4,
      waitingReason: "callback",
    }));
  });

  it("creates a receipt, graph run, event, and outbox atomically", async () => {
    const fixture = createFixture();

    const result = await createGraphLoopRun(createRunInput(), fixture.dependencies);

    expect(result).toEqual({ id: "loop_run_1", engineKind: "graph_v1" });
    expect(fixture.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(fixture.tx.projectLoopBinding.findUnique).toHaveBeenCalledWith({
      where: { id: "binding_1" },
      select: {
        id: true,
        projectId: true,
        loopDefinitionId: true,
        status: true,
        version: true,
        activeVersionId: true,
        loopDefinition: { select: { status: true } },
      },
    });
    expect(fixture.tx.triggerReceipt.create).toHaveBeenCalledOnce();
    expect(fixture.tx.loopRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "loop_run_1",
        engineKind: "graph_v1",
        triggerReceiptId: "trigger_receipt_1",
        transitionCount: 0,
        repeatCount: 0,
        usageAggregate: { transitions: 0, repeats: 0, edgeTraversals: {} },
      }),
    });
    const persistedData = fixture.tx.loopRun.create.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(persistedData).not.toHaveProperty("runGraphSnapshot");
    expect(persistedData).not.toHaveProperty("graphDigest");
    expect(persistedData).not.toHaveProperty("snapshotVersion");
    expect(fixture.tx.loopNodeRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "loop-node:loop_run_1:start:1",
        loopRunId: "loop_run_1",
        nodeKey: "start",
        activationNo: 1,
        status: "ready",
        inputSnapshot: { request: "run" },
      }),
    });
    expect(fixture.tx.orchestrationAggregateSequence.upsert).toHaveBeenCalledWith({
      where: { aggregateType_aggregateId: { aggregateType: "run", aggregateId: "loop_run_1" } },
      create: { aggregateType: "run", aggregateId: "loop_run_1", sequence: 1 },
      update: { sequence: { increment: 1 } },
    });
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledOnce();
    expect(fixture.tx.orchestrationEvent.createMany.mock.calls[0]?.[0].data).toHaveLength(2);
    expect(fixture.tx.outboxMessage.createMany).toHaveBeenCalledOnce();
    expect(fixture.tx.outboxMessage.createMany.mock.calls[0]?.[0].data).toHaveLength(2);
  });

  it("persists the supplied immutable graph snapshot identity on a new run", async () => {
    const fixture = createFixture();

    await createGraphLoopRun({ ...createRunInput(), runGraphSnapshot }, fixture.dependencies);

    expect(fixture.tx.loopRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        runGraphSnapshot,
        graphDigest: runGraphSnapshot.graphDigest,
        snapshotVersion: 1,
      }),
    });
  });

  it("persists the supplied scheduled task run association on a new run", async () => {
    const fixture = createFixture();

    await createGraphLoopRun({
      ...createRunInput(),
      scheduledTaskRunId: "a".repeat(32),
    }, fixture.dependencies);

    expect(fixture.tx.loopRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scheduledTaskRunId: "a".repeat(32),
      }),
    });
  });

  it.each([
    {
      label: "a mismatched lease token",
      fenceToken: "b".repeat(32),
      expiresAt: new Date(now.getTime() + 60_000),
    },
    {
      label: "an expired preparation lease",
      fenceToken: "a".repeat(32),
      expiresAt: new Date(now.getTime() - 1),
    },
  ])("rejects $label without creating a LoopRun", async ({ fenceToken, expiresAt }) => {
    const scheduledTaskRunId = "a".repeat(32);
    const fixture = createFixture({
      scheduledTaskPreparationRunState: {
        id: scheduledTaskRunId,
        status: "preparing",
        version: 3,
        preparationLeaseToken: "a".repeat(32),
        preparationLeaseExpiresAt: expiresAt,
      },
    });

    await expect(createGraphLoopRun({
      ...createRunInput(),
      scheduledTaskRunId,
      scheduledTaskPreparationFence: {
        scheduledTaskRunId,
        expectedVersion: 3,
        leaseToken: fenceToken,
        now,
      },
    }, fixture.dependencies)).rejects.toMatchObject({ code: "preparation_lease_lost" });

    expect(fixture.tx.projectScheduledTaskRun.findUnique).toHaveBeenCalledWith({
      where: { id: scheduledTaskRunId },
      select: {
        id: true,
        status: true,
        version: true,
        preparationLeaseToken: true,
        preparationLeaseExpiresAt: true,
      },
    });
    expect(fixture.tx.loopRun.create).not.toHaveBeenCalled();
  });

  it("rejects a stale trigger after recovery claims a newer preparation lease", async () => {
    const scheduledTaskRunId = "a".repeat(32);
    let ledger = {
      id: scheduledTaskRunId,
      status: "preparing",
      version: 1,
      preparationLeaseToken: "b".repeat(32),
      preparationLeaseExpiresAt: new Date(now.getTime() - 1),
    };
    const fixture = createFixture({ scheduledTaskPreparationRunState: ledger });

    ledger = {
      ...ledger,
      version: ledger.version + 1,
      preparationLeaseToken: "c".repeat(32),
      preparationLeaseExpiresAt: new Date(now.getTime() + 60_000),
    };
    fixture.tx.projectScheduledTaskRun.findUnique.mockImplementation(async () => ledger);

    await expect(createGraphLoopRun({
      ...createRunInput(),
      scheduledTaskRunId,
      scheduledTaskPreparationFence: {
        scheduledTaskRunId,
        expectedVersion: 1,
        leaseToken: "b".repeat(32),
        now,
      },
    }, fixture.dependencies)).rejects.toMatchObject({ code: "preparation_lease_lost" });

    expect(ledger).toMatchObject({
      version: 2,
      preparationLeaseToken: "c".repeat(32),
    });
    expect(fixture.tx.loopRun.create).not.toHaveBeenCalled();
  });

  it("creates with the current preparation fence and repeats idempotently", async () => {
    const scheduledTaskRunId = "a".repeat(32);
    const fixture = createFixture({
      scheduledTaskPreparationRunState: {
        id: scheduledTaskRunId,
        status: "preparing",
        version: 3,
        preparationLeaseToken: "b".repeat(32),
        preparationLeaseExpiresAt: new Date(now.getTime() + 60_000),
      },
    });
    const input = {
      ...createRunInput(),
      scheduledTaskRunId,
      scheduledTaskPreparationFence: {
        scheduledTaskRunId,
        expectedVersion: 3,
        leaseToken: "b".repeat(32),
        now,
      },
    };

    const created = await createGraphLoopRun(input, fixture.dependencies);
    expect(created).toEqual({ id: "loop_run_1", engineKind: "graph_v1" });
    expect(fixture.tx.loopRun.create).toHaveBeenCalledOnce();

    fixture.tx.triggerReceipt.findUnique.mockResolvedValue({ loopRun: created });
    fixture.tx.projectScheduledTaskRun.findUnique.mockResolvedValue(null);

    await expect(createGraphLoopRun(input, fixture.dependencies)).resolves.toEqual(created);
    expect(fixture.tx.loopRun.create).toHaveBeenCalledOnce();
    expect(fixture.tx.projectScheduledTaskRun.findUnique).toHaveBeenCalledOnce();
  });

  it("rejects an archived Loop definition inside the Run creation transaction", async () => {
    const fixture = createFixture({
      bindingState: {
        id: "binding_1",
        projectId: "project_1",
        loopDefinitionId: "loop_definition_1",
        status: "enabled",
        version: 2,
        activeVersionId: "loop_version_1",
        loopDefinition: { status: "archived" },
      },
    });

    await expect(createGraphLoopRun(createRunInput(), fixture.dependencies)).rejects.toMatchObject({
      code: "loop_binding_unavailable",
    });

    expect(fixture.tx.projectLoopBinding.findUnique).toHaveBeenCalledWith({
      where: { id: "binding_1" },
      select: {
        id: true,
        projectId: true,
        loopDefinitionId: true,
        status: true,
        version: true,
        activeVersionId: true,
        loopDefinition: { select: { status: true } },
      },
    });
    expect(fixture.tx.triggerReceipt.create).not.toHaveBeenCalled();
    expect(fixture.tx.loopRun.create).not.toHaveBeenCalled();
  });

  it("persists the selected execution target as an immutable Run snapshot", async () => {
    const fixture = createFixture();
    const executionSnapshot = {
      target: {
        type: "linux_worker_pool",
        workerPoolId: "a".repeat(32),
        poolDisplayName: "ht-agent",
      },
      workerExecution: {
        workerPoolId: "a".repeat(32),
        workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
        workerBranchPolicy: { allowedBranches: ["*-HT-*"] },
        workerStageConfigurations: {},
      },
      resolvedAt: "2026-08-29T10:00:00.000Z",
    };

    await createGraphLoopRun({ ...createRunInput(), executionSnapshot }, fixture.dependencies);

    expect(fixture.tx.loopRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ executionSnapshot }),
    });
  });

  it("persists a verified V2 graph snapshot with snapshot version 2", async () => {
    const fixture = createFixture({ graph: runtimeGraphV2 });

    await createGraphLoopRun({
      ...createRunInput(),
      runGraphSnapshot: runGraphSnapshotV2,
    }, fixture.dependencies);

    expect(fixture.tx.loopRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        runGraphSnapshot: runGraphSnapshotV2,
        graphDigest: runGraphSnapshotV2.graphDigest,
        snapshotVersion: 2,
      }),
    });
  });

  it("rejects a snapshot whose root version differs from the new run", async () => {
    const fixture = createFixture();

    await expect(createGraphLoopRun({
      ...createRunInput(),
      runGraphSnapshot: { ...runGraphSnapshot, rootLoopVersionId: "loop_version_other" },
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.loopRun.create).not.toHaveBeenCalled();
  });

  it("persists complete parent identity for a child LoopRun", async () => {
    const fixture = createFixture();

    await createGraphLoopRun({
      ...createRunInput(),
      parent: {
        loopRunId: "parent_run_1",
        nodeRunId: "parent_node_1",
        attemptId: "parent_attempt_1",
      },
    }, fixture.dependencies);

    expect(fixture.tx.loopRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        parentLoopRunId: "parent_run_1",
        parentNodeRunId: "parent_node_1",
        parentAttemptId: "parent_attempt_1",
      }),
    });
  });

  it("persists a child version pinned in the parent snapshot even after the binding is upgraded", async () => {
    const fixture = createFixture({
      parentRunState: {
        id: "parent_run_1",
        projectId: "project_1",
        taskId: "task_1",
        runGraphSnapshot: parentRunGraphSnapshot,
        graphDigest: parentRunGraphSnapshot.graphDigest,
        snapshotVersion: 1,
      },
      bindingState: {
        id: "task_binding_1",
        projectId: "project_1",
        loopDefinitionId: "task_definition_1",
        status: "enabled",
        version: 4,
        activeVersionId: "task_version_2",
      },
      loopVersionState: {
        id: "task_version_1",
        loopDefinitionId: "task_definition_1",
        status: "published",
      },
    });

    await createGraphLoopRun({
      ...createRunInput(),
      bindingId: "task_binding_1",
      taskId: "task_1",
      loopVersionId: "task_version_1",
      bindingSnapshot: {
        ...createRunInput().bindingSnapshot,
        id: "task_binding_1",
        loopDefinitionId: "task_definition_1",
        activeVersionId: "task_version_1",
        version: 4,
      },
      runGraphSnapshot: parentRunGraphSnapshot,
      parent: {
        loopRunId: "parent_run_1",
        nodeRunId: "parent_node_1",
        attemptId: "parent_attempt_1",
      },
    }, fixture.dependencies);

    expect(fixture.tx.loopRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        loopVersionId: "task_version_1",
        runGraphSnapshot: parentRunGraphSnapshot,
        graphDigest: parentRunGraphSnapshot.graphDigest,
      }),
    });
  });

  it("rejects a child version outside the parent snapshot", async () => {
    const fixture = createFixture({
      parentRunState: {
        id: "parent_run_1",
        projectId: "project_1",
        taskId: "task_1",
        runGraphSnapshot: parentRunGraphSnapshot,
        graphDigest: parentRunGraphSnapshot.graphDigest,
        snapshotVersion: 1,
      },
      bindingState: {
        id: "task_binding_1",
        projectId: "project_1",
        loopDefinitionId: "task_definition_b",
        status: "enabled",
        version: 4,
        activeVersionId: "task_version_b",
      },
      loopVersionState: {
        id: "task_version_b",
        loopDefinitionId: "task_definition_b",
        status: "published",
      },
    });

    await expect(createGraphLoopRun({
      ...createRunInput(),
      bindingId: "task_binding_1",
      taskId: "task_1",
      loopVersionId: "task_version_b",
      bindingSnapshot: {
        ...createRunInput().bindingSnapshot,
        id: "task_binding_1",
        loopDefinitionId: "task_definition_b",
        activeVersionId: "task_version_b",
        version: 4,
      },
      runGraphSnapshot: parentRunGraphSnapshot,
      parent: { loopRunId: "parent_run_1", nodeRunId: "parent_node_1", attemptId: "parent_attempt_1" },
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.loopRun.create).not.toHaveBeenCalled();
  });

  it("allows a scheduled-task parent with no task when the child carries the run reference", async () => {
    const fixture = createFixture({
      parentRunState: {
        id: "parent_run_1",
        projectId: "project_1",
        taskId: null,
        scheduledTaskRunId: "a".repeat(32),
        runGraphSnapshot: parentRunGraphSnapshot,
        graphDigest: parentRunGraphSnapshot.graphDigest,
        snapshotVersion: 1,
      },
      bindingState: {
        id: "task_binding_1",
        projectId: "project_1",
        loopDefinitionId: "task_definition_1",
        status: "enabled",
        version: 4,
        activeVersionId: "task_version_1",
      },
      loopVersionState: {
        id: "task_version_1",
        loopDefinitionId: "task_definition_1",
        status: "published",
      },
    });

    await createGraphLoopRun({
      ...createRunInput(),
      bindingId: "task_binding_1",
      loopVersionId: "task_version_1",
      inputSnapshot: { scheduledTaskRunId: "a".repeat(32) },
      bindingSnapshot: {
        ...createRunInput().bindingSnapshot,
        id: "task_binding_1",
        loopDefinitionId: "task_definition_1",
        activeVersionId: "task_version_1",
        version: 4,
      },
      runGraphSnapshot: parentRunGraphSnapshot,
      parent: { loopRunId: "parent_run_1", nodeRunId: "parent_node_1", attemptId: "parent_attempt_1" },
    }, fixture.dependencies);

    expect(fixture.tx.loopRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        parentLoopRunId: "parent_run_1",
      }),
    });
    const persistedData = fixture.tx.loopRun.create.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(persistedData).not.toHaveProperty("taskId");
  });

  it("rejects a child snapshot that differs from the persisted parent snapshot", async () => {
    const alternateSnapshot = resolveRunGraphSnapshot({
      rootLoopVersionId: "project_version_b",
      versions: [
        {
          loopDefinitionId: "project_definition_b",
          loopVersionId: "project_version_b",
          scope: "project",
          graph: {
            schemaVersion: 1,
            inputSchema: {},
            outputSchema: {},
            limits: { maxStages: 3, maxRepeatCount: 1 },
            nodes: [
              { key: "start", label: "Start", type: "start" },
              {
                key: "develop",
                label: "Develop",
                type: "subloop_call",
                executionTarget: "platform",
                targetLoopDefinitionId: "task_definition_b",
                targetLoopVersionId: "task_version_b",
                inputMapping: {},
                terminalOutcomeMapping: { success: "success" },
              },
              { key: "end", label: "End", type: "end" },
            ],
            edges: [
              { id: "start-develop", source: "start", target: "develop", kind: "normal", outcome: "success" },
              { id: "develop-end", source: "develop", target: "end", kind: "normal", outcome: "success" },
            ],
          },
        },
        {
          loopDefinitionId: "task_definition_b",
          loopVersionId: "task_version_b",
          scope: "task",
          graph: runtimeGraph,
        },
      ],
    });
    const fixture = createFixture({
      parentRunState: {
        id: "parent_run_1",
        projectId: "project_1",
        taskId: "task_1",
        runGraphSnapshot: parentRunGraphSnapshot,
        graphDigest: parentRunGraphSnapshot.graphDigest,
        snapshotVersion: 1,
      },
      bindingState: {
        id: "task_binding_1",
        projectId: "project_1",
        loopDefinitionId: "task_definition_b",
        status: "enabled",
        version: 4,
        activeVersionId: "task_version_b",
      },
      loopVersionState: {
        id: "task_version_b",
        loopDefinitionId: "task_definition_b",
        status: "published",
      },
    });

    await expect(createGraphLoopRun({
      ...createRunInput(),
      bindingId: "task_binding_1",
      taskId: "task_1",
      loopVersionId: "task_version_b",
      bindingSnapshot: {
        ...createRunInput().bindingSnapshot,
        id: "task_binding_1",
        loopDefinitionId: "task_definition_b",
        activeVersionId: "task_version_b",
        version: 4,
      },
      runGraphSnapshot: alternateSnapshot,
      parent: { loopRunId: "parent_run_1", nodeRunId: "parent_node_1", attemptId: "parent_attempt_1" },
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.loopRun.create).not.toHaveBeenCalled();
  });

  it("rejects partial or oversized parent identity before persistence", async () => {
    const fixture = createFixture();

    await expect(createGraphLoopRun({
      ...createRunInput(),
      parent: { loopRunId: "parent_run_1", nodeRunId: "parent_node_1" },
    } as never, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });
    await expect(createGraphLoopRun({
      ...createRunInput(),
      parent: {
        loopRunId: `parent_${"x".repeat(96)}`,
        nodeRunId: "parent_node_1",
        attemptId: "parent_attempt_1",
      },
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.loopRun.create).not.toHaveBeenCalled();
  });

  it("bounds deterministic NodeRun ids to the 96-character persistence column", async () => {
    const nodeKey = "local-configuration-check";
    const graph = {
      ...runtimeGraph,
      nodes: runtimeGraph.nodes.map((node) => node.key === "start" ? { ...node, key: nodeKey } : node),
      edges: runtimeGraph.edges.map((edge) => edge.source === "start" ? { ...edge, source: nodeKey } : edge),
    } satisfies LoopGraph;
    const runId = `loop_run:${"a".repeat(64)}`;
    const first = createFixture({ graph });
    const second = createFixture({ graph });

    await createGraphLoopRun({ ...createRunInput(), id: runId }, first.dependencies);
    await createGraphLoopRun({ ...createRunInput(), id: runId }, second.dependencies);

    const firstId = first.tx.loopNodeRun.create.mock.calls[0]?.[0].data.id as string;
    const secondId = second.tx.loopNodeRun.create.mock.calls[0]?.[0].data.id as string;
    expect(firstId).toMatch(/^loop-node:[a-f0-9]{64}$/u);
    expect(firstId.length).toBeLessThanOrEqual(96);
    expect(secondId).toBe(firstId);
  });

  it("returns the prior run for a duplicate trigger without appending another event or outbox", async () => {
    const fixture = createFixture({ existingTriggerRun: { id: "loop_run_existing", engineKind: "graph_v1" } });

    await expect(createGraphLoopRun(createRunInput(), fixture.dependencies)).resolves.toEqual({
      id: "loop_run_existing",
      engineKind: "graph_v1",
    });

    expect(fixture.tx.triggerReceipt.create).not.toHaveBeenCalled();
    expect(fixture.tx.loopRun.create).not.toHaveBeenCalled();
    expect(fixture.tx.orchestrationEvent.createMany).not.toHaveBeenCalled();
    expect(fixture.tx.outboxMessage.createMany).not.toHaveBeenCalled();
  });

  it("preserves trigger causation on created Run and Start events", async () => {
    const fixture = createFixture();

    await createGraphLoopRun({ ...createRunInput(), causationId: "task_event_cause_1" }, fixture.dependencies);

    expect(fixture.tx.orchestrationEvent.createMany.mock.calls[0]?.[0].data).toEqual([
      expect.objectContaining({ causationId: "task_event_cause_1" }),
      expect.objectContaining({ causationId: "task_event_cause_1" }),
    ]);
  });

  it("recovers the winning Run when a deadlock aborts the duplicate transaction before the winner commits", async () => {
    // MariaDB reports the losing side of a duplicate trigger as P2034 rather
    // than P2002. That abort can happen before the winning transaction commits,
    // so an immediate side read legitimately observes nothing; the command must
    // be retried once and only then recover the committed winner by key.
    const committed = { id: "loop_run_deadlock_winner", engineKind: "graph_v1" as const };
    const transaction = vi.fn(async () => {
      throw persistenceError("P2034");
    });
    const recoveryRead = vi.fn(async () => ({
      id: "trigger_receipt_1",
      loopRun: committed,
    }));
    const db = {
      $transaction: transaction,
      triggerReceipt: { findUnique: recoveryRead },
    };

    await expect(createGraphLoopRun(createRunInput(), { db } as never)).resolves.toEqual(committed);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(recoveryRead).toHaveBeenCalledTimes(1);
  });

  it("surfaces the serialization deadlock when no committed winner can be recovered", async () => {
    const transaction = vi.fn(async () => {
      throw persistenceError("P2034");
    });
    const db = {
      $transaction: transaction,
      triggerReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
    };

    await expect(createGraphLoopRun(createRunInput(), { db } as never)).rejects.toMatchObject({ code: "P2034" });
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("persists one run for concurrent duplicate triggers under the unique receipt boundary", async () => {
    const boundary = createConcurrentTriggerUniquenessBoundary();

    const [first, duplicate] = await Promise.all([
      createGraphLoopRun(createRunInput(), boundary.dependencies),
      createGraphLoopRun({
        ...createRunInput(),
        id: "loop_run_2",
        triggerReceiptId: "trigger_receipt_2",
      }, boundary.dependencies),
    ]);

    expect(first).toEqual({ id: "loop_run_1", engineKind: "graph_v1" });
    expect(duplicate).toEqual(first);
    expect(boundary.snapshot()).toEqual({
      loopRunIds: ["loop_run_1"],
      eventCount: 2,
      outboxCount: 2,
      maxConcurrentTransactions: 2,
      uniqueCollisionCount: 1,
      rollbackCount: 1,
      recoveryReadCount: 1,
    });
  });

  it("creates a local AgentRun through the graph NodeRun identity when activating a local node", async () => {
    const fixture = createFixture();

    await activateLoopNode({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 1,
      nodeKey: "implement",
      activationNo: 1,
      inputSnapshot: { task: "implement" },
      executionTarget: "local",
      attemptId: "attempt_1",
      agentRun: {
        id: "agent_run_1",
        projectId: "project_1",
        agentProfileId: "agent_profile_1",
        inputSnapshot: { task: "implement" },
      },
      occurredAt: now,
      correlationId: "correlation_1",
      actor: { type: "system", id: "scheduler" },
    }, fixture.dependencies);

    expect(fixture.tx.agentRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "agent_run_1",
        loopNodeRunId: "node_run_1",
        taskId: null,
        attempt: 1,
      }),
    });
    expect(fixture.tx.loopNodeRun.create).not.toHaveBeenCalled();
    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "node_run_1",
        loopRunId: "loop_run_1",
        nodeKey: "implement",
        activationNo: 1,
        status: "ready",
        version: 1,
      }),
      data: expect.objectContaining({ status: "running", selectedExecutionTarget: "local" }),
    }));
  });

  it("reuses a transaction-created scheduled Attempt when the ready node is activated", async () => {
    const scheduledAttempt = {
      id: buildLoopNodeAttemptId("node_run_1", 2),
      attempt: 2,
      executorType: "local" as const,
      inputFingerprint: loopRuntime.fingerprintJsonValue({ task: "implement" }),
    };
    const fixture = createFixture({
      nodeAttemptCount: 1,
      subloopAttemptCount: 2,
      scheduledAttempt,
    });

    await activateLoopNode({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 1,
      nodeKey: "implement",
      activationNo: 1,
      inputSnapshot: { task: "implement" },
      executionTarget: "local",
      attemptId: scheduledAttempt.id,
      agentRun: {
        id: "agent_run_2",
        projectId: "project_1",
        agentProfileId: "agent_profile_1",
        inputSnapshot: { task: "implement" },
      },
      occurredAt: now,
      correlationId: "correlation_retry",
      actor: { type: "system", id: "scheduler" },
    }, fixture.dependencies);

    expect(fixture.tx.loopNodeAttempt.create).not.toHaveBeenCalled();
    expect(fixture.tx.loopNodeAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: scheduledAttempt.id,
        status: "scheduled",
        version: 1,
      }),
      data: expect.objectContaining({ status: "running", agentRunId: "agent_run_2" }),
    }));
  });

  it("fails a ready node instead of creating a third SubLoop execution", async () => {
    const fixture = createFixture({ subloopAttemptCount: 2 });

    await expect(activateLoopNode({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 1,
      nodeKey: "implement",
      activationNo: 1,
      inputSnapshot: { task: "implement" },
      executionTarget: "local",
      attemptId: "attempt_3",
      agentRun: {
        id: "agent_run_3",
        projectId: "project_1",
        agentProfileId: "agent_profile_1",
        inputSnapshot: { task: "implement" },
      },
      occurredAt: now,
      correlationId: "correlation_1",
      actor: { type: "system", id: "scheduler" },
    }, fixture.dependencies)).rejects.toMatchObject({ code: "stale_lease" });

    expect(fixture.tx.loopNodeAttempt.count).toHaveBeenCalledWith({
      where: { loopNodeRunId: "node_run_1" },
    });
    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed" }),
    }));
    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        statusReason: "subloop_attempt_limit_exceeded",
        stopReason: "subloop_attempt_limit_exceeded",
      }),
    }));
    expect(fixture.tx.agentRun.create).not.toHaveBeenCalled();
    expect(fixture.tx.loopNodeAttempt.create).not.toHaveBeenCalled();
  });

  it("atomically waits for local configuration without creating an execution attempt", async () => {
    const fixture = createConfigurationGateFixture();

    await expect(waitForLoopNodeConfiguration({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 1,
      projectId: "project_1",
      recipientUserId: "user_1",
      waitingReason: "workspace_missing",
      configurationVersion: "binding:3|workspace:0",
      evidence: {
        bindingId: "binding_1",
        bindingVersion: 3,
        agentProfileId: "profile_codex",
        provider: "codex",
        workerId: "local-worker:device_1",
        workerVersion: 4,
        deviceId: "device_1",
        runtimeProfileId: "runtime_1",
        runtimeVersion: 2,
        workspaceBindingId: null,
        workspaceConfigurationVersion: null,
        automationGrantId: "grant_1",
        automationGrantVersion: 1,
      },
      occurredAt: now,
      correlationId: "loop:loop_run_1",
      actor: { type: "system", id: "loop-scheduler" },
    }, fixture.dependencies)).resolves.toEqual({
      status: "waiting_configuration",
      nodeRunVersion: 2,
    });

    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "node_run_1", status: "ready", version: 1 }),
      data: expect.objectContaining({
        status: "waiting_configuration",
        waitingReason: "workspace_missing",
      }),
    }));
    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "waiting", statusReason: "workspace_missing" }),
    }));
    expect(fixture.tx.agentRun.create).not.toHaveBeenCalled();
    expect(fixture.tx.loopNodeAttempt.create).not.toHaveBeenCalled();
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        eventType: "loop.node.waiting_configuration",
        payload: expect.objectContaining({
          reason: "workspace_missing",
          configurationVersion: "binding:3|workspace:0",
        }),
      })],
    }));
    expect(fixture.tx.notificationIntent.createMany).toHaveBeenCalledOnce();
  });

  it("releases the same activation after configuration becomes ready", async () => {
    const fixture = createConfigurationGateFixture({
      nodeStatus: "waiting_configuration",
      runStatus: "waiting",
      nodeVersion: 2,
    });

    await expect(resumeLoopNodeAfterConfiguration({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 2,
      occurredAt: now,
      correlationId: "loop:loop_run_1",
      actor: { type: "system", id: "loop-scheduler" },
    }, fixture.dependencies)).resolves.toEqual({ status: "ready", nodeRunVersion: 3 });

    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "node_run_1",
        status: "waiting_configuration",
        activationNo: 1,
        version: 2,
      }),
      data: expect.objectContaining({ status: "ready", waitingReason: null }),
    }));
    expect(fixture.tx.loopNodeRun.create).not.toHaveBeenCalled();
    expect(fixture.tx.agentRun.create).not.toHaveBeenCalled();
    expect(fixture.tx.loopNodeAttempt.create).not.toHaveBeenCalled();
  });

  it("refreshes the same waiting activation when the blocking configuration changes", async () => {
    const fixture = createConfigurationGateFixture({
      nodeStatus: "waiting_configuration",
      runStatus: "waiting",
      nodeVersion: 2,
      waitingReason: "workspace_missing",
      readinessEvidence: {
        configurationVersion: "configuration:old",
        evidence: { bindingId: "binding_1", bindingVersion: 3 },
      },
    });

    await expect(waitForLoopNodeConfiguration({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 2,
      projectId: "project_1",
      recipientUserId: "user_1",
      waitingReason: "runtime_missing",
      configurationVersion: "configuration:new",
      evidence: {
        bindingId: "binding_1",
        bindingVersion: 3,
        agentProfileId: "profile_codex",
        provider: "codex",
        workerId: "local-worker:device_1",
        workerVersion: 5,
        deviceId: "device_1",
        runtimeProfileId: null,
        runtimeVersion: null,
        workspaceBindingId: "workspace_1",
        workspaceConfigurationVersion: 2,
        automationGrantId: "grant_1",
        automationGrantVersion: 1,
      },
      occurredAt: now,
      correlationId: "loop:loop_run_1",
      actor: { type: "system", id: "loop-configuration-resumer" },
    }, fixture.dependencies)).resolves.toEqual({
      status: "waiting_configuration",
      nodeRunVersion: 3,
    });

    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "waiting_configuration", version: 2 }),
      data: expect.objectContaining({
        status: "waiting_configuration",
        waitingReason: "runtime_missing",
      }),
    }));
    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "waiting" }),
      data: expect.objectContaining({ status: "waiting", statusReason: "runtime_missing" }),
    }));
    expect(fixture.tx.notificationIntent.createMany).toHaveBeenCalledOnce();
    expect(fixture.tx.agentRun.create).not.toHaveBeenCalled();
    expect(fixture.tx.loopNodeAttempt.create).not.toHaveBeenCalled();
  });

  it("does not rewrite an unchanged configuration wait or duplicate its notification", async () => {
    const fixture = createConfigurationGateFixture({
      nodeStatus: "waiting_configuration",
      runStatus: "waiting",
      nodeVersion: 2,
      waitingReason: "workspace_missing",
      readinessEvidence: {
        configurationVersion: "configuration:same",
        evidence: { bindingId: "binding_1", bindingVersion: 3 },
      },
    });

    await expect(waitForLoopNodeConfiguration({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 2,
      projectId: "project_1",
      recipientUserId: "user_1",
      waitingReason: "workspace_missing",
      configurationVersion: "configuration:same",
      evidence: {
        bindingId: "binding_1",
        bindingVersion: 3,
        agentProfileId: null,
        provider: null,
        workerId: null,
        workerVersion: null,
        deviceId: null,
        runtimeProfileId: null,
        runtimeVersion: null,
        workspaceBindingId: null,
        workspaceConfigurationVersion: null,
        automationGrantId: null,
        automationGrantVersion: null,
      },
      occurredAt: now,
      correlationId: "loop:loop_run_1",
      actor: { type: "system", id: "loop-configuration-resumer" },
    }, fixture.dependencies)).resolves.toEqual({
      status: "waiting_configuration",
      nodeRunVersion: 2,
    });

    expect(fixture.dependencies.db.$transaction).not.toHaveBeenCalled();
    expect(fixture.tx.notificationIntent.createMany).not.toHaveBeenCalled();
    expect(fixture.tx.outboxMessage.createMany).not.toHaveBeenCalled();
  });

  it("creates the AgentRun before the linked local attempt so foreign keys remain valid", async () => {
    const boundary = createForeignKeyBoundary();

    await activateLoopNode({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 1,
      nodeKey: "implement",
      activationNo: 1,
      inputSnapshot: { task: "implement" },
      executionTarget: "local",
      attemptId: "attempt_1",
      agentRun: {
        id: "agent_run_1",
        projectId: "project_1",
        agentProfileId: "agent_profile_1",
        inputSnapshot: { task: "implement" },
      },
      occurredAt: now,
      correlationId: "correlation_1",
      actor: { type: "system", id: "scheduler" },
    }, boundary.dependencies);

    expect(boundary.snapshot()).toEqual({
      agentRunIds: ["agent_run_1"],
      attemptIds: ["attempt_1"],
      nodeRunIds: ["node_run_1"],
    });
  });

  it("persists a platform execution message in the activation transaction", async () => {
    const fixture = createFixture({
      graph: {
        ...runtimeGraph,
        nodes: runtimeGraph.nodes.map((node) => (
          node.key === "implement"
            ? {
                key: "implement",
                label: "Implement",
                type: "platform_action" as const,
                executionTarget: "platform" as const,
                action: "project_document.write",
              }
            : node
        )) as LoopGraph["nodes"],
      },
    });

    await activateLoopNode({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 1,
      nodeKey: "implement",
      activationNo: 1,
      inputSnapshot: { task: "implement" },
      executionTarget: "platform",
      attemptId: "attempt_platform_1",
      occurredAt: now,
      correlationId: "correlation_1",
      actor: { type: "system", id: "scheduler" },
    }, fixture.dependencies);

    const rows = fixture.tx.outboxMessage.createMany.mock.calls
      .flatMap((call) => call[0].data);
    expect(rows).toContainEqual(expect.objectContaining({
      topic: "loop.platform.execute",
      aggregateType: "loop_node",
      aggregateId: "node_run_1",
      payload: expect.objectContaining({
        loopRunId: "loop_run_1",
        projectId: "project_1",
        nodeRunId: "node_run_1",
        attemptId: "attempt_platform_1",
      }),
    }));
  });

  it("requeues an orphaned local attempt and emits a durable ready event", async () => {
    const fixture = createFixture({ nodeRunStatus: "running" });

    await expect(recoverOrphanedGraphNode({
      loopRunId: "loop_run_1",
      agentRunId: "agent_run_1",
      occurredAt: now,
      correlationId: "loop:loop_run_1",
      causationId: "recover:agent_run_1",
      actor: { type: "system", id: "loop-recovery" },
    }, fixture.dependencies)).resolves.toEqual({ recovered: true, nodeRunId: "node_run_1" });

    expect(fixture.tx.loopNodeAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "attempt_1", status: "running", version: 1 }),
      data: expect.objectContaining({ status: "failed", version: { increment: 1 } }),
    }));
    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "node_run_1", status: "running", version: 1 }),
      data: expect.objectContaining({ status: "ready", version: { increment: 1 } }),
    }));
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ eventType: "loop.node.ready", causationId: "recover:agent_run_1" })],
    }));
  });

  it("fails the Loop when lease recovery exhausts the initial Attempt plus two retries", async () => {
    const fixture = createFixture({ nodeRunStatus: "running", subloopAttemptCount: 3 });

    await expect(recoverOrphanedGraphNode({
      loopRunId: "loop_run_1",
      agentRunId: "agent_run_1",
      occurredAt: now,
      correlationId: "loop:loop_run_1",
      actor: { type: "system", id: "loop-recovery" },
    }, fixture.dependencies)).resolves.toEqual({ recovered: true, nodeRunId: "node_run_1" });

    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed" }),
    }));
    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        statusReason: "subloop_attempt_limit_exceeded",
        stopReason: "subloop_attempt_limit_exceeded",
      }),
    }));
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ eventType: "loop.node.failed" })],
    }));
  });

  it("does not recover an orphaned local attempt while its Loop is paused", async () => {
    const fixture = createFixture({ nodeRunStatus: "running", runStatus: "paused" });

    await expect(recoverOrphanedGraphNode({
      loopRunId: "loop_run_1",
      agentRunId: "agent_run_1",
      occurredAt: now,
      correlationId: "loop:loop_run_1",
      actor: { type: "system", id: "loop-recovery" },
    }, fixture.dependencies)).resolves.toEqual({ recovered: false, nodeRunId: "node_run_1" });

    expect(fixture.tx.loopNodeAttempt.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.loopNodeRun.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["local execution without an AgentRun", { executionTarget: "local" as const, agentRun: undefined }],
    ["local execution with a null AgentRun", { executionTarget: "local" as const, agentRun: null as never }],
    ["local execution with a malformed AgentRun", {
      executionTarget: "local" as const,
      agentRun: {
        id: 123 as never,
        projectId: "project_1",
        agentProfileId: "agent_profile_1",
        inputSnapshot: { task: "implement" },
      },
    }],
    ["platform execution with an AgentRun", {
      executionTarget: "platform" as const,
      agentRun: {
        id: "agent_run_1",
        projectId: "project_1",
        agentProfileId: "agent_profile_1",
        inputSnapshot: { task: "implement" },
      },
    }],
    ["platform execution with a null AgentRun", { executionTarget: "platform" as const, agentRun: null as never }],
  ])("rejects %s before opening a transaction", async (_name, mismatch) => {
    const fixture = createFixture();

    await expect(activateLoopNode({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 1,
      nodeKey: "implement",
      activationNo: 1,
      inputSnapshot: { task: "implement" },
      attemptId: "attempt_1",
      occurredAt: now,
      correlationId: "correlation_1",
      actor: { type: "system", id: "scheduler" },
      ...mismatch,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.db.$transaction).not.toHaveBeenCalled();
    expect(fixture.tx.agentRun.create).not.toHaveBeenCalled();
    expect(fixture.tx.loopNodeAttempt.create).not.toHaveBeenCalled();
  });

  it.each(["either", "remote"])(
    "rejects the non-concrete %s execution target before opening a transaction",
    async (executionTarget) => {
      const fixture = createFixture({
        graph: {
          ...runtimeGraph,
          nodes: runtimeGraph.nodes.map((node) => (
            node.key === "implement"
              ? { ...node, executionTarget: "either" as const }
              : node
          )),
        },
      });

      await expect(activateLoopNode({
        loopRunId: "loop_run_1",
        nodeRunId: "node_run_1",
        nodeRunVersion: 1,
        nodeKey: "implement",
        activationNo: 1,
        inputSnapshot: { task: "implement" },
        executionTarget: executionTarget as "local",
        attemptId: "attempt_1",
        occurredAt: now,
        correlationId: "correlation_1",
        actor: { type: "system", id: "scheduler" },
      }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

      expect(fixture.db.$transaction).not.toHaveBeenCalled();
      expect(fixture.tx.loopNodeRun.updateMany).not.toHaveBeenCalled();
      expect(fixture.tx.loopNodeAttempt.create).not.toHaveBeenCalled();
    },
  );

  it("rejects a ready-row activation identity mismatch before creating an attempt", async () => {
    const fixture = createFixture();

    await expect(activateLoopNode({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 1,
      nodeKey: "forged-node",
      activationNo: 99,
      inputSnapshot: { task: "implement" },
      executionTarget: "local",
      attemptId: "attempt_1",
      agentRun: {
        id: "agent_run_1",
        projectId: "project_1",
        agentProfileId: "agent_profile_1",
        inputSnapshot: { task: "implement" },
      },
      occurredAt: now,
      correlationId: "correlation_1",
      actor: { type: "system", id: "scheduler" },
    }, fixture.dependencies)).rejects.toMatchObject({ code: "stale_lease" });

    expect(fixture.tx.agentRun.create).not.toHaveBeenCalled();
    expect(fixture.tx.loopNodeAttempt.create).not.toHaveBeenCalled();
  });

  it("does not let an expired AgentRun lease complete its local NodeRun", async () => {
    const fixture = createFixture({ agentRunUpdateCount: 0 });

    await expect(completeLoopNode(completeInput(), fixture.dependencies)).rejects.toMatchObject({
      code: "stale_lease",
    });

    expect(fixture.tx.loopNodeAttempt.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.loopNodeRun.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.orchestrationEvent.createMany).not.toHaveBeenCalled();
  });

  it("uses the AgentRun lease as the sole authority for local attempt completion", async () => {
    const fixture = createFixture({ attemptClaimToken: null, attemptLeaseExpiresAt: null });
    const { claimToken: _platformClaimToken, ...input } = completeInput();

    await expect(completeLoopNode(input as never, fixture.dependencies)).resolves.toBeUndefined();

    expect(fixture.tx.agentRun.updateMany).toHaveBeenCalledOnce();
    expect(fixture.tx.loopNodeAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "attempt_1",
        loopNodeRunId: "node_run_1",
        attempt: 1,
        version: 1,
        status: "running",
        agentRunId: "agent_run_1",
      },
    }));
  });

  it("completes a Linux Pool session lease without releasing Desktop Worker capacity", async () => {
    const sessionId = "b".repeat(32);
    const fixture = createFixture({ agentRunWorkerId: null, linuxWorkerPoolSessionId: sessionId });
    const { workerId: _workerId, ...desktopInput } = completeInput();

    await expect(completeLoopNode({
      ...desktopInput,
      linuxWorkerPoolSessionId: sessionId,
    }, fixture.dependencies)).resolves.toBeUndefined();

    expect(fixture.tx.agentRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workerId: null, linuxWorkerPoolSessionId: sessionId }),
    }));
    expect(fixture.tx.agentWorker.updateMany).not.toHaveBeenCalled();
  });

  it("completes a local result command once and reauthenticates its duplicate", async () => {
    const fixture = createFixture();
    const input = {
      ...authoritativeCompleteInput(),
      commandId: "result_command_1",
    };

    await expect(completeLoopNode(input, fixture.dependencies)).resolves.toEqual({
      completed: true,
      duplicate: false,
    });
    await expect(completeLoopNode(input, fixture.dependencies)).resolves.toEqual({
      completed: false,
      duplicate: true,
    });
    await expect(completeLoopNode({
      ...input,
      leaseGeneration: 1,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "stale_lease" });

    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledOnce();
    expect(fixture.tx.loopNodeRun.create).toHaveBeenCalledOnce();
    expect(fixture.tx.agentWorker.updateMany).toHaveBeenCalledOnce();
  });

  it("rejects a local result that violates the immutable node output schema", async () => {
    const graph = structuredClone(runtimeGraph) as LoopGraph;
    graph.nodes[1] = {
      ...graph.nodes[1],
      outputSchema: {
        type: "object",
        required: ["summary"],
        additionalProperties: false,
        properties: { summary: { type: "string", minLength: 1 } },
      },
    };
    const fixture = createFixture({ graph });

    await expect(completeLoopNode({
      ...authoritativeCompleteInput(),
      commandId: "result_invalid_schema_1",
      result: {
        outcome: "success",
        output: { summary: "", extra: true },
        artifactRefs: [],
        effectReceipts: [],
      },
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.agentRun.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.agentWorker.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.loopNodeAttempt.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.loopNodeRun.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.orchestrationEvent.createMany).not.toHaveBeenCalled();
  });

  it("rejects a backdated completion when the trusted server clock is past the lease", async () => {
    const fixture = createFixture({
      agentRunLeaseExpiresAt: new Date("2026-07-29T08:10:00.000Z"),
      serverNow: new Date("2026-07-29T08:20:00.000Z"),
    });

    await expect(completeLoopNode({
      ...completeInput(),
      occurredAt: new Date("2026-07-29T07:00:00.000Z"),
    }, fixture.dependencies)).rejects.toMatchObject({ code: "stale_lease" });

    expect(fixture.tx.loopNodeAttempt.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.loopNodeRun.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a backdated platform completion when the trusted clock is past the attempt claim", async () => {
    const fixture = createFixture({
      attemptAgentRunId: null,
      attemptExecutorType: "platform",
      attemptLeaseExpiresAt: new Date("2026-07-29T08:10:00.000Z"),
      serverNow: new Date("2026-07-29T08:20:00.000Z"),
    });
    const {
      agentRunId: _agentRunId,
      workerId: _workerId,
      leaseGeneration: _leaseGeneration,
      ...input
    } = completeInput();

    await expect(completeLoopNode({
      ...input,
      occurredAt: new Date("2026-07-29T07:00:00.000Z"),
    }, fixture.dependencies)).rejects.toMatchObject({ code: "stale_lease" });

    expect(fixture.tx.loopNodeAttempt.updateMany).not.toHaveBeenCalled();
  });

  it("rejects completion when the persisted NodeRun belongs to another LoopRun", async () => {
    const fixture = createFixture({ attemptLoopRunId: "loop_run_other" });

    await expect(completeLoopNode(completeInput(), fixture.dependencies)).rejects.toMatchObject({
      code: "stale_lease",
    });

    expect(fixture.tx.agentRun.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.loopNodeAttempt.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.loopNodeRun.updateMany).not.toHaveBeenCalled();
  });

  it("rejects completion when the supplied attempt number does not match persisted identity", async () => {
    const fixture = createFixture();

    await expect(completeLoopNode({
      ...completeInput(),
      attemptNo: 2,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "stale_lease" });

    expect(fixture.tx.agentRun.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.loopNodeAttempt.updateMany).not.toHaveBeenCalled();
  });

  it("rolls back AgentRun and attempt updates when the NodeRun CAS fails", async () => {
    const fixture = createFixture({ nodeRunUpdateCount: 0 });

    await expect(completeLoopNode(completeInput(), fixture.dependencies)).rejects.toMatchObject({
      code: "stale_lease",
    });

    expect(fixture.snapshot()).toEqual({
      agentRunStatus: "running",
      attemptStatus: "running",
      nodeRunStatus: "running",
      loopRunStatus: "running",
      orchestrationEventCount: 0,
    });
  });

  it("derives the declared route and monotonic counters from persisted graph state", async () => {
    const fixture = createFixture();

    await completeLoopNode(authoritativeCompleteInput(), fixture.dependencies);

    expect(fixture.tx.loopNodeAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "attempt_1", version: 1, agentRunId: "agent_run_1" }),
    }));
    expect(fixture.tx.agentRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "agent_run_1", leaseGeneration: 2 }),
      data: expect.objectContaining({ status: "succeeded" }),
    }));
    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "node_run_1", loopRunId: "loop_run_1", version: 4, status: "running" },
      data: expect.objectContaining({ status: "succeeded", selectedEdgeId: "edge_next" }),
    }));
    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "loop_run_1",
        engineKind: "graph_v1",
        loopVersionId: "loop_version_1",
        status: "running",
        version: 7,
        projectionVersion: 3,
        transitionCount: 1,
        repeatCount: 0,
      },
      data: expect.objectContaining({
        status: "running",
        transitionCount: 2,
        repeatCount: 0,
        usageAggregate: {
          transitions: 2,
          repeats: 0,
          edgeTraversals: { "start-implement": 1, edge_next: 1 },
        },
      }),
    }));
    expect(fixture.tx.loopNodeRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ nodeKey: "next", activationNo: 1, status: "ready" }),
    });
    expect(fixture.tx.outboxMessage.createMany).toHaveBeenCalledOnce();
  });

  it("routes a completed local node to a non-adjacent node from its immutable Decision snapshot", async () => {
    const graph = {
      schemaVersion: 2,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      limits: { maxStages: 5, maxRepeatCount: 2 },
      nodes: [
        { key: "start", nodeId: "start", label: "Start", type: "start", offlinePolicy: "online_required" },
        { key: "implement", nodeId: "implement", label: "Implement", type: "agent_action", executionTarget: "local", promptTemplate: "Implement", offlinePolicy: "local_capable" },
        { key: "next", nodeId: "next", label: "Next", type: "platform_action", executionTarget: "platform", action: "project_document.write", offlinePolicy: "online_required" },
        { key: "write_plan", nodeId: "write_plan", label: "Write plan", type: "agent_action", executionTarget: "local", promptTemplate: "Write a verified plan", offlinePolicy: "local_capable" },
        { key: "end", nodeId: "end", label: "End", type: "end", offlinePolicy: "online_required" },
      ],
      edges: [
        { id: "start-implement", source: "start", target: "implement", kind: "normal", outcome: "success" },
        { id: "start-write-plan", source: "start", target: "write_plan", kind: "normal", outcome: "success" },
        { id: "implement-next", source: "implement", target: "next", kind: "normal", outcome: "success" },
        { id: "write-plan-next", source: "write_plan", target: "next", kind: "normal", outcome: "success" },
        { id: "next-end", source: "next", target: "end", kind: "normal", outcome: "success" },
      ],
      routingMetadata: {
        implement: { responsibility: "Implement the approved work." },
        next: { responsibility: "Continue the normal workflow." },
        write_plan: { responsibility: "Regenerate the implementation plan from repository facts." },
      },
    } satisfies LoopGraphV2;
    const projectGraph = {
      schemaVersion: 2,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      limits: { maxStages: 4, maxRepeatCount: 2 },
      nodes: [
        { key: "start", nodeId: "project_start", label: "Start", type: "start", offlinePolicy: "online_required" },
        { key: "implement", nodeId: "implement", label: "Project implement", type: "agent_action", executionTarget: "local", promptTemplate: "Project work", offlinePolicy: "local_capable" },
        {
          key: "develop",
          nodeId: "project_develop",
          label: "Develop",
          type: "subloop_call",
          executionTarget: "platform",
          offlinePolicy: "online_required",
          targetLoopDefinitionId: "task_definition_1",
          targetLoopVersionId: "task_version_1",
          inputMapping: {},
          terminalOutcomeMapping: { success: "success", failure: "failure" },
        },
        { key: "end", nodeId: "project_end", label: "End", type: "end", offlinePolicy: "online_required" },
      ],
      edges: [
        { id: "project-start-implement", source: "start", target: "implement", kind: "normal", outcome: "success" },
        { id: "project-implement-develop", source: "implement", target: "develop", kind: "normal", outcome: "success" },
        { id: "project-develop-end", source: "develop", target: "end", kind: "normal", outcome: "success" },
      ],
      routingMetadata: {
        implement: { responsibility: "Perform project-level preparation." },
        project_develop: { responsibility: "Execute the bound task Loop." },
      },
    } satisfies LoopGraphV2;
    const snapshot = resolveRunGraphSnapshotV2({
      rootLoopVersionId: "project_version_1",
      versions: [{
        loopDefinitionId: "project_definition_1",
        loopVersionId: "project_version_1",
        scope: "project",
        graph: projectGraph,
      }, {
        loopDefinitionId: "task_definition_1",
        loopVersionId: "task_version_1",
        scope: "task",
        graph,
      }],
    });
    const fixture = createFixture({
      graph,
      loopVersionId: "task_version_1",
      runGraphSnapshot: snapshot,
      graphDigest: snapshot.graphDigest,
    });

    await completeLoopNode({
      ...authoritativeCompleteInput(),
      commandId: "non_adjacent_decision_1",
      routeDecision: {
        decisionId: "decision_non_adjacent_1",
        fromNodeId: "implement",
        nextNodeId: "write_plan",
        reasonCode: "PLAN_ENVIRONMENT_MISMATCH",
        summary: "Regenerate the plan from current repository facts.",
        evidence: ["artifacts/develop/checkpoint.json"],
        confidence: 0.98,
        snapshotDigest: snapshot.graphDigest,
        routerContractVersion: 1,
        routerContractDigest: `sha256:${"d".repeat(64)}`,
      },
    }, fixture.dependencies);

    expect(fixture.tx.loopNodeRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ nodeKey: "write_plan", activationNo: 1, status: "ready" }),
    });
    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ selectedEdgeId: null }),
    }));
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({
        eventType: "loop.agent.route_decided",
        payload: expect.objectContaining({ targetNodeId: "write_plan", selectedEdgeId: null }),
      })]),
    }));
  });

  it("routes a failed local node to the Decision target after the SubLoop retry limit", async () => {
    const graph = {
      schemaVersion: 2,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      limits: { maxStages: 4, maxRepeatCount: 2 },
      nodes: [
        { key: "start", nodeId: "start", label: "Start", type: "start", offlinePolicy: "online_required" },
        { key: "business_test", nodeId: "business_test", label: "Business test", type: "agent_action", executionTarget: "local", promptTemplate: "Test", offlinePolicy: "local_capable" },
        { key: "develop", nodeId: "develop", label: "Develop", type: "agent_action", executionTarget: "local", promptTemplate: "Fix", offlinePolicy: "local_capable" },
        { key: "end", nodeId: "end", label: "End", type: "end", offlinePolicy: "online_required" },
      ],
      edges: [
        { id: "start-business-test", source: "start", target: "business_test", kind: "normal", outcome: "success" },
        { id: "start-develop", source: "start", target: "develop", kind: "normal", outcome: "success" },
        { id: "business-test-end", source: "business_test", target: "end", kind: "normal", outcome: "success" },
        { id: "develop-business-test", source: "develop", target: "business_test", kind: "normal", outcome: "success" },
      ],
      routingMetadata: {
        business_test: { responsibility: "Run authenticated business scenarios and report product regressions." },
        develop: { responsibility: "Fix product regressions using the business-test evidence." },
      },
    } satisfies LoopGraphV2;
    const snapshot = resolveRunGraphSnapshotV2({
      rootLoopVersionId: "project_version_1",
      versions: [{
        loopDefinitionId: "project_definition_1",
        loopVersionId: "project_version_1",
        scope: "project",
        graph,
      }],
    });
    const fixture = createFixture({
      graph,
      loopVersionId: "project_version_1",
      runGraphSnapshot: snapshot,
      graphDigest: snapshot.graphDigest,
      currentNodeKey: "business_test",
      subloopAttemptCount: 2,
    });

    await completeLoopNode({
      ...authoritativeCompleteInput(),
      commandId: "failed_business_test_result_2",
      result: {
        outcome: "failure",
        output: {
          execId: "main",
          status: "FAILED",
          issueType: "PRODUCT_BEHAVIOR_REGRESSION",
          summary: "A browser workflow exposed a product regression.",
        },
        artifactRefs: ["artifacts/business-test/business-test-report.json"],
        effectReceipts: [],
      },
      routeDecision: {
        decisionId: "decision_business_test_develop_2",
        fromNodeId: "business_test",
        nextNodeId: "develop",
        reasonCode: "PRODUCT_BEHAVIOR_REGRESSION",
        summary: "Return to development using the business-test evidence.",
        evidence: ["artifacts/business-test/business-test-report.json"],
        confidence: 0.99,
        snapshotDigest: snapshot.graphDigest,
        routerContractVersion: 1,
        routerContractDigest: `sha256:${"d".repeat(64)}`,
      },
    }, fixture.dependencies);

    expect(fixture.tx.agentRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed" }),
    }));
    expect(fixture.tx.loopNodeAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed" }),
    }));
    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", selectedEdgeId: null }),
    }));
    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "running",
        transitionCount: 2,
        usageAggregate: {
          transitions: 2,
          repeats: 0,
          edgeTraversals: { "start-implement": 1, "decision:develop": 1 },
        },
      }),
    }));
    expect(fixture.tx.loopNodeRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ nodeKey: "develop", activationNo: 1, status: "ready" }),
    });
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ eventType: "loop.node.failed" }),
        expect.objectContaining({
          eventType: "loop.agent.route_decided",
          payload: expect.objectContaining({ targetNodeId: "develop", selectedEdgeId: null }),
        }),
      ]),
    }));

    const invalidDecisionFixture = createFixture({
      graph,
      loopVersionId: "project_version_1",
      runGraphSnapshot: snapshot,
      graphDigest: snapshot.graphDigest,
      currentNodeKey: "business_test",
      subloopAttemptCount: 2,
    });
    await completeLoopNode({
      ...authoritativeCompleteInput(),
      commandId: "failed_business_test_invalid_decision_2",
      result: {
        outcome: "failure",
        output: { issueType: "PRODUCT_BEHAVIOR_REGRESSION" },
        artifactRefs: [],
        effectReceipts: [],
      },
      routeDecision: {
        decisionId: "decision_business_test_invalid_2",
        fromNodeId: "business_test",
        nextNodeId: "develop",
        reasonCode: "PRODUCT_BEHAVIOR_REGRESSION",
        summary: "Decision with a stale snapshot.",
        evidence: [],
        confidence: 0.99,
        snapshotDigest: `sha256:${"f".repeat(64)}`,
        routerContractVersion: 1,
        routerContractDigest: `sha256:${"d".repeat(64)}`,
      },
    }, invalidDecisionFixture.dependencies);

    expect(invalidDecisionFixture.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "waiting",
        statusReason: "intervention:PRODUCT_BEHAVIOR_REGRESSION",
      }),
    }));
    expect(invalidDecisionFixture.tx.loopNodeRun.create).not.toHaveBeenCalled();
    expect(invalidDecisionFixture.tx.orchestrationEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ eventType: "loop.failure.classified" }),
        expect.objectContaining({ eventType: "loop.node.waiting_intervention" }),
      ]),
    }));
  });

  it("routes a failed v1 snapshot node to a non-adjacent Decision target", async () => {
    const graph = {
      schemaVersion: 1,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      limits: { maxStages: 4, maxRepeatCount: 2 },
      nodes: [
        { key: "start", nodeId: "start", label: "Start", type: "start" },
        { key: "business_test", nodeId: "business_test", label: "Business test", type: "agent_action", executionTarget: "local", promptTemplate: "Test" },
        { key: "develop", nodeId: "develop", label: "Develop", type: "agent_action", executionTarget: "local", promptTemplate: "Fix" },
        { key: "end", nodeId: "end", label: "End", type: "end" },
      ],
      edges: [
        { id: "start-business-test", source: "start", target: "business_test", kind: "normal", outcome: "success" },
        { id: "business-test-end", source: "business_test", target: "end", kind: "normal", outcome: "success" },
        { id: "develop-business-test", source: "develop", target: "business_test", kind: "normal", outcome: "success" },
      ],
    } satisfies LoopGraph;
    const snapshot = resolveRunGraphSnapshot({
      rootLoopVersionId: "project_version_v1",
      versions: [{
        loopDefinitionId: "project_definition_v1",
        loopVersionId: "project_version_v1",
        scope: "project",
        graph,
      }],
    });
    const fixture = createFixture({
      graph,
      loopVersionId: "project_version_v1",
      runGraphSnapshot: snapshot,
      graphDigest: snapshot.graphDigest,
      currentNodeKey: "business_test",
      subloopAttemptCount: 2,
    });

    await completeLoopNode({
      ...authoritativeCompleteInput(),
      commandId: "failed_v1_business_test_result_2",
      result: {
        outcome: "failure",
        output: {
          execId: "main",
          status: "FAILED",
          issueType: "PRODUCT_BEHAVIOR_REGRESSION",
          summary: "A browser workflow exposed a product regression.",
        },
        artifactRefs: ["artifacts/business-test/business-test-report.json"],
        effectReceipts: [],
      },
      routeDecision: {
        decisionId: "decision_v1_business_test_develop_2",
        fromNodeId: "business_test",
        nextNodeId: "develop",
        reasonCode: "PRODUCT_BEHAVIOR_REGRESSION",
        summary: "Return to development using the business-test evidence.",
        evidence: ["artifacts/business-test/business-test-report.json"],
        confidence: 0.99,
        snapshotDigest: snapshot.graphDigest,
        routerContractVersion: 1,
        routerContractDigest: `sha256:${"d".repeat(64)}`,
      },
    }, fixture.dependencies);

    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "running" }),
    }));
    expect(fixture.tx.loopNodeRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ nodeKey: "develop", activationNo: 1, status: "ready" }),
    });
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({
        eventType: "loop.agent.route_decided",
        payload: expect.objectContaining({ targetNodeId: "develop", selectedEdgeId: null }),
      })]),
    }));
  });

  it("retries only the same SubLoop after its first failed execution", async () => {
    const fixture = createFixture({ subloopAttemptCount: 1 });

    await completeLoopNode({
      ...authoritativeCompleteInput(),
      result: {
        outcome: "failure",
        output: { errorCode: "provider_error", message: "operation failed" },
        artifactRefs: [],
        effectReceipts: [],
      },
    }, fixture.dependencies);

    expect(fixture.tx.agentRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed" }),
    }));
    expect(fixture.tx.loopNodeAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "blocked",
        error: { errorCode: "provider_error", message: "operation failed" },
      }),
    }));
    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "waiting_intervention",
        waitingReason: "runtime_intervention:provider_error",
      }),
    }));
    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "waiting", statusReason: "intervention:provider_error" }),
    }));
    expect(fixture.tx.loopNodeRun.create).not.toHaveBeenCalled();
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ eventType: "loop.failure.classified" }),
        expect.objectContaining({ eventType: "loop.node.waiting_intervention" }),
      ]),
    }));
  });

  it("creates the deterministic continuation Attempt in the failure transaction", async () => {
    const fixture = createFixture({ subloopAttemptCount: 1 });

    await completeLoopNode({
      ...authoritativeCompleteInput(),
      commandId: "retry_attempt_command_1",
      result: {
        outcome: "failure",
        output: { errorCode: "provider_timeout", message: "temporary provider timeout" },
        artifactRefs: [],
        effectReceipts: [],
      },
    }, fixture.dependencies);

    expect(fixture.tx.loopNodeAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: buildLoopNodeAttemptId("node_run_1", 2),
        loopNodeRunId: "node_run_1",
        attempt: 2,
        executorType: "local",
        status: "scheduled",
        inputFingerprint: "input_fingerprint_1",
      }),
    });
  });

  it("records a proposed intervention in shadow mode while retaining the legacy retry", async () => {
    const fixture = createFixture({
      subloopAttemptCount: 1,
      failureDecisionRollout: {
        shadowClassification: true,
        enforceFailureDecision: false,
        enforceMobileSourceIntervention: false,
      },
    });

    await completeLoopNode({
      ...authoritativeCompleteInput(),
      result: {
        outcome: "failure",
        output: { errorCode: "provider_error", message: "operation failed" },
        artifactRefs: [],
        effectReceipts: [],
      },
    }, fixture.dependencies);

    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "ready", waitingReason: "retry_scheduled" }),
    }));
    expect(fixture.tx.workflowInteraction.create).not.toHaveBeenCalled();
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({
        eventType: "loop.failure.classified",
        payload: expect.objectContaining({
          disposition: "retry_attempt",
          proposedDisposition: "open_intervention",
          shadow: true,
        }),
      })]),
    }));
  });

  it("requires the dedicated high-confidence flag before enforcing mobile source intervention", async () => {
    const result = {
      outcome: "failure" as const,
      output: {
        status: "FAILED",
        issueType: "MOBILE_SOURCE_UNAVAILABLE",
        summary: "No mobile source is available",
      },
      artifactRefs: [],
      effectReceipts: [],
    };
    const broadOnly = createFixture({
      failureDecisionRollout: {
        shadowClassification: true,
        enforceFailureDecision: true,
        enforceMobileSourceIntervention: false,
      },
    });
    await completeLoopNode({ ...authoritativeCompleteInput(), result }, broadOnly.dependencies);
    expect(broadOnly.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "ready" }),
    }));

    const highConfidence = createFixture({
      failureDecisionRollout: {
        shadowClassification: true,
        enforceFailureDecision: false,
        enforceMobileSourceIntervention: true,
      },
    });
    await completeLoopNode({ ...authoritativeCompleteInput(), result }, highConfidence.dependencies);
    expect(highConfidence.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "waiting_intervention" }),
    }));
  });

  it("stops automatic SubLoop retries when the Agent needs clarification", async () => {
    const fixture = createFixture({ subloopAttemptCount: 1 });

    await completeLoopNode({
      ...authoritativeCompleteInput(),
      result: {
        outcome: "failure",
        output: {
          execId: "main",
          status: "NEEDS_CLARIFICATION",
          issueType: "EMPTY_TASK_CONTENT",
          summary: "Task content is empty",
        },
        artifactRefs: ["artifacts/get-requirement/input-snapshot.json"],
        effectReceipts: [],
      },
    }, fixture.dependencies);

    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "waiting_intervention",
        waitingReason: "runtime_intervention:EMPTY_TASK_CONTENT",
      }),
    }));
    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "waiting",
        statusReason: "intervention:EMPTY_TASK_CONTENT",
      }),
    }));
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ eventType: "loop.failure.classified" }),
        expect.objectContaining({
          eventType: "loop.node.waiting_intervention",
          payload: expect.objectContaining({ reason: "intervention:EMPTY_TASK_CONTENT" }),
        }),
      ]),
    }));
  });

  it("reauthenticates a duplicate failed local result command without another retry transition", async () => {
    const fixture = createFixture({ subloopAttemptCount: 1 });
    const input = {
      ...authoritativeCompleteInput(),
      commandId: "failed_result_command_1",
      result: {
        outcome: "failure" as const,
        output: { errorCode: "provider_error", message: "operation failed" },
        artifactRefs: [],
        effectReceipts: [],
      },
    };

    await expect(completeLoopNode(input, fixture.dependencies)).resolves.toEqual({
      completed: true,
      duplicate: false,
    });
    await expect(completeLoopNode(input, fixture.dependencies)).resolves.toEqual({
      completed: false,
      duplicate: true,
    });

    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledOnce();
    expect(fixture.tx.agentWorker.updateMany).toHaveBeenCalledOnce();
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalled();
    expect(fixture.recordFailureDecision).toHaveBeenLastCalledWith("loop_failure_decision", expect.objectContaining({
      duplicateSuppressed: true,
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      attemptId: "attempt_1",
    }));
  });

  it("fails the Loop after the second failed execution without following a later edge", async () => {
    const fixture = createFixture({ subloopAttemptCount: 2 });

    await completeLoopNode({
      ...authoritativeCompleteInput(),
      result: {
        outcome: "failure",
        output: { errorCode: "provider_error", message: "operation failed again" },
        artifactRefs: [],
        effectReceipts: [],
      },
    }, fixture.dependencies);

    expect(fixture.tx.loopNodeAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "blocked",
        error: { errorCode: "provider_error", message: "operation failed again" },
      }),
    }));
    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "waiting_intervention" }),
    }));
    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "waiting",
        statusReason: "intervention:provider_error",
      }),
    }));
    expect(fixture.tx.loopNodeRun.create).not.toHaveBeenCalled();
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ eventType: "loop.failure.classified" }),
        expect.objectContaining({ eventType: "loop.node.waiting_intervention" }),
      ]),
    }));
  });

  it("opens one runtime intervention for a missing mobile source", async () => {
    const fixture = createFixture({ subloopAttemptCount: 1 });

    await completeLoopNode({
      ...authoritativeCompleteInput(),
      commandId: "mobile_source_failure_1",
      actor: { type: "user", id: "user_1" },
      result: {
        outcome: "failure",
        output: {
          status: "FAILED",
          issueType: "MOBILE_SOURCE_UNAVAILABLE",
          summary: "No mobile app source is configured",
          evidence: ["environment/mobile-source"],
        },
        artifactRefs: [],
        effectReceipts: [],
      },
    }, fixture.dependencies);

    expect(fixture.tx.workflowInteraction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "runtime_intervention", status: "open" }),
    }));
    expect(fixture.tx.notificationIntent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ dedupeKey: expect.any(String) })],
    }));
    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "waiting_intervention" }),
    }));
  });

  it("passes the published root and node retry policies into the classifier", async () => {
    const fixture = createFixture({ subloopAttemptCount: 1, graph: runtimeGraph });

    await completeLoopNode({
      ...authoritativeCompleteInput(),
      result: {
        outcome: "failure",
        output: { errorCode: "provider_timeout", message: "temporary provider timeout" },
        artifactRefs: [],
        effectReceipts: [],
      },
    }, fixture.dependencies);

    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({
        eventType: "loop.failure.classified",
        payload: expect.objectContaining({
          disposition: "retry_attempt",
          maxRetries: 1,
          nextAttemptNo: 2,
        }),
      })]),
    }));
  });

  it("routes a deterministic failure through a non-self feedback edge without consuming a retry", async () => {
    const graph = {
      ...runtimeGraph,
      retryPolicy: { maxRetries: 0 },
      nodes: runtimeGraph.nodes.map((node) => node.key === "implement" ? { ...node, retryPolicy: { maxRetries: 0 } } : node),
      edges: [
        ...runtimeGraph.edges,
        { id: "implement-rework", source: "implement", target: "next", kind: "feedback" as const, outcome: "rework" as const, maxTraversals: 2 },
      ],
    } satisfies LoopGraph;
    const fixture = createFixture({ graph, subloopAttemptCount: 2 });

    await completeLoopNode({
      ...authoritativeCompleteInput(),
      result: {
        outcome: "failure",
        output: { errorCode: "TEST_FAILED", message: "assertion failed" },
        artifactRefs: [],
        effectReceipts: [],
      },
    }, fixture.dependencies);

    expect(fixture.tx.loopNodeRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ nodeKey: "next", status: "ready" }),
    }));
    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "running" }),
    }));
  });

  it("rejects a Run when the binding changed after its trigger snapshot was read", async () => {
    const fixture = createFixture({
      bindingState: {
        id: "binding_1",
        projectId: "project_1",
        status: "disabled",
        version: 3,
        activeVersionId: "loop_version_1",
      },
    });

    await expect(createGraphLoopRun(createRunInput(), fixture.dependencies)).rejects.toMatchObject({
      code: "validation_failed",
    });

    expect(fixture.tx.triggerReceipt.create).not.toHaveBeenCalled();
    expect(fixture.tx.loopRun.create).not.toHaveBeenCalled();
  });

  it("allows a latest binding to start the newly published version while its active binding version is unchanged", async () => {
    const fixture = createFixture({
      bindingState: {
        id: "binding_1",
        projectId: "project_1",
        loopDefinitionId: "loop_definition_1",
        status: "enabled",
        version: 2,
        activeVersionId: "loop_version_1",
      },
      loopVersionState: {
        id: "loop_version_2",
        loopDefinitionId: "loop_definition_1",
        status: "published",
      },
    });

    await expect(createGraphLoopRun({
      ...createRunInput(),
      loopVersionId: "loop_version_2",
      bindingSnapshot: {
        ...createRunInput().bindingSnapshot,
        activeVersionId: "loop_version_2",
        versionPolicy: "latest",
      },
    }, fixture.dependencies)).resolves.toEqual({ id: "loop_run_1", engineKind: "graph_v1" });
  });

  it("rejects a pinned binding when the active binding version differs", async () => {
    const fixture = createFixture({
      bindingState: {
        id: "binding_1",
        projectId: "project_1",
        loopDefinitionId: "loop_definition_1",
        status: "enabled",
        version: 2,
        activeVersionId: "loop_version_1",
      },
      loopVersionState: {
        id: "loop_version_2",
        loopDefinitionId: "loop_definition_1",
        status: "published",
      },
    });

    await expect(createGraphLoopRun({
      ...createRunInput(),
      loopVersionId: "loop_version_2",
      bindingSnapshot: {
        ...createRunInput().bindingSnapshot,
        activeVersionId: "loop_version_2",
        versionPolicy: "pinned",
      },
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });
    expect(fixture.tx.loopRun.create).not.toHaveBeenCalled();
  });

  it("rejects a latest binding when the requested version differs from its trigger snapshot", async () => {
    const fixture = createFixture({
      bindingState: {
        id: "binding_1",
        projectId: "project_1",
        loopDefinitionId: "loop_definition_1",
        status: "enabled",
        version: 2,
        activeVersionId: "loop_version_1",
      },
      loopVersionState: {
        id: "loop_version_2",
        loopDefinitionId: "loop_definition_1",
        status: "published",
      },
    });

    await expect(createGraphLoopRun({
      ...createRunInput(),
      loopVersionId: "loop_version_2",
      bindingSnapshot: {
        ...createRunInput().bindingSnapshot,
        activeVersionId: "loop_version_1",
        versionPolicy: "latest",
      },
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });
    expect(fixture.tx.loopRun.create).not.toHaveBeenCalled();
  });

  it("ignores a forged undeclared transition, reduced counters, and caller activation number", async () => {
    const fixture = createFixture({
      runTransitionCount: 3,
      runRepeatCount: 1,
      runUsageAggregate: {
        transitions: 3,
        repeats: 1,
        edgeTraversals: { "start-implement": 1, edge_feedback: 1, edge_next: 1 },
      },
      targetMaxActivationNo: 2,
    });

    await completeLoopNode({
      ...completeInput(),
      transition: {
        status: "routed",
        edge: {
          id: "edge_forged",
          source: "implement",
          target: "undeclared",
          kind: "normal",
          outcome: "success",
        },
        counters: {
          transitions: 1,
          repeats: 0,
          edgeTraversals: {},
        },
        targetActivationNo: 99,
      },
    } as never, fixture.dependencies);

    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "running",
        transitionCount: 4,
        repeatCount: 1,
        usageAggregate: {
          transitions: 4,
          repeats: 1,
          edgeTraversals: { "start-implement": 1, edge_feedback: 1, edge_next: 2 },
        },
      }),
    }));
    expect(fixture.tx.loopNodeRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ nodeKey: "next", activationNo: 3, status: "ready" }),
    });
  });

  it("exhausts from the persisted effective budget without trusting a caller route", async () => {
    const fixture = createFixture({
      runTransitionCount: 7,
      runUsageAggregate: {
        transitions: 7,
        repeats: 0,
        edgeTraversals: { "start-implement": 1, edge_next: 6 },
      },
      runBudgetSnapshot: { maxStages: 4, maxRepeatCount: 2, maxTransitions: 8 },
    });

    await completeLoopNode(completeInput(), fixture.dependencies);

    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "exhausted",
        statusReason: "max_transitions_exhausted",
        finishedAt: now,
      }),
    }));
    expect(fixture.tx.loopNodeRun.create).not.toHaveBeenCalled();
  });

  it("only lets a persisted End node complete and ignores a fabricated outgoing transition", async () => {
    const fixture = createFixture({ currentNodeKey: "end" });

    await completeLoopNode({
      ...completeInput(),
      transition: {
        status: "routed",
        edge: {
          id: "edge_forged",
          source: "end",
          target: "undeclared",
          kind: "normal",
          outcome: "success",
        },
        counters: { transitions: 0, repeats: 0, edgeTraversals: {} },
        targetActivationNo: 99,
      },
    } as never, fixture.dependencies);

    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "completed", finishedAt: now }),
    }));
    expect(fixture.tx.loopNodeRun.create).not.toHaveBeenCalled();
  });

  it("rejects a fabricated GateDecision on an End node before mutation", async () => {
    const fixture = createFixture({ currentNodeKey: "end" });

    await expect(completeLoopNode({
      ...authoritativeCompleteInput(),
      result: { outcome: "pass", output: { done: true }, artifactRefs: [], effectReceipts: [] },
      gateDecision: {
        outcome: "pass",
        reasonCode: "forged",
        message: "Forged terminal decision",
        evidenceRefs: [],
        selectedEdgeId: "edge_forged",
      },
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.agentRun.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.loopNodeAttempt.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.loopRun.updateMany).not.toHaveBeenCalled();
  });

  it("does not let a caller complete a non-End node", async () => {
    const fixture = createFixture();

    await completeLoopNode({
      ...completeInput(),
      transition: { status: "completed" },
    } as never, fixture.dependencies);

    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "running", transitionCount: 2 }),
    }));
    expect(fixture.tx.loopNodeRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ nodeKey: "next", activationNo: 1, status: "ready" }),
    });
  });

  it("rejects a gate decision that disagrees with deterministic persisted routing", async () => {
    const fixture = createFixture({ currentNodeKey: "review", graph: gateGraph });

    await expect(completeLoopNode({
      ...authoritativeCompleteInput(),
      result: { outcome: "pass", output: { approved: true }, artifactRefs: [], effectReceipts: [] },
      gateDecision: {
        outcome: "pass",
        reasonCode: "approved",
        message: "Approved",
        evidenceRefs: [],
        selectedEdgeId: "review-rework",
      },
    } as never, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.agentRun.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.loopNodeAttempt.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.loopRun.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a GateDecision on a non-gate node before routing", async () => {
    const fixture = createFixture({ graph: nonGatePassGraph });

    await expect(completeLoopNode({
      ...authoritativeCompleteInput(),
      result: { outcome: "pass", output: { approved: true }, artifactRefs: [], effectReceipts: [] },
      gateDecision: {
        outcome: "pass",
        reasonCode: "approved",
        message: "Approved",
        evidenceRefs: [],
        selectedEdgeId: "edge_next",
      },
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.agentRun.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.loopNodeAttempt.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.loopRun.updateMany).not.toHaveBeenCalled();
  });

  it("rolls back every completion mutation when the persisted LoopRun CAS loses a race", async () => {
    const fixture = createFixture({ runUpdateCount: 0 });

    await expect(completeLoopNode(authoritativeCompleteInput(), fixture.dependencies)).rejects.toMatchObject({
      code: "stale_lease",
    });

    expect(fixture.snapshot()).toEqual({
      agentRunStatus: "running",
      attemptStatus: "running",
      nodeRunStatus: "running",
      loopRunStatus: "running",
      orchestrationEventCount: 0,
    });
    expect(fixture.tx.loopNodeRun.create).not.toHaveBeenCalled();
  });

  it("rejects a malformed result before opening a completion transaction", async () => {
    const fixture = createFixture();

    await expect(completeLoopNode({
      ...authoritativeCompleteInput(),
      result: {
        outcome: "success",
        output: { done: true },
        artifactRefs: [],
        effectReceipts: [],
        transitionCount: -1,
      },
    } as never, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.db.$transaction).not.toHaveBeenCalled();
  });

  it("accepts only in-order events from the valid AgentRun lease", async () => {
    const fixture = createFixture();

    await appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [{
        eventId: "agent_event_1",
        loopRunId: "loop_run_1",
        loopNodeRunId: "node_run_1",
        loopNodeAttemptId: "attempt_1",
        attemptNo: 1,
        leaseGeneration: 2,
        sequence: 1,
        eventType: "loop.node.progressed",
        occurredAt: now.toISOString(),
        payloadSummary: { phase: "working" },
        artifactRefs: [],
      }],
    }, fixture.dependencies);

    expect(fixture.tx.agentRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "agent_run_1",
        loopRunId: "loop_run_1",
        loopNodeRunId: "node_run_1",
        attempt: 1,
        workerId: "worker_1",
        leaseGeneration: 2,
        lastEventSequence: { lt: 1 },
      }),
      data: { lastEventSequence: 1 },
    }));
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledOnce();
  });

  it("validates and applies runtime checklist events in order", async () => {
    const fixture = createFixture();
    const binding = {
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attemptNo: 1,
      leaseGeneration: 2,
    };
    await appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [agentEvent({
        eventId: "checklist_created",
        eventType: "loop.checklist.created",
        payloadSummary: {
          ...binding,
          checklist: [{ id: "inspect", title: "Inspect", status: "not_started", evidenceRefs: [] }],
        },
      })],
    }, fixture.dependencies);
    await appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [agentEvent({
        eventId: "checklist_updated",
        sequence: 2,
        eventType: "loop.checklist.updated",
        payloadSummary: { ...binding, itemId: "inspect", status: "in_progress", evidenceRefs: [] },
      })],
    }, fixture.dependencies);
    await appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [agentEvent({
        eventId: "checklist_succeeded",
        sequence: 3,
        eventType: "loop.checklist.updated",
        payloadSummary: { ...binding, itemId: "inspect", status: "succeeded", evidenceRefs: ["artifact:inspect"] },
      })],
    }, fixture.dependencies);
    expect(fixture.acceptedEventCount()).toBe(3);
  });

  it("rejects checklist updates with an invalid transition or missing item", async () => {
    const fixture = createFixture();
    const binding = {
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attemptNo: 1,
      leaseGeneration: 2,
    };
    await expect(appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [agentEvent({
        eventId: "checklist_missing_update",
        eventType: "loop.checklist.updated",
        payloadSummary: { ...binding, itemId: "missing", status: "succeeded", evidenceRefs: [] },
      })],
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });
    expect(fixture.acceptedEventCount()).toBe(0);
  });

  it("finalizes incomplete checklist evidence and accepts local node success", async () => {
    const fixture = createFixture();
    const binding = {
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attemptNo: 1,
      leaseGeneration: 2,
    };
    await appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [agentEvent({
        eventId: "checklist_for_completion",
        eventType: "loop.checklist.created",
        payloadSummary: {
          ...binding,
          checklist: [{ id: "inspect", title: "Inspect", status: "in_progress", evidenceRefs: [] }],
        },
      })],
    }, fixture.dependencies);
    await expect(completeLoopNode(authoritativeCompleteInput(), fixture.dependencies)).resolves.toBeUndefined();
    expect(fixture.snapshot()).toMatchObject({
      agentRunStatus: "succeeded",
      attemptStatus: "succeeded",
      nodeRunStatus: "succeeded",
      loopRunStatus: "running",
    });
    expect(fixture.tx.agentRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lastEventSequence: 1 }),
    }));
    expect(fixture.acceptedEventCount()).toBe(3);
  });

  it("drops raw app-server notifications without a database write", async () => {
    const fixture = createFixture();

    await appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [agentEvent({
        eventId: "raw_notification_1",
        eventType: "worker.app_server.notification",
        payloadSummary: { method: "item/agentMessage/delta", delta: "secret output" },
      })],
    }, fixture.dependencies);

    expect(fixture.acceptedEventCount()).toBe(0);
    expect(fixture.tx.agentRun.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.outboxMessage.createMany).not.toHaveBeenCalled();
  });

  it.each(["agent.message.completed", "tool.started", "tool.completed"])(
    "drops high-frequency provider event %s without advancing durable state",
    async (eventType) => {
      const fixture = createFixture();
      await appendLoopAttemptEvents({
        agentRunId: "agent_run_1",
        attemptId: "attempt_1",
        workerId: "worker_1",
        leaseGeneration: 2,
        events: [agentEvent({ eventId: `transient_${eventType}`, eventType })],
      }, fixture.dependencies);
      expect(fixture.acceptedEventCount()).toBe(0);
      expect(fixture.tx.agentRun.updateMany).not.toHaveBeenCalled();
      expect(fixture.tx.outboxMessage.createMany).not.toHaveBeenCalled();
    },
  );

  it("allows a durable lifecycle event to skip discarded transport sequences", async () => {
    const fixture = createFixture();

    await appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [
        agentEvent({ eventId: "raw_notification_1", eventType: "worker.app_server.notification" }),
        agentEvent({ eventId: "lifecycle_2", eventType: "worker.stage.completed", sequence: 2 }),
      ],
    }, fixture.dependencies);

    expect(fixture.tx.agentRun.updateMany).toHaveBeenCalledTimes(1);
    expect(fixture.tx.agentRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ lastEventSequence: { lt: 2 } }),
      data: { lastEventSequence: 2 },
    }));
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledOnce();
  });

  it("accepts events from a Linux Pool session without treating it as a Desktop Worker", async () => {
    const sessionId = "b".repeat(32);
    const fixture = createFixture({ agentRunWorkerId: null, linuxWorkerPoolSessionId: sessionId });

    await expect(appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      linuxWorkerPoolSessionId: sessionId,
      leaseGeneration: 2,
      events: [agentEvent()],
    }, fixture.dependencies)).resolves.toBeUndefined();

    expect(fixture.tx.agentRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workerId: null, linuxWorkerPoolSessionId: sessionId }),
    }));
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ actorType: "worker", actorId: `linux-worker:${sessionId}` })],
    }));
  });

  it("rejects a Linux event from a session that did not claim the AgentRun", async () => {
    const fixture = createFixture({ agentRunWorkerId: null, linuxWorkerPoolSessionId: "b".repeat(32) });

    await expect(appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      linuxWorkerPoolSessionId: "c".repeat(32),
      leaseGeneration: 2,
      events: [agentEvent()],
    }, fixture.dependencies)).rejects.toMatchObject({ code: "stale_lease" });

    expect(fixture.tx.agentRun.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an event whose persisted attempt belongs to another LoopRun", async () => {
    const fixture = createFixture({ attemptLoopRunId: "loop_run_other" });

    await expect(appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [agentEvent()],
    }, fixture.dependencies)).rejects.toMatchObject({ code: "stale_lease" });

    expect(fixture.tx.agentRun.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.orchestrationEvent.createMany).not.toHaveBeenCalled();
  });

  it("rejects an event whose attempt number does not match persisted identity", async () => {
    const fixture = createFixture();

    await expect(appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [agentEvent({ attemptNo: 2 })],
    }, fixture.dependencies)).rejects.toMatchObject({ code: "stale_lease" });

    expect(fixture.tx.agentRun.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a backdated event when the trusted server clock is past the lease", async () => {
    const fixture = createFixture({
      agentRunLeaseExpiresAt: new Date("2026-07-29T08:10:00.000Z"),
      serverNow: new Date("2026-07-29T08:20:00.000Z"),
    });

    await expect(appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [agentEvent({ occurredAt: "2026-07-29T07:00:00.000Z" })],
    }, fixture.dependencies)).rejects.toMatchObject({ code: "stale_lease" });

    expect(fixture.tx.orchestrationEvent.createMany).not.toHaveBeenCalled();
  });

  it("persists distinct execution phase transitions and appends one durable event per transition", async () => {
    const fixture = createFixture();
    const startedAt = "2026-07-29T07:59:00.000Z";
    await appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [
        executionPhaseEvent({
          eventId: "execution_phase_1",
          sequence: 1,
          payloadSummary: {
            phase: "git.fetch",
            status: "running",
            startedAt,
            finishedAt: null,
            code: null,
            summary: "正在同步远端引用",
          },
        }),
        executionPhaseEvent({
          eventId: "execution_phase_2",
          sequence: 2,
          payloadSummary: {
            phase: "git.fetch",
            status: "succeeded",
            startedAt,
            finishedAt: "2026-07-29T08:00:00.000Z",
            code: "ok",
            summary: "远端引用已同步",
          },
        }),
      ],
    }, fixture.dependencies);

    expect(fixture.executionPhaseSnapshot()).toMatchObject({
      phase: "git.fetch",
      status: "succeeded",
      startedAt: new Date(startedAt),
      finishedAt: new Date("2026-07-29T08:00:00.000Z"),
      code: "ok",
      summary: "远端引用已同步",
      updatedAt: now,
    });
    const phaseEvents = fixture.tx.orchestrationEvent.createMany.mock.calls
      .flatMap(([args]) => args.data)
      .filter((row) => row.eventType === "loop.node.execution_phase_changed");
    expect(phaseEvents).toHaveLength(2);
    expect(phaseEvents.map((row) => (row.payload as { payloadSummary: { status: string } }).payloadSummary.status))
      .toEqual(["running", "succeeded"]);
  });

  it("refreshes the phase sample time for an identical redelivered transition without appending a second event", async () => {
    const fixture = createFixture();
    const event = executionPhaseEvent();

    await appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [event],
    }, fixture.dependencies);
    await appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [{
        ...event,
        eventId: "execution_phase_1_repeat",
        sequence: 2,
        occurredAt: "2026-07-29T08:00:30.000Z",
      }],
    }, fixture.dependencies);

    expect(fixture.executionPhaseSnapshot()).toMatchObject({
      phase: "git.fetch",
      status: "running",
      updatedAt: now,
    });
    const phaseWrites = fixture.tx.loopNodeAttempt.updateMany.mock.calls
      .map(([args]) => args.data)
      .filter((data) => data?.executionPhase === "git.fetch");
    expect(phaseWrites).toHaveLength(2);
    expect(phaseWrites[1]?.executionPhaseUpdatedAt).toEqual(now);
    const phaseEvents = fixture.tx.orchestrationEvent.createMany.mock.calls
      .flatMap(([args]) => args.data)
      .filter((row) => row.eventType === "loop.node.execution_phase_changed");
    expect(phaseEvents).toHaveLength(1);
  });

  it("records one phase transition when a mixed batch repeats the same transition", async () => {
    const fixture = createFixture();

    await appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [
        executionPhaseEvent({ eventId: "execution_phase_a", sequence: 1 }),
        executionPhaseEvent({ eventId: "execution_phase_b", sequence: 2 }),
      ],
    }, fixture.dependencies);

    expect(fixture.executionPhaseSnapshot()).toMatchObject({ phase: "git.fetch", status: "running" });
    const phaseEvents = fixture.tx.orchestrationEvent.createMany.mock.calls
      .flatMap(([args]) => args.data)
      .filter((row) => row.eventType === "loop.node.execution_phase_changed");
    expect(phaseEvents).toHaveLength(1);
  });

  it("rejects a late execution phase after the attempt is terminal and preserves the final snapshot", async () => {
    const fixture = createFixture();
    await appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [executionPhaseEvent({
        eventId: "execution_phase_1",
        payloadSummary: {
          phase: "cleanup",
          status: "succeeded",
          startedAt: now.toISOString(),
          finishedAt: now.toISOString(),
          code: null,
          summary: null,
        },
      })],
    }, fixture.dependencies);
    fixture.setAttemptStatus("succeeded");

    await expect(appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [executionPhaseEvent({
        eventId: "execution_phase_late",
        sequence: 2,
        payloadSummary: {
          phase: "git.fetch",
          status: "failed",
          startedAt: now.toISOString(),
          finishedAt: now.toISOString(),
          code: "late",
          summary: "late update",
        },
      })],
    }, fixture.dependencies)).rejects.toMatchObject({ code: "stale_lease" });

    expect(fixture.executionPhaseSnapshot()).toMatchObject({ phase: "cleanup", status: "succeeded", code: null });
    const phaseEvents = fixture.tx.orchestrationEvent.createMany.mock.calls
      .flatMap(([args]) => args.data)
      .filter((row) => row.eventType === "loop.node.execution_phase_changed");
    expect(phaseEvents).toHaveLength(1);
  });

  it("rejects an invalid execution phase payload before persisting any event", async () => {
    const fixture = createFixture();

    await expect(appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [executionPhaseEvent({
        payloadSummary: {
          phase: "git.fetch",
          status: "unknown",
          startedAt: now.toISOString(),
          finishedAt: null,
          code: null,
          summary: null,
        },
      })],
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.acceptedEventCount()).toBe(0);
    expect(fixture.executionPhaseSnapshot()).toBeNull();
  });

  it("uses trusted server time to make accepted worker events immediately available", async () => {
    const fixture = createFixture();
    const futureOccurredAt = "2126-07-29T08:00:00.000Z";

    await appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [agentEvent({ occurredAt: futureOccurredAt })],
    }, fixture.dependencies);

    const eventRow = fixture.tx.orchestrationEvent.createMany.mock.calls[0]?.[0].data[0];
    const outboxRow = fixture.tx.outboxMessage.createMany.mock.calls[0]?.[0].data[0];
    expect(eventRow?.occurredAt).toBe(futureOccurredAt);
    expect(outboxRow?.availableAt).toEqual(now);
  });

  it("rejects a malformed event batch before opening a transaction", async () => {
    const fixture = createFixture();

    await expect(appendLoopAttemptEvents({
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 3,
      events: [agentEvent()],
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.db.$transaction).not.toHaveBeenCalled();
    expect(fixture.tx.agentRun.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.orchestrationEvent.createMany).not.toHaveBeenCalled();
    expect(fixture.tx.outboxMessage.createMany).not.toHaveBeenCalled();
  });

  it("accepts identical eventId redelivery without advancing sequence or appending another event", async () => {
    const fixture = createFixture();
    const input = {
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [agentEvent()],
    };

    await appendLoopAttemptEvents(input, fixture.dependencies);
    await expect(appendLoopAttemptEvents(input, fixture.dependencies)).resolves.toBeUndefined();

    expect(fixture.acceptedEventCount()).toBe(1);
    expect(fixture.tx.agentRun.updateMany).toHaveBeenCalledOnce();
    expect(fixture.tx.outboxMessage.createMany).toHaveBeenCalledOnce();
  });

  it("reauthenticates an identical event redelivery after lease takeover", async () => {
    const fixture = createFixture();
    const input = {
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [agentEvent()],
    };

    await appendLoopAttemptEvents(input, fixture.dependencies);
    fixture.takeOverAgentRunLease();

    await expect(appendLoopAttemptEvents(input, fixture.dependencies))
      .rejects.toMatchObject({ code: "stale_lease" });
    expect(fixture.acceptedEventCount()).toBe(1);
    expect(fixture.tx.outboxMessage.createMany).toHaveBeenCalledOnce();
  });

  it("rejects conflicting reuse of an already accepted eventId", async () => {
    const fixture = createFixture();
    const baseInput = {
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
    };

    await appendLoopAttemptEvents({ ...baseInput, events: [agentEvent()] }, fixture.dependencies);
    await expect(appendLoopAttemptEvents({
      ...baseInput,
      events: [agentEvent({ payloadSummary: { phase: "different" } })],
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.acceptedEventCount()).toBe(1);
  });

  it("treats equivalent event JSON with different key insertion order as identical redelivery", async () => {
    const fixture = createFixture();
    const baseInput = {
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
    };

    await appendLoopAttemptEvents({
      ...baseInput,
      events: [agentEvent({ payloadSummary: { phase: "working", step: 1 } })],
    }, fixture.dependencies);
    await expect(appendLoopAttemptEvents({
      ...baseInput,
      events: [agentEvent({ payloadSummary: { step: 1, phase: "working" } })],
    }, fixture.dependencies)).resolves.toBeUndefined();

    expect(fixture.acceptedEventCount()).toBe(1);
  });

  it("treats reordered distinct Unicode keys with equal locale collation as identical redelivery", async () => {
    const fixture = createFixture();
    const composedKey = "\u00e9";
    const decomposedKey = "e\u0301";
    const baseInput = {
      agentRunId: "agent_run_1",
      attemptId: "attempt_1",
      workerId: "worker_1",
      leaseGeneration: 2,
    };

    expect(composedKey).not.toBe(decomposedKey);
    expect(composedKey.localeCompare(decomposedKey)).toBe(0);

    await appendLoopAttemptEvents({
      ...baseInput,
      events: [agentEvent({ payloadSummary: { [composedKey]: 1, [decomposedKey]: 2 } })],
    }, fixture.dependencies);
    await expect(appendLoopAttemptEvents({
      ...baseInput,
      events: [agentEvent({ payloadSummary: { [decomposedKey]: 2, [composedKey]: 1 } })],
    }, fixture.dependencies)).resolves.toBeUndefined();

    expect(fixture.acceptedEventCount()).toBe(1);
  });

  it("reserves and resolves an effect with atomic loop_effect events and outbox rows", async () => {
    const fixture = createFixture();
    const input = effectReserveInput();
    const effectKey = "effect:51f80f4c58523e69d9c5192bb6d34572d99d0d59d44d50769cadbd7df27f6650";

    await reserveEffectExecution(input, fixture.dependencies);
    await resolveEffectExecution(effectResolutionInput(effectKey), fixture.dependencies);

    expect(fixture.tx.effectExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ effectKey, status: "prepared" }),
    });
    expect(fixture.tx.effectExecution.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { effectKey, status: { in: ["prepared", "executing"] } },
    }));
    const eventRows = fixture.tx.orchestrationEvent.createMany.mock.calls.flatMap(([args]) => args.data);
    expect(eventRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ aggregateType: "loop_effect", aggregateId: "effect_1", eventType: "loop.effect.reserved" }),
      expect.objectContaining({ aggregateType: "loop_effect", aggregateId: "effect_1", eventType: "loop.effect.resolved" }),
    ]));
    expect(fixture.effectSnapshot()).toEqual({
      status: "succeeded",
      requestFingerprint: "request_hash_1",
      resultFingerprint: "result_hash_1",
      eventCount: 2,
      outboxCount: 2,
    });
  });

  it("requires the active platform attempt claim before reserving an effect", async () => {
    const fixture = createFixture({
      attemptExecutorType: "platform",
      attemptAgentRunId: null,
    });

    await expect(reserveEffectExecution(
      effectReserveInput(),
      fixture.dependencies,
    )).rejects.toMatchObject({ code: "stale_lease" });

    expect(fixture.tx.effectExecution.create).not.toHaveBeenCalled();
  });

  it("requires the active local AgentRun lease before reserving or resolving an effect", async () => {
    const fixture = createFixture();
    const effectKey = buildEffectKey(effectReserveInput());

    await expect(reserveEffectExecution(effectReserveInput({
      workerId: "worker_other",
    }), fixture.dependencies)).rejects.toMatchObject({ code: "stale_lease" });
    expect(fixture.tx.effectExecution.create).not.toHaveBeenCalled();

    await reserveEffectExecution(effectReserveInput(), fixture.dependencies);
    await expect(resolveEffectExecution(effectResolutionInput(effectKey, {
      leaseGeneration: 1,
    }), fixture.dependencies)).rejects.toMatchObject({ code: "stale_lease" });
    expect(fixture.tx.effectExecution.updateMany).not.toHaveBeenCalled();
  });

  it("rechecks the platform claim after a concurrent effect reservation wins", async () => {
    const input = effectReserveInput() as ReturnType<typeof effectReserveInput> & { claimToken: string };
    input.claimToken = "claim_1";
    const effectKey = buildEffectKey(input);
    const existingEffect = {
      id: input.id,
      effectKey,
      loopRunId: input.loopRunId,
      nodeRunId: input.nodeRunId,
      attemptId: input.attemptId,
      operationType: input.operationType,
      requestFingerprint: input.requestFingerprint,
      providerIdempotencyKey: input.providerIdempotencyKey,
      status: "prepared",
    };
    let transactionNo = 0;
    const db = {
      effectExecution: { findUnique: vi.fn().mockResolvedValue(existingEffect) },
      $transaction: vi.fn(async (callback: (tx: Record<string, unknown>) => Promise<unknown>) => {
        transactionNo += 1;
        const tx = {
          loopNodeRun: {
            findUnique: vi.fn().mockResolvedValue({ id: "node_run_1", loopRunId: "loop_run_1" }),
          },
          loopNodeAttempt: {
            findUnique: vi.fn().mockResolvedValue({
              id: "attempt_1",
              loopNodeRunId: "node_run_1",
              executorType: "platform",
              status: "running",
              agentRunId: null,
              claimToken: transactionNo === 1 ? "claim_1" : "claim_2",
              claimExpiresAt: new Date("2026-07-29T08:10:00.000Z"),
            }),
          },
          effectExecution: {
            findUnique: vi.fn().mockResolvedValue(transactionNo === 1 ? null : existingEffect),
            create: vi.fn().mockRejectedValue(Object.assign(new Error("P2002"), { code: "P2002" })),
          },
        };
        return callback(tx as never);
      }),
    };

    await expect(reserveEffectExecution(input, {
      db: db as never,
      now: () => now,
    })).rejects.toMatchObject({ code: "stale_lease" });
  });

  it("rejects mismatched effect run, node, and attempt identity before mutation", async () => {
    const fixture = createFixture({ effectNodeLoopRunId: "loop_run_other" });

    await expect(reserveEffectExecution(effectReserveInput(), fixture.dependencies)).rejects.toMatchObject({
      code: "stale_lease",
    });

    expect(fixture.tx.effectExecution.create).not.toHaveBeenCalled();
    expect(fixture.tx.effectExecution.upsert).not.toHaveBeenCalled();
    expect(fixture.tx.orchestrationEvent.createMany).not.toHaveBeenCalled();
    expect(fixture.tx.outboxMessage.createMany).not.toHaveBeenCalled();
  });

  it("makes identical effect reservation and resolution retries idempotent", async () => {
    const fixture = createFixture();
    const effectKey = buildEffectKey(effectReserveInput());

    await reserveEffectExecution(effectReserveInput(), fixture.dependencies);
    await reserveEffectExecution(effectReserveInput(), fixture.dependencies);
    await resolveEffectExecution(effectResolutionInput(effectKey), fixture.dependencies);
    await resolveEffectExecution(effectResolutionInput(effectKey), fixture.dependencies);

    expect(fixture.tx.effectExecution.create).toHaveBeenCalledOnce();
    expect(fixture.tx.effectExecution.updateMany).toHaveBeenCalledOnce();
    expect(fixture.effectSnapshot()).toEqual(expect.objectContaining({ eventCount: 2, outboxCount: 2 }));
  });

  it("recovers an identical effect resolution after a concurrent CAS winner", async () => {
    const boundary = createConcurrentEffectResolutionBoundary();

    await expect(resolveEffectExecution(
      effectResolutionInput(boundary.effectKey),
      boundary.dependencies,
    )).resolves.toBeUndefined();

    expect(boundary.committedFind).toHaveBeenCalledOnce();
    expect(boundary.tx.orchestrationEvent.createMany).not.toHaveBeenCalled();
    expect(boundary.tx.outboxMessage.createMany).not.toHaveBeenCalled();
  });

  it("rejects a non-terminal effect resolution status before mutation", async () => {
    const fixture = createFixture();
    const effectKey = buildEffectKey(effectReserveInput());
    await reserveEffectExecution(effectReserveInput(), fixture.dependencies);

    await expect(resolveEffectExecution({
      ...effectResolutionInput(effectKey),
      status: "executing" as "succeeded",
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.db.$transaction).toHaveBeenCalledOnce();
    expect(fixture.effectSnapshot()).toEqual({
      status: "prepared",
      requestFingerprint: "request_hash_1",
      resultFingerprint: null,
      eventCount: 1,
      outboxCount: 1,
    });
  });

  it("rejects conflicting request and result fingerprints for the same logical effect", async () => {
    const fixture = createFixture();
    const effectKey = buildEffectKey(effectReserveInput());

    await reserveEffectExecution(effectReserveInput(), fixture.dependencies);
    await expect(reserveEffectExecution(effectReserveInput({
      requestFingerprint: "request_hash_conflict",
    }), fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    await resolveEffectExecution(effectResolutionInput(effectKey), fixture.dependencies);
    await expect(resolveEffectExecution(effectResolutionInput(effectKey, {
      resultFingerprint: "result_hash_conflict",
    }), fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.effectSnapshot()).toEqual(expect.objectContaining({
      requestFingerprint: "request_hash_1",
      resultFingerprint: "result_hash_1",
      eventCount: 2,
      outboxCount: 2,
    }));
  });

  it("rejects a receipt whose operation request does not match the reservation", async () => {
    const fixture = createFixture();
    const effectKey = buildEffectKey(effectReserveInput());
    await reserveEffectExecution(effectReserveInput(), fixture.dependencies);

    await expect(resolveEffectExecution({
      ...effectResolutionInput(effectKey),
      requestFingerprint: "request_hash_other",
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });
    expect(fixture.tx.effectExecution.updateMany).not.toHaveBeenCalled();
  });

  it("rolls back effect state when its event outbox append fails", async () => {
    const reserveFixture = createFixture();
    reserveFixture.failNextOutbox();

    await expect(reserveEffectExecution(effectReserveInput(), reserveFixture.dependencies)).rejects.toThrowError(
      "Injected outbox failure",
    );
    expect(reserveFixture.effectSnapshot()).toEqual({
      status: null,
      requestFingerprint: null,
      resultFingerprint: null,
      eventCount: 0,
      outboxCount: 0,
    });

    const resolveFixture = createFixture();
    const effectKey = buildEffectKey(effectReserveInput());
    await reserveEffectExecution(effectReserveInput(), resolveFixture.dependencies);
    resolveFixture.failNextOutbox();

    await expect(resolveEffectExecution(effectResolutionInput(effectKey), resolveFixture.dependencies)).rejects.toThrowError(
      "Injected outbox failure",
    );
    expect(resolveFixture.effectSnapshot()).toEqual({
      status: "prepared",
      requestFingerprint: "request_hash_1",
      resultFingerprint: null,
      eventCount: 1,
      outboxCount: 1,
    });
  });

  it("builds bounded delimiter-safe effect keys from the canonical tuple", () => {
    const key = buildEffectKey({
      id: "effect_1",
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      attemptId: "attempt_1",
      operationType: "document.write",
      requestFingerprint: "request_hash_1",
    });
    const delimiterLeft = buildEffectKey({
      id: "effect_1",
      loopRunId: "loop:run",
      nodeRunId: "node",
      attemptId: "attempt",
      operationType: "document.write",
      requestFingerprint: "request_hash_1",
    });
    const delimiterRight = buildEffectKey({
      id: "effect_1",
      loopRunId: "loop",
      nodeRunId: "run:node",
      attemptId: "attempt",
      operationType: "document.write",
      requestFingerprint: "request_hash_1",
    });
    const longKey = buildEffectKey({
      id: "i".repeat(512),
      loopRunId: "l".repeat(512),
      nodeRunId: "n".repeat(512),
      attemptId: "a".repeat(512),
      operationType: "o".repeat(512),
      requestFingerprint: "r".repeat(512),
    });

    expect(key).toBe("effect:51f80f4c58523e69d9c5192bb6d34572d99d0d59d44d50769cadbd7df27f6650");
    expect(delimiterLeft).not.toBe(delimiterRight);
    expect(longKey).toHaveLength(71);
  });

  it("reads the graph projection without querying legacy LoopIteration records", async () => {
    const fixture = createFixture();

    await readLoopRunProjection("loop_run_1", fixture.dependencies);

    expect(fixture.db.loopRun.findUnique).toHaveBeenCalledWith({
      where: { id: "loop_run_1", engineKind: "graph_v1" },
      include: expect.objectContaining({ nodeRuns: expect.any(Object) }),
    });
  });
});

describe.skipIf(!loopRuntimeTestDatabaseUrl)("graph loop runtime MariaDB integration", () => {
  const prefix = `looprt_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const ids = {
    team: `${prefix}_team`,
    user: `${prefix}_user`,
    space: `${prefix}_space`,
    project: `${prefix}_project`,
    definition: `${prefix}_definition`,
    version: `${prefix}_version`,
    binding: `${prefix}_binding`,
    sourceEvent: `${prefix}_source`,
    receiptA: `${prefix}_receipt_a`,
    receiptB: `${prefix}_receipt_b`,
    runA: `${prefix}_run_a`,
    runB: `${prefix}_run_b`,
  };
  let client: ReturnType<typeof createPrismaClient> | undefined;

  beforeAll(async () => {
    client = createPrismaClient(loopRuntimeTestDatabaseUrl!);
    await client.$connect();
    await client.team.create({ data: { id: ids.team, name: `${prefix} team` } });
    await client.user.create({
      data: { id: ids.user, teamId: ids.team, name: `${prefix} user`, status: "active" },
    });
    await client.space.create({
      data: {
        id: ids.space,
        type: "personal",
        ownerUserId: ids.user,
        name: `${prefix} space`,
        status: "active",
      },
    });
    await client.project.create({
      data: {
        id: ids.project,
        teamId: ids.team,
        spaceId: ids.space,
        ownerType: "personal",
        ownerUserId: ids.user,
        name: `${prefix} project`,
      },
    });
    await client.loopDefinition.create({
      data: {
        id: ids.definition,
        spaceId: ids.space,
        name: `${prefix} definition`,
        ownerUserId: ids.user,
        draftGraph: {},
        status: "draft",
      },
    });
    await client.loopVersion.create({
      data: {
        id: ids.version,
        loopDefinitionId: ids.definition,
        versionNumber: 1,
        graphSchemaVersion: 1,
        graph: runtimeGraph,
        maxStages: runtimeGraph.limits.maxStages,
        maxRepeatCount: runtimeGraph.limits.maxRepeatCount,
        platformMaxTransitions: 12,
        checksum: `${prefix}_checksum`,
        publishedByUserId: ids.user,
        publishedAt: now,
        status: "published",
      },
    });
    await client.projectLoopBinding.create({
      data: {
        id: ids.binding,
        projectId: ids.project,
        loopDefinitionId: ids.definition,
        activeVersionId: ids.version,
        status: "enabled",
        triggerPolicy: {},
        parameterOverrides: {},
        notificationPolicy: {},
        automationGrantIds: [],
        createdByUserId: ids.user,
        version: 2,
      },
    });
  }, 20_000);

  afterAll(async () => {
    if (!client) return;
    try {
      const nodeRuns = await client.loopNodeRun.findMany({
        where: { loopRunId: { in: [ids.runA, ids.runB] } },
        select: { id: true },
      });
      const aggregateIds = [ids.runA, ids.runB, ...nodeRuns.map((nodeRun) => nodeRun.id)];
      await client.outboxMessage.deleteMany({
        where: { aggregateType: { in: ["run", "loop_node"] }, aggregateId: { in: aggregateIds } },
      });
      await client.orchestrationEvent.deleteMany({
        where: { aggregateType: { in: ["run", "loop_node"] }, aggregateId: { in: aggregateIds } },
      });
      await client.orchestrationAggregateSequence.deleteMany({
        where: { aggregateType: { in: ["run", "loop_node"] }, aggregateId: { in: aggregateIds } },
      });
      await client.loopNodeRun.deleteMany({
        where: { loopRunId: { in: [ids.runA, ids.runB] } },
      });
      await client.loopRun.deleteMany({ where: { id: { in: [ids.runA, ids.runB] } } });
      await client.triggerReceipt.deleteMany({ where: { bindingId: ids.binding } });
      await client.projectLoopBinding.deleteMany({ where: { id: ids.binding } });
      await client.loopVersion.deleteMany({ where: { id: ids.version } });
      await client.loopDefinition.deleteMany({ where: { id: ids.definition } });
      await client.project.deleteMany({ where: { id: ids.project } });
      await client.space.deleteMany({ where: { id: ids.space } });
      await client.user.deleteMany({ where: { id: ids.user } });
      await client.team.deleteMany({ where: { id: ids.team } });
    } finally {
      await client.$disconnect();
    }
  }, 20_000);

  it("recovers the winning graph run after real MariaDB unique-key contention", async () => {
    if (!client) throw new Error("Live Prisma client was not initialized");
    const boundary = createLiveTriggerRaceBoundary(client);
    const { commandId: _commandId, ...baseInput } = createRunInput();

    const [first, duplicate] = await Promise.all([
      createGraphLoopRun({
        ...baseInput,
        id: ids.runA,
        triggerReceiptId: ids.receiptA,
        bindingId: ids.binding,
        sourceEventId: ids.sourceEvent,
        projectId: ids.project,
        loopVersionId: ids.version,
        bindingSnapshot: {
          ...(baseInput.bindingSnapshot as Record<string, unknown>),
          id: ids.binding,
          projectId: ids.project,
          // The live fixture publishes its own Loop definition, so the binding
          // snapshot must name that definition rather than the shared fixture's.
          loopDefinitionId: ids.definition,
          activeVersionId: ids.version,
          version: 2,
        },
        correlationId: `${prefix}_correlation_a`,
        actor: { type: "user", id: ids.user },
      }, boundary.dependencies),
      createGraphLoopRun({
        ...baseInput,
        id: ids.runB,
        triggerReceiptId: ids.receiptB,
        bindingId: ids.binding,
        sourceEventId: ids.sourceEvent,
        projectId: ids.project,
        loopVersionId: ids.version,
        bindingSnapshot: {
          ...(baseInput.bindingSnapshot as Record<string, unknown>),
          id: ids.binding,
          projectId: ids.project,
          loopDefinitionId: ids.definition,
          activeVersionId: ids.version,
          version: 2,
        },
        correlationId: `${prefix}_correlation_b`,
        actor: { type: "user", id: ids.user },
      }, boundary.dependencies),
    ]);

    expect(duplicate).toEqual(first);
    expect([ids.runA, ids.runB]).toContain(first.id);
    const boundarySnapshot = boundary.snapshot();
    // MariaDB reports the losing duplicate as either P2002 or P2034. P2002 is
    // recovered by a side read; P2034 retries the command once, whose initial
    // receipt lookup then returns the committed winner. Exactly one of those
    // paths must recover `first`, no path may create a second Run, and the
    // losing command must never surface the conflict to its caller.
    expect(boundarySnapshot.p2002RollbackCount + boundarySnapshot.p2034RollbackCount).toBe(1);
    expect(boundarySnapshot.initialReceiptReadCount).toBeGreaterThanOrEqual(2);
    if (boundarySnapshot.p2002RollbackCount === 1) {
      expect(boundarySnapshot.transactionCount).toBe(2);
      expect(boundarySnapshot.recoveryReadCount).toBe(1);
      expect(boundarySnapshot.recoveryRunIds).toEqual([first.id]);
    } else {
      expect(boundarySnapshot.transactionCount).toBe(3);
      expect(boundarySnapshot.recoveryReadCount).toBe(0);
      expect(boundarySnapshot.recoveryRunIds).toEqual([]);
    }

    const nodeRuns = await client.loopNodeRun.findMany({
      where: { loopRunId: { in: [ids.runA, ids.runB] } },
      select: { id: true, status: true },
    });
    const aggregateIds = [ids.runA, ids.runB, ...nodeRuns.map((nodeRun) => nodeRun.id)];
    const [receiptCount, runCount, eventCount, outboxCount, persistedRun] = await Promise.all([
      client.triggerReceipt.count({
        where: {
          bindingId: ids.binding,
          triggerType: "manual",
          sourceEventId: ids.sourceEvent,
        },
      }),
      client.loopRun.count({ where: { id: { in: [ids.runA, ids.runB] } } }),
      client.orchestrationEvent.count({
        where: { aggregateType: { in: ["run", "loop_node"] }, aggregateId: { in: aggregateIds } },
      }),
      client.outboxMessage.count({
        where: { aggregateType: { in: ["run", "loop_node"] }, aggregateId: { in: aggregateIds } },
      }),
      client.loopRun.findUnique({
        where: { id: first.id },
        select: {
          id: true,
          projectId: true,
          loopVersionId: true,
          bindingId: true,
          triggerReceiptId: true,
          triggerReceipt: { select: { id: true } },
        },
      }),
    ]);

    expect({ receiptCount, runCount, eventCount, outboxCount }).toEqual({
      receiptCount: 1,
      runCount: 1,
      eventCount: 2,
      outboxCount: 2,
    });
    expect(nodeRuns).toEqual([expect.objectContaining({ status: "ready" })]);
    expect(persistedRun).toEqual({
      id: first.id,
      projectId: ids.project,
      loopVersionId: ids.version,
      bindingId: ids.binding,
      triggerReceiptId: first.id === ids.runA ? ids.receiptA : ids.receiptB,
      triggerReceipt: { id: first.id === ids.runA ? ids.receiptA : ids.receiptB },
    });
  }, 20_000);
});

function createRunInput() {
  return {
    id: "loop_run_1",
    triggerReceiptId: "trigger_receipt_1",
    bindingId: "binding_1",
    triggerType: "manual",
    sourceEventId: "command_1",
    commandId: "command_1",
    projectId: "project_1",
    loopVersionId: "loop_version_1",
    inputSnapshot: { request: "run" },
    bindingSnapshot: {
      id: "binding_1",
      projectId: "project_1",
      loopDefinitionId: "loop_definition_1",
      activeVersionId: "loop_version_1",
      status: "enabled",
      version: 2,
      createdByUserId: "user_1",
      parameterOverrides: {},
      allowedAgentProfileIds: [],
      allowedProviders: [],
    },
    policySnapshot: { policy: "snapshot" },
    grantSnapshot: { grant: "snapshot" },
    budgetSnapshot: { maxTransitions: 4, maxRepeatCount: 1 },
    occurredAt: now,
    correlationId: "correlation_1",
    actor: { type: "user", id: "user_1" },
  };
}

function completeInput() {
  return {
    loopRunId: "loop_run_1",
    nodeRunId: "node_run_1",
    nodeRunVersion: 4,
    attemptId: "attempt_1",
    attemptNo: 1,
    attemptVersion: 1,
    agentRunId: "agent_run_1",
    workerId: "worker_1",
    leaseGeneration: 2,
    claimToken: "claim_1",
    result: { outcome: "success", output: { done: true }, artifactRefs: [], effectReceipts: [] },
    transition: {
      status: "routed",
      edge: {
        id: "edge_next",
        source: "implement",
        target: "next",
        kind: "normal",
        outcome: "success",
      },
      counters: { transitions: 1, repeats: 0, edgeTraversals: { edge_next: 1 } },
      targetActivationNo: 1,
    },
    occurredAt: now,
    correlationId: "correlation_1",
    actor: { type: "agent", id: "worker_1" },
  };
}

function authoritativeCompleteInput() {
  const { transition: _callerTransition, ...input } = completeInput();
  return input as never;
}

function waitingResumeInput(overrides: Record<string, unknown>) {
  return {
    loopRunId: "loop_run_1",
    nodeRunId: "node_run_1",
    nodeRunVersion: 4,
    attemptId: "attempt_1",
    attemptNo: 1,
    attemptVersion: 1,
    result: { outcome: "success", output: { done: true }, artifactRefs: [], effectReceipts: [] },
    occurredAt: now,
    correlationId: "loop:loop_run_1",
    actor: { type: "system" as const, id: "loop-wait-resumer" },
    ...overrides,
  } as never;
}

function createChildLoopResumeFixture(input: {
  childStatus: string;
  checkpointChildLoopRunId?: string;
  duplicate?: boolean;
  reviewArtifacts?: Array<{
    id: string;
    storageKey: string;
    mimeType: string;
    byteSize: bigint;
    metadata: unknown;
  }>;
}) {
  const resume = vi.fn().mockResolvedValue({
    completed: !input.duplicate,
    duplicate: input.duplicate ?? false,
  });
  const db = {
    loopRun: {
      findUnique: vi.fn().mockResolvedValue({
        id: "child_run_1",
        status: input.childStatus,
        parentLoopRunId: "parent_run_1",
        parentNodeRunId: "parent_node_1",
        parentAttemptId: "parent_attempt_1",
      }),
    },
    loopNodeAttempt: {
      findUnique: vi.fn().mockResolvedValue({
        id: "parent_attempt_1",
        attempt: 1,
        version: 3,
        status: "waiting",
        checkpoint: {
          waitingReason: "child_loop",
          childLoopRunId: input.checkpointChildLoopRunId ?? "child_run_1",
        },
        loopNodeRun: {
          id: "parent_node_1",
          loopRunId: "parent_run_1",
          version: 5,
          status: "waiting_input",
        },
      }),
    },
    artifact: {
      findMany: vi.fn().mockResolvedValue(input.reviewArtifacts ?? []),
    },
  };
  return { resume, dependencies: { db, resume } as never };
}

function agentEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "agent_event_1",
    loopRunId: "loop_run_1",
    loopNodeRunId: "node_run_1",
    loopNodeAttemptId: "attempt_1",
    attemptNo: 1,
    leaseGeneration: 2,
    sequence: 1,
    eventType: "loop.node.progressed",
    occurredAt: now.toISOString(),
    payloadSummary: { phase: "working" },
    artifactRefs: [],
    ...overrides,
  };
}

function executionPhaseEvent(overrides: Record<string, unknown> = {}) {
  return agentEvent({
    eventId: "execution_phase_1",
    eventType: "loop.node.execution_phase_changed",
    payloadSummary: {
      phase: "git.fetch",
      status: "running",
      startedAt: now.toISOString(),
      finishedAt: null,
      code: null,
      summary: "正在同步远端引用",
    },
    ...overrides,
  });
}

function effectReserveInput(overrides: Partial<{
  requestFingerprint: string;
  workerId: string;
  leaseGeneration: number;
}> = {}) {
  return {
    id: "effect_1",
    loopRunId: "loop_run_1",
    nodeRunId: "node_run_1",
    attemptId: "attempt_1",
    operationType: "document.write",
    requestFingerprint: "request_hash_1",
    providerIdempotencyKey: "provider_key_1",
    workerId: "worker_1",
    leaseGeneration: 2,
    occurredAt: now,
    correlationId: "correlation_1",
    actor: { type: "worker" as const, id: "worker_1" },
    ...overrides,
  };
}

function effectResolutionInput(effectKey: string, overrides: Partial<{
  resultFingerprint: string;
  workerId: string;
  leaseGeneration: number;
  requestFingerprint: string;
}> = {}) {
  return {
    effectKey,
    loopRunId: "loop_run_1",
    nodeRunId: "node_run_1",
    attemptId: "attempt_1",
    status: "succeeded" as const,
    operationType: "document.write",
    requestFingerprint: "request_hash_1",
    providerReceipt: { id: "receipt_1" },
    resultFingerprint: "result_hash_1",
    workerId: "worker_1",
    leaseGeneration: 2,
    resolvedAt: now,
    correlationId: "correlation_1",
    actor: { type: "worker" as const, id: "worker_1" },
    ...overrides,
  };
}

function createConfigurationGateFixture(input: {
  nodeStatus?: "ready" | "waiting_configuration";
  runStatus?: "running" | "waiting";
  nodeVersion?: number;
  waitingReason?: string | null;
  readinessEvidence?: unknown;
} = {}) {
  const nodeStatus = input.nodeStatus ?? "ready";
  const runStatus = input.runStatus ?? "running";
  const nodeVersion = input.nodeVersion ?? 1;
  const tx = {
    loopNodeRun: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn(),
    },
    loopRun: {
      findUnique: vi.fn().mockResolvedValue({
        id: "loop_run_1",
        projectId: "project_1",
        engineKind: "graph_v1",
        status: runStatus,
        version: 4,
        projectionVersion: 7,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    agentRun: { create: vi.fn() },
    loopNodeAttempt: { create: vi.fn() },
    notificationIntent: {
      findUnique: vi.fn().mockResolvedValue(null),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    orchestrationAggregateSequence: { upsert: vi.fn().mockResolvedValue({ sequence: 8 }) },
    orchestrationEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    outboxMessage: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const db = {
    $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  return {
    tx,
    dependencies: {
      db,
      loadNodeRun: vi.fn().mockResolvedValue({
        id: "node_run_1",
        loopRunId: "loop_run_1",
        nodeKey: "code",
        activationNo: 1,
        status: nodeStatus,
        version: nodeVersion,
        waitingReason: input.waitingReason ?? null,
        readinessEvidence: input.readinessEvidence ?? null,
      }),
    } as never,
  };
}

function createFixture(input: {
  agentRunWorkerId?: string | null;
  linuxWorkerPoolSessionId?: string | null;
  agentRunLeaseExpiresAt?: Date;
  agentRunUpdateCount?: number;
  attemptAgentRunId?: string | null;
  attemptExecutorType?: "local" | "platform";
  attemptLoopRunId?: string;
  existingTriggerRun?: { id: string; engineKind: string };
  attemptClaimToken?: string | null;
  attemptLeaseExpiresAt?: Date | null;
  attemptStatus?: "running" | "waiting";
  attemptCheckpoint?: unknown;
  nodeRunUpdateCount?: number;
  nodeAttemptCount?: number;
  runUpdateCount?: number;
  runTransitionCount?: number;
  runRepeatCount?: number;
  runUsageAggregate?: unknown;
  runBudgetSnapshot?: unknown;
  runGraphSnapshot?: unknown;
  graphDigest?: string | null;
  loopVersionId?: string;
  currentNodeKey?: string;
  graph?: LoopGraph | LoopGraphV2;
  targetMaxActivationNo?: number | null;
  effectNodeLoopRunId?: string;
  nodeRunStatus?: "ready" | "running" | "waiting_input";
  runStatus?: "running" | "waiting";
  serverNow?: Date;
  subloopAttemptCount?: number;
  scheduledAttempt?: {
    id: string;
    attempt: number;
    executorType: "local" | "platform";
    inputFingerprint: string;
    version?: number;
  };
  failureDecisionRollout?: {
    shadowClassification: boolean;
    enforceFailureDecision: boolean;
    enforceMobileSourceIntervention: boolean;
  };
  bindingState?: {
    id: string;
    projectId: string;
    loopDefinitionId?: string;
    status: string;
    version: number;
    activeVersionId: string;
    loopDefinition?: { status: string };
  };
  loopVersionState?: {
    id: string;
    loopDefinitionId: string;
    status: string;
  };
  parentRunState?: {
    id: string;
    projectId: string;
    taskId: string | null;
    scheduledTaskRunId?: string | null;
    runGraphSnapshot: unknown;
    graphDigest: string | null;
    snapshotVersion: number | null;
  };
  scheduledTaskPreparationRunState?: {
    id: string;
    status: string;
    version: number;
    preparationLeaseToken: string | null;
    preparationLeaseExpiresAt: Date | null;
  } | null;
} = {}) {
  const graph = input.graph ?? runtimeGraph;
  const loopVersionId = input.loopVersionId ?? "loop_version_1";
  const runTransitionCount = input.runTransitionCount ?? 1;
  const runRepeatCount = input.runRepeatCount ?? 0;
  const runUsageAggregate = input.runUsageAggregate ?? {
    transitions: runTransitionCount,
    repeats: runRepeatCount,
    edgeTraversals: { "start-implement": 1 },
  };
  const persisted = {
    agentRunStatus: "running",
    agentRunLeaseGeneration: 2,
    agentRunLastEventSequence: 0,
    attemptStatus: input.attemptStatus ?? "running",
    attemptCheckpoint: input.attemptCheckpoint ?? null,
    executionPhase: null as Record<string, unknown> | null,
    nodeRunStatus: input.nodeRunStatus ?? "running",
    loopRunStatus: input.runStatus ?? "running",
    orchestrationEventCount: 0,
  };
  const orchestrationEvents = new Map<string, { id: string; payload: unknown }>();
  const effects = new Map<string, Record<string, unknown>>();
  let outboxCount = 0;
  let failNextOutbox = false;
  const tx = {
    agentWorker: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    triggerReceipt: {
      findUnique: vi.fn().mockResolvedValue(input.existingTriggerRun ? { loopRun: input.existingTriggerRun } : null),
      create: vi.fn().mockResolvedValue({}),
    },
    projectLoopBinding: {
      findUnique: vi.fn().mockResolvedValue({
        id: "binding_1",
        projectId: "project_1",
        loopDefinitionId: "loop_definition_1",
        status: "enabled",
        version: 2,
        activeVersionId: "loop_version_1",
        loopDefinition: { status: "active" },
        ...(input.bindingState ?? {}),
      }),
    },
    projectScheduledTaskRun: {
      findUnique: vi.fn().mockResolvedValue(input.scheduledTaskPreparationRunState ?? null),
    },
    loopRun: {
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockImplementation(async (args: { data?: { status?: string } }) => {
        const count = input.runUpdateCount ?? 1;
        if (count === 1 && args.data?.status) persisted.loopRunStatus = args.data.status;
        return { count };
      }),
      findUnique: vi.fn().mockImplementation(async (args: { where?: { id?: string } }) => (
        input.parentRunState && args.where?.id === input.parentRunState.id
          ? input.parentRunState
          : ({
        id: "loop_run_1",
        projectId: "project_1",
        scheduledTaskRunId: null,
        engineKind: "graph_v1",
        loopVersionId,
        status: persisted.loopRunStatus,
        version: 7,
        projectionVersion: 3,
        transitionCount: runTransitionCount,
        repeatCount: runRepeatCount,
        usageAggregate: runUsageAggregate,
        budgetSnapshot: input.runBudgetSnapshot ?? { maxStages: 4, maxRepeatCount: 2, maxTransitions: 8 },
        runGraphSnapshot: input.runGraphSnapshot ?? null,
        graphDigest: input.graphDigest ?? null,
        loopVersion: {
          id: loopVersionId,
          graph,
          maxStages: graph.limits.maxStages,
          maxRepeatCount: graph.limits.maxRepeatCount,
          platformMaxTransitions: 12,
          status: "published",
        },
        nodeRuns: [],
      })
      )),
    },
    loopVersion: {
      findUnique: vi.fn().mockResolvedValue({
        id: input.loopVersionState?.id ?? loopVersionId,
        loopDefinitionId: input.loopVersionState?.loopDefinitionId ?? "loop_definition_1",
        graph,
        maxStages: graph.limits.maxStages,
        maxRepeatCount: graph.limits.maxRepeatCount,
        platformMaxTransitions: 12,
        status: input.loopVersionState?.status ?? "published",
      }),
    },
    loopNodeRun: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({
        id: "node_run_1",
        loopRunId: input.effectNodeLoopRunId ?? "loop_run_1",
        nodeKey: "implement",
        activationNo: 1,
        status: input.nodeRunStatus ?? "ready",
        version: 1,
        attemptCount: input.nodeAttemptCount ?? 0,
        inputSnapshot: { task: "implement" },
        loopRun: { id: "loop_run_1", projectId: "project_1", taskId: null, status: persisted.loopRunStatus },
      }),
      findFirst: vi.fn().mockResolvedValue(
        input.targetMaxActivationNo == null ? null : { activationNo: input.targetMaxActivationNo },
      ),
      updateMany: vi.fn().mockImplementation(async (args: { data?: { status?: string } }) => {
        const count = input.nodeRunUpdateCount ?? 1;
        if (count === 1 && args.data?.status) persisted.nodeRunStatus = args.data.status;
        return { count };
      }),
    },
    loopNodeAttempt: {
      create: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(input.subloopAttemptCount ?? 1),
      findUnique: vi.fn().mockImplementation(async (args: { where?: { id?: string; loopNodeRunId_attempt?: unknown } }) => {
        if (args.where?.loopNodeRunId_attempt) {
          return input.scheduledAttempt === undefined
            ? null
            : {
                ...input.scheduledAttempt,
                status: "scheduled",
                agentRunId: null,
                version: input.scheduledAttempt.version ?? 1,
              };
        }
        return {
          id: "attempt_1",
          loopNodeRunId: "node_run_1",
          attempt: 1,
          executorType: input.attemptExecutorType ?? "local",
          inputFingerprint: "input_fingerprint_1",
          version: 1,
          status: persisted.attemptStatus,
          checkpoint: persisted.attemptCheckpoint,
          executionPhase: persisted.executionPhase?.phase ?? null,
          executionPhaseStatus: persisted.executionPhase?.status ?? null,
          executionPhaseStartedAt: persisted.executionPhase?.startedAt ?? null,
          executionPhaseFinishedAt: persisted.executionPhase?.finishedAt ?? null,
          executionPhaseCode: persisted.executionPhase?.code ?? null,
          executionPhaseSummary: persisted.executionPhase?.summary ?? null,
          executionPhaseUpdatedAt: persisted.executionPhase?.updatedAt ?? null,
          claimToken: input.attemptClaimToken === undefined ? "claim_1" : input.attemptClaimToken,
          claimExpiresAt: input.attemptLeaseExpiresAt === undefined
            ? new Date("2026-07-29T08:10:00.000Z")
            : input.attemptLeaseExpiresAt,
          agentRunId: input.attemptAgentRunId === undefined ? "agent_run_1" : input.attemptAgentRunId,
          loopNodeRun: {
            loopRunId: input.attemptLoopRunId ?? "loop_run_1",
            nodeKey: input.currentNodeKey ?? "implement",
            activationNo: 1,
            version: 4,
            status: persisted.nodeRunStatus,
            inputSnapshot: { task: "implement" },
            loopRun: { id: "loop_run_1", projectId: "project_1", taskId: null, status: persisted.loopRunStatus },
          },
        };
      }),
      updateMany: vi.fn().mockImplementation(async (args: {
        where?: { id?: string; status?: string; executionPhase?: string | null; executionPhaseStatus?: string | null };
        data?: {
          status?: string;
          checkpoint?: unknown;
          executionPhase?: string;
          executionPhaseStatus?: string;
          executionPhaseStartedAt?: Date | null;
          executionPhaseFinishedAt?: Date | null;
          executionPhaseCode?: string | null;
          executionPhaseSummary?: string | null;
          executionPhaseUpdatedAt?: Date;
        };
      }) => {
        if (
          args.where
          && "executionPhaseStatus" in args.where
          && (
            args.where.status !== persisted.attemptStatus
            || (args.where.executionPhaseStatus ?? null) !== (persisted.executionPhase?.status ?? null)
          )
        ) return { count: 0 };
        if (args.data?.status) persisted.attemptStatus = args.data.status;
        if (args.data?.checkpoint !== undefined) persisted.attemptCheckpoint = args.data.checkpoint;
        if (args.data?.executionPhase !== undefined) {
          persisted.executionPhase = {
            phase: args.data.executionPhase,
            status: args.data.executionPhaseStatus ?? null,
            startedAt: args.data.executionPhaseStartedAt ?? null,
            finishedAt: args.data.executionPhaseFinishedAt ?? null,
            code: args.data.executionPhaseCode ?? null,
            summary: args.data.executionPhaseSummary ?? null,
            updatedAt: args.data.executionPhaseUpdatedAt ?? null,
          };
        }
        return { count: 1 };
      }),
    },
    workflowInteraction: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    notificationIntent: {
      findUnique: vi.fn().mockResolvedValue(null),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    agentRun: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockImplementation(async (args: { select?: { taskId?: boolean } }) => (
        args.select?.taskId
          ? {
              id: "agent_run_1",
              taskId: null,
              attempt: 1,
              workerId: input.agentRunWorkerId === undefined ? "worker_1" : input.agentRunWorkerId,
              linuxWorkerPoolSessionId: input.linuxWorkerPoolSessionId ?? null,
              leaseGeneration: persisted.agentRunLeaseGeneration,
              leaseExpiresAt: new Date("2026-07-29T08:10:00.000Z"),
              status: persisted.agentRunStatus,
              loopRunId: "loop_run_1",
              loopNodeRunId: "node_run_1",
            }
          : {
              id: "agent_run_1",
              status: "orphaned",
              loopRunId: "loop_run_1",
              loopNodeRunId: "node_run_1",
              loopRun: {
                engineKind: "graph_v1",
                status: persisted.loopRunStatus,
                version: 7,
                projectionVersion: 3,
              },
            }
      )),
      updateMany: vi.fn().mockImplementation(async (args: {
        where: { lastEventSequence?: number | { lt: number }; leaseExpiresAt?: { gt: Date } };
        data: { lastEventSequence?: number; status?: string };
      }) => {
        const count = input.agentRunUpdateCount
          ?? (!input.agentRunLeaseExpiresAt || !args.where.leaseExpiresAt
            ? 1
            : input.agentRunLeaseExpiresAt > args.where.leaseExpiresAt.gt ? 1 : 0);
        if (
          args.where.lastEventSequence !== undefined
          && (typeof args.where.lastEventSequence === "number"
            ? args.where.lastEventSequence !== persisted.agentRunLastEventSequence
            : persisted.agentRunLastEventSequence >= args.where.lastEventSequence.lt)
        ) return { count: 0 };
        if (count === 1 && args.data.lastEventSequence !== undefined) {
          persisted.agentRunLastEventSequence = args.data.lastEventSequence;
        }
        if (count === 1 && args.data.status) persisted.agentRunStatus = args.data.status;
        return { count };
      }),
    },
    effectExecution: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { effectKey: string } }) => (
        effects.get(where.effectKey) ?? null
      )),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> & { effectKey: string } }) => {
        if (effects.has(data.effectKey)) throw persistenceError("P2002");
        effects.set(data.effectKey, { ...data });
        return data;
      }),
      upsert: vi.fn().mockImplementation(async ({ where, create }: {
        where: { effectKey: string };
        create: Record<string, unknown> & { effectKey: string };
      }) => {
        const existing = effects.get(where.effectKey);
        if (existing) return existing;
        effects.set(where.effectKey, { ...create });
        return create;
      }),
      updateMany: vi.fn().mockImplementation(async ({ where, data }: {
        where: { effectKey: string; status?: { in: string[] } };
        data: Record<string, unknown>;
      }) => {
        const existing = effects.get(where.effectKey);
        if (!existing || (where.status && !where.status.in.includes(String(existing.status)))) return { count: 0 };
        effects.set(where.effectKey, { ...existing, ...data });
        return { count: 1 };
      }),
    },
    orchestrationAggregateSequence: { upsert: vi.fn().mockResolvedValue({ sequence: 1 }) },
    orchestrationEvent: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => (
        orchestrationEvents.get(where.id) ?? null
      )),
      findMany: vi.fn().mockImplementation(async () => [...orchestrationEvents.values()]),
      createMany: vi.fn().mockImplementation(async ({ data }: { data: Array<{ id: string; payload: unknown }> }) => {
        for (const record of data) {
          if (orchestrationEvents.has(record.id)) throw persistenceError("P2002");
          orchestrationEvents.set(record.id, record);
        }
        persisted.orchestrationEventCount += data.length;
        return { count: data.length };
      }),
    },
    outboxMessage: {
      createMany: vi.fn().mockImplementation(async ({ data }: { data: unknown[] }) => {
        if (failNextOutbox) {
          failNextOutbox = false;
          throw new Error("Injected outbox failure");
        }
        outboxCount += data.length;
        return { count: data.length };
      }),
    },
  };
  const db = {
    ...tx,
    $transaction: vi.fn(async (
      callback: (value: typeof tx) => Promise<unknown>,
      _options?: { isolationLevel: "Serializable" },
    ) => {
      const before = { ...persisted };
      const eventsBefore = new Map(orchestrationEvents);
      const effectsBefore = new Map(effects);
      const outboxCountBefore = outboxCount;
      try {
        return await callback(tx);
      } catch (error) {
        Object.assign(persisted, before);
        orchestrationEvents.clear();
        for (const [id, event] of eventsBefore) orchestrationEvents.set(id, event);
        effects.clear();
        for (const [key, effect] of effectsBefore) effects.set(key, effect);
        outboxCount = outboxCountBefore;
        throw error;
      }
    }),
  };
  const recordFailureDecision = vi.fn();
  return {
    tx,
    db,
    dependencies: {
      db,
      now: () => input.serverNow ?? now,
      failureDecisionRollout: input.failureDecisionRollout ?? {
        shadowClassification: true,
        enforceFailureDecision: true,
        enforceMobileSourceIntervention: true,
      },
      recordFailureDecision,
    },
    recordFailureDecision,
    acceptedEventCount: () => orchestrationEvents.size,
    takeOverAgentRunLease: () => {
      persisted.agentRunLeaseGeneration += 1;
    },
    setAttemptStatus: (status: string) => {
      persisted.attemptStatus = status;
    },
    failNextOutbox: () => {
      failNextOutbox = true;
    },
    effectSnapshot: () => {
      const effect = [...effects.values()][0];
      return {
        status: typeof effect?.status === "string" ? effect.status : null,
        requestFingerprint: typeof effect?.requestFingerprint === "string" ? effect.requestFingerprint : null,
        resultFingerprint: typeof effect?.resultFingerprint === "string" ? effect.resultFingerprint : null,
        eventCount: orchestrationEvents.size,
        outboxCount,
      };
    },
    snapshot: () => ({
      agentRunStatus: persisted.agentRunStatus,
      attemptStatus: persisted.attemptStatus,
      nodeRunStatus: persisted.nodeRunStatus,
      loopRunStatus: persisted.loopRunStatus,
      orchestrationEventCount: persisted.orchestrationEventCount,
    }),
    executionPhaseSnapshot: () => persisted.executionPhase,
  };
}

function createConcurrentEffectResolutionBoundary() {
  const effectKey = buildEffectKey(effectReserveInput());
  const preparedEffect = {
    id: "effect_1",
    effectKey,
    loopRunId: "loop_run_1",
    nodeRunId: "node_run_1",
    attemptId: "attempt_1",
    operationType: "document.write",
    requestFingerprint: "request_hash_1",
    status: "prepared",
    providerReceipt: null,
    resultFingerprint: null,
  };
  const committedFind = vi.fn().mockResolvedValue({
    ...preparedEffect,
    status: "succeeded",
    providerReceipt: { id: "receipt_1" },
    resultFingerprint: "result_hash_1",
  });
  const tx = {
    loopNodeRun: {
      findUnique: vi.fn().mockResolvedValue({ id: "node_run_1", loopRunId: "loop_run_1" }),
    },
    loopNodeAttempt: {
      findUnique: vi.fn().mockResolvedValue({ id: "attempt_1", loopNodeRunId: "node_run_1" }),
    },
    effectExecution: {
      findUnique: vi.fn().mockResolvedValue(preparedEffect),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    orchestrationEvent: { createMany: vi.fn() },
    outboxMessage: { createMany: vi.fn() },
  };
  const db = {
    effectExecution: { findUnique: committedFind },
    $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  return { effectKey, tx, committedFind, dependencies: { db } as never };
}

function createForeignKeyBoundary() {
  let state = {
    agentRunIds: new Set<string>(),
    attemptIds: new Set<string>(),
    nodeRunIds: new Set(["node_run_1"]),
  };
  const db = {
    $transaction: async (callback: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const transactionState = {
        agentRunIds: new Set(state.agentRunIds),
        attemptIds: new Set(state.attemptIds),
        nodeRunIds: new Set(state.nodeRunIds),
      };
      const tx = {
        loopRun: {
          findUnique: async () => ({
            id: "loop_run_1",
            projectId: "project_1",
            engineKind: "graph_v1",
            status: "running",
            version: 1,
            projectionVersion: 1,
            loopVersionId: "loop_version_1",
            loopVersion: { id: "loop_version_1", graph: runtimeGraph },
          }),
        },
        loopNodeRun: {
          findUnique: async () => ({
            id: "node_run_1",
            loopRunId: "loop_run_1",
            nodeKey: "implement",
            activationNo: 1,
            status: "ready",
            version: 1,
            attemptCount: 0,
            inputSnapshot: { task: "implement" },
          }),
          updateMany: async () => ({ count: 1 }),
          create: async ({ data }: { data: { id: string } }) => {
            transactionState.nodeRunIds.add(data.id);
            return data;
          },
        },
        agentRun: {
          create: async ({ data }: { data: { id: string; loopNodeRunId: string } }) => {
            if (!transactionState.nodeRunIds.has(data.loopNodeRunId)) throw persistenceError("P2003");
            transactionState.agentRunIds.add(data.id);
            return data;
          },
        },
        loopNodeAttempt: {
          count: async () => 0,
          findUnique: async ({ where }: { where: { loopNodeRunId_attempt?: unknown } }) => (
            where.loopNodeRunId_attempt ? null : null
          ),
          create: async ({ data }: { data: { id: string; loopNodeRunId: string; agentRunId?: string } }) => {
            if (!transactionState.nodeRunIds.has(data.loopNodeRunId)) throw persistenceError("P2003");
            if (data.agentRunId && !transactionState.agentRunIds.has(data.agentRunId)) throw persistenceError("P2003");
            transactionState.attemptIds.add(data.id);
            return data;
          },
        },
        orchestrationAggregateSequence: { upsert: async () => ({ sequence: 1 }) },
        orchestrationEvent: { createMany: async () => ({ count: 1 }) },
        outboxMessage: { createMany: async () => ({ count: 1 }) },
      };

      const result = await callback(tx);
      state = transactionState;
      return result;
    },
  };
  return {
    dependencies: { db } as never,
    snapshot: () => ({
      agentRunIds: [...state.agentRunIds],
      attemptIds: [...state.attemptIds],
      nodeRunIds: [...state.nodeRunIds],
    }),
  };
}

function createConcurrentTriggerUniquenessBoundary() {
  type Receipt = { id: string; loopRunId: string | null };
  type LoopRun = { id: string; engineKind: string };
  type TransactionState = {
    id: number;
    receiptsByKey: Map<string, Receipt>;
    receiptsById: Map<string, Receipt>;
    loopRuns: Map<string, LoopRun>;
    sequences: Map<string, number>;
    eventCount: number;
    outboxCount: number;
    finished: ReturnType<typeof deferred>;
  };
  const receiptsByKey = new Map<string, Receipt>();
  const receiptsById = new Map<string, Receipt>();
  const loopRuns = new Map<string, LoopRun>();
  const sequences = new Map<string, number>();
  const receiptReservations = new Map<string, TransactionState>();
  const initialReadBarrier = deferred();
  let eventCount = 0;
  let outboxCount = 0;
  let initialReadCount = 0;
  let nextTransactionId = 1;
  let activeTransactions = 0;
  let maxConcurrentTransactions = 0;
  let uniqueCollisionCount = 0;
  let rollbackCount = 0;
  let recoveryReadCount = 0;

  const findCommittedReceipt = (args: { where: { bindingId_triggerType_sourceEventId: Record<string, string> } }) => {
    const key = receiptKey(args.where.bindingId_triggerType_sourceEventId);
    const receipt = receiptsByKey.get(key);
    const loopRun = receipt?.loopRunId ? loopRuns.get(receipt.loopRunId) ?? null : null;
    return receipt ? { loopRun } : null;
  };
  const transaction = async (callback: (tx: Record<string, unknown>) => Promise<unknown>) => {
    const state: TransactionState = {
      id: nextTransactionId++,
      receiptsByKey: new Map(),
      receiptsById: new Map(),
      loopRuns: new Map(),
      sequences: new Map(),
      eventCount: 0,
      outboxCount: 0,
      finished: deferred(),
    };
    activeTransactions += 1;
    maxConcurrentTransactions = Math.max(maxConcurrentTransactions, activeTransactions);
    const tx = {
      triggerReceipt: {
        findUnique: async (args: { where: { bindingId_triggerType_sourceEventId: Record<string, string> } }) => {
          const existing = findCommittedReceipt(args);
          if (existing) return existing;
          initialReadCount += 1;
          if (initialReadCount === 2) initialReadBarrier.resolve();
          await initialReadBarrier.promise;
          return null;
        },
        create: async ({ data }: { data: { id: string; bindingId: string; triggerType: string; sourceEventId: string } }) => {
          const key = receiptKey(data);
          const reservation = receiptReservations.get(key);
          if (reservation && reservation.id !== state.id) {
            uniqueCollisionCount += 1;
            await reservation.finished.promise;
            throw persistenceError("P2002");
          }
          if (receiptsByKey.has(key)) {
            uniqueCollisionCount += 1;
            throw persistenceError("P2002");
          }
          const receipt = { id: data.id, loopRunId: null };
          receiptReservations.set(key, state);
          state.receiptsByKey.set(key, receipt);
          state.receiptsById.set(data.id, receipt);
          return receipt;
        },
      },
      loopVersion: {
        findUnique: async () => ({
          graph: runtimeGraph,
          status: "published",
          loopDefinitionId: "loop_definition_1",
        }),
      },
      projectLoopBinding: {
        findUnique: async () => ({
          id: "binding_1",
          projectId: "project_1",
          loopDefinitionId: "loop_definition_1",
          status: "enabled",
          version: 2,
          activeVersionId: "loop_version_1",
        }),
      },
      loopRun: {
        create: async ({ data }: { data: { id: string; engineKind: string; triggerReceiptId: string } }) => {
          const receipt = state.receiptsById.get(data.triggerReceiptId);
          if (!receipt) throw persistenceError("P2003");
          const run = { id: data.id, engineKind: data.engineKind };
          state.loopRuns.set(data.id, run);
          receipt.loopRunId = data.id;
          return run;
        },
      },
      loopNodeRun: {
        create: async ({ data }: { data: unknown }) => data,
      },
      orchestrationAggregateSequence: {
        upsert: async ({ create }: { create: { aggregateType: string; aggregateId: string } }) => {
          const key = `${create.aggregateType}:${create.aggregateId}`;
          const sequence = (state.sequences.get(key) ?? sequences.get(key) ?? 0) + 1;
          state.sequences.set(key, sequence);
          return { sequence };
        },
      },
      orchestrationEvent: {
        createMany: async ({ data }: { data: unknown[] }) => {
          state.eventCount += data.length;
          return { count: data.length };
        },
      },
      outboxMessage: {
        createMany: async ({ data }: { data: unknown[] }) => {
          state.outboxCount += data.length;
          return { count: data.length };
        },
      },
    };
    try {
      const result = await callback(tx);
      for (const [key, receipt] of state.receiptsByKey) receiptsByKey.set(key, receipt);
      for (const [id, receipt] of state.receiptsById) receiptsById.set(id, receipt);
      for (const [id, run] of state.loopRuns) loopRuns.set(id, run);
      for (const [key, sequence] of state.sequences) sequences.set(key, sequence);
      eventCount += state.eventCount;
      outboxCount += state.outboxCount;
      return result;
    } catch (error) {
      rollbackCount += 1;
      throw error;
    } finally {
      for (const key of state.receiptsByKey.keys()) {
        if (receiptReservations.get(key)?.id === state.id) receiptReservations.delete(key);
      }
      state.finished.resolve();
      activeTransactions -= 1;
    }
  };
  const db = {
    triggerReceipt: {
      findUnique: async (args: { where: { bindingId_triggerType_sourceEventId: Record<string, string> } }) => {
        recoveryReadCount += 1;
        return findCommittedReceipt(args);
      },
    },
    loopRun: { findUnique: async () => null },
    $transaction: transaction,
  };

  return {
    dependencies: { db } as never,
    snapshot: () => ({
      loopRunIds: [...loopRuns.keys()],
      eventCount,
      outboxCount,
      maxConcurrentTransactions,
      uniqueCollisionCount,
      rollbackCount,
      recoveryReadCount,
    }),
  };
}

function createLiveTriggerRaceBoundary(client: ReturnType<typeof createPrismaClient>) {
  const initialReceiptReadBarrier = createBarrier(2);
  let transactionCount = 0;
  let initialReceiptReadCount = 0;
  let p2002RollbackCount = 0;
  let p2034RollbackCount = 0;
  let recoveryReadCount = 0;
  const recoveryRunIds: string[] = [];

  const db = {
    loopRun: client.loopRun,
    triggerReceipt: {
      findUnique: async (
        args: Parameters<typeof client.triggerReceipt.findUnique>[0],
      ) => {
        recoveryReadCount += 1;
        const receipt = await client.triggerReceipt.findUnique(args);
        const recoveredRun = (receipt as typeof receipt & { loopRun?: { id: string } | null })?.loopRun;
        if (recoveredRun) recoveryRunIds.push(recoveredRun.id);
        return receipt;
      },
    },
    $transaction: async <T>(
      callback: (tx: Prisma.TransactionClient) => Promise<T>,
      options?: { isolationLevel: "Serializable" },
    ): Promise<T> => {
      transactionCount += 1;
      try {
        return await client.$transaction(async (tx) => {
          const triggerReceipt = new Proxy(tx.triggerReceipt, {
            get(target, property, receiver) {
              if (property === "findUnique") {
                return async (args: Parameters<typeof tx.triggerReceipt.findUnique>[0]) => {
                  const receipt = await tx.triggerReceipt.findUnique(args);
                  initialReceiptReadCount += 1;
                  await initialReceiptReadBarrier.arrive();
                  return receipt;
                };
              }
              const value = Reflect.get(target, property, receiver);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
          const instrumentedTx = new Proxy(tx, {
            get(target, property, receiver) {
              if (property === "triggerReceipt") return triggerReceipt;
              const value = Reflect.get(target, property, receiver);
              return typeof value === "function" ? value.bind(target) : value;
            },
          }) as Prisma.TransactionClient;
          return callback(instrumentedTx);
        }, options);
      } catch (error) {
        if (isPersistenceError(error, "P2002")) p2002RollbackCount += 1;
        if (isPersistenceError(error, "P2034")) p2034RollbackCount += 1;
        throw error;
      }
    },
  };

  return {
    dependencies: { db } as never,
    snapshot: () => ({
      transactionCount,
      initialReceiptReadCount,
      p2002RollbackCount,
      p2034RollbackCount,
      recoveryReadCount,
      recoveryRunIds,
    }),
  };
}

function receiptKey(input: { bindingId: string; triggerType: string; sourceEventId: string }): string {
  return JSON.stringify([input.bindingId, input.triggerType, input.sourceEventId]);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function createBarrier(parties: number) {
  const opened = deferred();
  let arrivals = 0;
  return {
    async arrive() {
      arrivals += 1;
      if (arrivals === parties) opened.resolve();
      await opened.promise;
    },
  };
}

function isPersistenceError(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === code;
}

function persistenceError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
