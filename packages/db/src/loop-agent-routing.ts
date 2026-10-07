import {
  localRouteDecisionSchema,
  type LocalRouteDecision,
  type LoopNodeResult,
  type RunGraphSnapshotV2,
} from "@humanthread/shared";
import { stableNodeId } from "@humanthread/shared";
import { createHash } from "node:crypto";
import { boundedPersistenceId } from "./bounded-id";

export type AgentRouteCounters = {
  transitions: number;
  repeats: number;
  edgeTraversals: Record<string, number>;
};

export type AgentRouteState = {
  loopRunId: string;
  loopNodeRunId: string;
  loopNodeAttemptId: string;
  attemptNo: number;
  loopVersionId: string;
  nodeKey: string;
  nodeStatus: string;
  attemptStatus: string;
  runStatus: string;
  runGraphSnapshot: RunGraphSnapshotV2;
  graphDigest: string;
  routerContractVersion: number;
  routerContractDigest: string;
  counters: AgentRouteCounters;
  limits: { maxTransitions: number; maxRepeatCount: number };
  targetActivations: Record<string, number>;
};

export type AgentRouteCommand = {
  commandId: string;
  loopNodeRunId?: string;
  decision: unknown;
  result: LoopNodeResult;
  now: Date;
};

export type AgentRouteResult = {
  status: "routed" | "completed" | "exhausted";
  decisionId: string;
  sourceNodeId: string;
  targetNodeId: string | null;
  selectedEdgeId: string | null;
  targetNodeRunId: string | null;
  counters: AgentRouteCounters;
};

type AgentRouteTransaction = {
  loadState(input: { loopNodeRunId: string }): Promise<AgentRouteState>;
  findDecision(input: { decisionId: string }): Promise<{ fingerprint: string; result: AgentRouteResult } | null>;
  saveStageResult(input: { state: AgentRouteState; result: LoopNodeResult; command: AgentRouteCommand }): Promise<void>;
  saveRouteAudit(input: { state: AgentRouteState; decision: LocalRouteDecision; result: AgentRouteResult; command: AgentRouteCommand }): Promise<void>;
  updateCounters(input: { state: AgentRouteState; counters: AgentRouteCounters; result: AgentRouteResult; command: AgentRouteCommand }): Promise<void>;
  createNodeRun(input: { state: AgentRouteState; targetNodeId: string; targetNodeRunId: string; activationNo: number; inputSnapshot: unknown; command: AgentRouteCommand }): Promise<void>;
  emit(input: { state: AgentRouteState; decision: LocalRouteDecision; result: AgentRouteResult; command: AgentRouteCommand }): Promise<void>;
};

export type LoopAgentRoutingDependencies = {
  transaction<T>(callback: (tx: AgentRouteTransaction) => Promise<T>): Promise<T>;
};

export type OfflineContinuationIngress = {
  provisionalStepId: string;
  routeDecision: unknown;
  stageResult: LoopNodeResult;
};

/**
 * Reconnect validation is deliberately prefix-based: once one provisional
 * record is invalid, later records are not considered independently.
 */
export function validateOfflineContinuationChain(input: {
  records: readonly OfflineContinuationIngress[];
  initialState: AgentRouteState;
  nextState?: (state: AgentRouteState, targetNodeId: string, record: OfflineContinuationIngress) => AgentRouteState;
}): { acceptedProvisionalStepIds: string[]; rejectedSuffix: string[] } {
  const acceptedProvisionalStepIds: string[] = [];
  const rejectedSuffix: string[] = [];
  const seen = new Set<string>();
  let state = input.initialState;
  for (const record of input.records) {
    if (rejectedSuffix.length > 0) {
      rejectedSuffix.push(record.provisionalStepId);
      continue;
    }
    try {
      if (!record.provisionalStepId || seen.has(record.provisionalStepId)) throw routeDecisionInvalid("Offline provisional step id is duplicated");
      const decision = validateAgentRouteDecision({ state, decision: record.routeDecision });
      seen.add(record.provisionalStepId);
      acceptedProvisionalStepIds.push(record.provisionalStepId);
      if (input.nextState) state = input.nextState(state, decision.nextNodeId, record);
    } catch {
      rejectedSuffix.push(record.provisionalStepId);
    }
  }
  return { acceptedProvisionalStepIds, rejectedSuffix };
}

export function validateAgentRouteDecision(input: {
  state: AgentRouteState;
  decision: unknown;
}): LocalRouteDecision {
  const decision = localRouteDecisionSchema.parse(input.decision);
  const graph = graphForState(input.state);
  const sourceNode = graph.nodes.find((node) => node.key === input.state.nodeKey);
  if (!sourceNode || (sourceNode.type !== "start" && sourceNode.type !== "end" && !sourceNode.allowedRouteTargets)) {
    throw routeDecisionInvalid("Current node has no v2 route metadata");
  }
  if (decision.fromNodeId !== stableNodeId(sourceNode)) {
    throw routeDecisionInvalid("Route decision source node does not match the current node");
  }
  if (decision.snapshotDigest !== input.state.graphDigest || input.state.runGraphSnapshot.graphDigest !== input.state.graphDigest) {
    throw routeDecisionInvalid("Route decision snapshot digest does not match the persisted run snapshot");
  }
  if (
    decision.routerContractVersion !== input.state.routerContractVersion
    || decision.routerContractDigest !== input.state.routerContractDigest
  ) {
    throw routeDecisionInvalid("Route decision Router contract does not match the persisted assignment");
  }
  const targetNode = graph.nodes.find((node) => stableNodeId(node) === decision.nextNodeId);
  if (!targetNode || targetNode.type === "start") {
    throw routeDecisionInvalid("Route decision target is outside the current Loop snapshot");
  }
  if (input.state.nodeStatus !== "running" || input.state.attemptStatus !== "running" || input.state.runStatus !== "running") {
    throw routeDecisionInvalid("Loop stage is no longer routable");
  }
  return decision;
}

export async function completeLoopAssignmentAndRoute(
  command: AgentRouteCommand,
  dependencies: LoopAgentRoutingDependencies,
): Promise<AgentRouteResult> {
  const decision = localRouteDecisionSchema.parse(command.decision);
  return dependencies.transaction(async (tx) => {
    const state = await tx.loadState({ loopNodeRunId: command.loopNodeRunId ?? decision.fromNodeId });
    const fingerprint = fingerprintAgentRouteDecision({ decision, result: command.result });
    const existing = await tx.findDecision({ decisionId: decision.decisionId });
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw routeDecisionInvalid("Route decision id was already accepted with different content");
      return existing.result;
    }
    const validated = validateAgentRouteDecision({ state, decision });
    const graph = graphForState(state);
    const sourceNode = graph.nodes.find((node) => node.key === state.nodeKey);
    if (!sourceNode) throw routeDecisionInvalid("Current node is absent from the persisted graph");
    const targetNode = graph.nodes.find((node) => stableNodeId(node) === validated.nextNodeId);
    const edge = targetNode && graph.edges.find((candidate) => candidate.source === sourceNode.key && candidate.target === targetNode.key);
    if (!targetNode) throw routeDecisionInvalid("Route target is absent from the persisted graph");
    const nextCounters = applyBudget(state.counters, targetNode.key, edge, state.limits, state.targetActivations);
    const activationNo = (state.targetActivations[targetNode.key] ?? 0) + 1;
    const targetNodeRunId = boundedPersistenceId("loop-node", [state.loopRunId, targetNode.key, String(activationNo)], 96);
    const status: AgentRouteResult["status"] = nextCounters.status;
    const result: AgentRouteResult = {
      status,
      decisionId: validated.decisionId,
      sourceNodeId: validated.fromNodeId,
      targetNodeId: validated.nextNodeId,
      selectedEdgeId: edge?.id ?? null,
      targetNodeRunId: status === "routed" ? targetNodeRunId : null,
      counters: nextCounters.counters,
    };
    await tx.saveStageResult({ state, result: command.result, command });
    await tx.saveRouteAudit({ state, decision: validated, result, command });
    await tx.updateCounters({ state, counters: result.counters, result, command });
    if (result.targetNodeRunId) {
      await tx.createNodeRun({
        state,
        targetNodeId: targetNode.key,
        targetNodeRunId: result.targetNodeRunId,
        activationNo,
        inputSnapshot: command.result.output,
        command,
      });
    }
    await tx.emit({ state, decision: validated, result, command });
    return result;
  });
}

function graphForState(state: AgentRouteState) {
  const loop = state.runGraphSnapshot.loopVersions.find((version) => version.loopVersionId === state.loopVersionId);
  if (!loop) throw routeDecisionInvalid("Current node is outside the persisted Loop graph snapshot");
  return loop.graph;
}

function applyBudget(
  counters: AgentRouteCounters,
  targetNodeKey: string,
  edge: { id: string; maxTraversals?: number | undefined; kind: string } | undefined,
  limits: AgentRouteState["limits"],
  targetActivations: Record<string, number>,
): { status: "routed" | "exhausted"; counters: AgentRouteCounters } {
  if (counters.transitions >= limits.maxTransitions) return { status: "exhausted", counters };
  const decisionKey = edge?.id ?? `decision:${targetNodeKey}`;
  const edgeTraversals = counters.edgeTraversals[decisionKey] ?? 0;
  const repeatedActivation = (targetActivations[targetNodeKey] ?? 0) > 0;
  if (edge?.maxTraversals !== undefined && edgeTraversals >= edge.maxTraversals) return { status: "exhausted", counters };
  if (repeatedActivation && (targetActivations[targetNodeKey] ?? 0) >= limits.maxRepeatCount) {
    return { status: "exhausted", counters };
  }
  return {
    status: "routed",
    counters: {
      transitions: counters.transitions + 1,
      repeats: counters.repeats + (repeatedActivation ? 1 : 0),
      edgeTraversals: { ...counters.edgeTraversals, [decisionKey]: edgeTraversals + 1 },
    },
  };
}

export function fingerprintAgentRouteDecision(input: { decision: unknown; result: unknown }): string {
  return stableFingerprint({ decision: input.decision, result: input.result });
}

function stableFingerprint(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) return nested;
    return Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b)));
  });
  return createHash("sha256").update(serialized).digest("hex");
}

function routeDecisionInvalid(message: string): Error {
  return Object.assign(new Error(message), { code: "route_decision_invalid" });
}
