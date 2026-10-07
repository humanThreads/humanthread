// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MilestoneLoopButton } from "./milestone-loop-dialog";

const poolId = "a".repeat(32);
const optionsBody = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  milestone: { id: "milestone_1", name: "首轮交付" },
  tasks: [
    { id: "task_1", title: "待开发任务", eligible: true, reason: null },
    { id: "task_2", title: "已完成任务", eligible: false, reason: "任务已完成" },
  ],
  options: [
    { type: "local_agent", id: "profile_1", displayName: "本地 Agent · Gelsang Codex", ready: true, reason: null },
    { type: "linux_worker_pool", id: poolId, displayName: "Linux Worker · disaster", ready: true, reason: null },
  ],
  defaultTarget: { type: "linux_worker_pool", id: poolId, displayName: "Linux Worker · disaster", ready: true, reason: null },
  ...overrides,
});
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("MilestoneLoopButton", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("loads the selectable start conditions and starts the batch with the chosen target", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(optionsBody()))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        result: { started: 1, skipped: 0, failed: 0, results: [{ taskId: "task_1", status: "started", loopRunId: "loop_run:task_1" }] },
      }, 201));
    render(<MilestoneLoopButton milestoneId="milestone_1" milestoneName="首轮交付" />);

    await user.click(screen.getByRole("button", { name: "运行里程碑任务 Loop" }));
    expect(screen.getByRole("dialog", { name: "启动里程碑任务 Loop" })).toBeTruthy();
    expect(await screen.findByText(/将启动 1 个任务，跳过 1 个/)).toBeTruthy();

    const target = await screen.findByLabelText("执行目标") as HTMLSelectElement;
    expect(target.value).toBe(`linux_worker_pool:${poolId}`);
    await user.click(screen.getByRole("button", { name: "启动 1 个任务" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("/api/milestones/milestone_1/loop/options");
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe("/api/milestones/milestone_1/loop");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body))).toMatchObject({
      commandId: "milestone-loop-milestone_1",
      executionTarget: { type: "linux_worker_pool", workerPoolId: poolId },
    });
    expect(await screen.findByText("已启动 1 个，跳过 0 个，失败 0 个")).toBeTruthy();
    expect(screen.getByRole("link", { name: "查看运行记录" }).getAttribute("href")).toBe("/loop-runs/loop_run%3Atask_1");
    expect(screen.queryByRole("button", { name: "启动 1 个任务" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取消" })).toBeNull();

    const done = screen.getByRole("button", { name: "完成" });
    await user.click(done);
    expect(screen.queryByRole("dialog", { name: "启动里程碑任务 Loop" })).toBeNull();
  });

  it("keeps the start controls when the batch request fails so the user can retry", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(optionsBody()))
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: "里程碑 Loop 启动失败" }, 500));
    render(<MilestoneLoopButton milestoneId="milestone_1" milestoneName="首轮交付" />);

    await user.click(screen.getByRole("button", { name: "运行里程碑任务 Loop" }));
    await screen.findByLabelText("执行目标");
    await user.click(screen.getByRole("button", { name: "启动 1 个任务" }));

    expect(await screen.findByText("里程碑 Loop 启动失败")).toBeTruthy();
    expect(screen.getByRole("button", { name: "启动 1 个任务" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "完成" })).toBeNull();
  });

  it("blocks starting while the selected target is not ready and explains why", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(optionsBody({
      options: [{ type: "linux_worker_pool", id: poolId, displayName: "Linux Worker · disaster", ready: false, reason: "Linux Worker 暂无可用容量" }],
      defaultTarget: null,
    })));
    render(<MilestoneLoopButton milestoneId="milestone_1" milestoneName="首轮交付" />);

    await user.click(screen.getByRole("button", { name: "运行里程碑任务 Loop" }));
    const start = await screen.findByRole("button", { name: "暂无可启动目标" });
    const target = screen.getByLabelText("执行目标") as HTMLSelectElement;

    expect(start.hasAttribute("disabled")).toBe(true);
    expect(target.value).toBe(`linux_worker_pool:${poolId}`);
    expect(target.selectedOptions[0]?.textContent).toContain("Linux Worker 暂无可用容量");
  });

  it("guides the user when no execution target is configured", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(optionsBody({ options: [], defaultTarget: null })));
    render(<MilestoneLoopButton milestoneId="milestone_1" milestoneName="首轮交付" />);

    await user.click(screen.getByRole("button", { name: "运行里程碑任务 Loop" }));

    expect(await screen.findByText("尚未配置可用的执行目标")).toBeTruthy();
    expect(screen.queryByLabelText("执行目标")).toBeNull();
  });

  it("offers a retry when the start conditions fail to load", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: "执行目标暂不可用" }, 500))
      .mockResolvedValueOnce(jsonResponse(optionsBody()));
    render(<MilestoneLoopButton milestoneId="milestone_1" milestoneName="首轮交付" />);

    await user.click(screen.getByRole("button", { name: "运行里程碑任务 Loop" }));
    expect(await screen.findByRole("alert")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByLabelText("执行目标")).toBeTruthy();
  });
});
