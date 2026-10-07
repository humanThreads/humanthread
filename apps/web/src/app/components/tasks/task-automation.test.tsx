// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskAutomation } from "./task-automation";

const push = vi.fn();
const refresh = vi.fn();
const executionOptionsResponse = () => new Response(JSON.stringify({
  ok: true,
  options: [{ type: "linux_worker_pool", id: "a".repeat(32), displayName: "Linux Worker · ht-agent", ready: true, reason: null }],
  defaultTarget: { type: "linux_worker_pool", id: "a".repeat(32), displayName: "Linux Worker · ht-agent", ready: true, reason: null },
}), { status: 200, headers: { "content-type": "application/json" } });
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); push.mockReset(); refresh.mockReset(); });

describe("TaskAutomation", () => {
  it("keeps technical execution detail collapsed behind a user summary", async () => {
    const user = userEvent.setup();
    render(<TaskAutomation taskId="task_1" version={3} canDispatch agentProfiles={[{ id: "agent_1", name: "Codex", provider: "openai", status: "active" }]} agentRun={{ id: "run_1", status: "running", createdAt: new Date(), agentProfile: { id: "agent_1", name: "Codex", provider: "openai" } }} loopRun={{ id: "loop_1", status: "paused", currentIteration: 2, stopReason: null, version: 1 }} onVersionChange={vi.fn()} />);
    expect(screen.getByText("Codex 执行中")).toBeTruthy();
    expect(screen.queryByText("Loop 迭代 2")).toBeNull();
    await user.click(screen.getByRole("button", { name: "展开自动化详情" }));
    expect(screen.getByText(/^Loop 迭代 2/)).toBeTruthy();
    expect(screen.queryByText(/lease|provider session|checkpoint/iu)).toBeNull();
  });

  it("dispatches to a selected Agent without completing the Task", async () => {
    const user = userEvent.setup();
    const onVersionChange = vi.fn();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { version: 4, executionRelationship: { type: "agent_dispatch_candidate" } } }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<TaskAutomation taskId="task_1" version={3} canDispatch agentProfiles={[{ id: "agent_1", name: "Codex", provider: "openai", status: "active" }]} agentRun={null} loopRun={null} onVersionChange={onVersionChange} />);
    await user.click(screen.getByRole("button", { name: "展开自动化详情" }));
    await user.selectOptions(screen.getByLabelText("执行 Agent"), "agent_1");
    await user.click(screen.getByRole("button", { name: "交给 Agent" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/tasks/task_1/commands/dispatch_agent", expect.objectContaining({ method: "POST" })));
    expect(onVersionChange).toHaveBeenCalledWith(4);
    expect(screen.getByRole("status").textContent).toContain("候选执行");
  });

  it("does not mix legacy Agent dispatch controls into a graph Loop target", async () => {
    const user = userEvent.setup();
    render(<TaskAutomation
      taskId="task_1"
      version={3}
      canDispatch
      agentProfiles={[{ id: "agent_1", name: "Gelsang Codex", provider: "codex", status: "active" }]}
      agentRun={{ id: "run_1", status: "running", createdAt: new Date(), agentProfile: { id: "agent_1", name: "Gelsang Codex", provider: "codex" } }}
      loopRun={{ id: "loop_1", status: "running", currentIteration: 0, stopReason: null, version: 1 }}
      onVersionChange={vi.fn()}
    />);
    await user.click(screen.getByRole("button", { name: "展开自动化详情" }));
    expect(screen.queryByRole("combobox", { name: "执行 Agent" })).toBeNull();
    expect(screen.queryByRole("button", { name: "交给 Agent" })).toBeNull();
    expect(screen.queryByText("Gelsang Codex · running")).toBeNull();
  });

  it("keeps automation command IDs within the API limit for long internal task IDs", async () => {
    const user = userEvent.setup();
    const longTaskId = `task:space:company:${"company_".repeat(8)}:${"command_".repeat(8)}`;
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { version: 4 } }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<TaskAutomation taskId={longTaskId} version={3} canDispatch agentProfiles={[{ id: "agent_1", name: "Codex", provider: "openai", status: "active" }]} agentRun={null} loopRun={null} onVersionChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "展开自动化详情" }));
    await user.click(screen.getByRole("button", { name: "交给 Agent" }));

    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as { commandId: string };
    expect(body.commandId).toMatch(/^[a-f0-9]{32}$/);
  });

  it("starts a Task Loop and exposes its workflow entry", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(executionOptionsResponse()).mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      result: { id: "loop_run_task_1", engineKind: "graph_v1" },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    render(<TaskAutomation taskId="task_1" version={3} canDispatch agentProfiles={[]} agentRun={null} loopRun={null} onVersionChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "展开自动化详情" }));
    await user.click(screen.getByRole("button", { name: "启动任务 Loop" }));
    await user.click(screen.getByRole("button", { name: "启动任务 Loop" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/tasks/task_1/loop",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(screen.getByRole("link", { name: "进入 Loop 工作流" }).getAttribute("href")).toBe("/loop-runs/loop_run_task_1");
  });

  it("navigates to a newly started Loop instead of leaving the failed Task view stale", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(executionOptionsResponse()).mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      result: { id: "loop_run_task_navigation", engineKind: "graph_v1" },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    render(<TaskAutomation taskId="task_1" version={3} canDispatch agentProfiles={[]} agentRun={null} loopRun={null} onVersionChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "展开自动化详情" }));
    await user.click(screen.getByRole("button", { name: "启动任务 Loop" }));
    await user.click(screen.getByRole("button", { name: "启动任务 Loop" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/loop-runs/loop_run_task_navigation"));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("exposes a cancelled Task Loop restart that creates a fresh Run", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(executionOptionsResponse()).mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      result: { id: "loop_run_task_2", engineKind: "graph_v1" },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    render(<TaskAutomation
      taskId="task_1"
      version={6}
      canDispatch
      agentProfiles={[]}
      agentRun={null}
      loopRun={{ id: "loop_run_cancelled_1", status: "cancelled", currentIteration: 1, stopReason: "cancelled_by_user", version: 5 }}
      onVersionChange={vi.fn()}
    />);

    await user.click(screen.getByRole("button", { name: "重新启动任务 Loop" }));
    await user.click(screen.getByRole("button", { name: "重新启动任务 Loop" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const request = vi.mocked(fetch).mock.calls[1]?.[1];
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ command: "start" });
    expect(body.commandId).toMatch(/^[a-f0-9]{32}$/);
    expect(body).not.toHaveProperty("loopRunId");
    expect(screen.getByRole("link", { name: "进入 Loop 工作流" }).getAttribute("href")).toBe("/loop-runs/loop_run_task_2");
  });

  it("exposes restart for a worker execution failure waiting for intervention", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(executionOptionsResponse()).mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      result: { id: "loop_run_task_worker_retry", engineKind: "graph_v1" },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    render(<TaskAutomation taskId="task_1" version={10} canDispatch agentProfiles={[]} agentRun={null}
      loopRun={{ id: "loop_run_worker_failed", status: "waiting", statusReason: "intervention:worker_execution_failed", currentIteration: 0, stopReason: null, version: 7 }}
      onVersionChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "重新启动任务 Loop" }));
    await user.click(screen.getByRole("button", { name: "重新启动任务 Loop" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/loop-runs/loop_run_task_worker_retry"));
  });

  it("allows an active Task Loop to be cancelled before restarting", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<TaskAutomation taskId="task_1" version={6} canDispatch agentProfiles={[]} agentRun={null} loopRun={{ id: "loop_run_active_1", status: "running", currentIteration: 1, stopReason: null, version: 5 }} onVersionChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "展开自动化详情" }));
    await user.click(screen.getByRole("button", { name: "取消 Loop" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/tasks/task_1/loop", expect.objectContaining({ method: "POST", body: expect.stringContaining('"command":"cancel"') })));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("opens the automation details so a failed restart is immediately visible", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(executionOptionsResponse()).mockResolvedValueOnce(new Response(JSON.stringify({
      ok: false,
      error: "LoopVersion graph is incompatible with the requested snapshot contract",
    }), { status: 400, headers: { "content-type": "application/json" } }));
    render(<TaskAutomation
      taskId="task_1"
      version={6}
      canDispatch
      agentProfiles={[]}
      agentRun={null}
      loopRun={{ id: "loop_run_cancelled_1", status: "cancelled", currentIteration: 1, stopReason: "cancelled_by_user", version: 5 }}
      onVersionChange={vi.fn()}
    />);

    await user.click(screen.getByRole("button", { name: "重新启动任务 Loop" }));
    await user.click(screen.getByRole("button", { name: "重新启动任务 Loop" }));

    expect((await screen.findByRole("alert")).textContent).toContain("LoopVersion graph is incompatible");
    expect(screen.getByRole("button", { name: "收起自动化详情" })).toBeTruthy();
  });
});
