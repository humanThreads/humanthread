import { fireEvent, render, screen } from "@testing-library/react";
import type { DesktopAgentsResponse } from "@humanthread/workbench-client";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AgentWorkspaceView } from "./agent-workspace";

const data: DesktopAgentsResponse["data"] = {
  canManage: true,
  profiles: [{
    id: "profile_1", name: "Codex Delivery", provider: "codex", status: "active",
    model: "gpt-5", route: "/agents?profile=profile_1",
  }],
  workers: [{
    id: "worker_1", name: "Mac Studio", runtimeType: "local_agent", status: "online",
    activeRunCount: 1, maxConcurrentRuns: 2, lastHeartbeatAt: "2026-07-27T10:05:00.000Z",
  }],
  runs: [{
    id: "run_1", taskId: "task_1", taskTitle: "Build Agent workspace", status: "running",
    attempt: 2, provider: "codex", workerName: "Mac Studio",
    createdAt: "2026-07-27T10:00:00.000Z", lastHeartbeatAt: "2026-07-27T10:05:00.000Z",
    route: "/tasks/task_1",
  }],
  loops: [{
    id: "loop_1", taskId: "task_1", taskTitle: "Build Agent workspace", status: "running",
    loopName: "Task Loop", scope: "task", parentLoopRunId: null, parentLoopName: null,
    version: 3, currentIteration: 2, maxIterations: 5, attempt: 2,
    lastHeartbeatAt: "2026-07-27T10:05:00.000Z", route: "/tasks/task_1",
  }],
  approvals: [{
    id: "approval_1", type: "merge", status: "pending", taskTitle: "Build Agent workspace",
    createdAt: "2026-07-27T10:03:00.000Z", action: "merge main", scope: "repository",
    policyReason: "主分支合并需要人工确认",
  }],
};

describe("desktop Agent workspace", () => {
  it("exposes runs, Loops, approvals and device capacity without decorative cards", () => {
    render(<MemoryRouter><AgentWorkspaceView
      activeView="overview"
      data={data}
      onApprovalDecision={vi.fn()}
      onLoopCommand={vi.fn()}
      onViewChange={vi.fn()}
    /></MemoryRouter>);

    expect(screen.getByRole("tab", { name: /Runs 1/u })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Loops 1/u })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /审批 1/u })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Build Agent workspace/u }))
      .toHaveAttribute("href", "/tasks/task_1");
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("sends the current Loop version with a pause command", () => {
    const onLoopCommand = vi.fn();
    render(<MemoryRouter><AgentWorkspaceView
      activeView="loops"
      data={data}
      onApprovalDecision={vi.fn()}
      onLoopCommand={onLoopCommand}
      onViewChange={vi.fn()}
    /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "暂停 Loop" }));
    expect(onLoopCommand).toHaveBeenCalledWith({
      loopId: "loop_1",
      command: "pause",
      expectedVersion: 3,
    });
  });

  it("summarizes only live Kubernetes instances and the task group", () => {
    render(<MemoryRouter><AgentWorkspaceView
      activeView="workers"
      data={{
        ...data,
        workers: [
          { ...data.workers[0]!, id: "worker_k8s_1", name: "pod-a", runtimeType: "kubernetes" },
          { ...data.workers[0]!, id: "worker_k8s_2", name: "pod-b", runtimeType: "kubernetes" },
        ],
      }}
      onApprovalDecision={vi.fn()}
      onLoopCommand={vi.fn()}
      onViewChange={vi.fn()}
    /></MemoryRouter>);

    const summary = screen.getByRole("region", { name: "Kubernetes Worker 存活统计" });
    expect(summary).toHaveTextContent("存活实例");
    expect(summary).toHaveTextContent("2");
    expect(summary).toHaveTextContent("任务组");
    expect(summary).toHaveTextContent("kubernetes");
    expect(screen.queryByText("历史实例")).not.toBeInTheDocument();
  });

  it("does not offer an invalid resume command while a Loop waits for its owner", () => {
    const onLoopCommand = vi.fn();
    const loop = data.loops[0]!;
    const waitingData = {
      ...data,
      loops: [{ ...loop, status: "waiting", waitingReason: "worker_offline" }],
    };
    render(<MemoryRouter><AgentWorkspaceView
      activeView="loops"
      data={waitingData}
      onApprovalDecision={vi.fn()}
      onLoopCommand={onLoopCommand}
      onViewChange={vi.fn()}
    /></MemoryRouter>);

    expect(screen.queryByRole("button", { name: "恢复 Loop" })).not.toBeInTheDocument();
    expect(screen.getByText("等待条件", { selector: ".agent-loop-action-placeholder" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消 Loop" }));
    expect(onLoopCommand).toHaveBeenCalledWith({
      loopId: "loop_1",
      command: "cancel",
      expectedVersion: 3,
    });
  });

  it("selects a Loop for the runtime detail drawer", () => {
    const onLoopSelect = vi.fn();
    render(<MemoryRouter><AgentWorkspaceView
      activeView="loops"
      data={data}
      selectedLoopId={null}
      onApprovalDecision={vi.fn()}
      onLoopCommand={vi.fn()}
      onLoopSelect={onLoopSelect}
      onViewChange={vi.fn()}
    /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "查看 Loop 详情：Build Agent workspace" }));
    expect(onLoopSelect).toHaveBeenCalledWith("loop_1");
  });

  it("exposes the local terminal view without a remote-device selector", () => {
    render(<MemoryRouter><AgentWorkspaceView
      activeView="terminals"
      data={data}
      terminalContent={<section aria-label="本机 Codex 终端">local only</section>}
      onApprovalDecision={vi.fn()}
      onLoopCommand={vi.fn()}
      onViewChange={vi.fn()}
    /></MemoryRouter>);

    expect(screen.getByRole("tab", { name: /本机终端/u })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "本机 Codex 终端" })).toBeInTheDocument();
    expect(screen.queryByText(/其他设备/u)).not.toBeInTheDocument();
  });

  it("exposes a direct execution-log entry for each Loop", () => {
    const onLoopSelect = vi.fn();
    render(<MemoryRouter><AgentWorkspaceView
      activeView="loops"
      data={data}
      selectedLoopId={null}
      onApprovalDecision={vi.fn()}
      onLoopCommand={vi.fn()}
      onLoopSelect={onLoopSelect}
      onViewChange={vi.fn()}
    /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "查看执行日志：Build Agent workspace" }));
    expect(onLoopSelect).toHaveBeenCalledWith("loop_1", "logs");
  });

  it("requires a rejection reason and submits the selected approval", () => {
    const onApprovalDecision = vi.fn();
    render(<MemoryRouter><AgentWorkspaceView
      activeView="approvals"
      data={data}
      onApprovalDecision={onApprovalDecision}
      onLoopCommand={vi.fn()}
      onViewChange={vi.fn()}
    /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: /Build Agent workspace/u }));
    fireEvent.change(screen.getByLabelText("驳回原因"), { target: { value: "范围过大" } });
    fireEvent.click(screen.getByRole("button", { name: "驳回" }));

    expect(onApprovalDecision).toHaveBeenCalledWith({
      approvalId: "approval_1",
      decision: "rejected",
      reason: "范围过大",
    });
  });
});
