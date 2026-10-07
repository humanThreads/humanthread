import {
  validateLocalRouteDecision,
  type LocalRouteDecision,
  type LoopAssignmentV2,
  type OfflineContinuationGrant,
} from "@humanthread/shared";
import { DECISION_ROUTER_CONTRACT_DIGEST, DECISION_ROUTER_CONTRACT_VERSION } from "./decision-router-contract";

export type OfflineCheckpoint = {
  branch: string;
  commit: string;
  artifacts: string[];
  checklist: unknown[];
};

export type OfflineContinuationRecord = {
  protocol: "humanthread-offline-continuation/v1";
  grant: OfflineContinuationGrant;
  provisionalStepId: string;
  fromNodeId: string;
  nextNodeId: string;
  routeDecision: LocalRouteDecision;
  checkpoint: OfflineCheckpoint;
};

export type OfflineContinuationResult =
  | { status: "continue"; record: OfflineContinuationRecord }
  | { status: "pause"; code: string; summary: string };

function pause(code: string, summary: string): OfflineContinuationResult {
  return { status: "pause", code, summary };
}

async function provisionalStepId(input: LoopAssignmentV2, decisionId: string): Promise<string> {
  const source = `${input.loopRunId}\0${input.loopNodeAttemptId}\0${decisionId}`;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return `offline:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function createOfflineContinuation(input: {
  assignment: LoopAssignmentV2;
  decision: LocalRouteDecision;
  current: { workerId: string; agentProfileId: string; workspaceBindingId: string };
  checkpoint: OfflineCheckpoint | null;
  now: Date;
}): Promise<OfflineContinuationResult> {
  const grant = input.assignment.offlineContinuation;
  if (!grant) return pause("offline_grant_missing", "Assignment does not contain an offline continuation grant");
  if (
    input.assignment.routerContract.version !== DECISION_ROUTER_CONTRACT_VERSION
    || input.assignment.routerContract.digest !== DECISION_ROUTER_CONTRACT_DIGEST
  ) return pause("offline_router_contract_mismatch", "Offline continuation Router contract is not the built-in contract");
  if (Date.parse(grant.validUntil) <= input.now.getTime()) return pause("offline_grant_expired", "Offline continuation grant has expired");
  if (grant.workerId !== input.current.workerId) return pause("offline_worker_mismatch", "Offline continuation is bound to another Worker");
  if (grant.agentProfileId !== input.current.agentProfileId) return pause("offline_profile_mismatch", "Offline continuation is bound to another Agent Profile");
  if (grant.workspaceBindingId !== input.current.workspaceBindingId) return pause("offline_workspace_mismatch", "Offline continuation is bound to another Workspace");
  if (grant.snapshotDigest !== input.assignment.runGraphSnapshot.graphDigest || input.decision.snapshotDigest !== grant.snapshotDigest) {
    return pause("offline_snapshot_mismatch", "Offline continuation snapshot does not match the Assignment");
  }
  if (!input.checkpoint || !input.checkpoint.branch.trim() || !/^[a-f0-9]{40}$/u.test(input.checkpoint.commit)) {
    return pause("offline_checkpoint_uncertain", "Offline continuation requires a verified branch and commit checkpoint");
  }
  if (!grant.allowedNodeIds.includes(input.decision.nextNodeId)) return pause("offline_target_not_allowed", "Offline grant does not allow the selected target node");
  try {
    validateLocalRouteDecision({
      decision: input.decision,
      fromNodeId: input.assignment.node.nodeId ?? input.assignment.node.key,
      allowedRouteTargets: grant.allowedNodeIds,
      snapshotDigest: grant.snapshotDigest,
      routerContractVersion: input.assignment.routerContract.version,
      routerContractDigest: input.assignment.routerContract.digest,
    });
  } catch {
    return pause("offline_route_invalid", "Offline route is not valid for the immutable Assignment snapshot");
  }
  return {
    status: "continue",
    record: {
      protocol: "humanthread-offline-continuation/v1",
      grant,
      provisionalStepId: await provisionalStepId(input.assignment, input.decision.decisionId),
      fromNodeId: input.decision.fromNodeId,
      nextNodeId: input.decision.nextNodeId,
      routeDecision: input.decision,
      checkpoint: input.checkpoint,
    },
  };
}

export function serializeOfflineContinuation(result: OfflineContinuationResult): unknown {
  if (result.status === "pause") return result;
  const { token: _token, ...grantWithoutToken } = result.record.grant;
  return {
    status: result.status,
    record: {
      ...result.record,
      grant: grantWithoutToken,
    },
  };
}
