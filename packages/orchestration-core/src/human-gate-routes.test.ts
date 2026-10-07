import type { LoopAuthoringGraph } from "@humanthread/shared";
import { describe, expect, it } from "vitest";
import { deriveHumanGateRoutes, selectHumanGateDecisionEdge } from "./human-gate-routes";

const legacyGraph: LoopAuthoringGraph = {
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

const ambiguousGraph: LoopAuthoringGraph = {
  ...legacyGraph,
  nodes: [
    { key: "start", label: "Start", type: "start" },
    { key: "review", label: "Review", type: "human_gate", executionTarget: "platform" },
    { key: "accepted", label: "Accepted", type: "end" },
    { key: "rejected", label: "Rejected", type: "end" },
  ],
  edges: [
    { id: "review_accepted", source: "review", target: "accepted", kind: "normal", outcome: "success" },
    { id: "review_rejected", source: "review", target: "rejected", kind: "normal", outcome: "success" },
  ],
};

describe("Human Gate routes", () => {
  it("maps one legacy success edge to pass without changing the graph", () => {
    const routes = deriveHumanGateRoutes(legacyGraph, "confirm_requirement");

    expect(routes).toEqual({ pass: ["confirm_write_prd"], rework: [], reject: [] });
    expect(legacyGraph.edges[0]?.outcome).toBe("success");
  });

  it("keeps standard decision routes unchanged", () => {
    const graph: LoopAuthoringGraph = {
      ...legacyGraph,
      edges: [
        { id: "confirm_pass", source: "confirm_requirement", target: "write_prd", kind: "normal", outcome: "pass" },
        { id: "confirm_rework", source: "confirm_requirement", target: "write_prd", kind: "feedback", outcome: "rework", maxTraversals: 1 },
        { id: "confirm_reject", source: "confirm_requirement", target: "write_prd", kind: "normal", outcome: "reject" },
        { id: "confirm_legacy", source: "confirm_requirement", target: "write_prd", kind: "normal", outcome: "success" },
      ],
    };

    expect(deriveHumanGateRoutes(graph, "confirm_requirement")).toEqual({
      pass: ["confirm_pass"],
      rework: ["confirm_rework"],
      reject: ["confirm_reject"],
    });
  });

  it("rejects ambiguous legacy success routes", () => {
    expect(() => deriveHumanGateRoutes(ambiguousGraph, "review"))
      .toThrowError(/unique success edge/);
  });

  it("returns the exact Human Gate edge selected from a declared outcome", () => {
    expect(selectHumanGateDecisionEdge(legacyGraph, "confirm_requirement", "pass", "confirm_write_prd"))
      .toBe(legacyGraph.edges[0]);
  });

  it("rejects a Human Gate edge selected for the wrong outcome", () => {
    expect(() => selectHumanGateDecisionEdge(legacyGraph, "confirm_requirement", "reject", "confirm_write_prd"))
      .toThrowError(/selectedEdgeId/);
  });
});
