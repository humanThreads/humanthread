// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LoopGraph } from "@humanthread/orchestration-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLoopNodePosition, LoopEditor, type LoopEditorInitial } from "./loop-editor";

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ nodes, edges, onNodeClick, onEdgeClick, children }: {
    nodes: Array<{ id: string; data: { label: string } }>;
    edges: Array<{ id: string; label: string }>;
    onNodeClick?: (event: unknown, node: { id: string }) => void;
    onEdgeClick?: (event: unknown, edge: { id: string }) => void;
    children?: unknown;
  }) => (
    <div aria-label="Loop 图画布">
      {nodes.map((node) => (
        <button key={node.id} type="button" onClick={() => onNodeClick?.({}, node)}>{node.data.label}</button>
      ))}
      {edges.map((edge) => (
        <button key={edge.id} type="button" aria-label={`连接 ${edge.label}`} onClick={() => onEdgeClick?.({}, edge)}>
          {edge.label}
        </button>
      ))}
      {children as never}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
  MarkerType: { ArrowClosed: "arrowclosed" },
}));

afterEach(cleanup);

const graph = {
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

const initial: LoopEditorInitial = {
  definition: { id: "loop_1", name: "交付 Loop", description: null },
  graph,
  draftRevision: 2,
  versions: [],
  platformCaps: { maxStages: 64, maxRepeatCount: 20, maxTransitions: 1024 },
};

const projectInitial: LoopEditorInitial = {
  ...initial,
  definition: { ...initial.definition, scope: "project" },
  subloopOptions: [{
    definitionId: "task_loop_1",
    name: "Gelsang Project Loop",
    versions: [{ id: "task_version_3", versionNumber: 3 }],
  }],
};

const v2Initial: LoopEditorInitial = {
  ...initial,
  graph: {
    ...feedbackGraph(),
    schemaVersion: 2,
    routingMetadata: {
      agent: { responsibility: "Implement the approved requirement." },
      gate: { responsibility: "Verify evidence and classify the result." },
    },
  },
};

function invalidGraph(): LoopGraph {
  const extraNodes = Array.from({ length: 63 }, (_, index) => ({
    key: `node_${index + 1}`,
    label: `节点 ${index + 1}`,
    type: "condition" as const,
    executionTarget: "platform" as const,
  }));
  return {
    ...graph,
    limits: { maxStages: 64, maxRepeatCount: 2 },
    nodes: [graph.nodes[0], ...extraNodes, graph.nodes[1]],
    edges: [
      ...graph.edges,
      {
        id: "feedback-missing-limit",
        source: "node_1",
        target: "start",
        kind: "feedback",
        outcome: "rework",
      },
    ],
  } as unknown as LoopGraph;
}

function feedbackGraph(): LoopGraph {
  return {
    ...graph,
    nodes: [
      graph.nodes[0]!,
      {
        key: "agent",
        label: "执行工作",
        type: "agent_action",
        executionTarget: "either",
        promptTemplate: "完成工作",
      },
      {
        key: "gate",
        label: "质量门禁",
        type: "policy_gate",
        executionTarget: "platform",
      },
      graph.nodes[1]!,
    ],
    edges: [
      { id: "start-agent", source: "start", target: "agent", kind: "normal", outcome: "success" },
      { id: "agent-gate", source: "agent", target: "gate", kind: "normal", outcome: "success" },
      { id: "gate-end", source: "gate", target: "end", kind: "normal", outcome: "pass" },
      { id: "gate-agent", source: "gate", target: "agent", kind: "feedback", outcome: "rework", maxTraversals: 1 },
    ],
  };
}

describe("LoopEditor", () => {
  it("keeps the canvas visible beside a scrollable inspector on desktop", async () => {
    const user = userEvent.setup();
    render(<LoopEditor initial={{ ...initial, graph: feedbackGraph() }} api={{ saveDraft: vi.fn(), publish: vi.fn() }} />);

    await user.click(screen.getByRole("button", { name: "执行工作" }));

    const canvas = screen.getAllByLabelText("Loop 图画布").find((element) => element.className.includes("min-h-0 min-w-0"))!;
    const inspector = screen.getByRole("complementary", { name: "Loop 属性检查器" });
    const layout = canvas.closest("[data-loop-editor-layout]");

    expect(layout?.getAttribute("data-loop-editor-layout")).toBe("true");
    expect(layout?.className).toContain("md:grid-cols-[minmax(0,7fr)_minmax(260px,3fr)]");
    expect(canvas.className).toContain("md:row-start-2");
    expect(inspector.parentElement?.className).toContain("md:col-start-2");
    expect(inspector.parentElement?.className).toContain("h-full");
    expect(inspector.className).toContain("overflow-y-auto");
  });

  it("persists an Agent reasoning effort override", async () => {
    const user = userEvent.setup();
    const api = { saveDraft: vi.fn().mockResolvedValue({ draftRevision: 3 }), publish: vi.fn() };
    render(<LoopEditor initial={{ ...initial, graph: feedbackGraph() }} api={api} />);

    await user.click(screen.getByRole("button", { name: "执行工作" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "推理强度" }), "xhigh");
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      graph: expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ key: "agent", reasoningEffort: "xhigh" }),
        ]),
      }),
    })));
  });

  it("persists the standard requirement conversation policy for an Agent node", async () => {
    const user = userEvent.setup();
    const api = { saveDraft: vi.fn().mockResolvedValue({ draftRevision: 3 }), publish: vi.fn() };
    render(<LoopEditor initial={{ ...initial, graph: feedbackGraph() }} api={api} />);

    await user.click(screen.getByRole("button", { name: "执行工作" }));
    await user.click(screen.getByRole("checkbox", { name: "允许需求沟通" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      graph: expect.objectContaining({
        nodes: expect.arrayContaining([expect.objectContaining({
          key: "agent",
          interactionPolicy: {
            kind: "requirement_conversation",
            replyRoles: ["task_collaborator", "task_assignee", "task_creator", "project_admin"],
            confirmRoles: ["task_assignee", "task_creator", "project_admin"],
            structuredFields: [],
          },
        })]),
      }),
    })));
  });

  it("edits node responsibility and shows derived route candidates as read-only", async () => {
    const user = userEvent.setup();
    const api = { saveDraft: vi.fn().mockResolvedValue({ draftRevision: 3 }), publish: vi.fn() };
    render(<LoopEditor initial={v2Initial} api={api} />);

    await user.click(screen.getByRole("button", { name: "执行工作" }));
    const responsibility = screen.getByRole("textbox", { name: "节点职责" });
    await user.clear(responsibility);
    expect(await screen.findByText("节点 执行工作 必须填写职责")).toBeTruthy();
    await user.type(responsibility, "实现已确认需求并产出代码与测试证据");
    expect(screen.getByText("gate")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "允许路由目标" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      graph: expect.objectContaining({
        schemaVersion: 2,
        routingMetadata: expect.objectContaining({
          agent: { responsibility: "实现已确认需求并产出代码与测试证据" },
        }),
      }),
    })));
  }, 15_000);
  it("adds a task SubLoop and persists its selected definition and version in a project Loop", async () => {
    const user = userEvent.setup();
    const api = { saveDraft: vi.fn().mockResolvedValue({ draftRevision: 3 }), publish: vi.fn() };
    render(<LoopEditor initial={projectInitial} api={api} />);

    await user.click(screen.getByRole("button", { name: "添加节点" }));
    await user.click(screen.getByRole("menuitem", { name: "任务 SubLoop" }));
    await user.click(screen.getByRole("button", { name: "任务 SubLoop" }));
    expect((screen.getByRole("combobox", { name: "任务级 Loop" }) as HTMLSelectElement).value).toBe("task_loop_1");
    expect((screen.getByRole("combobox", { name: "任务级 Loop 版本" }) as HTMLSelectElement).value).toBe("task_version_3");
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      graph: expect.objectContaining({
        nodes: expect.arrayContaining([expect.objectContaining({
          type: "subloop_call",
          targetLoopDefinitionId: "task_loop_1",
          targetLoopVersionId: "task_version_3",
        })]),
      }),
    })));
  });

  it("does not offer task SubLoop nodes for a task Loop", async () => {
    const user = userEvent.setup();
    render(<LoopEditor initial={initial} api={{ saveDraft: vi.fn(), publish: vi.fn() }} />);
    await user.click(screen.getByRole("button", { name: "添加节点" }));
    expect(screen.queryByRole("menuitem", { name: "任务 SubLoop" })).toBeNull();
  });

  it("uses a vertical node layout on compact viewports", () => {
    expect(getLoopNodePosition(0, true)).toEqual({ x: 72, y: 48 });
    expect(getLoopNodePosition(3, true)).toEqual({ x: 72, y: 498 });
    expect(getLoopNodePosition(3, false).x).toBeGreaterThan(600);
  });

  it("shows immutable metadata and suppresses mutations for a platform Loop", () => {
    render(<LoopEditor
      initial={{
        ...initial,
        definition: {
          ...initial.definition,
          scope: "project",
          origin: "platform",
          readOnly: true,
        },
      }}
      api={{ saveDraft: vi.fn(), publish: vi.fn() }}
    />);

    expect(screen.getByText(/项目级/u)).toBeTruthy();
    expect(screen.getByText(/平台内置/u)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "保存草稿" })).toBeNull();
    expect(screen.queryByRole("button", { name: "发布版本" })).toBeNull();
  });

  it("creates a valid no-human graph and saves with the draft revision", async () => {
    const user = userEvent.setup();
    const api = {
      saveDraft: vi.fn().mockResolvedValue({ draftRevision: 3 }),
      publish: vi.fn().mockResolvedValue({ versionNumber: 1, checksum: "sha256:version_1" }),
    };
    render(<LoopEditor initial={initial} api={api} />);

    await user.click(screen.getByRole("button", { name: "添加节点" }));
    await user.click(screen.getByRole("menuitem", { name: "Agent 操作" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      draftRevision: 2,
      graph: expect.objectContaining({
        nodes: expect.arrayContaining([expect.objectContaining({
          type: "agent_action",
          reasoningEffort: "high",
        })]),
      }),
    })));
    expect(screen.queryByText("必须添加人工确认")).toBeNull();
  });

  it("shows exact feedback and platform-cap validation outside the canvas", () => {
    render(<LoopEditor
      initial={{ ...initial, graph: invalidGraph() }}
      api={{ saveDraft: vi.fn(), publish: vi.fn() }}
    />);

    expect(screen.getByText("返工边必须设置最大经过次数")).toBeTruthy();
    expect(screen.getByText("节点数量 65 超过平台上限 64")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Loop 校验结果" })).toBeTruthy();
  });

  it("edits selected nodes and supports delete, undo, redo, and unsaved-change protection", async () => {
    const user = userEvent.setup();
    render(<LoopEditor initial={{ ...initial, graph: feedbackGraph() }} api={{ saveDraft: vi.fn(), publish: vi.fn() }} />);

    await user.click(screen.getByRole("button", { name: "执行工作" }));
    await user.clear(screen.getByRole("textbox", { name: "节点名称" }));
    await user.type(screen.getByRole("textbox", { name: "节点名称" }), "编码实现");
    expect(screen.getByRole("button", { name: "编码实现" })).toBeTruthy();

    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const link = document.createElement("a");
    link.href = "/projects";
    document.body.append(link);
    const navigation = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(navigation);
    expect(confirm).toHaveBeenCalledWith("存在未保存更改，确定离开？");
    expect(navigation.defaultPrevented).toBe(true);
    link.remove();

    fireEvent.keyDown(window, { key: "Delete" });
    expect(screen.queryByRole("button", { name: "编码实现" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByRole("button", { name: "编码实现" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "重做" }));
    expect(screen.queryByRole("button", { name: "编码实现" })).toBeNull();
  });

  it("edits graph limits and feedback traversal caps from the inspector", async () => {
    const user = userEvent.setup();
    const api = { saveDraft: vi.fn().mockResolvedValue({ draftRevision: 3 }), publish: vi.fn() };
    render(<LoopEditor initial={{ ...initial, graph: feedbackGraph() }} api={api} />);

    await user.clear(screen.getByRole("spinbutton", { name: "最大 Stage 数" }));
    await user.type(screen.getByRole("spinbutton", { name: "最大 Stage 数" }), "12");
    await user.click(screen.getByRole("button", { name: "连接 rework" }));
    await user.clear(screen.getByRole("spinbutton", { name: "最大经过次数" }));
    await user.type(screen.getByRole("spinbutton", { name: "最大经过次数" }), "2");
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      graph: expect.objectContaining({
        limits: expect.objectContaining({ maxStages: 12 }),
        edges: expect.arrayContaining([expect.objectContaining({ id: "gate-agent", maxTraversals: 2 })]),
      }),
    })));
  });

  it("reports a stale draft revision without discarding local changes", async () => {
    const user = userEvent.setup();
    const api = {
      saveDraft: vi.fn().mockRejectedValue(Object.assign(new Error("stale"), {
        code: "version_conflict",
        currentRevision: 5,
      })),
      publish: vi.fn(),
    };
    render(<LoopEditor initial={initial} api={api} />);

    await user.click(screen.getByRole("button", { name: "添加节点" }));
    await user.click(screen.getByRole("menuitem", { name: "条件" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    expect((await screen.findByRole("alert")).textContent).toContain("草稿已在其他位置更新，当前修订号 5");
    expect(screen.getByRole("button", { name: "条件" })).toBeTruthy();
  });

  it("publishes only a saved valid draft and reports its immutable checksum", async () => {
    const user = userEvent.setup();
    const api = {
      saveDraft: vi.fn().mockResolvedValue({ draftRevision: 3 }),
      publish: vi.fn().mockResolvedValue({ versionNumber: 7, checksum: "sha256:published_7" }),
    };
    render(<LoopEditor initial={initial} api={api} />);

    await user.click(screen.getByRole("button", { name: "添加节点" }));
    await user.click(screen.getByRole("menuitem", { name: "平台操作" }));
    expect((screen.getByRole("button", { name: "发布版本" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "平台操作" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "平台操作类型" }), "project_document.write");
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "发布版本" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: "发布版本" }));
    expect(screen.getByRole("dialog", { name: "确认发布 Loop 版本" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "确认发布" }));

    await waitFor(() => expect(api.publish).toHaveBeenCalledWith(expect.objectContaining({ draftRevision: 3 })));
    expect(await screen.findByText("版本 7 已发布 · sha256:published_7")).toBeTruthy();
  });

  it("keeps publishing blocked until a platform action node selects a supported action", async () => {
    const user = userEvent.setup();
    const api = {
      saveDraft: vi.fn().mockResolvedValue({ draftRevision: 3 }),
      publish: vi.fn().mockResolvedValue({ versionNumber: 8, checksum: "sha256:published_8" }),
    };
    render(<LoopEditor initial={initial} api={api} />);

    await user.click(screen.getByRole("button", { name: "添加节点" }));
    await user.click(screen.getByRole("menuitem", { name: "平台操作" }));
    await user.click(screen.getByRole("button", { name: "平台操作" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() => expect(api.saveDraft).toHaveBeenCalled());
    expect((screen.getByRole("button", { name: "发布版本" }) as HTMLButtonElement).disabled).toBe(true);

    await user.selectOptions(screen.getByRole("combobox", { name: "平台操作类型" }), "project_document.write");
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() => expect((screen.getByRole("button", { name: "发布版本" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("shows version history only in the editor and activates a historical version", async () => {
    const user = userEvent.setup();
    const api = {
      saveDraft: vi.fn(),
      publish: vi.fn(),
      activateVersion: vi.fn().mockResolvedValue({ draftRevision: 3 }),
    };
    render(<LoopEditor initial={{
      ...initial,
      definition: { ...initial.definition, activeVersionId: "loop_version_2" },
      versions: [
        { id: "loop_version_2", versionNumber: 2 },
        { id: "loop_version_1", versionNumber: 1 },
      ],
    }} api={api} />);

    expect(screen.getByText("当前激活")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "激活历史版本 1" }));

    await waitFor(() => expect(api.activateVersion).toHaveBeenCalledWith({
      activeVersionId: "loop_version_1",
      draftRevision: 2,
    }));
  });
});
