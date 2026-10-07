import { describe, expect, it, vi } from "vitest";
import { dispatchReadyNode } from "./loop-dispatcher";

const now = new Date("2026-07-31T01:00:00.000Z");
const agentNode = {
  key: "code",
  label: "Code",
  type: "agent_action" as const,
  executionTarget: "local" as const,
  promptTemplate: "Implement",
};

function dependencies() {
  return {
    createAssignment: vi.fn().mockResolvedValue({ status: "assigned" }),
    createApproval: vi.fn().mockResolvedValue({ id: "approval_1" }),
    updateNode: vi.fn().mockResolvedValue({ count: 1 }),
    updateRun: vi.fn().mockResolvedValue({ count: 1 }),
  };
}

describe("dispatchReadyNode", () => {
  it("dispatches an allowed no-human assignment without creating ApprovalRequest", async () => {
    const deps = dependencies();

    await expect(dispatchReadyNode({
      loopRunId: "loop_run_1",
      projectId: "project_1",
      nodeRunId: "node_run_code_1",
      nodeRunVersion: 1,
      node: agentNode,
      policyDecision: { outcome: "auto_approve", reasonCode: "automation_grant_matched", matchedGrantId: "grant_1" },
      now,
    }, deps)).resolves.toEqual({ status: "assigned" });

    expect(deps.createAssignment).toHaveBeenCalledOnce();
    expect(deps.createApproval).not.toHaveBeenCalled();
    expect(deps.updateNode).not.toHaveBeenCalled();
    expect(deps.updateRun).not.toHaveBeenCalled();
  });

  it("waits for a runtime safety approval on grant scope miss", async () => {
    const deps = dependencies();

    await expect(dispatchReadyNode({
      loopRunId: "loop_run_1",
      projectId: "project_1",
      nodeRunId: "node_run_code_1",
      nodeRunVersion: 1,
      node: { ...agentNode, type: "platform_action", executionTarget: "platform" },
      actionFingerprint: "sha256:git-push",
      policyDecision: { outcome: "require_approval", reasonCode: "automation_grant_scope_miss", matchedGrantId: null },
      now,
    }, deps)).resolves.toMatchObject({ status: "waiting_approval", approvalType: "loop_runtime_safety" });

    expect(deps.createApproval).toHaveBeenCalledWith(expect.objectContaining({
      type: "loop_runtime_safety",
      requestPayload: expect.objectContaining({ actionFingerprint: "sha256:git-push" }),
      expiresAt: new Date("2026-07-31T02:00:00.000Z"),
    }));
    expect(deps.updateNode).toHaveBeenCalledWith(expect.objectContaining({
      nodeRunId: "node_run_code_1",
      nodeRunVersion: 1,
      status: "waiting_approval",
      waitingReason: "runtime_safety",
    }));
    expect(deps.updateRun).toHaveBeenCalledWith(expect.objectContaining({
      loopRunId: "loop_run_1",
      status: "waiting",
      waitingReason: "runtime_safety",
    }));
    expect(deps.createAssignment).not.toHaveBeenCalled();
  });

  it("dispatches local agent execution without an automation grant", async () => {
    const deps = dependencies();

    await expect(dispatchReadyNode({
      loopRunId: "loop_run_1",
      projectId: "project_1",
      nodeRunId: "node_run_code_2",
      nodeRunVersion: 1,
      node: agentNode,
      actionFingerprint: "sha256:git-push",
      policyDecision: { outcome: "require_approval", reasonCode: "grant_missing", matchedGrantId: null },
      now,
    }, deps)).resolves.toEqual({ status: "assigned" });

    expect(deps.createAssignment).toHaveBeenCalledOnce();
    expect(deps.createApproval).not.toHaveBeenCalled();
  });

  it("always opens a business approval for a declared Human Gate", async () => {
    const deps = dependencies();

    await dispatchReadyNode({
      loopRunId: "loop_run_1",
      projectId: "project_1",
      nodeRunId: "node_run_review_1",
      nodeRunVersion: 1,
      node: { key: "review", label: "Review", type: "human_gate", executionTarget: "platform", prompt: "Review" },
      humanGateRoutes: {
        pass: ["review_to_end"],
        rework: ["review_to_code"],
        reject: ["review_to_rejected"],
      },
      policyDecision: { outcome: "allow", reasonCode: "low_risk_platform_action", matchedGrantId: null },
      now,
    }, deps);

    expect(deps.createApproval).toHaveBeenCalledWith(expect.objectContaining({
      type: "loop_human_gate",
      requestPayload: expect.objectContaining({
        routes: {
          pass: ["review_to_end"],
          rework: ["review_to_code"],
          reject: ["review_to_rejected"],
        },
      }),
      expiresAt: null,
    }));
    expect(deps.updateNode).toHaveBeenCalledWith(expect.objectContaining({ waitingReason: "human_gate" }));
    expect(deps.updateRun).toHaveBeenCalledWith(expect.objectContaining({
      status: "waiting",
      waitingReason: "human_gate",
    }));
  });

  it("does not inherit upstream review artifacts into the Human Gate approval", async () => {
    const deps = dependencies();
    // Human confirmation is mandatory and always available, so the gate no
    // longer has to carry a page it did not produce. An Agent that wants a
    // human to read an HTML page asks for it explicitly through its own
    // interaction, where the page is served from a short-lived proxy rather
    // than stored as platform evidence.

    await dispatchReadyNode({
      loopRunId: "loop_run_1",
      projectId: "project_1",
      nodeRunId: "node_run_review_1",
      nodeRunVersion: 1,
      node: { key: "review", label: "Review", type: "human_gate", executionTarget: "platform", prompt: "Review" },
      humanGateRoutes: { pass: ["pass"], rework: ["rework"], reject: ["reject"] },
      policyDecision: { outcome: "allow", reasonCode: "low_risk_platform_action", matchedGrantId: null },
      now,
    }, deps);

    const approvalPayload = deps.createApproval.mock.calls.at(-1)?.[0] as { requestPayload: Record<string, unknown> };
    expect(approvalPayload.requestPayload).not.toHaveProperty("reviewArtifacts");
  });

  it("rolls back the approval wait when the LoopRun changed", async () => {
    const deps = dependencies();
    deps.updateRun.mockResolvedValue({ count: 0 });
    deps.transaction = vi.fn(async (callback) => callback(undefined));

    await expect(dispatchReadyNode({
      loopRunId: "loop_run_1",
      projectId: "project_1",
      nodeRunId: "node_run_review_1",
      nodeRunVersion: 1,
      node: { key: "review", label: "Review", type: "human_gate", executionTarget: "platform", prompt: "Review" },
      humanGateRoutes: { pass: ["pass"], rework: ["rework"], reject: ["reject"] },
      policyDecision: { outcome: "allow", reasonCode: "low_risk_platform_action", matchedGrantId: null },
      now,
    }, deps)).rejects.toMatchObject({ code: "stale_lease" });

    expect(deps.createApproval).not.toHaveBeenCalled();
  });
});
