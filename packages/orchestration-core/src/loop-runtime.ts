import type { GateDecision, LoopEdgeDefinition, LoopGraph } from "@humanthread/shared";
import { selectHumanGateDecisionEdge } from "./human-gate-routes";
import { calculateMaxTransitions, selectNextEdge } from "./loop-graph";

export interface TransitionCounters {
  transitions: number;
  repeats: number;
  edgeTraversals: Record<string, number>;
}

export interface TransitionLimits {
  maxRepeatCount: number;
  maxTransitions: number;
}

export type TransitionExhaustionReason =
  | "max_transitions_exhausted"
  | "max_repeat_count_exhausted"
  | "edge_max_traversals_exhausted";

export type TransitionBudgetResult =
  | { ok: true; counters: TransitionCounters }
  | { ok: false; reason: TransitionExhaustionReason };

export function applyTransitionBudget(input: {
  counters: TransitionCounters;
  edge: LoopEdgeDefinition;
  limits: TransitionLimits;
}): TransitionBudgetResult {
  if (input.counters.transitions + 1 >= input.limits.maxTransitions) {
    return { ok: false, reason: "max_transitions_exhausted" };
  }

  const isFeedback = input.edge.kind === "feedback";
  if (isFeedback && input.counters.repeats + 1 > input.limits.maxRepeatCount) {
    return { ok: false, reason: "max_repeat_count_exhausted" };
  }

  const currentEdgeTraversals = Object.hasOwn(input.counters.edgeTraversals, input.edge.id)
    ? input.counters.edgeTraversals[input.edge.id] ?? 0
    : 0;
  if (input.edge.maxTraversals !== undefined && currentEdgeTraversals + 1 > input.edge.maxTraversals) {
    return { ok: false, reason: "edge_max_traversals_exhausted" };
  }

  return {
    ok: true,
    counters: {
      transitions: input.counters.transitions + 1,
      repeats: input.counters.repeats + (isFeedback ? 1 : 0),
      edgeTraversals: { ...input.counters.edgeTraversals, [input.edge.id]: currentEdgeTraversals + 1 },
    },
  };
}

export function transitionLoopNode(input: {
  graph: LoopGraph;
  nodeKey: string;
  decision: GateDecision;
  counters: TransitionCounters;
  limits: TransitionLimits;
}):
  | { status: "routed"; edge: LoopEdgeDefinition; counters: TransitionCounters }
  | { status: "exhausted"; edge: LoopEdgeDefinition; reason: TransitionExhaustionReason } {
  const node = input.graph.nodes.find((candidate) => candidate.key === input.nodeKey);
  const edge = node?.type === "human_gate"
    ? selectHumanGateDecisionEdge(
      input.graph,
      input.nodeKey,
      input.decision.outcome,
      input.decision.selectedEdgeId,
    )
    : selectNextEdge({
      graph: input.graph,
      nodeKey: input.nodeKey,
      outcome: input.decision.outcome,
      data: input.decision,
    });
  if (node?.type !== "human_gate" && edge.id !== input.decision.selectedEdgeId) {
    throw Object.assign(new Error("Gate selectedEdgeId does not match deterministic routing"), { code: "validation_failed" });
  }

  const budget = applyTransitionBudget({
    counters: input.counters,
    edge,
    limits: {
      maxRepeatCount: Math.min(input.limits.maxRepeatCount, input.graph.limits.maxRepeatCount),
      maxTransitions: Math.min(input.limits.maxTransitions, calculateMaxTransitions(input.graph)),
    },
  });
  return budget.ok
    ? { status: "routed", edge, counters: budget.counters }
    : { status: "exhausted", edge, reason: budget.reason };
}
