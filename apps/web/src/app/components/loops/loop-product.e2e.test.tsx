// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LoopAuthoringGraph, LoopGraph } from "@humanthread/orchestration-core";
import type { LoopRunProjection } from "@/lib/orchestration/loop-read-model";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoopEditor, type LoopEditorInitial } from "./loop-editor";
import { LoopRunViewer } from "./loop-run-viewer";
import {
  ProjectLoopBindings,
  type ProjectLoopSettingsModel,
} from "./project-loop-bindings";

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ nodes, edges, onNodeClick, onEdgeClick }: {
    nodes: Array<{ id: string; data: { label?: string; status?: string } }>;
    edges: Array<{ id: string; label?: string; data?: { traversalCount?: number } }>;
    onNodeClick?: (event: unknown, node: { id: string }) => void;
    onEdgeClick?: (event: unknown, edge: { id: string }) => void;
  }) => (
    <div aria-label="Loop 图">
      {nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          data-testid={`node-${node.id}`}
          data-status={node.data.status}
          onClick={() => onNodeClick?.({}, node)}
        >
          {node.data.label ?? node.id}
        </button>
      ))}
      {edges.map((edge) => (
        <button
          key={edge.id}
          type="button"
          data-testid={`edge-${edge.id}`}
          data-traversed={String((edge.data?.traversalCount ?? 0) > 0)}
          onClick={() => onEdgeClick?.({}, edge)}
        >
          {edge.label ?? edge.id}
        </button>
      ))}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Bottom: "bottom", Left: "left", Right: "right", Top: "top" },
  useUpdateNodeInternals: () => vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const baseGraph = {
  schemaVersion: 1,
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  limits: { maxStages: 8, maxRepeatCount: 2 },
  nodes: [
    { key: "start", label: "开始", type: "start" },
    { key: "end", label: "结束", type: "end" },
  ],
  edges: [
    { id: "start-end", source: "start", target: "end", kind: "normal", outcome: "success" },
  ],
} satisfies LoopGraph;

const editorInitial: LoopEditorInitial = {
  definition: { id: "loop_coding", name: "自动编码 Loop", description: null },
  graph: baseGraph,
  draftRevision: 1,
  versions: [],
  platformCaps: { maxStages: 64, maxRepeatCount: 20, maxTransitions: 1_024 },
};

describe("Loop product journey E2E", () => {
  it("configures, publishes, binds, and observes a no-human coding Loop", async () => {
    const user = userEvent.setup();
    const captured: { publishedGraph?: LoopAuthoringGraph } = {};
    const editorApi = {
      saveDraft: vi.fn(async (input: { graph: LoopAuthoringGraph }) => {
        captured.publishedGraph = input.graph;
        return { draftRevision: 2 };
      }),
      publish: vi.fn(async () => ({ versionNumber: 1, checksum: "sha256:coding-v1" })),
    };
    render(<LoopEditor initial={editorInitial} api={editorApi} />);

    await user.click(screen.getByRole("button", { name: "添加节点" }));
    await user.click(screen.getByRole("menuitem", { name: "Agent 操作" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(editorApi.saveDraft).toHaveBeenCalledOnce());
    await user.click(screen.getByRole("button", { name: "发布版本" }));
    await user.click(screen.getByRole("button", { name: "确认发布" }));
    expect(await screen.findByText("版本 1 已发布 · sha256:coding-v1")).toBeTruthy();
    expect(captured.publishedGraph?.nodes.some((node) => node.type === "human_gate")).toBe(false);

    cleanup();
    const saveBinding = vi.fn().mockResolvedValue({ id: "binding_coding", version: 1 });
    const trigger = vi.fn().mockResolvedValue({ id: "run_coding" });
    const model = productModel([]);
    render(<ProjectLoopBindings model={model} api={{
      saveBinding,
      trigger,
      createGrant: vi.fn(),
      revokeGrant: vi.fn(),
    }} />);

    await user.click(screen.getByRole("checkbox", { name: /Workspace 完全权限/u }));
    await user.click(screen.getByRole("button", { name: "保存绑定" }));
    await waitFor(() => expect(saveBinding).toHaveBeenCalledWith(expect.objectContaining({
      activeVersionId: "version_coding_v1",
      automationGrantIds: ["grant_workspace_full"],
    })));
    expect(trigger).not.toHaveBeenCalled();

    cleanup();
    render(<ProjectLoopBindings model={productModel([{
      id: "binding_coding",
      loopDefinitionId: "loop_coding",
      activeVersionId: "version_coding_v1",
      status: "enabled",
      version: 1,
      triggerPolicy: { manual: true, taskEvents: [] },
      automationGrantIds: ["grant_workspace_full"],
    }])} api={{ saveBinding, trigger, createGrant: vi.fn(), revokeGrant: vi.fn() }} />);
    expect(screen.queryByRole("button", { name: "立即运行" })).toBeNull();
    expect(trigger).not.toHaveBeenCalled();

    cleanup();
    const projection = completedProjection(captured.publishedGraph ?? baseGraph);
    render(<LoopRunViewer
      initialProjection={projection}
      fetchBatch={vi.fn().mockResolvedValue({ cursor: projection.eventCursor, events: [] })}
      pollIntervalMs={60_000}
    />);

    expect(screen.getByText("已完成")).toBeTruthy();
    expect(screen.getByText(/定义 v1 · 投影 v8 · 游标 12/u)).toBeTruthy();
    expect(screen.getAllByTestId(/^node-/u).every((node) => node.getAttribute("data-status") === "succeeded")).toBe(true);
  }, 15_000);
});

function productModel(
  bindings: ProjectLoopSettingsModel["bindings"],
): ProjectLoopSettingsModel {
  return {
    project: {
      id: "project_1",
      name: "HumanThread",
      spaceId: "space_1",
      workspaceBindings: [{
        id: "workspace_1",
        deviceId: "device_1",
        deviceName: "Alice MacBook",
        status: "ready",
        configurationVersion: 2,
      }],
    },
    definitions: [{
      id: "loop_coding",
      name: "自动编码 Loop",
      versions: [{
        id: "version_coding_v1",
        versionNumber: 1,
        humanGateCount: 0,
        maxStages: 8,
        maxRepeatCount: 2,
        agentNodeKeys: [],
      }],
    }],
    agentProfiles: [],
    providerReadiness: [],
    bindings,
    grants: [{
      id: "grant_workspace_full",
      status: "active",
      permission: "workspace_full",
      workspaceBindingIds: ["workspace_1"],
      allowedRelativePathPrefixes: ["."],
      bindingIds: ["binding_coding"],
      expiresAt: "2026-08-01T00:00:00.000Z",
      revokedAt: null,
    }],
    triggerTypes: ["manual", "task_event"],
  };
}

function completedProjection(graph: LoopAuthoringGraph): LoopRunProjection {
  return {
    definitionVersion: 1,
    projectionVersion: 8,
    eventCursor: 12,
    run: {
      id: "run_coding",
      status: "completed",
      repeatCount: 0,
      transitionCount: graph.nodes.length - 1,
      stopReason: null,
    },
    nodes: graph.nodes.map((node, index) => ({
      nodeKey: node.key,
      label: node.label,
      type: node.type,
      status: "succeeded",
      currentNodeRunId: `node_run_${index + 1}`,
      attemptNo: 1,
      waitingReason: null,
      attempts: [],
    })),
    edges: graph.edges.map((edge) => ({
      edgeId: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      outcome: edge.outcome,
      traversalCount: 1,
      limit: edge.kind === "feedback" ? edge.maxTraversals ?? null : null,
      lastTraversalAt: "2026-07-31T10:00:00.000Z",
    })),
    activities: [{
      id: "event_completed",
      cursor: 12,
      eventType: "loop.run.completed",
      occurredAt: "2026-07-31T10:00:00.000Z",
      nodeKey: "end",
      edgeId: null,
      summary: "Loop 运行已完成",
    }],
  };
}
