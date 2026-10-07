import type { LoopGraph } from "@humanthread/shared";
import { describe, expect, it } from "vitest";
import {
  calculateMaxTransitions,
  selectNextEdge,
  validateJsonSchemaValue,
  validateLoopGraph,
} from "./loop-graph";

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

describe("loop graph validation and routing", () => {
  it("validates a JSON value against a published result schema", () => {
    expect(validateJsonSchemaValue({
      type: "object",
      required: ["summary"],
      additionalProperties: false,
      properties: { summary: { type: "string", minLength: 1 } },
    }, { summary: "done" })).toEqual({ ok: true });
    expect(validateJsonSchemaValue({
      type: "object",
      required: ["summary"],
      additionalProperties: false,
      properties: { summary: { type: "string", minLength: 1 } },
    }, { summary: "", extra: true })).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        expect.stringMatching(/additionalProperties/),
        expect.stringMatching(/summary.*minLength/),
      ]),
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "additionalProperties", path: ["extra"] }),
        expect.objectContaining({ code: "minLength", path: ["summary"] }),
      ]),
    });
  });

  it("rejects a normal cycle but accepts a declared bounded feedback edge", () => {
    const normalCycleGraph: LoopGraph = {
      ...feedbackGraph,
      edges: feedbackGraph.edges.map((edge) => edge.id === "feedback" ? {
        ...edge,
        kind: "normal" as const,
        maxTraversals: undefined,
      } : edge),
    };

    expect(validateLoopGraph(normalCycleGraph)).toEqual(expect.objectContaining({ ok: false }));
    expect(validateLoopGraph(feedbackGraph)).toEqual({ ok: true, maxTransitions: 9 });
  });

  it("rejects invalid node schemas and incompatible execution targets", () => {
    const invalidGraph = structuredClone(feedbackGraph) as LoopGraph;
    invalidGraph.nodes[1] = {
      key: "work",
      label: "Work",
      type: "agent_action",
      executionTarget: "platform",
      promptTemplate: "Work",
    } as LoopGraph["nodes"][number];

    expect(validateLoopGraph(invalidGraph)).toEqual(expect.objectContaining({ ok: false }));
  });

  it("rejects graph and node schemas that cannot be compiled as JSON Schema", () => {
    const invalidGraph = structuredClone(feedbackGraph) as LoopGraph;
    invalidGraph.inputSchema = { type: "not-a-json-schema-type" };
    invalidGraph.nodes[1] = {
      ...invalidGraph.nodes[1],
      outputSchema: { required: "must be an array" },
    };

    expect(validateLoopGraph(invalidGraph)).toEqual(expect.objectContaining({
      ok: false,
      errors: expect.arrayContaining([
        expect.stringMatching(/inputSchema/),
        expect.stringMatching(/nodes\.1\.outputSchema/),
      ]),
    }));
  });

  it.each([
    ["a graph without exactly one start", (graph: LoopGraph) => ({
      ...graph,
      nodes: graph.nodes.map((node) => node.key === "start" ? { ...node, type: "end" as const } : node),
    })],
    ["a graph with duplicate node keys", (graph: LoopGraph) => ({
      ...graph,
      nodes: graph.nodes.map((node) => node.key === "end" ? { ...node, key: "work" } as LoopGraph["nodes"][number] : node),
    })],
    ["a graph with an unreachable node", (graph: LoopGraph) => ({
      ...graph,
      limits: { ...graph.limits, maxStages: 4 },
      nodes: [...graph.nodes, { key: "orphan", label: "Orphan", type: "end" as const }],
    })],
    ["a feedback edge that does not point to an ancestor", (graph: LoopGraph) => ({
      ...graph,
      edges: graph.edges.map((edge) => edge.id === "feedback" ? { ...edge, target: "end" } : edge),
    })],
    ["nodes and feedback targets only reachable through feedback edges", (graph: LoopGraph) => ({
      ...graph,
      limits: { ...graph.limits, maxStages: 4 },
      nodes: [
        graph.nodes[0],
        { key: "ancestor", label: "Ancestor", type: "agent_action" as const, executionTarget: "local" as const, promptTemplate: "Work" },
        { key: "source", label: "Source", type: "agent_action" as const, executionTarget: "local" as const, promptTemplate: "Work" },
        graph.nodes[2],
      ],
      edges: [
        { id: "start-end", source: "start", target: "end", kind: "normal" as const, outcome: "success" as const },
        { id: "ancestor-start", source: "ancestor", target: "start", kind: "normal" as const, outcome: "success" as const },
        { id: "ancestor-source", source: "ancestor", target: "source", kind: "normal" as const, outcome: "success" as const },
        { id: "source-end", source: "source", target: "end", kind: "normal" as const, outcome: "success" as const },
        { id: "start-ancestor", source: "start", target: "ancestor", kind: "feedback" as const, outcome: "rework" as const, maxTraversals: 2 },
        { id: "source-ancestor", source: "source", target: "ancestor", kind: "feedback" as const, outcome: "rework" as const, maxTraversals: 2 },
      ],
    })],
    ["an edge traversal cap greater than the graph repeat cap", (graph: LoopGraph) => ({
      ...graph,
      edges: graph.edges.map((edge) => edge.id === "feedback" ? { ...edge, maxTraversals: 3 } : edge),
    })],
    ["a node without a terminal path", (graph: LoopGraph) => ({
      ...graph,
      edges: graph.edges.filter((edge) => edge.id !== "work-end"),
    })],
  ])("rejects %s", (_description, mutate) => {
    expect(validateLoopGraph(mutate(feedbackGraph))).toEqual(expect.objectContaining({ ok: false }));
  });

  it("calculates a platform-capped transition budget", () => {
    expect(calculateMaxTransitions(feedbackGraph)).toBe(9);
    expect(calculateMaxTransitions({
      ...feedbackGraph,
      nodes: Array.from({ length: 64 }, (_, index) => ({
        key: `end-${index}`,
        label: `End ${index}`,
        type: "end" as const,
      })),
      limits: { maxStages: 64, maxRepeatCount: 20 },
    })).toBe(1_024);
  });

  it("selects exactly one route after evaluating JsonLogic conditions", () => {
    const graph: LoopGraph = {
      ...feedbackGraph,
      edges: [
        feedbackGraph.edges[0],
        { id: "approved", source: "work", target: "end", kind: "normal", outcome: "success", condition: { "==": [{ var: "approved" }, true] } },
        { id: "rejected", source: "work", target: "end", kind: "normal", outcome: "success", condition: { "==": [{ var: "approved" }, false] } },
      ],
    };

    expect(selectNextEdge({ graph, nodeKey: "work", outcome: "success", data: { approved: true } }).id).toBe("approved");
    expect(() => selectNextEdge({ graph, nodeKey: "work", outcome: "failure", data: {} })).toThrowError(/exactly one edge/);
    expect(() => selectNextEdge({ graph, nodeKey: "work", outcome: "failure", data: {} })).toThrowError(expect.objectContaining({ code: "validation_failed" }));
  });

  it("rejects a platform action node that declares no executable action", () => {
    const graph: LoopGraph = {
      schemaVersion: 1,
      inputSchema: {},
      outputSchema: {},
      limits: { maxStages: 3, maxRepeatCount: 2 },
      nodes: [
        { key: "start", label: "Start", type: "start" },
        { key: "confirm", label: "Confirm", type: "platform_action", executionTarget: "platform" },
        { key: "end", label: "End", type: "end" },
      ],
      edges: [
        { id: "start-confirm", source: "start", target: "confirm", kind: "normal", outcome: "success" },
        { id: "confirm-end", source: "confirm", target: "end", kind: "normal", outcome: "success" },
      ],
    };

    expect(validateLoopGraph(graph)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "Node confirm of type platform_action must declare an action; use a human_gate node for author confirmation",
      ]),
    });
    expect(validateLoopGraph({
      ...graph,
      nodes: graph.nodes.map((node) => (
        node.key === "confirm" ? { ...node, action: "project_document.write" } : node
      )),
    }).ok).toBe(true);
  });
});
