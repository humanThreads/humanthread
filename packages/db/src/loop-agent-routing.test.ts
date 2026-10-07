import type { LocalRouteDecision, LoopNodeResult, RunGraphSnapshotV2 } from "@humanthread/shared";
import { describe, expect, it, vi } from "vitest";

import {
  completeLoopAssignmentAndRoute,
  fingerprintAgentRouteDecision,
  validateAgentRouteDecision,
  type AgentRouteState,
  type LoopAgentRoutingDependencies,
} from "./loop-agent-routing";

const digest = `sha256:${"a".repeat(64)}`;
const routerDigest = `sha256:${"b".repeat(64)}`;
const snapshot: RunGraphSnapshotV2 = {
  schemaVersion: 2,
  snapshotId: "snapshot_1",
  graphDigest: digest,
  rootLoopVersionId: "version_1",
  reachableNodeIds: ["develop", "test", "write_plan", "done"],
  loopVersions: [{
    loopDefinitionId: "definition_1",
    loopVersionId: "version_1",
    scope: "project",
    graph: {
      schemaVersion: 2,
      limits: { maxStages: 4, maxRepeatCount: 2 },
      nodes: [
        { key: "develop", nodeId: "develop", label: "Develop", type: "agent_action", executionTarget: "local", offlinePolicy: "local_capable", responsibility: "Implement", allowedRouteTargets: ["test"] },
        { key: "test", nodeId: "test", label: "Test", type: "agent_action", executionTarget: "local", offlinePolicy: "local_capable", responsibility: "Verify", allowedRouteTargets: ["develop", "done"] },
        { key: "write_plan", nodeId: "write_plan", label: "Plan", type: "agent_action", executionTarget: "local", offlinePolicy: "local_capable", responsibility: "Regenerate the implementation plan", allowedRouteTargets: ["develop"] },
        { key: "done", nodeId: "done", label: "Done", type: "end", offlinePolicy: "online_required" },
      ],
      edges: [
        { id: "develop-test", source: "develop", target: "test", kind: "normal", outcome: "success" },
        { id: "test-develop", source: "test", target: "develop", kind: "feedback", outcome: "rework", maxTraversals: 2 },
        { id: "test-done", source: "test", target: "done", kind: "normal", outcome: "success" },
      ],
    },
  }],
};

const result: LoopNodeResult = {
  outcome: "success",
  output: { ok: true },
  artifactRefs: [],
  effectReceipts: [],
};

function decision(overrides: Partial<LocalRouteDecision> = {}): LocalRouteDecision {
  return {
    decisionId: "decision_1",
    fromNodeId: "test",
    nextNodeId: "done",
    reasonCode: "verified",
    summary: "All tests pass",
    evidence: [],
    confidence: 0.98,
    snapshotDigest: digest,
    routerContractVersion: 1,
    routerContractDigest: routerDigest,
    ...overrides,
  };
}

function state(overrides: Partial<AgentRouteState> = {}): AgentRouteState {
  return {
    loopRunId: "run_1",
    loopNodeRunId: "node_1",
    loopNodeAttemptId: "attempt_1",
    attemptNo: 1,
    loopVersionId: "version_1",
    nodeKey: "test",
    nodeStatus: "running",
    attemptStatus: "running",
    runStatus: "running",
    runGraphSnapshot: snapshot,
    graphDigest: digest,
    routerContractVersion: 1,
    routerContractDigest: routerDigest,
    counters: { transitions: 1, repeats: 0, edgeTraversals: { "develop-test": 1 } },
    limits: { maxTransitions: 10, maxRepeatCount: 2 },
    targetActivations: {},
    ...overrides,
  };
}

function deps(current = state()) {
  let accepted: { fingerprint: string; result: ReturnType<typeof makeResult> } | null = null;
  const calls = {
    saveStageResult: vi.fn().mockResolvedValue(undefined),
    saveRouteAudit: vi.fn().mockResolvedValue(undefined),
    updateCounters: vi.fn().mockResolvedValue(undefined),
    createNodeRun: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn().mockResolvedValue(undefined),
  };
  const dependencies: LoopAgentRoutingDependencies = {
    transaction: async (callback) => callback({
      loadState: async () => current,
      findDecision: async () => accepted,
      ...calls,
    }),
  };
  calls.saveRouteAudit.mockImplementation(async ({ decision, result, command }) => {
    accepted = { fingerprint: fingerprintAgentRouteDecision({ decision, result: command.result }), result };
  });
  return { dependencies, calls };
}

function makeResult() {
  return { status: "routed" as const, decisionId: "decision_1", sourceNodeId: "test", targetNodeId: "done", selectedEdgeId: "test-done", targetNodeRunId: "node_2", counters: { transitions: 2, repeats: 0, edgeTraversals: { "develop-test": 1, "test-done": 1 } } };
}

describe("validateAgentRouteDecision", () => {
  it("rejects a stale snapshot, forged target, or Router digest", () => {
    expect(() => validateAgentRouteDecision({ state: state(), decision: decision({ snapshotDigest: `sha256:${"c".repeat(64)}` }) })).toThrowError(expect.objectContaining({ code: "route_decision_invalid" }));
    expect(() => validateAgentRouteDecision({ state: state(), decision: decision({ nextNodeId: "missing" }) })).toThrowError(expect.objectContaining({ code: "route_decision_invalid" }));
    expect(() => validateAgentRouteDecision({ state: state(), decision: decision({ routerContractDigest: `sha256:${"d".repeat(64)}` }) })).toThrowError(expect.objectContaining({ code: "route_decision_invalid" }));
  });

  it("uses the persisted Loop version when another snapshot Loop has the same node key", () => {
    const duplicateSnapshot: RunGraphSnapshotV2 = {
      ...snapshot,
      loopVersions: [{
        loopDefinitionId: "definition_project",
        loopVersionId: "version_project",
        scope: "project",
        graph: {
          schemaVersion: 2,
          limits: { maxStages: 2, maxRepeatCount: 2 },
          nodes: [
            { key: "test", nodeId: "test", label: "Project Test", type: "agent_action", executionTarget: "local", offlinePolicy: "local_capable", responsibility: "Project test", allowedRouteTargets: ["project_done"] },
            { key: "project_done", nodeId: "project_done", label: "Project Done", type: "end", offlinePolicy: "online_required" },
          ],
          edges: [{ id: "project-test-done", source: "test", target: "project_done", kind: "normal", outcome: "success" }],
        },
      }, ...snapshot.loopVersions],
    };

    expect(validateAgentRouteDecision({
      state: state({ runGraphSnapshot: duplicateSnapshot }),
      decision: decision({ nextNodeId: "write_plan" }),
    }).nextNodeId).toBe("write_plan");
  });
});

describe("completeLoopAssignmentAndRoute", () => {
  it("persists one route and creates one target activation on duplicate replay", async () => {
    const { dependencies, calls } = deps();
    const command = { commandId: "command_1", decision: decision(), result, now: new Date("2026-08-08T08:00:00.000Z") };
    const first = await completeLoopAssignmentAndRoute(command, dependencies);
    const duplicate = await completeLoopAssignmentAndRoute(command, dependencies);
    expect(duplicate).toEqual(first);
    expect(calls.createNodeRun).toHaveBeenCalledTimes(1);
  });

  it("does not activate a target outside the snapshot candidate list", async () => {
    const { dependencies } = deps();
    await expect(completeLoopAssignmentAndRoute({
      commandId: "command_2",
      decision: decision({ nextNodeId: "missing" }),
      result,
      now: new Date("2026-08-08T08:00:00.000Z"),
    }, dependencies)).rejects.toMatchObject({ code: "route_decision_invalid" });
  });

  it("accepts an Agent Decision target in the current Loop snapshot without requiring a direct edge", async () => {
    const { dependencies, calls } = deps();

    const routed = await completeLoopAssignmentAndRoute({
      commandId: "command_replan",
      decision: decision({
        decisionId: "decision_replan",
        nextNodeId: "write_plan",
        reasonCode: "PLAN_ENVIRONMENT_MISMATCH",
        summary: "The plan must be regenerated from current repository facts",
      }),
      result: { ...result, outcome: "failure" },
      now: new Date("2026-08-08T08:00:00.000Z"),
    }, dependencies);

    expect(routed).toMatchObject({
      status: "routed",
      sourceNodeId: "test",
      targetNodeId: "write_plan",
      selectedEdgeId: null,
    });
    expect(calls.createNodeRun).toHaveBeenCalledWith(expect.objectContaining({
      targetNodeId: "write_plan",
      activationNo: 1,
    }));
  });

  it("exhausts before a Decision creates a third activation of the same SubLoop", async () => {
    const { dependencies, calls } = deps(state({ targetActivations: { develop: 2 } }));

    const routed = await completeLoopAssignmentAndRoute({
      commandId: "command_third_activation",
      decision: decision({ decisionId: "decision_third_activation", nextNodeId: "develop" }),
      result,
      now: new Date("2026-08-08T08:00:00.000Z"),
    }, dependencies);

    expect(routed.status).toBe("exhausted");
    expect(calls.createNodeRun).not.toHaveBeenCalled();
  });
});
