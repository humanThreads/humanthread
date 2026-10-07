// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ProjectScheduledTaskDetailModel,
  ProjectScheduledTaskSelectedRun,
} from "../../../lib/orchestration/scheduled-task-read-model";
import { ProjectScheduledTaskDetail } from "./project-scheduled-task-detail";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  pathname: `/projects/project_1/scheduled-tasks/${"a".repeat(32)}`,
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => navigation.pathname,
  useSearchParams: () => navigation.searchParams,
}));

const taskId = "a".repeat(32);
const runId = "b".repeat(32);
const olderRunId = "c".repeat(32);

const selectedRun: ProjectScheduledTaskSelectedRun = {
  id: runId,
  status: "failed",
  triggerSource: "scheduled",
  scheduledFor: "2026-09-22T00:00:00.000Z",
  triggeredAt: "2026-09-22T01:00:00.000Z",
  startedAt: "2026-09-22T01:00:01.000Z",
  finishedAt: "2026-09-22T01:01:31.000Z",
  taskSnapshot: {
    scheduledTaskId: taskId,
    name: "历史巡检",
    description: "检查昨日交付",
    status: "enabled",
    version: 2,
    contentMode: "platform",
    cronExpression: "0 9 * * *",
    timezone: "Asia/Shanghai",
    configurationSnapshot: {
      loopBindingId: "binding_1",
      loopDefinitionId: "loop_1",
      loopName: "历史 Loop",
      loopVersionId: "version_2",
      loopScope: "project",
    },
    executionTargetSnapshot: {
      type: "linux_worker_pool",
      id: "worker_1",
      displayName: "巡检 Worker",
      provider: null,
    },
  },
  contentSnapshot: "# 旧正文",
  executionTargetSnapshot: {
    type: "linux_worker_pool",
    id: "worker_1",
    displayName: "巡检 Worker",
    provider: null,
  },
  loopRunReference: { id: "loop_run_1", engineKind: "graph_v1" },
  failureCode: "provider_error",
  failureMessage: "模型调用失败",
};

const model: ProjectScheduledTaskDetailModel & {
  selectedTab?: "logs" | "report";
  runStatus?: "all" | "preparing" | "running" | "waiting" | "succeeded" | "failed" | "cancelled" | "blocked";
} = {
  task: {
    id: taskId,
    name: "当前巡检",
    description: "当前说明",
    status: "enabled",
    version: 4,
    cronExpression: "0 9 * * *",
    timezone: "Asia/Shanghai",
    contentMode: "platform",
    contentMarkdown: "# 新正文",
    loopBinding: { id: "binding_1", name: "当前 Loop 名称", scope: "project", versionNumber: 4 },
    executionTarget: { type: "linux_worker_pool", id: "worker_2", displayName: "新 Worker", provider: null },
    nextRunAt: "2026-09-23T01:00:00.000Z",
    pendingScheduledFor: null,
    lastScheduledFor: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T02:00:00.000Z",
    activeRun: null,
    latestRun: null,
  },
  loopOptions: [],
  targetOptions: [],
  canEdit: true,
  runs: [
    {
      id: runId,
      status: "failed",
      triggerSource: "scheduled",
      scheduledFor: "2026-09-22T00:00:00.000Z",
      triggeredAt: "2026-09-22T01:00:00.000Z",
      startedAt: "2026-09-22T01:00:01.000Z",
      finishedAt: "2026-09-22T01:01:31.000Z",
      taskSnapshot: selectedRun.taskSnapshot,
      executionTargetSnapshot: selectedRun.executionTargetSnapshot,
      loopRunReference: selectedRun.loopRunReference,
      failureCode: selectedRun.failureCode,
      failureMessage: selectedRun.failureMessage,
    },
    {
      id: olderRunId,
      status: "succeeded",
      triggerSource: "manual",
      scheduledFor: null,
      triggeredAt: "2026-09-21T01:00:00.000Z",
      startedAt: "2026-09-21T01:00:01.000Z",
      finishedAt: "2026-09-21T01:00:31.000Z",
      taskSnapshot: selectedRun.taskSnapshot,
      executionTargetSnapshot: selectedRun.executionTargetSnapshot,
      loopRunReference: { id: "loop_run_0", engineKind: "graph_v1" },
      failureCode: null,
      failureMessage: null,
    },
  ],
  selectedRun,
  loopRun: {
    definitionVersion: 2,
    projectionVersion: 3,
    eventCursor: 2,
    run: {
      id: "loop_run_1",
      taskId: null,
      status: "failed",
      statusReason: "provider_error",
      repeatCount: 0,
      transitionCount: 1,
      stopReason: null,
    },
    nodes: [
      {
        nodeKey: "inspect",
        label: "检查",
        type: "agent_action",
        status: "completed",
        currentNodeRunId: "node_run_1",
        attemptNo: 1,
        waitingReason: null,
        attempts: [{
          attemptId: "loop_attempt:inspect_1",
          attempt: 1,
          status: "completed",
          executorType: "worker",
          startedAt: "2026-09-22T01:00:01.000Z",
          finishedAt: "2026-09-22T01:00:30.000Z",
          result: { summary: "检查完成" },
          error: null,
          executionPhase: null,
        }],
        artifactRefs: [],
      },
      {
        nodeKey: "report",
        label: "报告",
        type: "platform_action",
        status: "failed",
        currentNodeRunId: "node_run_2",
        attemptNo: 1,
        waitingReason: null,
        attempts: [{
          attemptId: "loop_attempt:report_1",
          attempt: 1,
          status: "failed",
          executorType: "platform",
          startedAt: "2026-09-22T01:00:30.000Z",
          finishedAt: "2026-09-22T01:01:31.000Z",
          result: null,
          error: { code: "provider_error", message: "模型调用失败" },
          executionPhase: null,
        }],
        artifactRefs: [],
      },
    ],
    edges: [],
    activities: [{
      id: "event_1",
      cursor: 1,
      eventType: "loop.node.completed",
      occurredAt: "2026-09-22T01:00:30.000Z",
      nodeKey: "inspect",
      edgeId: null,
      summary: "检查已完成",
    }],
  },
  report: {
    status: "failed",
    durationMs: 90_000,
    completedNodes: 1,
    totalNodes: 2,
    failures: [{
      nodeKey: "report",
      label: "报告",
      code: "provider_error",
      message: "模型调用失败",
    }],
    artifactRefs: [],
    primaryArtifactRef: null,
  },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  navigation.searchParams = new URLSearchParams();
});

describe("ProjectScheduledTaskDetail", () => {
  it("shows logs and reports for the same selected run", () => {
    render(<ProjectScheduledTaskDetail model={model} />);

    expect(screen.getByRole("tab", { name: "运行日志" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("2026-09-22T01:00:00.000Z")).toBeTruthy();
    expect(screen.getByText("平台维护")).toBeTruthy();
    expect(screen.getByText("巡检 Worker")).toBeTruthy();
    expect(screen.getByText("历史 Loop")).toBeTruthy();
    expect(screen.queryByText("当前 Loop 名称")).toBeNull();
    expect(screen.getByText("检查已完成")).toBeTruthy();
  });

  it("switches tabs while keeping the exact run selected", async () => {
    const user = userEvent.setup();
    const push = vi.fn();
    navigation.searchParams = new URLSearchParams(`run=${runId}&tab=logs&runStatus=failed`);
    render(<ProjectScheduledTaskDetail model={model} onNavigate={push} />);

    await user.click(screen.getByRole("tab", { name: "任务报告" }));

    expect(push).toHaveBeenCalledWith(expect.stringContaining(`run=${runId}`));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("tab=report"));
  });

  it("renders the deterministic report when no Loop report artifact exists", () => {
    render(<ProjectScheduledTaskDetail model={{ ...model, selectedTab: "report" }} />);

    expect(screen.getByText("完成节点 1 / 2")).toBeTruthy();
    expect(screen.getByText("provider_error")).toBeTruthy();
    expect(screen.getByText("平台未生成额外叙事报告，以下结果来自本次 Loop 事实。")).toBeTruthy();
  });

  it("renders every report timing from the selected immutable run", () => {
    render(<ProjectScheduledTaskDetail model={{
      ...model,
      selectedTab: "report",
      selectedRun: {
        ...selectedRun,
        scheduledFor: "2026-09-22T00:10:00.000Z",
        triggeredAt: "2026-09-22T01:10:00.000Z",
        startedAt: "2026-09-22T01:10:01.000Z",
        finishedAt: "2026-09-22T01:11:31.000Z",
      },
      report: { ...model.report, durationMs: 90_000 },
      task: { ...model.task, nextRunAt: "2026-09-23T23:59:59.000Z" },
    }} />);

    const report = screen.getByRole("tabpanel", { name: "任务报告" });
    expect(within(report).getByText("2026-09-22T00:10:00.000Z")).toBeTruthy();
    expect(within(report).getByText("2026-09-22T01:10:00.000Z")).toBeTruthy();
    expect(within(report).getByText("2026-09-22T01:10:01.000Z")).toBeTruthy();
    expect(within(report).getByText("2026-09-22T01:11:31.000Z")).toBeTruthy();
    expect(within(report).getAllByText("1分 30秒").length).toBeGreaterThan(0);
    expect(within(report).queryByText("2026-09-23T23:59:59.000Z")).toBeNull();
  });

  it("shows a Loop report artifact as the primary report when present", () => {
    render(<ProjectScheduledTaskDetail model={{
      ...model,
      selectedTab: "report",
      report: {
        ...model.report,
        artifactRefs: ["reports/final.json", "output.zip"],
        primaryArtifactRef: "reports/final.json",
      },
    }} />);

    expect(screen.getByRole("link", { name: /主报告.*reports\/final\.json/ }).getAttribute("href")).toBe("/reports/final.json");
    expect(screen.queryByText("平台未生成额外叙事报告，以下结果来自本次 Loop 事实。")).toBeNull();
  });

  it("keeps the historical snapshot after task configuration changes", () => {
    render(<ProjectScheduledTaskDetail model={{
      ...model,
      task: {
        ...model.task,
        name: "新任务名称",
        contentMarkdown: "# 新正文",
        executionTarget: { type: "linux_worker_pool", id: "worker_2", displayName: "新 Worker", provider: null },
      },
    }} />);

    expect(screen.getByText("# 旧正文")).toBeTruthy();
    expect(screen.getAllByText("历史巡检").length).toBeGreaterThan(0);
    expect(screen.queryByText("# 新正文")).toBeNull();
    expect(screen.queryByText("新任务名称")).toBeNull();
    expect(screen.queryByText("新 Worker")).toBeNull();
  });

  it("filters runs through the URL without changing the selected tab", async () => {
    const user = userEvent.setup();
    const push = vi.fn();
    navigation.searchParams = new URLSearchParams(`run=${runId}&tab=logs&spaceKey=space_1`);
    render(<ProjectScheduledTaskDetail model={model} onNavigate={push} />);

    await user.selectOptions(screen.getByLabelText("运行状态筛选"), "failed");

    expect(push).toHaveBeenCalledWith(expect.stringContaining("runStatus=failed"));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("tab=logs"));
    expect(push).toHaveBeenCalledWith(expect.stringContaining(`run=${runId}`));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("spaceKey=space_1"));
  });

  it("does not render an explicit run that does not match the active status filter", () => {
    navigation.searchParams = new URLSearchParams(`run=${runId}&runStatus=succeeded`);
    render(<ProjectScheduledTaskDetail model={{
      ...model,
      runStatus: "succeeded",
      runs: model.runs.filter((run) => run.status === "succeeded"),
    }} />);

    expect(screen.getByText("没有符合当前状态筛选的运行，请从运行列表中选择。")).toBeTruthy();
    expect(screen.queryByText("检查已完成")).toBeNull();
    expect(screen.queryByText("provider_error")).toBeNull();
    expect((screen.getByLabelText("选择运行") as HTMLSelectElement).value).toBe("");
  });

  it("keeps an explicit run active when it matches the status filter", () => {
    navigation.searchParams = new URLSearchParams(`run=${olderRunId}&runStatus=succeeded`);
    const matchingRun: ProjectScheduledTaskSelectedRun = {
      ...selectedRun,
      id: olderRunId,
      status: "succeeded",
      triggerSource: "manual",
      scheduledFor: null,
      triggeredAt: "2026-09-21T01:00:00.000Z",
      startedAt: "2026-09-21T01:00:01.000Z",
      finishedAt: "2026-09-21T01:00:31.000Z",
      loopRunReference: { id: "loop_run_0", engineKind: "graph_v1" },
      failureCode: null,
      failureMessage: null,
    };
    render(<ProjectScheduledTaskDetail model={{
      ...model,
      runStatus: "succeeded",
      runs: model.runs.filter((run) => run.status === "succeeded"),
      selectedRun: matchingRun,
      loopRun: null,
      report: {
        ...model.report,
        status: "succeeded",
        durationMs: 30_000,
        completedNodes: 0,
        totalNodes: 0,
        failures: [],
      },
    }} />);

    expect((screen.getByLabelText("选择运行") as HTMLSelectElement).value).toBe(olderRunId);
    expect(screen.getByText("未创建 Loop Run，暂无可核验节点。")).toBeTruthy();
    expect(screen.queryByText("没有符合当前状态筛选的运行，请从运行列表中选择。")).toBeNull();
  });

  it.each(["blocked", "failed"] as const)("uses the ledger failure as the primary explanation for a %s run without a Loop Run", (status) => {
    render(<ProjectScheduledTaskDetail model={{
      ...model,
      selectedTab: "report",
      selectedRun: {
        ...selectedRun,
        status,
        loopRunReference: null,
        failureCode: status === "blocked" ? "loop_binding_unavailable" : "provider_error",
        failureMessage: status === "blocked" ? "Loop 绑定不可用" : "模型调用失败",
      },
      loopRun: null,
      report: {
        ...model.report,
        status,
        completedNodes: 0,
        totalNodes: 0,
        failures: [],
      },
    }} />);

    const report = screen.getByRole("tabpanel", { name: "任务报告" });
    expect(within(report).getByText(status === "blocked" ? "loop_binding_unavailable" : "provider_error")).toBeTruthy();
    expect(within(report).getByText(status === "blocked" ? "Loop 绑定不可用" : "模型调用失败")).toBeTruthy();
    expect(within(report).queryByText("本次运行没有失败的 Loop 节点。")).toBeNull();
  });

  it("shows a no-run report state instead of a synthetic not_started report", () => {
    render(<ProjectScheduledTaskDetail model={{
      ...model,
      selectedTab: "report",
      runs: [],
      selectedRun: null,
      loopRun: null,
      report: { ...model.report, status: "not_started", completedNodes: 0, totalNodes: 0, durationMs: null, failures: [] },
    }} />);

    const report = screen.getByRole("tabpanel", { name: "任务报告" });
    expect(within(report).getByText("暂无运行记录")).toBeTruthy();
    expect(within(report).queryByText("完成节点 0 / 0")).toBeNull();
  });

  it("offers every supported run status and exposes accessible tabs and selects", () => {
    render(<ProjectScheduledTaskDetail model={model} />);

    expect(screen.getByRole("tablist", { name: "运行详情视图" })).toBeTruthy();
    expect(screen.getByRole("tabpanel", { name: "运行日志" })).toBeTruthy();
    const statusSelect = screen.getByLabelText("运行状态筛选");
    expect(Array.from(statusSelect.querySelectorAll("option"), (option) => option.textContent)).toEqual([
      "全部", "准备中", "运行中", "等待处理", "成功", "失败", "已取消", "已阻止",
    ]);
    expect(screen.getByLabelText("选择运行")).toBeTruthy();
  });

  it("moves focus to the next selected tab and only wires controls for the rendered panel", async () => {
    const user = userEvent.setup();
    const push = vi.fn();
    render(<ProjectScheduledTaskDetail model={model} onNavigate={push} />);

    const logsTab = screen.getByRole("tab", { name: "运行日志" });
    const reportTab = screen.getByRole("tab", { name: "任务报告" });
    const logsPanelId = logsTab.getAttribute("aria-controls");
    expect(logsPanelId).toBeTruthy();
    expect(document.getElementById(logsPanelId! )).toBeTruthy();
    expect(reportTab.getAttribute("aria-controls")).toBeNull();

    logsTab.focus();
    await user.keyboard("{ArrowRight}");

    expect(push).toHaveBeenCalledWith(expect.stringContaining("tab=report"));
    expect(document.activeElement).toBe(reportTab);
  });

  it("links to Loop Run only when the selected run has an authoritative Loop Run", () => {
    const { rerender } = render(<ProjectScheduledTaskDetail model={model} />);
    expect(screen.getByRole("link", { name: "进入 Loop Run" }).getAttribute("href")).toBe("/loop-runs/loop_run_1");

    rerender(<ProjectScheduledTaskDetail model={{
      ...model,
      selectedRun: {
        ...selectedRun,
        status: "blocked",
        loopRunReference: null,
        failureCode: "loop_binding_unavailable",
        failureMessage: "Loop binding unavailable",
      },
      loopRun: null,
      report: {
        ...model.report,
        status: "blocked",
        completedNodes: 0,
        totalNodes: 0,
        failures: [{
          nodeKey: "run",
          label: "运行",
          code: "loop_binding_unavailable",
          message: "Loop binding unavailable",
        }],
      },
    }} />);

    expect(screen.queryByRole("link", { name: "进入 Loop Run" })).toBeNull();
    expect(screen.getByText("未创建 Loop Run，暂无可核验节点。")).toBeTruthy();
    expect(screen.queryByText("检查已完成")).toBeNull();
  });
});
