import type { LoopGraph, LoopGraphV2 } from "@humanthread/shared";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  parseRunGraphSnapshot,
  projectPlatformLoopGraphV2,
  resolveRunGraphSnapshot,
  resolveRunGraphSnapshotV2,
  resolvePublishedRunGraphSnapshot,
  resolveScheduledPublishedRunGraphSnapshot,
  snapshotDigest,
} from "./run-graph-snapshot";

function graph(nodes: LoopGraph["nodes"], edges: LoopGraph["edges"]): LoopGraph {
  return {
    schemaVersion: 1,
    inputSchema: { type: "object", properties: { secret: { type: "string" } } },
    outputSchema: { type: "object" },
    limits: { maxStages: 8, maxRepeatCount: 2 },
    nodes,
    edges,
  };
}

const start = { key: "start", nodeId: "node_start", type: "start" as const, label: "Start" };
const end = { key: "end", nodeId: "node_end", type: "end" as const, label: "End" };

const codeDevA: LoopGraph = graph(
  [start, {
    key: "work",
    nodeId: "node_code_dev_a",
    type: "agent_action",
    label: "Work",
    executionTarget: "local",
    promptTemplate: "Project-owned prompt",
    reasoningEffort: "xhigh",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    requiredCapabilities: ["workspace"],
    riskRequirements: { rules: "local rules" },
    retryPolicy: { maxRetries: 1 },
    timeoutPolicy: { callback: "wait" },
  }, end],
  [
    { id: "a-start", source: "start", target: "work", kind: "normal", outcome: "success", condition: { prompt: "secret" } },
    { id: "a-end", source: "work", target: "end", kind: "normal", outcome: "success" },
  ],
);

const codeDevB: LoopGraph = graph(
  [start, { key: "work", nodeId: "node_code_dev_b", type: "agent_action", label: "Other", executionTarget: "local", promptTemplate: "Other" }, end],
  [
    { id: "b-start", source: "start", target: "work", kind: "normal", outcome: "success" },
    { id: "b-end", source: "work", target: "end", kind: "normal", outcome: "success" },
  ],
);

const projectGraph: LoopGraph = graph(
  [start, {
    key: "develop",
    nodeId: "node_develop",
    type: "subloop_call",
    label: "Develop",
    executionTarget: "platform",
    targetLoopDefinitionId: "loop_code_dev",
    targetLoopVersionId: "code_dev_a_v1",
    inputMapping: { taskId: { var: "taskId" } },
    terminalOutcomeMapping: { success: "success", failure: "failure" },
  }, end],
  [
    { id: "p-start", source: "start", target: "develop", kind: "normal", outcome: "success" },
    { id: "p-end", source: "develop", target: "end", kind: "normal", outcome: "success" },
  ],
);

const projectVersion = {
  loopDefinitionId: "loop_project",
  loopVersionId: "project_v1",
  scope: "project" as const,
  graph: projectGraph,
};
const codeDevAVersion = {
  loopDefinitionId: "loop_code_dev",
  loopVersionId: "code_dev_a_v1",
  scope: "task" as const,
  graph: codeDevA,
};
const codeDevBVersion = {
  loopDefinitionId: "loop_code_dev",
  loopVersionId: "code_dev_b_v1",
  scope: "task" as const,
  graph: codeDevB,
};

function graphV2(responsibility = "Implement the approved requirement."): LoopGraphV2 {
  return {
    ...codeDevA,
    schemaVersion: 2,
    routingMetadata: {
      node_code_dev_a: { responsibility },
    },
  };
}

describe("resolveRunGraphSnapshot", () => {
  it("includes only root-reachable SubLoops and redacts legacy content", () => {
    const snapshot = resolveRunGraphSnapshot({
      rootLoopVersionId: "project_v1",
      versions: [projectVersion, codeDevAVersion, codeDevBVersion],
    });

    expect(snapshot.loopVersions.map(({ loopVersionId }) => loopVersionId)).toEqual([
      "project_v1",
      "code_dev_a_v1",
    ]);
    expect(snapshot.reachableNodeIds).toEqual([
      "node_code_dev_a",
      "node_develop",
      "node_end",
      "node_start",
    ]);
    expect(snapshot.reachableNodeIds).not.toContain("node_code_dev_b");
    expect(JSON.stringify(snapshot)).not.toMatch(/"(?:promptTemplate|inputSchema|outputSchema|skills|command|rules|config|callback|condition|expression|riskRequirements|retryPolicy|timeoutPolicy)"/iu);
    expect(snapshot.loopVersions[0]?.graph.nodes[1]).toMatchObject({
      type: "subloop_call",
      targetLoopVersionId: "code_dev_a_v1",
      inputMapping: { taskId: { var: "taskId" } },
    });
    expect(snapshot.loopVersions[1]?.graph.nodes).toContainEqual(
      expect.objectContaining({ type: "agent_action", reasoningEffort: "xhigh" }),
    );
    expect(JSON.stringify(snapshot)).not.toContain("promptTemplate");
    expect(snapshot.loopVersions[0]?.graph.edges[0]).not.toHaveProperty("condition");
  });

  it("produces the same digest regardless of database row order", () => {
    const input = {
      rootLoopVersionId: "project_v1",
      versions: [projectVersion, codeDevAVersion, codeDevBVersion],
    };
    expect(resolveRunGraphSnapshot(input).graphDigest)
      .toBe(resolveRunGraphSnapshot({ ...input, versions: [...input.versions].reverse() }).graphDigest);
  });

  it("parses only snapshots whose digest matches the frozen version set", () => {
    const snapshot = resolveRunGraphSnapshot({
      rootLoopVersionId: "project_v1",
      versions: [projectVersion, codeDevAVersion],
    });

    expect(parseRunGraphSnapshot(snapshot)).toEqual(snapshot);
    expect(() => parseRunGraphSnapshot({
      ...snapshot,
      graphDigest: `sha256:${"0".repeat(64)}`,
    })).toThrow(/digest/u);
  });

  it("rejects missing, mismatched-scope, and recursive SubLoops", () => {
    expect(() => resolveRunGraphSnapshot({
      rootLoopVersionId: "project_v1",
      versions: [projectVersion],
    })).toThrow(/published target/u);

    const projectTarget = {
      ...projectVersion,
      graph: graph([
        start,
        {
          key: "develop",
          type: "subloop_call" as const,
          label: "Develop",
          executionTarget: "platform" as const,
          targetLoopDefinitionId: "loop_project_target",
          targetLoopVersionId: "project_target_v1",
          inputMapping: {},
          terminalOutcomeMapping: { success: "success" as const },
        },
        end,
      ], projectGraph.edges),
    };
    expect(() => resolveRunGraphSnapshot({
      rootLoopVersionId: "project_v1",
      versions: [projectTarget, {
        loopDefinitionId: "loop_project_target",
        loopVersionId: "project_target_v1",
        scope: "project" as const,
        graph: projectGraph,
      }],
    })).toThrow(/task-scoped/u);

    const recursiveGraph = graph([
      start,
      {
        key: "develop",
        type: "subloop_call" as const,
        label: "Develop",
        executionTarget: "platform" as const,
        targetLoopDefinitionId: "loop_code_dev",
        targetLoopVersionId: "code_dev_recursive_v1",
        inputMapping: {},
        terminalOutcomeMapping: { success: "success" as const },
      },
      end,
    ], projectGraph.edges);
    const recursiveTaskGraph = graph([
      start,
      {
        key: "again",
        type: "subloop_call" as const,
        label: "Again",
        executionTarget: "platform" as const,
        targetLoopDefinitionId: "loop_code_dev",
        targetLoopVersionId: "code_dev_recursive_v1",
        inputMapping: {},
        terminalOutcomeMapping: { success: "success" as const },
      },
      end,
    ], codeDevA.edges);
    expect(() => resolveRunGraphSnapshot({
      rootLoopVersionId: "project_v1",
      versions: [
        { ...projectVersion, graph: recursiveGraph },
        {
          loopDefinitionId: "loop_code_dev",
          loopVersionId: "code_dev_recursive_v1",
          scope: "task" as const,
          graph: recursiveTaskGraph,
        },
      ],
    })).toThrow(/recursive/u);

    expect(() => resolveRunGraphSnapshot({
      rootLoopVersionId: "project_v1",
      versions: [{
        ...projectVersion,
        graph: {
          ...projectGraph,
          nodes: [
            ...projectGraph.nodes,
            { key: "duplicate", nodeId: "node_develop", type: "end", label: "Duplicate" },
          ],
        },
      }, codeDevAVersion],
    })).toThrow(/duplicate stable node/u);
  });

  it("rejects forbidden local-content keys nested in input mappings", () => {
    const forbiddenMapping = {
      taskId: { var: "taskId", nested: { promptTemplate: "do not ship" } },
    };
    const graphWithForbiddenMapping = graph([
      start,
      {
        ...projectGraph.nodes[1]!,
        inputMapping: forbiddenMapping,
      } as typeof projectGraph.nodes[number],
      end,
    ], projectGraph.edges);

    expect(() => resolveRunGraphSnapshot({
      rootLoopVersionId: "project_v1",
      versions: [{ ...projectVersion, graph: graphWithForbiddenMapping }, codeDevAVersion],
    })).toThrow(/forbidden.*promptTemplate/iu);
  });

  it("preserves valid variable mappings and isolates them from caller mutation", () => {
    const inputMapping = { taskId: { var: "taskId" } };
    const graphWithMapping = graph([
      start,
      {
        ...projectGraph.nodes[1]!,
        inputMapping,
      } as typeof projectGraph.nodes[number],
      end,
    ], projectGraph.edges);
    const input = {
      rootLoopVersionId: "project_v1",
      versions: [{ ...projectVersion, graph: graphWithMapping }, codeDevAVersion],
    };
    const snapshot = resolveRunGraphSnapshot(input);
    const digestBeforeMutation = snapshot.graphDigest;

    inputMapping.taskId.var = "mutated";

    expect(snapshot.loopVersions[0]?.graph.nodes[1]).toMatchObject({
      inputMapping: { taskId: { var: "taskId" } },
    });
    expect(snapshot.graphDigest).toBe(digestBeforeMutation);
    expect(snapshotDigest({
      rootLoopVersionId: snapshot.rootLoopVersionId,
      loopVersions: snapshot.loopVersions,
    })).toBe(snapshot.graphDigest);
  });

  it("canonicalizes undefined and sparse array entries consistently", () => {
    expect(canonicalJson({ b: undefined, a: [undefined, , 1] })).toBe('{"a":[null,null,1]}');
    expect(canonicalJson({ a: [null, null, 1] })).toBe('{"a":[null,null,1]}');
  });

  it("rejects cycles and non-plain objects in canonical JSON", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => canonicalJson(cyclic)).toThrow(/cycle/u);
    expect(() => canonicalJson(new Date("2026-08-05T00:00:00.000Z"))).toThrow(/plain/u);
    expect(() => canonicalJson(new Map([["key", "value"]]))).toThrow(/plain/u);
    expect(() => canonicalJson({ value: () => "not JSON" })).toThrow(/JSON values/u);
  });
});

describe("resolveRunGraphSnapshotV2", () => {
  it("selects the resolver from the published root graph schema", () => {
    const snapshot = resolvePublishedRunGraphSnapshot({
      rootLoopVersionId: "project_v2",
      versions: [{
        loopDefinitionId: "loop_project",
        loopVersionId: "project_v2",
        scope: "project",
        graph: { ...projectGraph, schemaVersion: 2, routingMetadata: { node_develop: { responsibility: "Run task Loop." } } },
      }, {
        ...codeDevAVersion,
        graph: { ...graphV2(), schemaVersion: 2, routingMetadata: { node_code_dev_a: { responsibility: "Implement the task." } } },
      }],
    });
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.rootLoopVersionId).toBe("project_v2");
  });

  it("freezes responsibilities and derives route candidates from outgoing edges", () => {
    const graph = graphV2();
    const projected = projectPlatformLoopGraphV2(graph);

    expect(projected.nodes[1]).toMatchObject({
      nodeId: "node_code_dev_a",
      responsibility: "Implement the approved requirement.",
      allowedRouteTargets: ["node_end"],
      reasoningEffort: "xhigh",
    });
    expect(JSON.stringify(projected)).not.toContain("promptTemplate");

    const snapshot = resolveRunGraphSnapshotV2({
      rootLoopVersionId: "project_v2",
      versions: [{
        loopDefinitionId: "loop_project",
        loopVersionId: "project_v2",
        scope: "project",
        graph: {
          ...projectGraph,
          schemaVersion: 2,
          routingMetadata: {
            node_develop: { responsibility: "Execute the selected task Loop." },
          },
        },
      }, {
        ...codeDevAVersion,
        graph,
      }],
    });

    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.loopVersions.map(({ loopVersionId }) => loopVersionId)).toEqual(["project_v2", "code_dev_a_v1"]);
    expect(snapshot.loopVersions[1]?.graph.nodes).toContainEqual(
      expect.objectContaining({ type: "agent_action", reasoningEffort: "xhigh" }),
    );
    expect(JSON.stringify(snapshot)).not.toContain("promptTemplate");
  });

  it("changes the immutable digest when responsibility changes", () => {
    const resolve = (responsibility: string) => resolveRunGraphSnapshotV2({
      rootLoopVersionId: "project_v2",
      versions: [{
        loopDefinitionId: "loop_project",
        loopVersionId: "project_v2",
        scope: "project" as const,
        graph: {
          ...projectGraph,
          schemaVersion: 2 as const,
          routingMetadata: { node_develop: { responsibility } },
        },
      }, { ...codeDevAVersion, graph: graphV2() }],
    });

    expect(resolve("Execute development.").graphDigest)
      .not.toBe(resolve("Execute development and preserve evidence.").graphDigest);
  });

  it("rejects missing responsibilities and duplicate derived candidates", () => {
    expect(() => projectPlatformLoopGraphV2({ ...graphV2(), routingMetadata: {} } as LoopGraphV2))
      .toThrow(/responsibility/iu);
    const duplicate = graphV2();
    expect(() => projectPlatformLoopGraphV2({
      ...duplicate,
      edges: [...duplicate.edges, { ...duplicate.edges[1]!, id: "develop-end-duplicate", outcome: "failure" }],
    })).toThrow(/duplicate.*route/iu);
  });
});

describe("resolveScheduledPublishedRunGraphSnapshot", () => {
  it("allows a task-scoped root without weakening project-root callers", () => {
    const versions = [{
      loopDefinitionId: "loop_task",
      loopVersionId: "task_v1",
      scope: "task" as const,
      graph: codeDevA,
    }];

    const snapshot = resolveScheduledPublishedRunGraphSnapshot({
      rootLoopVersionId: "task_v1",
      versions,
    });
    expect(snapshot.rootLoopVersionId).toBe("task_v1");
    expect(snapshot.loopVersions.map(({ loopVersionId }) => loopVersionId)).toEqual(["task_v1"]);
    expect(() => resolveRunGraphSnapshot({
      rootLoopVersionId: "task_v1",
      versions,
    })).toThrow(/project Loop/u);
  });

  it("keeps scheduled task-root subloop traversal task-scoped", () => {
    const snapshot = resolveScheduledPublishedRunGraphSnapshot({
      rootLoopVersionId: "task_root_v1",
      versions: [
        {
          loopDefinitionId: "loop_task_root",
          loopVersionId: "task_root_v1",
          scope: "task",
          graph: graph([
            start,
            {
              key: "develop",
              nodeId: "node_task_develop",
              type: "subloop_call" as const,
              label: "Develop",
              executionTarget: "platform" as const,
              targetLoopDefinitionId: "loop_code_dev",
              targetLoopVersionId: "code_dev_a_v1",
              inputMapping: {},
              terminalOutcomeMapping: { success: "success" as const, failure: "failure" as const },
            },
            end,
          ], [
            { id: "start-develop", source: "start", target: "develop", kind: "normal" as const, outcome: "success" as const },
            { id: "develop-end", source: "develop", target: "end", kind: "normal" as const, outcome: "success" as const },
          ]),
        },
        codeDevAVersion,
      ],
    });
    expect(snapshot.loopVersions.map(({ loopVersionId }) => loopVersionId)).toEqual([
      "task_root_v1",
      "code_dev_a_v1",
    ]);
  });
});
