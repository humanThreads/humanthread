import { fireEvent, render, screen } from "@testing-library/react";
import type { DesktopLoopDetailResponse } from "@humanthread/workbench-client";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AgentLoopDetail } from "./agent-loop-detail";
import { appendLoopExecutionLog } from "../../lib/loop-execution-logs";

const detail: DesktopLoopDetailResponse["data"] = {
  run: {
    id: "loop_1", status: "waiting", version: 4, definitionVersion: 2,
    projectionVersion: 7, currentIteration: 2, maxIterations: 5,
    transitionCount: 6, stopReason: null, waitingReason: "requirement_confirmation",
    lastHeartbeatAt: "2026-08-06T10:05:00.000Z",
  },
  task: { id: "task_1", title: "Desktop Loop detail", route: "/tasks/task_1" },
  worker: { id: "worker_1", name: "Mac Studio", status: "online" },
  agentRunId: "run_1",
  nodes: [{
    nodeKey: "develop", label: "Develop", type: "agent_action", status: "waiting_input",
    currentNodeRunId: "node_run_1", attemptNo: 2, waitingReason: "requirement_confirmation",
    attempts: [{
      attempt: 2, status: "waiting", executorType: "local_agent",
      startedAt: "2026-08-06T10:00:00.000Z", finishedAt: null,
      summary: "Waiting for confirmation", errorSummary: null,
    }],
  }],
  edges: [{
    edgeId: "edge_done", source: "develop", target: "test", kind: "forward",
    outcome: "success", traversalCount: 0, limit: 1, lastTraversalAt: null,
  }],
  timeline: [{
    id: "timeline_1", kind: "workflow.interaction.opened",
    occurredAt: "2026-08-06T10:05:00.000Z", summary: "Waiting for confirmation",
    actorType: "agent", actorId: "agent_1", status: "open",
  }],
  interaction: {
    id: "interaction_1", kind: "requirement_conversation", status: "open", version: 3,
    createdAt: "2026-08-06T10:05:00.000Z", closedAt: null,
    messages: [{
      id: "message_1", sequence: 1, actorType: "agent", actorId: "agent_1",
      body: "Confirm the migration path", answers: {}, createdAt: "2026-08-06T10:05:00.000Z",
    }],
    decision: null,
  },
  capabilities: { canReply: true, canConfirm: true, canDecideApproval: false },
};

const baseProps = {
  detail,
  isLoading: false,
  error: null,
  actionsEnabled: true,
  onClose: vi.fn(),
  onMessage: vi.fn(),
  onConfirm: vi.fn(),
  onDecision: vi.fn(),
};

describe("Desktop Agent Loop detail", () => {
  it("shows waiting context, selected node evidence, and timeline", () => {
    render(<MemoryRouter><AgentLoopDetail {...baseProps} /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "Desktop Loop detail" })).toBeInTheDocument();
    expect(screen.getByText("requirement_confirmation")).toBeInTheDocument();
    expect(screen.getAllByText("Waiting for confirmation").length).toBeGreaterThan(0);
    expect(screen.getByText("Mac Studio · online")).toBeInTheDocument();
  });

  it("submits a requirement reply and confirmation with the detail version", () => {
    render(<MemoryRouter><AgentLoopDetail {...baseProps} /></MemoryRouter>);

    fireEvent.click(screen.getByRole("tab", { name: /人工交互/u }));
    fireEvent.change(screen.getByLabelText("回复需求"), { target: { value: "Use migration A" } });
    fireEvent.click(screen.getByRole("button", { name: "发送回复" }));
    expect(baseProps.onMessage).toHaveBeenCalledWith(expect.objectContaining({
      interactionId: "interaction_1",
      expectedVersion: 3,
      body: "Use migration A",
    }));

    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    expect(baseProps.onConfirm).toHaveBeenCalledWith({
      interactionId: "interaction_1", expectedVersion: 3, reason: "",
    });
  });

  it("keeps the list boundary visible when detail loading fails", () => {
    render(<MemoryRouter><AgentLoopDetail {...baseProps} detail={null} error={new Error("Detail unavailable")} /></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent("Detail unavailable");
    expect(screen.getByRole("button", { name: "关闭 Loop 详情" })).toBeInTheDocument();
  });

  it("shows durable platform history and local process output in the execution log", () => {
    appendLoopExecutionLog({
      loopRunId: detail.run.id,
      nodeKey: "develop",
      stream: "stdout",
      text: "pnpm test passed\n",
      occurredAt: "2026-08-06T10:06:00.000Z",
    });
    render(<MemoryRouter><AgentLoopDetail {...baseProps} /></MemoryRouter>);

    fireEvent.click(screen.getByRole("tab", { name: "执行日志" }));

    expect(screen.getByRole("tab", { name: "执行日志" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("log", { name: "Loop 执行日志" })).toHaveTextContent("Waiting for confirmation");
    expect(screen.getByRole("log", { name: "Loop 执行日志" })).toHaveTextContent("pnpm test passed");
    expect(screen.getByText("本机实时输出")).toBeInTheDocument();
  });

  it("explains when an unassigned Loop has no local output", () => {
    const queuedDetail = {
      ...detail,
      run: { ...detail.run, id: "loop_queued", status: "running" },
      worker: null,
      timeline: [],
    };
    render(<MemoryRouter><AgentLoopDetail {...baseProps} detail={queuedDetail} /></MemoryRouter>);

    fireEvent.click(screen.getByRole("tab", { name: "执行日志" }));

    expect(screen.getByText("尚未分配 Worker，暂无本机执行输出。")).toBeInTheDocument();
  });

  it("shows Router audit details in the shared Loop timeline", () => {
    const routeDetail = {
      ...detail,
      timeline: [{
        ...detail.timeline[0]!,
        id: "route_event_1",
        kind: "loop.agent.route_decided",
        summary: "测试未通过，回到执行节点",
        routeDecision: {
          decisionId: "decision_1",
          sourceNodeId: "review",
          targetNodeId: "work",
          reasonCode: "REWORK_REQUIRED",
          summary: "测试未通过，回到执行节点",
          confidence: 0.88,
          evidence: ["artifacts/test-report.json"],
          routerContractVersion: 1,
          routerContractDigest: "digest_1",
          selectedEdgeId: "review_to_work",
          errorSummary: null,
        },
      }],
    };
    render(<MemoryRouter><AgentLoopDetail {...baseProps} detail={routeDetail} /></MemoryRouter>);

    expect(screen.getByText("REWORK_REQUIRED")).not.toBeNull();
    expect(screen.getAllByText("测试未通过，回到执行节点")).toHaveLength(2);
    expect(screen.getByText("artifacts/test-report.json")).not.toBeNull();
  });

  it("shows the local terminal tab only when this Loop has a local session", () => {
    render(<MemoryRouter><AgentLoopDetail
      {...baseProps}
      terminalContent={<section aria-label="Loop 本机终端">local terminal</section>}
    /></MemoryRouter>);

    fireEvent.click(screen.getByRole("tab", { name: "终端" }));

    expect(screen.getByRole("region", { name: "Loop 本机终端" })).toBeInTheDocument();
  });

  it("explains when this Loop has no live local terminal", () => {
    render(<MemoryRouter><AgentLoopDetail {...baseProps} hasLocalTerminal={false} /></MemoryRouter>);

    fireEvent.click(screen.getByRole("tab", { name: "终端" }));

    expect(screen.getByText("当前 Loop 没有可附着的本机终端。")).toBeInTheDocument();
  });
});
