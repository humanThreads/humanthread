import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyLoopApprovalDecision,
  openHumanGateApproval,
  openRuntimeSafetyApproval,
  type LoopApprovalRecord,
} from "./loop-approval-commands";

const dbMocks = vi.hoisted(() => {
  const tx = {
    approvalRequest: { updateMany: vi.fn() },
    loopNodeRun: { updateMany: vi.fn() },
    loopRun: { updateMany: vi.fn() },
  };
  return {
    assertCanWriteProject: vi.fn(),
    approvalFindUnique: vi.fn(),
    automationGrantFindUnique: vi.fn(),
    transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    tx,
  };
});

vi.mock("@humanthread/db", () => ({
  assertCanWriteProject: dbMocks.assertCanWriteProject,
  prisma: {
    approvalRequest: { findUnique: dbMocks.approvalFindUnique, create: vi.fn() },
    automationGrant: { findUnique: dbMocks.automationGrantFindUnique },
    $transaction: dbMocks.transaction,
  },
  routeGateDecision: vi.fn(),
}));

const now = new Date("2026-07-31T01:00:00.000Z");

const legacyGraph = {
  schemaVersion: 1,
  inputSchema: {},
  outputSchema: {},
  limits: { maxStages: 3, maxRepeatCount: 1 },
  nodes: [
    { key: "start", label: "Start", type: "start" },
    { key: "confirm_requirement", label: "Confirm requirement", type: "human_gate", executionTarget: "platform" },
    { key: "write_prd", label: "Write PRD", type: "end" },
  ],
  edges: [
    { id: "confirm_write_prd", source: "confirm_requirement", target: "write_prd", kind: "normal", outcome: "success" },
  ],
};

function humanApproval(overrides: Partial<LoopApprovalRecord> = {}) {
  return {
    id: "approval_human_1",
    projectId: "project_1",
    loopRunId: "loop_run_1",
    loopNodeRunId: "node_run_review_1",
    type: "loop_human_gate",
    status: "pending",
    requestPayload: {
      routes: {
        pass: ["review_to_end"],
        rework: ["review_to_draft"],
        reject: ["review_to_rejected"],
      },
    },
    policySnapshot: {},
    expiresAt: null,
    ...overrides,
  };
}

function dependencies(approval: LoopApprovalRecord = humanApproval()) {
  return {
    loadForDecision: vi.fn().mockResolvedValue(approval),
    authorize: vi.fn().mockResolvedValue({ role: "maintainer" }),
    routeHumanGate: vi.fn().mockResolvedValue({ status: "routed", targetNodeRunId: "node_run_draft_2" }),
    failOrCancelWaitingAction: vi.fn().mockResolvedValue({ status: "rejected" }),
    resumeWithOneTimeActionGrant: vi.fn().mockResolvedValue({ status: "approved" }),
  };
}

describe("Loop approval commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.assertCanWriteProject.mockResolvedValue({ role: "maintainer" });
    dbMocks.tx.approvalRequest.updateMany.mockResolvedValue({ count: 1 });
    dbMocks.tx.loopNodeRun.updateMany.mockResolvedValue({ count: 1 });
    dbMocks.tx.loopRun.updateMany.mockResolvedValue({ count: 1 });
  });
  it("creates Human Gate requests with explicit decision routes", async () => {
    const create = vi.fn().mockResolvedValue({ id: "approval_human_1" });

    await openHumanGateApproval({
      approvalId: "approval_human_1",
      projectId: "project_1",
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_review_1",
      requestedByActor: "system:loop-dispatcher",
      prompt: "Review the draft",
      routes: {
        pass: ["review_to_end"],
        rework: ["review_to_draft"],
        reject: ["review_to_rejected"],
      },
      policySnapshot: {},
    }, { create });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      type: "loop_human_gate",
      status: "pending",
      expiresAt: null,
    }));
  });

  it("creates runtime safety requests bound to one exact action for one hour", async () => {
    const create = vi.fn().mockResolvedValue({ id: "approval_runtime_1" });

    await openRuntimeSafetyApproval({
      approvalId: "approval_runtime_1",
      projectId: "project_1",
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_code_1",
      requestedByActor: "system:loop-dispatcher",
      actionFingerprint: "sha256:git-push",
      action: { operationType: "git.push" },
      policySnapshot: { reasonCode: "automation_grant_scope_miss" },
      now,
    }, { create });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      type: "loop_runtime_safety",
      requestPayload: expect.objectContaining({ actionFingerprint: "sha256:git-push" }),
      expiresAt: new Date("2026-07-31T02:00:00.000Z"),
    }));
  });

  it("routes a changes-requested Human Gate through its explicit feedback edge", async () => {
    const deps = dependencies();

    await expect(applyLoopApprovalDecision({
      approvalId: "approval_human_1",
      actorUserId: "user_1",
      decision: "changes_requested",
      reason: "Revise evidence",
      selectedEdgeId: "review_to_draft",
      now,
    }, deps)).resolves.toMatchObject({ outcome: "rework", selectedEdgeId: "review_to_draft" });

    expect(deps.authorize).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
    expect(deps.routeHumanGate).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "rework",
      selectedEdgeId: "review_to_draft",
      message: "Revise evidence",
    }));
  });

  it("recovers an all-empty historical route set from its persisted Human Gate graph", async () => {
    const approval = humanApproval({
      requestPayload: { routes: { pass: [], rework: [], reject: [] } },
      loopNodeRun: { nodeKey: "confirm_requirement", loopRun: { loopVersion: { graph: legacyGraph } } },
    });
    const deps = dependencies(approval);

    await applyLoopApprovalDecision({
      approvalId: approval.id,
      actorUserId: "user_1",
      decision: "approved",
      reason: "Confirmed",
      selectedEdgeId: "confirm_write_prd",
      now,
    }, deps);

    expect(deps.routeHumanGate).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "pass",
      selectedEdgeId: "confirm_write_prd",
    }));
  });

  it("rejects an edge outside the recovered Human Gate routes", async () => {
    const approval = humanApproval({
      requestPayload: { routes: { pass: [], rework: [], reject: [] } },
      loopNodeRun: { nodeKey: "confirm_requirement", loopRun: { loopVersion: { graph: legacyGraph } } },
    });

    await expect(applyLoopApprovalDecision({
      approvalId: approval.id,
      actorUserId: "user_1",
      decision: "approved",
      reason: "Confirmed",
      selectedEdgeId: "write_prd_to_end",
      now,
    }, dependencies(approval))).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("resumes runtime safety approval with only the exact one-time action grant", async () => {
    const runtime = {
      ...humanApproval(),
      id: "approval_runtime_1",
      type: "loop_runtime_safety",
      requestPayload: { actionFingerprint: "sha256:git-push", action: { operationType: "git.push" } },
      expiresAt: new Date("2026-07-31T02:00:00.000Z"),
    };
    const deps = dependencies(runtime);

    await applyLoopApprovalDecision({
      approvalId: "approval_runtime_1",
      actorUserId: "user_1",
      decision: "approved",
      reason: "Allow once",
      now,
    }, deps);

    expect(deps.resumeWithOneTimeActionGrant).toHaveBeenCalledWith(expect.objectContaining({
      actionFingerprint: "sha256:git-push",
      expiresAt: new Date("2026-07-31T02:00:00.000Z"),
    }));
    expect(deps.routeHumanGate).not.toHaveBeenCalled();
  });

  it.each(["approved", "rejected"] as const)(
    "rejects %s when the waiting LoopRun CAS is lost",
    async (decision) => {
      dbMocks.approvalFindUnique.mockResolvedValue({
        ...humanApproval(),
        id: "approval_runtime_1",
        type: "loop_runtime_safety",
        requestPayload: { actionFingerprint: "sha256:git-push" },
        policySnapshot: { outcome: "require_approval" },
        expiresAt: new Date("2026-07-31T02:00:00.000Z"),
      });
      dbMocks.tx.loopRun.updateMany.mockResolvedValue({ count: 0 });

      await expect(applyLoopApprovalDecision({
        approvalId: "approval_runtime_1",
        actorUserId: "user_1",
        decision,
        reason: decision === "approved" ? "Allow once" : "Too risky",
        now,
      })).rejects.toMatchObject({ code: "version_conflict" });
    },
  );
});
