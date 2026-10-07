import fc from "fast-check";
import type { GateDecision, LoopEdgeDefinition, LoopGraph } from "@humanthread/shared";
import { describe, expect, it } from "vitest";
import { applyTransitionBudget, transitionLoopNode } from "./loop-runtime";
import { validateLoopGraph } from "./loop-graph";

const feedbackGraph: LoopGraph = {
  schemaVersion: 1,
  inputSchema: {},
  outputSchema: {},
  limits: { maxStages: 3, maxRepeatCount: 2 },
  nodes: [
    { key: "start", label: "Start", type: "start" },
    { key: "work", label: "Work", type: "agent_action", executionTarget: "local", promptTemplate: "Work" },
    { key: "end", label: "End", type: "end" },
  ],
  edges: [
    { id: "start-work", source: "start", target: "work", kind: "normal", outcome: "success" },
    { id: "work-end", source: "work", target: "end", kind: "normal", outcome: "success" },
    { id: "feedback", source: "work", target: "start", kind: "feedback", outcome: "rework", maxTraversals: 2 },
  ],
};

const feedbackEdge = feedbackGraph.edges.find((edge) => edge.id === "feedback") as LoopEdgeDefinition;

const legacyHumanGateGraph: LoopGraph = {
  schemaVersion: 1,
  inputSchema: {},
  outputSchema: {},
  limits: { maxStages: 3, maxRepeatCount: 1 },
  nodes: [
    { key: "start", label: "Start", type: "start" },
    { key: "confirm", label: "Confirm", type: "human_gate", executionTarget: "platform" },
    { key: "end", label: "End", type: "end" },
  ],
  edges: [
    { id: "start-confirm", source: "start", target: "confirm", kind: "normal", outcome: "success" },
    { id: "confirm-end", source: "confirm", target: "end", kind: "normal", outcome: "success" },
  ],
};

describe("loop transition budgets", () => {
  it("exhausts before routing past the hard cap", () => {
    expect(applyTransitionBudget({
      counters: { transitions: 8, repeats: 2, edgeTraversals: { feedback: 2 } },
      edge: { ...feedbackEdge, id: "feedback", maxTraversals: 3 },
      limits: { maxRepeatCount: 3, maxTransitions: 9 },
    })).toEqual({ ok: false, reason: "max_transitions_exhausted" });
  });

  it("enforces feedback repeat and per-edge traversal limits", () => {
    expect(applyTransitionBudget({
      counters: { transitions: 1, repeats: 2, edgeTraversals: { feedback: 2 } },
      edge: feedbackEdge,
      limits: { maxRepeatCount: 2, maxTransitions: 9 },
    })).toEqual({ ok: false, reason: "max_repeat_count_exhausted" });

    expect(applyTransitionBudget({
      counters: { transitions: 1, repeats: 1, edgeTraversals: { feedback: 2 } },
      edge: feedbackEdge,
      limits: { maxRepeatCount: 2, maxTransitions: 9 },
    })).toEqual({ ok: false, reason: "edge_max_traversals_exhausted" });
  });

  it.each(["__proto__", "constructor", "toString"])(
    "counts the reserved edge id %s as an own numeric property",
    (edgeId) => {
      const edge = { ...feedbackEdge, id: edgeId, maxTraversals: 1 };
      const first = applyTransitionBudget({
        counters: { transitions: 0, repeats: 0, edgeTraversals: {} },
        edge,
        limits: { maxRepeatCount: 2, maxTransitions: 9 },
      });

      expect(first).toEqual({
        ok: true,
        counters: {
          transitions: 1,
          repeats: 1,
          edgeTraversals: { [edgeId]: 1 },
        },
      });
      if (!first.ok) return;
      expect(Object.hasOwn(first.counters.edgeTraversals, edgeId)).toBe(true);
      expect(applyTransitionBudget({
        counters: first.counters,
        edge,
        limits: { maxRepeatCount: 2, maxTransitions: 9 },
      })).toEqual({ ok: false, reason: "edge_max_traversals_exhausted" });
    },
  );

  it("does not let caller limits raise the published graph transition ceiling", () => {
    expect(transitionLoopNode({
      graph: feedbackGraph,
      nodeKey: "work",
      decision: {
        outcome: "rework",
        reasonCode: "needs_changes",
        message: "Needs changes",
        evidenceRefs: [],
        selectedEdgeId: "feedback",
      },
      counters: { transitions: 8, repeats: 0, edgeTraversals: {} },
      limits: { maxRepeatCount: 20, maxTransitions: 1_024 },
    })).toEqual(expect.objectContaining({ status: "exhausted", reason: "max_transitions_exhausted" }));
  });

  it("keeps generated sequential graph counters monotonic and stops at the calculated transition cap", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 20 }),
      fc.integer({ min: 1, max: 16 }),
      (maxRepeatCount, stageCount) => {
        const graph: LoopGraph = {
          ...feedbackGraph,
          limits: { maxStages: stageCount + 2, maxRepeatCount },
          nodes: [
            { key: "start", label: "Start", type: "start" },
            ...Array.from({ length: stageCount }, (_, index) => ({
              key: `stage-${index}`,
              label: `Stage ${index}`,
              type: "agent_action" as const,
              executionTarget: "local" as const,
              promptTemplate: "Work",
            })),
            { key: "end", label: "End", type: "end" },
          ],
          edges: [
            { id: "start-stage", source: "start", target: "stage-0", kind: "normal", outcome: "success" },
            ...Array.from({ length: stageCount - 1 }, (_, index) => ({
              id: `stage-${index}-${index + 1}`,
              source: `stage-${index}`,
              target: `stage-${index + 1}`,
              kind: "normal" as const,
              outcome: "success" as const,
            })),
            { id: "stage-end", source: `stage-${stageCount - 1}`, target: "end", kind: "normal", outcome: "success" },
            { id: "feedback", source: `stage-${stageCount - 1}`, target: "start", kind: "feedback", outcome: "rework", maxTraversals: maxRepeatCount },
          ],
        };
        const validation = validateLoopGraph(graph);
        expect(validation.ok).toBe(true);
        if (!validation.ok) return;

        const maxTransitions = validation.maxTransitions;
        let counters = { transitions: 0, repeats: 0, edgeTraversals: {} as Record<string, number> };
        const edge = graph.edges[0] as LoopEdgeDefinition;

        for (let transition = 0; transition < maxTransitions - 1; transition += 1) {
          const next = applyTransitionBudget({ counters, edge, limits: { maxRepeatCount, maxTransitions } });
          expect(next.ok).toBe(true);
          if (!next.ok) return;
          expect(next.counters.transitions).toBeGreaterThan(counters.transitions);
          expect(next.counters.repeats).toBe(counters.repeats);
          expect(next.counters.transitions).toBeLessThanOrEqual(maxTransitions);
          counters = next.counters;
        }

        expect(applyTransitionBudget({ counters, edge, limits: { maxRepeatCount, maxTransitions } })).toEqual({
          ok: false,
          reason: "max_transitions_exhausted",
        });
      },
    ));
  }, 15_000);

  it("requires a gate decision to agree with deterministic edge selection", () => {
    const decision: GateDecision = {
      outcome: "rework",
      reasonCode: "needs_changes",
      message: "Needs changes",
      evidenceRefs: [],
      selectedEdgeId: "feedback",
    };

    expect(transitionLoopNode({
      graph: feedbackGraph,
      nodeKey: "work",
      decision,
      counters: { transitions: 0, repeats: 0, edgeTraversals: {} },
      limits: { maxRepeatCount: 2, maxTransitions: 9 },
    })).toEqual(expect.objectContaining({ status: "routed", edge: feedbackEdge }));

    expect(() => transitionLoopNode({
      graph: feedbackGraph,
      nodeKey: "work",
      decision: { ...decision, selectedEdgeId: "work-end" },
      counters: { transitions: 0, repeats: 0, edgeTraversals: {} },
      limits: { maxRepeatCount: 2, maxTransitions: 9 },
    })).toThrowError(/selectedEdgeId/);
    expect(() => transitionLoopNode({
      graph: feedbackGraph,
      nodeKey: "work",
      decision: { ...decision, selectedEdgeId: "work-end" },
      counters: { transitions: 0, repeats: 0, edgeTraversals: {} },
      limits: { maxRepeatCount: 2, maxTransitions: 9 },
    })).toThrowError(expect.objectContaining({ code: "validation_failed" }));
  });

  it("routes a Human Gate decision through its selected legacy success edge", () => {
    expect(transitionLoopNode({
      graph: legacyHumanGateGraph,
      nodeKey: "confirm",
      decision: {
        outcome: "pass",
        reasonCode: "approved",
        message: "Approved",
        evidenceRefs: [],
        selectedEdgeId: "confirm-end",
      },
      counters: { transitions: 0, repeats: 0, edgeTraversals: {} },
      limits: { maxRepeatCount: 1, maxTransitions: 9 },
    })).toEqual(expect.objectContaining({
      status: "routed",
      edge: legacyHumanGateGraph.edges[1],
    }));
  });
});
