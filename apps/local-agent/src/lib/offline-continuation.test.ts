import type { LoopAssignmentV2, LocalRouteDecision } from "@humanthread/shared";
import { describe, expect, it } from "vitest";

import { createOfflineContinuation, serializeOfflineContinuation } from "./offline-continuation";
import { DECISION_ROUTER_CONTRACT_DIGEST } from "./decision-router-contract";

const digest = (letter: string) => `sha256:${letter.repeat(64)}` as `sha256:${string}`;
const decision: LocalRouteDecision = {
  decisionId: "decision_offline",
  fromNodeId: "test",
  nextNodeId: "code_dev_a",
  reasonCode: "TEST_FAILED_REQUIRES_CODE_FIX",
  summary: "继续修复",
  evidence: ["artifacts/test.json"],
  confidence: 0.9,
  snapshotDigest: digest("a"),
  routerContractVersion: 1,
  routerContractDigest: DECISION_ROUTER_CONTRACT_DIGEST,
};

function assignment(): LoopAssignmentV2 {
  return {
    id: "assignment_offline", agentRunId: "agent_run_offline", loopRunId: "loop_run_offline",
    loopNodeRunId: "node_run_offline", loopNodeAttemptId: "attempt_offline", attemptNo: 1,
    leaseGeneration: 1, leaseExpiresAt: "2026-08-08T13:00:00.000Z", acceptedThroughSequence: 0,
    node: {
      key: "test", nodeId: "test", label: "测试", type: "agent_action", executionTarget: "local",
      offlinePolicy: "local_capable", promptTemplate: "test",
    },
    graph: {} as LoopAssignmentV2["graph"], inputSnapshot: {},
    policySnapshot: {}, grantSnapshot: {}, runtime: { agentProfileId: "profile_codex", provider: "codex", runtimeProfileId: "runtime_1", configurationVersion: 1 },
    workspace: { bindingId: "workspace_1", configurationVersion: 1, pathFingerprint: "hmac-sha256:offline" },
    prompt: "test", resultSchemaPath: ".humanthread/results/offline.json", contractVersion: 2,
    runGraphSnapshot: { schemaVersion: 2, snapshotId: "snapshot_offline", graphDigest: digest("a"), rootLoopVersionId: "version_offline", loopVersions: [], reachableNodeIds: ["test", "code_dev_a"] },
    routerContract: { version: 1, digest: DECISION_ROUTER_CONTRACT_DIGEST },
    offlineContinuation: { token: "offline-token-abcdefghijklmnopqrstuvwxyz", validUntil: "2026-08-08T12:30:00.000Z", workerId: "worker_1", agentProfileId: "profile_codex", workspaceBindingId: "workspace_1", snapshotDigest: digest("a"), allowedNodeIds: ["code_dev_a"] },
  } as unknown as LoopAssignmentV2;
}

describe("offline continuation", () => {
  it("continues on the same Worker/Profile/Workspace with a valid checkpoint", async () => {
    const result = await createOfflineContinuation({
      assignment: assignment(), decision,
      current: { workerId: "worker_1", agentProfileId: "profile_codex", workspaceBindingId: "workspace_1" },
      checkpoint: { branch: "2026-HT100013", commit: "a".repeat(40), artifacts: ["artifacts/test.json"], checklist: [] },
      now: new Date("2026-08-08T12:00:00.000Z"),
    });
    expect(result).toMatchObject({ status: "continue", record: { nextNodeId: "code_dev_a" } });
    expect(result.status === "continue" ? result.record.provisionalStepId : "").toMatch(/^offline:[a-f0-9]{64}$/u);
  });

  it("pauses when the route requires a different Worker", async () => {
    const result = await createOfflineContinuation({
      assignment: assignment(), decision,
      current: { workerId: "worker_2", agentProfileId: "profile_codex", workspaceBindingId: "workspace_1" },
      checkpoint: { branch: "2026-HT100013", commit: "a".repeat(40), artifacts: [], checklist: [] },
      now: new Date("2026-08-08T12:00:00.000Z"),
    });
    expect(result).toMatchObject({ status: "pause", code: "offline_worker_mismatch" });
  });

  it("pauses for an expired grant, disallowed target, or uncertain checkpoint", async () => {
    const expired = await createOfflineContinuation({
      assignment: assignment(), decision,
      current: { workerId: "worker_1", agentProfileId: "profile_codex", workspaceBindingId: "workspace_1" },
      checkpoint: { branch: "2026-HT100013", commit: "a".repeat(40), artifacts: [], checklist: [] },
      now: new Date("2026-08-08T13:00:00.000Z"),
    });
    expect(expired).toMatchObject({ status: "pause", code: "offline_grant_expired" });

    const uncertain = await createOfflineContinuation({
      assignment: assignment(), decision: { ...decision, nextNodeId: "human_review" },
      current: { workerId: "worker_1", agentProfileId: "profile_codex", workspaceBindingId: "workspace_1" },
      checkpoint: null,
      now: new Date("2026-08-08T12:00:00.000Z"),
    });
    expect(uncertain).toMatchObject({ status: "pause", code: "offline_checkpoint_uncertain" });
  });

  it("never serializes the continuation token to a durable payload", async () => {
    const result = await createOfflineContinuation({
      assignment: assignment(), decision,
      current: { workerId: "worker_1", agentProfileId: "profile_codex", workspaceBindingId: "workspace_1" },
      checkpoint: { branch: "2026-HT100013", commit: "a".repeat(40), artifacts: [], checklist: [] },
      now: new Date("2026-08-08T12:00:00.000Z"),
    });
    expect(JSON.stringify(serializeOfflineContinuation(result))).not.toContain("offline-token");
  });
});
