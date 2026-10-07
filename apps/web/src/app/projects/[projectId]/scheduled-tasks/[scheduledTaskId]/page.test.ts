// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readProjectScheduledTaskDetail } from "../../../../../lib/orchestration/scheduled-task-read-model";
import { readProjectScheduledTaskRunView } from "../../../../../lib/orchestration/scheduled-task-read-model";
import { ProjectScheduledTaskDetail } from "../../../../components/scheduled-tasks/project-scheduled-task-detail";

const mocks = vi.hoisted(() => ({
  readProjectScheduledTaskDetail: vi.fn(),
  readProjectScheduledTaskRunView: vi.fn(),
  requireWorkbenchSession: vi.fn(),
  getProjectHubView: vi.fn(),
  getWorkbenchCompanyFilters: vi.fn(),
  getWorkbenchProjects: vi.fn(),
  getWorkbenchSelectedSpaceFilter: vi.fn(),
  ProjectScheduledTaskDetail: vi.fn(() => null),
}));

vi.mock("../../../../../lib/orchestration/scheduled-task-read-model", () => ({
  readProjectScheduledTaskDetail: mocks.readProjectScheduledTaskDetail,
  readProjectScheduledTaskRunView: mocks.readProjectScheduledTaskRunView,
}));
vi.mock("../../../../../lib/workbench/workbench-route-auth", () => ({
  requireWorkbenchSession: mocks.requireWorkbenchSession,
}));
vi.mock("../../../../../lib/workbench/workbench-projects", () => ({
  getProjectHubView: mocks.getProjectHubView,
  getWorkbenchProjects: mocks.getWorkbenchProjects,
}));
vi.mock("../../../../../lib/workbench/workbench-companies", () => ({
  getWorkbenchCompanyFilters: mocks.getWorkbenchCompanyFilters,
}));
vi.mock("../../../../../lib/workbench/workbench-space-filters", () => ({
  getSingleWorkbenchSearchParam: (_searchParams: Record<string, unknown>, key: string) => {
    const value = _searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  },
  getWorkbenchSelectedSpaceFilter: mocks.getWorkbenchSelectedSpaceFilter,
  PROJECT_SPACE_SEARCH_PARAM: "space",
  WORKBENCH_SPACE_COOKIE: "space",
}));
vi.mock("../../../../components/workbench-shell", () => ({
  WorkbenchShell: ({ children }: { children: unknown }) => children,
}));
vi.mock("../../../../components/scheduled-tasks/project-scheduled-task-detail", () => ({
  ProjectScheduledTaskDetail: mocks.ProjectScheduledTaskDetail,
  PROJECT_SCHEDULED_TASK_DETAIL_TABS: [
    { value: "logs", label: "运行日志" },
    { value: "report", label: "任务报告" },
  ],
  PROJECT_SCHEDULED_TASK_RUN_STATUS_FILTERS: [
    { value: "all", label: "全部" },
    { value: "preparing", label: "准备中" },
    { value: "running", label: "运行中" },
    { value: "waiting", label: "等待处理" },
    { value: "succeeded", label: "成功" },
    { value: "failed", label: "失败" },
    { value: "cancelled", label: "已取消" },
    { value: "blocked", label: "已阻止" },
  ],
}));

import ProjectScheduledTaskDetailPage, {
  PROJECT_SCHEDULED_TASK_DETAIL_PAGE_TITLE,
  resolveProjectScheduledTaskDetailTab,
  resolveProjectScheduledTaskRunStatus,
} from "./page";

const taskId = "a".repeat(32);
const runId = "b".repeat(32);
const matchingRunId = "c".repeat(32);

afterEach(() => {
  vi.clearAllMocks();
});

function renderedModel(): Parameters<typeof ProjectScheduledTaskDetail>[0]["model"] | undefined {
  const call = mocks.ProjectScheduledTaskDetail.mock.calls[0] as unknown as [Parameters<typeof ProjectScheduledTaskDetail>[0]] | undefined;
  return call?.[0].model;
}

describe("Project scheduled task detail page", () => {
  it("forces the selected run and report tab into the detail model", async () => {
    const selectedRun = {
      id: runId,
      status: "failed",
      triggerSource: "scheduled",
      scheduledFor: null,
      triggeredAt: "2026-09-22T01:00:00.000Z",
      startedAt: null,
      finishedAt: null,
      taskSnapshot: {},
      contentSnapshot: null,
      executionTargetSnapshot: {},
      loopRunReference: null,
      failureCode: null,
      failureMessage: null,
    };
    mocks.requireWorkbenchSession.mockResolvedValue({
      session: { context: { userId: "user_1" }, loginEmail: "user@example.com" },
      cookieStore: { get: vi.fn(() => undefined) },
    });
    mocks.getProjectHubView.mockResolvedValue({ project: { id: "project_1", name: "项目一" } });
    mocks.readProjectScheduledTaskDetail.mockResolvedValue({
      task: { id: taskId, name: "每日巡检" },
      loopOptions: [],
      targetOptions: [],
      canEdit: true,
      runs: [{ ...selectedRun }],
      selectedRun,
      loopRun: null,
      report: { status: "failed", completedNodes: 0, totalNodes: 0, failures: [], artifactRefs: [], primaryArtifactRef: null, durationMs: null },
    });
    mocks.getWorkbenchCompanyFilters.mockResolvedValue([]);
    mocks.getWorkbenchProjects.mockResolvedValue([]);
    mocks.getWorkbenchSelectedSpaceFilter.mockReturnValue({ key: "space_1", label: "空间一" });

    render(await ProjectScheduledTaskDetailPage({
      params: Promise.resolve({ projectId: "project_1", scheduledTaskId: taskId }),
      searchParams: Promise.resolve({ run: runId, tab: "report" }),
    }));

    expect(readProjectScheduledTaskDetail).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
      scheduledTaskId: taskId,
      runId,
    });
    expect(ProjectScheduledTaskDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          selectedRun: expect.objectContaining({ id: runId }),
          selectedTab: "report",
        }),
      }),
      undefined,
    );
    expect(ProjectScheduledTaskDetail).toHaveBeenCalledTimes(1);
  });

  it("does not pass or prepend an explicit run that does not match the status filter", async () => {
    const nonmatchingRun = {
      id: runId,
      status: "failed",
      triggerSource: "scheduled",
      scheduledFor: null,
      triggeredAt: "2026-09-22T01:00:00.000Z",
      startedAt: null,
      finishedAt: null,
      taskSnapshot: {},
      contentSnapshot: null,
      executionTargetSnapshot: {},
      loopRunReference: null,
      failureCode: "provider_error",
      failureMessage: "模型调用失败",
    };
    const matchingRun = {
      ...nonmatchingRun,
      id: matchingRunId,
      status: "succeeded",
      failureCode: null,
      failureMessage: null,
    };
    mocks.requireWorkbenchSession.mockResolvedValue({
      session: { context: { userId: "user_1" }, loginEmail: "user@example.com" },
      cookieStore: { get: vi.fn(() => undefined) },
    });
    mocks.getProjectHubView.mockResolvedValue({ project: { id: "project_1", name: "项目一" } });
    mocks.readProjectScheduledTaskDetail.mockResolvedValue({
      task: { id: taskId, name: "每日巡检" },
      loopOptions: [],
      targetOptions: [],
      canEdit: true,
      runs: [nonmatchingRun, matchingRun],
      selectedRun: nonmatchingRun,
      loopRun: null,
      report: { status: "failed", completedNodes: 0, totalNodes: 0, failures: [], artifactRefs: [], primaryArtifactRef: null, durationMs: null },
    });
    mocks.getWorkbenchCompanyFilters.mockResolvedValue([]);
    mocks.getWorkbenchProjects.mockResolvedValue([]);
    mocks.getWorkbenchSelectedSpaceFilter.mockReturnValue({ key: "space_1", label: "空间一" });

    render(await ProjectScheduledTaskDetailPage({
      params: Promise.resolve({ projectId: "project_1", scheduledTaskId: taskId }),
      searchParams: Promise.resolve({ run: runId, runStatus: "succeeded", tab: "logs" }),
    }));

    expect(readProjectScheduledTaskRunView).not.toHaveBeenCalled();
    const model = renderedModel();
    expect(model?.selectedRun).toBeNull();
    expect(model?.runs.map((run) => run.id)).toEqual([matchingRunId]);
  });

  it("selects the first matching run deterministically when no explicit run is present", async () => {
    const latestRun = {
      id: runId,
      status: "succeeded",
      triggerSource: "scheduled",
      scheduledFor: null,
      triggeredAt: "2026-09-22T01:00:00.000Z",
      startedAt: null,
      finishedAt: null,
      taskSnapshot: {},
      executionTargetSnapshot: {},
      loopRunReference: null,
      failureCode: null,
      failureMessage: null,
    };
    const firstMatchingRun = {
      ...latestRun,
      id: matchingRunId,
      status: "failed",
      failureCode: "provider_error",
      failureMessage: "模型调用失败",
    };
    const matchingView = {
      run: { ...firstMatchingRun, contentSnapshot: null },
      loopRun: null,
      report: { status: "failed", completedNodes: 0, totalNodes: 0, failures: [], artifactRefs: [], primaryArtifactRef: null, durationMs: null },
    };
    mocks.requireWorkbenchSession.mockResolvedValue({
      session: { context: { userId: "user_1" }, loginEmail: "user@example.com" },
      cookieStore: { get: vi.fn(() => undefined) },
    });
    mocks.getProjectHubView.mockResolvedValue({ project: { id: "project_1", name: "项目一" } });
    mocks.readProjectScheduledTaskDetail.mockResolvedValue({
      task: { id: taskId, name: "每日巡检" },
      loopOptions: [],
      targetOptions: [],
      canEdit: true,
      runs: [firstMatchingRun, latestRun],
      selectedRun: latestRun,
      loopRun: null,
      report: { status: "succeeded", completedNodes: 0, totalNodes: 0, failures: [], artifactRefs: [], primaryArtifactRef: null, durationMs: null },
    });
    mocks.readProjectScheduledTaskRunView.mockResolvedValue(matchingView);
    mocks.getWorkbenchCompanyFilters.mockResolvedValue([]);
    mocks.getWorkbenchProjects.mockResolvedValue([]);
    mocks.getWorkbenchSelectedSpaceFilter.mockReturnValue({ key: "space_1", label: "空间一" });

    render(await ProjectScheduledTaskDetailPage({
      params: Promise.resolve({ projectId: "project_1", scheduledTaskId: taskId }),
      searchParams: Promise.resolve({ runStatus: "failed", tab: "report" }),
    }));

    expect(readProjectScheduledTaskRunView).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
      scheduledTaskId: taskId,
      runId: matchingRunId,
    });
    const model = renderedModel();
    expect(model?.selectedRun?.id).toBe(matchingRunId);
    expect(model?.report.status).toBe("failed");
    expect(model?.runs.map((run) => run.id)).toEqual([matchingRunId]);
  });

  it("uses stable supported tab and run-status values", () => {
    expect(PROJECT_SCHEDULED_TASK_DETAIL_PAGE_TITLE).toBe("运行日志与任务报告");
    expect(resolveProjectScheduledTaskDetailTab({})).toBe("logs");
    expect(resolveProjectScheduledTaskDetailTab({ tab: "report" })).toBe("report");
    expect(resolveProjectScheduledTaskDetailTab({ tab: ["logs", "report"] })).toBe("logs");
    expect(resolveProjectScheduledTaskDetailTab({ tab: "unknown" })).toBe("logs");
    expect(resolveProjectScheduledTaskRunStatus({})).toBe("all");
    expect(resolveProjectScheduledTaskRunStatus({ runStatus: "blocked" })).toBe("blocked");
    expect(resolveProjectScheduledTaskRunStatus({ runStatus: "unknown" })).toBe("all");
  });
});
