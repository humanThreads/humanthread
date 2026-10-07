// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LoopRunProjection } from "@/lib/orchestration/loop-read-model";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistedLoopEvent } from "./loop-run-projection";
import { LoopRunViewer } from "./loop-run-viewer";

vi.mock("./loop-attempt-live-stream", () => ({
  LoopAttemptLiveStream: ({ attempt }: { attempt: { attempt: number } }) => (
    <section aria-label="实时执行">attempt {attempt.attempt}</section>
  ),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ nodes, edges, nodeTypes, nodesDraggable, onNodeContextMenu, onPaneClick }: {
    nodes: Array<{ id: string; selected?: boolean; data: { status: string } }>;
    edges: Array<{ id: string; animated?: boolean; data: { traversalCount: number } }>;
    nodeTypes: Record<string, (props: { id: string; data: unknown; selected?: boolean }) => ReactNode>;
    nodesDraggable?: boolean;
    onNodeContextMenu?: (event: { preventDefault(): void; clientX: number; clientY: number }, node: { id: string }) => void;
    onPaneClick?: () => void;
  }) => (
    <div aria-label="Loop 运行图">
      <span data-testid="nodes-draggable">{String(nodesDraggable)}</span>
      <button type="button" aria-label="运行图空白处" onClick={() => onPaneClick?.()} />
      {nodes.map((node) => <div key={node.id} data-testid={`node-${node.id}`} data-selected={String(Boolean(node.selected))} data-status={node.data.status} onContextMenu={(event) => onNodeContextMenu?.({ preventDefault: () => event.preventDefault(), clientX: event.clientX, clientY: event.clientY }, node)}>{nodeTypes.runtime?.({ id: node.id, data: node.data, ...(node.selected === undefined ? {} : { selected: node.selected }) })}</div>)}
      {edges.map((edge) => <div key={edge.id} data-testid={`edge-${edge.id}`} data-traversed={String(edge.data.traversalCount > 0)} data-animated={String(Boolean(edge.animated))} />)}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
  MarkerType: { ArrowClosed: "arrowclosed" },
  useUpdateNodeInternals: () => vi.fn(),
  applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  push.mockReset();
  refresh.mockReset();
  vi.useRealTimers();
});

function projection(): LoopRunProjection {
  return {
    definitionVersion: 3,
    projectionVersion: 8,
    eventCursor: 12,
    run: { id: "run_1", status: "running", repeatCount: 0, transitionCount: 2, stopReason: null },
    nodes: [
      { nodeKey: "work", label: "执行工作", type: "agent_action", status: "succeeded", currentNodeRunId: "node_work_1", attemptNo: 1, waitingReason: null, attempts: [] },
      { nodeKey: "review", label: "质量门禁", type: "policy_gate", status: "running", currentNodeRunId: "node_review_1", attemptNo: 1, waitingReason: null, attempts: [] },
    ],
    edges: [{ edgeId: "review_to_work", source: "review", target: "work", kind: "feedback", outcome: "rework", traversalCount: 0, limit: 2, lastTraversalAt: null }],
    activities: [],
  };
}

function waitingApprovalProjection(): LoopRunProjection {
  return {
    ...projection(),
    run: { ...projection().run, status: "waiting" },
    pendingApprovals: [{
      id: "approval_gate_1",
      type: "loop_human_gate",
      status: "pending",
      createdAt: new Date("2026-08-11T10:00:00.000Z"),
      taskShortId: "HUMANTHR1100003",
      taskTitle: "优化任务详情交互",
      projectName: "humanthread",
      loopRunId: "run_1",
      loopLabel: "Gelsang Project Loop",
      loopNodeRunId: "node_confirm_1",
      nodeKey: "confirm_requirement",
      nodeLabel: "确认需求",
      prompt: "确认需求是否完整",
      routes: { pass: ["confirm_write_prd"], rework: [], reject: [] },
      action: "确认需求",
      scope: "当前任务范围",
      policyReason: "需要人工确认",
    }],
    nodes: [
      { nodeKey: "confirm_requirement", label: "确认需求", type: "human_gate", status: "waiting_approval", currentNodeRunId: "node_confirm_1", attemptNo: 1, waitingReason: "human_gate", attempts: [] },
      { nodeKey: "write_prd", label: "编写 PRD", type: "agent_action", status: "pending", currentNodeRunId: null, attemptNo: 0, waitingReason: null, attempts: [] },
    ],
    edges: [{ edgeId: "confirm_write_prd", source: "confirm_requirement", target: "write_prd", kind: "normal", outcome: "success", traversalCount: 0, limit: null, lastTraversalAt: null }],
  };
}

function failedTaskProjection(): LoopRunProjection {
  return {
    ...projection(),
    run: {
      ...projection().run,
      taskId: "task_1",
      status: "failed",
      statusReason: "runtime_safety_expired",
    },
  } as LoopRunProjection;
}

function runtimeInterventionInteraction(overrides: Record<string, unknown> = {}) {
  return {
    id: "interaction_1",
    projectId: "project_1",
    taskId: "task_1",
    loopRunId: "run_1",
    loopNodeRunId: "node_review_1",
    activationNo: 1,
    kind: "runtime_intervention",
    status: "open",
    version: 7,
    createdAt: "2026-08-11T10:00:00.000Z",
    closedAt: null,
    messages: [],
    decision: null,
    discussionState: {
      phase: "ordinary",
      activeSpeakerKey: null,
      speakers: [],
      conflicts: [],
      missingConfirmationCount: 0,
      missingSpeakerKeys: [],
      allSpeakersConfirmed: true,
      hasConflict: false,
    },
    capabilities: {
      canReply: true,
      canConfirmOwnPosition: false,
      canSubmit: true,
      canDelegateConflictSpeaker: false,
      canResolveConflict: false,
    },
    ...overrides,
  };
}

function mockInteractionFetch(interaction: Record<string, unknown>) {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const response = (body: unknown) => new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes("/timeline")) return response({ items: [] });
    if (url.endsWith("/interactions")) {
      return response({ ok: true, interactions: [interaction], capabilities: {}, currentUserId: "user_assignee" });
    }
    if (url.includes("/interactions/interaction_1/")) return response({ ok: true, interaction: { interactionId: "interaction_1", version: 8 } });
    return response({ ok: true });
  });
  return { fetch, requests };
}

const routeEvent = {
  id: "event_13",
  eventType: "loop.gate.routed",
  aggregateType: "loop_node",
  aggregateId: "node_review_1",
  sequence: 4,
  occurredAt: "2026-07-31T08:00:00.000Z",
  payload: { result: { status: "routed", selectedEdgeId: "review_to_work", targetNodeRunId: "node_work_2" } },
};

describe("LoopRunViewer", () => {
  it("restarts the run from a node chosen in the graph context menu", async () => {
    const user = userEvent.setup();
    const loadProjection = vi.fn().mockResolvedValue({ ...projection(), run: { ...projection().run, status: "running" } });
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url === "/api/loop-runs/run_1/commands") {
        return new Response(JSON.stringify({ ok: true, result: { nodeKey: "review", activationNo: 2 } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/timeline")) return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ interactions: [], capabilities: {} }), { status: 200, headers: { "content-type": "application/json" } });
    });
    render(<LoopRunViewer initialProjection={failedTaskProjection()} fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })} loadProjection={loadProjection} pollIntervalMs={60_000} />);

    fireEvent.contextMenu(screen.getByTestId("node-review"));
    const menuItem = await screen.findByRole("menuitem", { name: "从该节点启动" });
    expect(menuItem.hasAttribute("disabled")).toBe(false);
    await user.click(menuItem);

    expect(await screen.findByRole("dialog", { name: "从节点重新启动" })).not.toBeNull();
    await user.type(screen.getByLabelText("重跑原因（可选）"), "网关空响应");
    await user.click(screen.getByRole("button", { name: "确认重启" }));

    await waitFor(() => expect(requests.some((request) => request.url === "/api/loop-runs/run_1/commands")).toBe(true));
    const request = requests.find((candidate) => candidate.url === "/api/loop-runs/run_1/commands");
    expect(JSON.parse(String(request?.init?.body))).toEqual(expect.objectContaining({
      command: "restart_from_node",
      targetNodeKey: "review",
      reason: "网关空响应",
      commandId: expect.any(String),
    }));
    await waitFor(() => expect(loadProjection).toHaveBeenCalledWith("run_1"));
    expect(refresh).toHaveBeenCalled();
  });

  it("disables node restart on an active run and for nodes without execution", async () => {
    render(<LoopRunViewer initialProjection={projection()} fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })} pollIntervalMs={60_000} />);

    fireEvent.contextMenu(screen.getByTestId("node-work"));
    expect((await screen.findByRole("menuitem", { name: "从该节点启动" })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("运行尚未结束")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "运行图空白处" }));
    expect(screen.queryByRole("menuitem", { name: "从该节点启动" })).toBeNull();

    cleanup();
    // A run parked on human intervention has no live executor, so recovery
    // from the failed node must be offered instead of being reported as
    // "运行尚未结束".
    const waitingForHuman: LoopRunProjection = {
      ...projection(),
      run: { ...projection().run, status: "waiting", stopReason: null },
    };
    render(<LoopRunViewer initialProjection={waitingForHuman} fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })} pollIntervalMs={60_000} />);
    fireEvent.contextMenu(screen.getByTestId("node-work"));
    expect((await screen.findByRole("menuitem", { name: "从该节点启动" })).hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText("运行尚未结束")).toBeNull();

    cleanup();
    const failedWithPending: LoopRunProjection = {
      ...projection(),
      run: { ...projection().run, status: "failed" },
      nodes: [
        projection().nodes[0]!,
        { ...projection().nodes[1]!, status: "pending", currentNodeRunId: null },
      ],
    };
    render(<LoopRunViewer initialProjection={failedWithPending} fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })} pollIntervalMs={60_000} />);
    fireEvent.contextMenu(screen.getByTestId("node-review"));
    expect((await screen.findByRole("menuitem", { name: "从该节点启动" })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("该节点尚未执行")).not.toBeNull();
  });

  it("offers the restart action for the right-clicked node and names it in the confirmation", async () => {
    render(<LoopRunViewer initialProjection={failedTaskProjection()} fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })} pollIntervalMs={60_000} />);

    fireEvent.contextMenu(screen.getByTestId("node-review"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "从该节点启动" }));

    expect(await screen.findByRole("dialog", { name: "从节点重新启动" })).not.toBeNull();
    expect(within(screen.getByRole("dialog", { name: "从节点重新启动" })).getByText(/质量门禁/)).not.toBeNull();
  });

  it("names the Linux Worker instance in attempt evidence", async () => {
    const user = userEvent.setup();
    const withWorkerEvidence: LoopRunProjection = {
      ...projection(),
      nodes: [{
        ...projection().nodes[0]!,
        attempts: [{
          attemptId: "loop_attempt:worker_evidence",
          attempt: 1,
          status: "succeeded",
          executorType: "local",
          startedAt: "2026-08-30T05:17:55.000Z",
          finishedAt: "2026-08-30T05:25:19.000Z",
          result: { output: { delivery: { branch: "2026-HUMANTHR1100008", headCommit: "a".repeat(40) } } },
          error: null,
          executionPhase: null,
          executionTarget: "linux_worker_pool",
          workerInstance: "ht-agnet-02",
        }],
      }, projection().nodes[1]!],
    };
    render(<LoopRunViewer initialProjection={withWorkerEvidence} />);
    await user.click(screen.getByRole("tab", { name: "节点与证据" }));
    await user.selectOptions(screen.getByLabelText("节点"), "work");
    expect(screen.getByText("尝试 1 · Linux Worker · ht-agnet-02")).toBeTruthy();
    expect(screen.getByText("Linux Worker Pool")).toBeTruthy();
  });

  it("labels an Agent node by its execution plane instead of calling it local", () => {
    render(<LoopRunViewer initialProjection={projection()} />);

    expect(screen.getByText("Agent 执行")).toBeTruthy();
    expect(screen.queryByText("本地 / Agent")).toBeNull();
  });

  it("shows the Run execution target before an AgentRun is claimed", () => {
    render(<LoopRunViewer initialProjection={{
      ...projection(),
      run: {
        ...projection().run,
        executionTarget: { type: "linux_worker_pool", displayName: "default-pool" },
      },
    }} />);

    expect(screen.getByText("Linux Worker · default-pool")).toBeTruthy();
  });

  it("renders an AI-generated execution checklist with its terminal evidence", async () => {
    const user = userEvent.setup();
    const withChecklist: LoopRunProjection = {
      ...projection(),
      nodes: [{
        ...projection().nodes[0]!,
        checklist: [{
          id: "inspect_repository",
          title: "检查仓库状态",
          status: "skipped",
          reason: "仓库尚未初始化",
          evidenceRefs: ["artifacts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        }],
      }, projection().nodes[1]!],
    };

    render(<LoopRunViewer initialProjection={withChecklist} />);
    await user.click(screen.getByRole("tab", { name: "节点与证据" }));
    await user.selectOptions(screen.getByLabelText("节点"), "work");

    expect(screen.getByText("AI 执行清单")).toBeTruthy();
    expect(screen.getByText("检查仓库状态")).toBeTruthy();
    expect(screen.getByText("已跳过")).toBeTruthy();
    expect(screen.getByText("仓库尚未初始化")).toBeTruthy();
    expect(screen.getByText("artifacts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBeTruthy();
  });

  it("shows a structured failure description when a Worker result is rejected", async () => {
    const user = userEvent.setup();
    const withFailure: LoopRunProjection = {
      ...projection(),
      nodes: [{
        ...projection().nodes[0]!,
        status: "failed",
        attempts: [{
          attemptId: "loop_attempt:structured_failure",
          attempt: 1,
          status: "failed",
          executorType: "local",
          startedAt: "2026-08-30T05:17:55.000Z",
          finishedAt: "2026-08-30T05:18:01.000Z",
          result: {
            outcome: "failure",
            output: { errorCode: "delivery_not_pushed", message: "Task branch does not contain a pushed Worker commit" },
            failure: { code: "delivery_not_pushed", summary: "Task branch does not contain a pushed Worker commit" },
          },
          error: null,
          executionPhase: null,
        },
        ],
      }, projection().nodes[1]!],
    };
    render(<LoopRunViewer initialProjection={withFailure} />);
    await user.click(screen.getByRole("tab", { name: "节点与证据" }));
    await user.selectOptions(screen.getByLabelText("节点"), "work");
    expect(screen.getByRole("alert").textContent).toContain("delivery_not_pushed");
    expect(screen.getByRole("alert").textContent).toContain("Task branch does not contain a pushed Worker commit");
  });

  it("wires speaker confirmation without an aggregate version", async () => {
    const user = userEvent.setup();
    const { requests } = mockInteractionFetch(runtimeInterventionInteraction({
      capabilities: {
        canReply: true,
        canConfirmOwnPosition: true,
        canSubmit: false,
        canDelegateConflictSpeaker: false,
        canResolveConflict: false,
      },
      discussionState: {
        phase: "ordinary",
        activeSpeakerKey: null,
        speakers: [{ speakerKey: "a".repeat(32), actorUserId: "user_assignee", displayName: "Assignee", latestSequence: 3, confirmed: false }],
        conflicts: [],
        missingConfirmationCount: 1,
        missingSpeakerKeys: ["a".repeat(32)],
        allSpeakersConfirmed: false,
        hasConflict: false,
      },
    }));
    render(<LoopRunViewer initialProjection={projection()} fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })} pollIntervalMs={60_000} />);

    await user.click(screen.getByRole("tab", { name: "工作流时间线" }));
    const confirm = await screen.findByRole("button", { name: "确认我的意见" });
    await user.click(confirm);

    await waitFor(() => expect(requests.some((request) => request.url.endsWith("/speaker-confirmation"))).toBe(true));
    const request = requests.find((candidate) => candidate.url.endsWith("/speaker-confirmation"));
    const body = JSON.parse(String(request?.init?.body));
    expect(body).toEqual(expect.objectContaining({ commandId: expect.any(String) }));
    expect(body).not.toHaveProperty("expectedVersion");
  });

  it("submits a task-owner intervention with a version-fenced resolution action", async () => {
    const user = userEvent.setup();
    const { requests } = mockInteractionFetch(runtimeInterventionInteraction());
    render(<LoopRunViewer initialProjection={projection()} fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })} pollIntervalMs={60_000} />);

    await user.click(screen.getByRole("tab", { name: "工作流时间线" }));
    await screen.findByRole("button", { name: "确认提交" });
    await user.type(screen.getByLabelText("处理说明"), "依赖已补齐");
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(requests.some((request) => request.url.endsWith("/submit"))).toBe(true));
    const request = requests.find((candidate) => candidate.url.endsWith("/submit"));
    expect(JSON.parse(String(request?.init?.body))).toEqual(expect.objectContaining({
      expectedVersion: 7,
      reason: "依赖已补齐",
      action: { type: "resume_checkpoint" },
      manualConflict: false,
    }));
  });

  it("delegates a conflict speaker with the current interaction version", async () => {
    const user = userEvent.setup();
    const { requests } = mockInteractionFetch(runtimeInterventionInteraction({
      discussionState: {
        phase: "conflict_resolution",
        activeSpeakerKey: "a".repeat(32),
        speakers: [],
        conflicts: [{ topicKey: "scope", optionKeys: ["a", "b"] }],
        missingConfirmationCount: 0,
        missingSpeakerKeys: [],
        allSpeakersConfirmed: true,
        hasConflict: true,
      },
      capabilities: {
        canReply: false,
        canConfirmOwnPosition: false,
        canSubmit: false,
        canDelegateConflictSpeaker: true,
        canResolveConflict: false,
        conflictSpeakerCandidates: [{ userId: "user_member", displayName: "成员" }],
      },
    }));
    render(<LoopRunViewer initialProjection={projection()} fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })} pollIntervalMs={60_000} />);

    await user.click(screen.getByRole("tab", { name: "工作流时间线" }));
    await screen.findByRole("button", { name: "转交发言权" });
    await user.selectOptions(screen.getByLabelText("转交二次发言人"), "user_member");
    await user.click(screen.getByRole("button", { name: "转交发言权" }));

    await waitFor(() => expect(requests.some((request) => request.url.endsWith("/conflict-speaker"))).toBe(true));
    const request = requests.find((candidate) => candidate.url.endsWith("/conflict-speaker"));
    expect(JSON.parse(String(request?.init?.body))).toEqual(expect.objectContaining({
      expectedVersion: 7,
      speakerUserId: "user_member",
    }));
  });

  it("opens the current waiting Human Gate once and keeps manual approval controls", async () => {
    const user = userEvent.setup();
    render(<LoopRunViewer initialProjection={waitingApprovalProjection()} fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })} pollIntervalMs={60_000} />);

    expect(await screen.findByRole("dialog", { name: "审批 · 确认需求" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "关闭审批弹窗" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("button", { name: "立即审批" }).length).toBeGreaterThan(1);

    await user.click(screen.getAllByRole("button", { name: "立即审批" })[0]!);
    expect(await screen.findByRole("dialog", { name: "审批 · 确认需求" })).not.toBeNull();
  });

  it("does not reopen a dismissed approval after an ordinary event update", async () => {
    let resolveBatch!: (value: { cursor: number; events: PersistedLoopEvent[] }) => void;
    const fetchBatch = vi.fn()
      .mockReturnValueOnce(new Promise((resolve) => { resolveBatch = resolve; }))
      .mockResolvedValue({ cursor: 13, events: [] });
    const user = userEvent.setup();
    render(<LoopRunViewer initialProjection={waitingApprovalProjection()} fetchBatch={fetchBatch} pollIntervalMs={60_000} />);

    await screen.findByRole("dialog", { name: "审批 · 确认需求" });
    await user.click(screen.getByRole("button", { name: "关闭审批弹窗" }));
    resolveBatch({ cursor: 13, events: [{ ...routeEvent, cursor: 13, eventType: "loop.agent.message.completed", aggregateId: "node_confirm_1", payload: { nodeKey: "confirm_requirement" } }] });

    await waitFor(() => expect(screen.getByText(/游标 13/)).not.toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reloads the Run and selects the next current node after approval", async () => {
    const nextProjection: LoopRunProjection = {
      ...waitingApprovalProjection(),
      run: { ...waitingApprovalProjection().run, status: "running" },
      pendingApprovals: [],
      nodes: [
        { ...waitingApprovalProjection().nodes[0]!, status: "succeeded" },
        { ...waitingApprovalProjection().nodes[1]!, status: "ready", currentNodeRunId: "node_write_1" },
      ],
    };
    const loadProjection = vi.fn().mockResolvedValue(nextProjection);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/decision")) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.includes("/timeline")) return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ interactions: [], capabilities: {} }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const user = userEvent.setup();
    render(<LoopRunViewer initialProjection={waitingApprovalProjection()} fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })} loadProjection={loadProjection} pollIntervalMs={60_000} />);

    await user.click(await screen.findByRole("button", { name: "确认同意" }));

    await waitFor(() => expect(loadProjection).toHaveBeenCalledWith("run_1"));
    await waitFor(() => expect(screen.getByTestId("node-write_prd").getAttribute("data-selected")).toBe("true"));
  });

  it("links a selected parent node to its Task workflow", () => {
    render(<LoopRunViewer
      initialProjection={{
        ...projection(),
        childRuns: [{
          id: "child:run/1",
          parentNodeRunId: "node_review_1",
          status: "running",
          progress: { completed: 1, total: 3 },
          nodes: [
            { nodeKey: "prepare", label: "准备分支", status: "succeeded" },
            { nodeKey: "develop", label: "开发", status: "running" },
            { nodeKey: "test", label: "测试", status: "pending" },
          ],
        }],
      }}
      fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })}
      pollIntervalMs={60_000}
    />);

    expect(screen.getByRole("link", { name: "进入任务流程" }).getAttribute("href"))
      .toBe("/loop-runs/child%3Arun%2F1");
    expect(screen.getByRole("link", { name: "任务流程运行中" }).getAttribute("href"))
      .toBe("/loop-runs/child%3Arun%2F1");
    expect(screen.getByText("开发")).not.toBeNull();
    expect(screen.getByText("1 / 3")).not.toBeNull();
  });

  it("links a child workspace back to its Project workflow", () => {
    render(<LoopRunViewer
      initialProjection={{
        ...projection(),
        parentRun: { id: "parent:run/1", status: "waiting" },
      }}
      fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })}
      pollIntervalMs={60_000}
    />);

    expect(screen.getByRole("link", { name: "返回项目流程" }).getAttribute("href"))
      .toBe("/loop-runs/parent%3Arun%2F1");
  });

  it("retries a failed child in place and keeps the user on its workflow", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true, result: { childLoopRunId: "run_1" } }),
    } as never);
    render(<LoopRunViewer
      initialProjection={{
        ...projection(),
        run: { ...projection().run, status: "failed", stopReason: "subloop_attempt_limit_exceeded" },
        parentRun: { id: "parent:run/1", status: "waiting" },
      }}
      fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })}
      pollIntervalMs={60_000}
    />);

    await act(async () => { screen.getByRole("button", { name: "从所选节点恢复" }).click(); });

    expect(fetch).toHaveBeenCalledWith("/api/loop-runs/run_1", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"command":"retry_child"'),
    }));
    expect(push).toHaveBeenCalledWith("/loop-runs/run_1");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("lets the user select a recovery node in the same Task workflow", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true, result: { childLoopRunId: "run_1" } }),
    } as never);
    render(<LoopRunViewer
      initialProjection={{
        ...projection(),
        run: { ...projection().run, status: "failed", stopReason: "stage_failed" },
        parentRun: { id: "parent:run/1", status: "waiting" },
      }}
      fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })}
      pollIntervalMs={60_000}
    />);

    const selector = screen.getByLabelText("恢复节点") as HTMLSelectElement;
    selector.value = "work";
    selector.dispatchEvent(new Event("change", { bubbles: true }));
    await act(async () => { screen.getByRole("button", { name: "从所选节点恢复" }).click(); });

    expect(fetch).toHaveBeenCalledWith("/api/loop-runs/run_1", expect.objectContaining({
      body: expect.stringContaining('"targetNodeId":"work"'),
    }));
  });

  it("offers explicit recovery for a cancelled child", () => {
    render(<LoopRunViewer
      initialProjection={{
        ...projection(),
        run: { ...projection().run, status: "cancelled", stopReason: "cancelled_by_user" },
        parentRun: { id: "parent:run/1", status: "waiting" },
      }}
      fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })}
      pollIntervalMs={60_000}
    />);

    expect((screen.getByRole("button", { name: "从所选节点恢复" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("explains a failed top-level task Loop and starts a replacement Run", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/tasks/task_1/loop/execution-options") {
        return new Response(JSON.stringify({ ok: true, options: [{ type: "linux_worker_pool", id: "pool_1", displayName: "Linux Worker · ht-agent", ready: true, reason: null }], defaultTarget: { type: "linux_worker_pool", id: "pool_1", displayName: "Linux Worker · ht-agent", ready: true, reason: null } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "/api/tasks/task_1/loop" && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true, result: { id: "run_restarted_1" } }), { status: 201, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/timeline")) return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ interactions: [], capabilities: {} }), { status: 200, headers: { "content-type": "application/json" } });
    });
    render(<LoopRunViewer initialProjection={failedTaskProjection()} fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })} pollIntervalMs={60_000} />);

    expect(await screen.findByText("运行安全审批已过期")).not.toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "重新开始任务 Loop" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/tasks/task_1/loop", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"executionTarget":{"type":"linux_worker_pool","workerPoolId":"pool_1"}'),
    })));
    expect(push).toHaveBeenCalledWith("/loop-runs/run_restarted_1");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("offers cancellation while a top-level task Loop is active", async () => {
    const user = userEvent.setup();
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/tasks/task_1/loop" && init?.method === "POST") return new Response(JSON.stringify({ ok: true, result: { status: "cancelled" } }), { status: 200, headers: { "content-type": "application/json" } });
      if (String(input).includes("/timeline")) return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ interactions: [], capabilities: {} }), { status: 200, headers: { "content-type": "application/json" } });
    });
    render(<LoopRunViewer initialProjection={{ ...projection(), run: { ...projection().run, taskId: "task_1", status: "running" } }} fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })} pollIntervalMs={60_000} />);
    await user.click(await screen.findByRole("button", { name: "取消 Loop" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/tasks/task_1/loop", expect.objectContaining({ body: expect.stringContaining('"command":"cancel"') })));
  });

  it("reveals a newly created Task workflow when the parent enters a child-loop wait", async () => {
    const waitingProjection: LoopRunProjection = {
      ...projection(),
      eventCursor: 13,
      childRuns: [{ id: "child:run/new", parentNodeRunId: "node_review_1", status: "running" }],
    };
    const loadProjection = vi.fn().mockResolvedValue(waitingProjection);
    render(<LoopRunViewer
      initialProjection={projection()}
      fetchBatch={vi.fn().mockResolvedValueOnce({ cursor: 13, events: [{
        id: "event_13",
        eventType: "loop.node.waiting",
        aggregateType: "loop_node",
        aggregateId: "node_review_1",
        sequence: 5,
        occurredAt: "2026-07-31T08:00:00.000Z",
        payload: { nodeKey: "review", waitingReason: "child_loop", childLoopRunId: "child:run/new" },
      }]}).mockResolvedValue({ cursor: 13, events: [] })}
      loadProjection={loadProjection}
      pollIntervalMs={60_000}
    />);

    await waitFor(() => expect(loadProjection).toHaveBeenCalledWith("run_1"));
    expect(screen.getByRole("link", { name: "任务流程运行中" }).getAttribute("href"))
      .toBe("/loop-runs/child%3Arun%2Fnew");
  });

  it("refreshes the Task workflow status when the parent resumes after child completion", async () => {
    const initial = {
      ...projection(),
      childRuns: [{ id: "child:run/1", parentNodeRunId: "node_review_1", status: "running" }],
    } satisfies LoopRunProjection;
    const completed = {
      ...initial,
      eventCursor: 13,
      childRuns: [{ id: "child:run/1", parentNodeRunId: "node_review_1", status: "completed" }],
    } satisfies LoopRunProjection;
    const loadProjection = vi.fn().mockResolvedValue(completed);
    render(<LoopRunViewer
      initialProjection={initial}
      fetchBatch={vi.fn().mockResolvedValueOnce({ cursor: 13, events: [{
        ...routeEvent,
        eventType: "loop.node.completed",
        aggregateId: "node_review_1",
        payload: { nodeKey: "review", transition: { status: "completed" } },
      }]}).mockResolvedValue({ cursor: 13, events: [] })}
      loadProjection={loadProjection}
      pollIntervalMs={60_000}
    />);

    await waitFor(() => expect(loadProjection).toHaveBeenCalledWith("run_1"));
    expect(screen.getByRole("link", { name: "任务流程已完成" })).not.toBeNull();
  });

  it("keeps legacy projections without relation fields navigable", () => {
    render(<LoopRunViewer
      initialProjection={projection()}
      fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })}
      pollIntervalMs={60_000}
    />);

    expect(screen.queryByRole("link", { name: "进入任务流程" })).toBeNull();
    expect(screen.queryByRole("link", { name: "返回项目流程" })).toBeNull();
  });

  it("keeps mobile activity and details reachable below a fixed-height graph", () => {
    const { container } = render(
      <LoopRunViewer
        initialProjection={projection()}
        fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })}
        pollIntervalMs={60_000}
      />,
    );

    expect(container.firstElementChild?.className).toContain("grid-rows-[auto_auto]");
    expect(container.firstElementChild?.className).toContain("overflow-y-auto");
    expect(container.firstElementChild?.className).toContain("lg:grid-rows-[minmax(0,1fr)]");
    expect(container.firstElementChild?.className).toContain("lg:overflow-hidden");
    expect(screen.getByRole("main").className).toContain("grid-rows-[auto_360px]");
    expect(screen.getByRole("main").className).toContain("overflow-visible");
    expect(screen.getByRole("main").className).toContain("lg:grid-rows-[auto_minmax(360px,1fr)]");
    expect(screen.getByRole("main").className).toContain("lg:overflow-hidden");
  });

  it("uses right-side detail tabs and allows resetting a draggable view-local layout", async () => {
    render(<LoopRunViewer initialProjection={projection()} fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })} pollIntervalMs={60_000} />);

    expect(screen.getByTestId("nodes-draggable").textContent).toBe("true");
    expect(screen.getByRole("button", { name: "重置布局" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "节点与证据" }).getAttribute("aria-selected")).toBe("true");
    await act(async () => { screen.getByRole("tab", { name: "节点与证据" }).click(); });
    expect(screen.getByLabelText("节点")).not.toBeNull();
    await act(async () => { screen.getByRole("tab", { name: "工作流时间线" }).click(); });
    expect(screen.getByLabelText("工作流时间线")).not.toBeNull();
  });

  it("renders the four detail tabs with their exact names", () => {
    render(<LoopRunViewer initialProjection={projection()} fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })} pollIntervalMs={60_000} />);

    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["实时执行", "节点与证据", "工作流时间线", "运行详情"]);
  });

  it("defaults a running run to the live tab", () => {
    const active = projection();
    render(<LoopRunViewer
      initialProjection={{
        ...active,
        nodes: [active.nodes[0]!, {
          ...active.nodes[1]!,
          attempts: [{
            attemptId: "loop_attempt:running",
            attempt: 1,
            status: "running",
            executorType: "local",
            startedAt: "2026-09-30T00:00:00.000Z",
            finishedAt: null,
            result: null,
            error: null,
            executionPhase: null,
          }],
        }],
      }}
      fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })}
      pollIntervalMs={60_000}
    />);

    expect(screen.getByRole("tab", { name: "实时执行" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("实时执行")).not.toBeNull();
  });

  it("defaults a terminal run to node evidence", () => {
    const terminal = projection();
    render(<LoopRunViewer
      initialProjection={{ ...terminal, run: { ...terminal.run, status: "completed" } }}
      fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })}
      pollIntervalMs={60_000}
    />);

    expect(screen.getByRole("tab", { name: "节点与证据" }).getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the manually selected tab when the projection refreshes", async () => {
    const fetchBatch = vi.fn().mockResolvedValue({ cursor: 12, events: [] });
    const { rerender } = render(<LoopRunViewer initialProjection={projection()} fetchBatch={fetchBatch} pollIntervalMs={60_000} />);

    await act(async () => { screen.getByRole("tab", { name: "工作流时间线" }).click(); });
    const refreshed = { ...projection(), projectionVersion: 9 };
    rerender(<LoopRunViewer initialProjection={refreshed} fetchBatch={fetchBatch} pollIntervalMs={60_000} />);

    expect(screen.getByRole("tab", { name: "工作流时间线" }).getAttribute("aria-selected")).toBe("true");
  });

  it("scopes the live view to the selected node attempt", async () => {
    const historical = projection();
    render(<LoopRunViewer
      initialProjection={{
        ...historical,
        nodes: [{
          ...historical.nodes[0]!,
          attempts: [{
            attemptId: "loop_attempt:attempt_3",
            attempt: 3,
            status: "running",
            executorType: "local",
            startedAt: "2026-09-30T00:00:00.000Z",
            finishedAt: null,
            result: null,
            error: null,
            executionPhase: null,
          }],
        }, historical.nodes[1]!],
      }}
      fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })}
      pollIntervalMs={60_000}
    />);

    await act(async () => { screen.getByRole("tab", { name: "节点与证据" }).click(); });
    await act(async () => { fireEvent.change(screen.getByLabelText("节点"), { target: { value: "work" } }); });
    await act(async () => { screen.getByRole("tab", { name: "实时执行" }).click(); });
    expect(screen.getByLabelText("实时执行").textContent).toContain("attempt 3");
  });

  it("animates only after a contiguous persisted edge event", async () => {
    const fetchBatch = vi.fn().mockResolvedValueOnce({ cursor: 13, events: [routeEvent] }).mockResolvedValue({ cursor: 13, events: [] });
    render(<LoopRunViewer initialProjection={projection()} fetchBatch={fetchBatch} pollIntervalMs={60_000} />);

    await waitFor(() => expect(screen.getByTestId("edge-review_to_work").getAttribute("data-traversed")).toBe("true"));
    expect(screen.getByTestId("edge-review_to_work").getAttribute("data-animated")).toBe("true");
    expect(screen.getByTestId("node-work").getAttribute("data-status")).toBe("ready");
  });

  it("reloads the snapshot when the persisted cursor has a gap", async () => {
    const loadProjection = vi.fn().mockResolvedValue({ ...projection(), eventCursor: 14 });
    render(<LoopRunViewer
      initialProjection={projection()}
      fetchBatch={vi.fn().mockResolvedValue({ cursor: 14, events: [routeEvent] })}
      loadProjection={loadProjection}
      pollIntervalMs={60_000}
    />);

    await waitFor(() => expect(loadProjection).toHaveBeenCalledWith("run_1"));
  });

  it("uses static edge state when reduced motion is requested", async () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
    render(<LoopRunViewer initialProjection={projection()} fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })} pollIntervalMs={60_000} />);

    expect(screen.getByTestId("loop-run-canvas").getAttribute("data-motion")).toBe("reduced");
    expect(screen.getByTestId("edge-review_to_work").getAttribute("data-animated")).toBe("false");
  });

  it("does not replay animation for a duplicate persisted event", async () => {
    const fetchBatch = vi.fn().mockResolvedValue({ cursor: 12, events: [] });
    render(<LoopRunViewer initialProjection={projection()} fetchBatch={fetchBatch} pollIntervalMs={60_000} />);
    await act(async () => {});

    expect(screen.getByTestId("edge-review_to_work").getAttribute("data-animated")).toBe("false");
  });

  it("shows Router audit details from the persisted route decision", async () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
    const fetchBatch = vi.fn().mockResolvedValueOnce({ cursor: 13, events: [{
      ...routeEvent,
      eventType: "loop.agent.route_decided",
      payload: {
        sourceNodeId: "review",
        targetNodeId: "work",
        decisionId: "decision_13",
        reasonCode: "REWORK_REQUIRED",
        summary: "测试未通过，回到执行节点",
        evidence: ["artifacts/test-report.json"],
        confidence: 0.88,
        routerContractVersion: 1,
        routerContractDigest: "digest_1",
        selectedEdgeId: "review_to_work",
      },
    }]}).mockResolvedValue({ cursor: 13, events: [] });
    render(<LoopRunViewer initialProjection={projection()} fetchBatch={fetchBatch} pollIntervalMs={60_000} />);

    // Router audit lives on the run detail surface, which is not the default
    // tab for a Run without an active attempt.
    await act(async () => { screen.getByRole("tab", { name: "运行详情" }).click(); });
    await waitFor(() => expect(screen.getByText("REWORK_REQUIRED")).not.toBeNull());
    expect(screen.getByText("测试未通过，回到执行节点")).not.toBeNull();
    expect(screen.getByText("artifacts/test-report.json")).not.toBeNull();
    expect(screen.getByText("置信度 88% · Router v1")).not.toBeNull();
    expect(screen.getByTestId("edge-review_to_work").getAttribute("data-animated")).toBe("true");
  });

  it("shows a visible recovery message when an intervention activation is stale", async () => {
    const interaction = {
      id: "interaction_stale",
      kind: "runtime_intervention",
      status: "open",
      version: 1,
      messages: [],
      decision: null,
      discussionState: {
        phase: "ordinary",
        activeSpeakerKey: null,
        speakers: [],
        conflicts: [],
        missingConfirmationCount: 0,
        allSpeakersConfirmed: true,
      },
      capabilities: {
        canReply: true,
        canConfirmOwnPosition: false,
        canSubmit: true,
        canDelegateConflictSpeaker: false,
        canResolveConflict: false,
      },
    };
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/interactions/") && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: false, code: "version_conflict", error: "Workflow interaction changed" }), { status: 409, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/interactions")) {
        return new Response(JSON.stringify({ ok: true, interactions: [interaction], capabilities: { canReply: true, canConfirm: true, canDecideApproval: true } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    render(<LoopRunViewer initialProjection={projection()} fetchBatch={vi.fn().mockResolvedValue({ cursor: 12, events: [] })} pollIntervalMs={60_000} />);

    await waitFor(() => expect(screen.getByRole("tab", { name: "工作流时间线" })).not.toBeNull());
    await act(async () => { screen.getByRole("tab", { name: "工作流时间线" }).click(); });
    await waitFor(() => expect(screen.getByRole("button", { name: "确认提交" })).not.toBeNull());
    await act(async () => { screen.getByRole("button", { name: "确认提交" }).click(); });

    expect((await screen.findByRole("alert")).textContent).toContain("人工介入已过期或运行状态已变化");
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/interactions"), expect.objectContaining({ method: "POST" }));
  });
});
