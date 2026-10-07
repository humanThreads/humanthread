import {
  completeLoopAssignmentAndRoute,
  type AgentRouteState,
  type LoopAgentRoutingDependencies,
} from "../../../packages/db/src/loop-agent-routing";
import { describe, expect, it, vi } from "vitest";

const graphDigest = `sha256:${"a".repeat(64)}` as const;
const routerDigest = `sha256:${"b".repeat(64)}` as const;

const snapshot: AgentRouteState["runGraphSnapshot"] = {
  schemaVersion: 2,
  snapshotId: "snapshot_feedback",
  graphDigest,
  rootLoopVersionId: "version_code_dev_a",
  reachableNodeIds: ["code_dev_a", "test", "done"],
  loopVersions: [
    {
      loopDefinitionId: "loop_selected",
      loopVersionId: "version_code_dev_a",
      scope: "task",
      graph: {
        schemaVersion: 2,
        limits: { maxStages: 8, maxRepeatCount: 2 },
        nodes: [
          { key: "develop", nodeId: "code_dev_a", label: "Code Dev", type: "agent_action", executionTarget: "local", offlinePolicy: "local_capable", responsibility: "Implement the requested change", allowedRouteTargets: ["test"] },
          { key: "test", nodeId: "test", label: "Test", type: "agent_action", executionTarget: "local", offlinePolicy: "local_capable", responsibility: "Run business tests and classify failures", allowedRouteTargets: ["code_dev_a", "done"] },
          { key: "done", nodeId: "done", label: "Done", type: "end", offlinePolicy: "online_required" },
        ],
        edges: [
          { id: "develop-test", source: "develop", target: "test", kind: "normal", outcome: "success" },
          { id: "test-develop", source: "test", target: "develop", kind: "feedback", outcome: "rework", maxTraversals: 2 },
          { id: "test-done", source: "test", target: "done", kind: "normal", outcome: "success" },
        ],
      },
    },
    {
      loopDefinitionId: "loop_unreferenced",
      loopVersionId: "version_code_dev_b",
      scope: "task",
      graph: {
        schemaVersion: 2,
        limits: { maxStages: 4, maxRepeatCount: 1 },
        nodes: [
          { key: "develop_b", nodeId: "code_dev_b", label: "Code Dev", type: "agent_action", executionTarget: "local", offlinePolicy: "local_capable", responsibility: "Unrelated development flow", allowedRouteTargets: ["done_b"] },
          { key: "done_b", nodeId: "done_b", label: "Done", type: "end", offlinePolicy: "online_required" },
        ],
        edges: [{ id: "develop-b-done", source: "develop_b", target: "done_b", kind: "normal", outcome: "success" }],
      },
    },
  ],
};

function state(nodeKey: "develop" | "test", counters: AgentRouteState["counters"]): AgentRouteState {
  return {
    loopRunId: "run_feedback",
    loopNodeRunId: `node_${nodeKey}`,
    loopNodeAttemptId: `attempt_${nodeKey}`,
    attemptNo: 1,
    loopVersionId: "version_code_dev_a",
    nodeKey,
    nodeStatus: "running",
    attemptStatus: "running",
    runStatus: "running",
    runGraphSnapshot: snapshot,
    graphDigest,
    routerContractVersion: 1,
    routerContractDigest: routerDigest,
    counters,
    limits: { maxTransitions: 12, maxRepeatCount: 2 },
    targetActivations: {},
  };
}

function decision(fromNodeId: string, nextNodeId: string, decisionId: string) {
  return {
    decisionId,
    fromNodeId,
    nextNodeId,
    reasonCode: nextNodeId === "test" ? "IMPLEMENTATION_READY" : "BUSINESS_TEST_FAILED",
    summary: nextNodeId === "test" ? "Implementation is ready for verification" : "Failed business test requires code changes",
    evidence: [nextNodeId === "test" ? "artifacts/develop.json" : "artifacts/test-report.json"],
    confidence: 0.96,
    snapshotDigest: graphDigest,
    routerContractVersion: 1,
    routerContractDigest: routerDigest,
  };
}

function dependencies(current: () => AgentRouteState) {
  const routeAudits: Array<{ sourceNodeId: string; targetNodeId: string | null; selectedEdgeId: string | null }> = [];
  const deps: LoopAgentRoutingDependencies = {
    transaction: async (callback) => callback({
      loadState: async () => current(),
      findDecision: async () => null,
      saveStageResult: vi.fn().mockResolvedValue(undefined),
      saveRouteAudit: async ({ result }) => { routeAudits.push(result); },
      updateCounters: vi.fn().mockResolvedValue(undefined),
      createNodeRun: vi.fn().mockResolvedValue(undefined),
      emit: vi.fn().mockResolvedValue(undefined),
    }),
  };
  return { deps, routeAudits };
}

describe("Stage Package v2 failed-test feedback E2E", () => {
  it("persists the selected feedback edge and never considers a same-name node outside the selected Loop", async () => {
    let current = state("develop", { transitions: 0, repeats: 0, edgeTraversals: {} });
    const { deps, routeAudits } = dependencies(() => current);
    const implementation = { outcome: "success" as const, output: { commit: "a".repeat(40) }, artifactRefs: ["artifacts/develop.json"], effectReceipts: [] };
    const developed = await completeLoopAssignmentAndRoute({
      commandId: "route_develop_test",
      decision: decision("code_dev_a", "test", "decision_develop_test"),
      result: implementation,
      now: new Date("2026-08-08T08:00:00.000Z"),
    }, deps);

    current = state("test", developed.counters);
    current.targetActivations = { develop: 1 };
    const failedTest = { outcome: "failure" as const, output: { failedCases: ["CRM-142"] }, artifactRefs: ["artifacts/test-report.json"], effectReceipts: [] };
    const feedback = await completeLoopAssignmentAndRoute({
      commandId: "route_test_develop",
      decision: decision("test", "code_dev_a", "decision_test_develop"),
      result: failedTest,
      now: new Date("2026-08-08T08:05:00.000Z"),
    }, deps);

    expect(feedback).toMatchObject({ status: "routed", targetNodeId: "code_dev_a", selectedEdgeId: "test-develop" });
    expect(feedback.counters).toEqual({ transitions: 2, repeats: 1, edgeTraversals: { "develop-test": 1, "test-develop": 1 } });
    expect(routeAudits).toEqual([
      expect.objectContaining({ sourceNodeId: "code_dev_a", targetNodeId: "test", selectedEdgeId: "develop-test" }),
      expect.objectContaining({ sourceNodeId: "test", targetNodeId: "code_dev_a", selectedEdgeId: "test-develop" }),
    ]);
    expect(JSON.stringify(routeAudits)).not.toContain("code_dev_b");
  });
});
