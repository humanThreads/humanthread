import { notFound } from "next/navigation";

import {
  readProjectScheduledTaskDetail,
  readProjectScheduledTaskRunView,
} from "../../../../../lib/orchestration/scheduled-task-read-model";
import { getWorkbenchShellLoginProps } from "../../../../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../../../../lib/workbench/workbench-companies";
import { getProjectHubView, getWorkbenchProjects } from "../../../../../lib/workbench/workbench-projects";
import { requireWorkbenchSession } from "../../../../../lib/workbench/workbench-route-auth";
import {
  getSingleWorkbenchSearchParam,
  getWorkbenchSelectedSpaceFilter,
  PROJECT_SPACE_SEARCH_PARAM,
  WORKBENCH_SPACE_COOKIE,
  type WorkbenchSearchParams,
} from "../../../../../lib/workbench/workbench-space-filters";
import {
  ProjectScheduledTaskDetail,
  PROJECT_SCHEDULED_TASK_DETAIL_TABS,
  PROJECT_SCHEDULED_TASK_RUN_STATUS_FILTERS,
  type ProjectScheduledTaskDetailTab,
  type ProjectScheduledTaskRunStatusFilter,
} from "../../../../components/scheduled-tasks/project-scheduled-task-detail";
import { WorkbenchShell } from "../../../../components/workbench-shell";

export const dynamic = "force-dynamic";
export const PROJECT_SCHEDULED_TASK_DETAIL_PAGE_TITLE = "运行日志与任务报告";

export function resolveProjectScheduledTaskDetailTab(
  searchParams: Record<string, string | string[] | undefined>,
): ProjectScheduledTaskDetailTab {
  const raw = getSingleWorkbenchSearchParam(searchParams, "tab");
  return PROJECT_SCHEDULED_TASK_DETAIL_TABS.some((tab) => tab.value === raw)
    ? raw as ProjectScheduledTaskDetailTab
    : "logs";
}

export function resolveProjectScheduledTaskRunStatus(
  searchParams: Record<string, string | string[] | undefined>,
): ProjectScheduledTaskRunStatusFilter {
  const raw = getSingleWorkbenchSearchParam(searchParams, "runStatus");
  return PROJECT_SCHEDULED_TASK_RUN_STATUS_FILTERS.some((filter) => filter.value === raw)
    ? raw as ProjectScheduledTaskRunStatusFilter
    : "all";
}

export default async function ProjectScheduledTaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; scheduledTaskId: string }>;
  searchParams?: Promise<WorkbenchSearchParams>;
}) {
  const [{ projectId, scheduledTaskId }, raw] = await Promise.all([params, searchParams ?? Promise.resolve({})]);
  const requestedPath = `/projects/${encodeURIComponent(projectId)}/scheduled-tasks/${encodeURIComponent(scheduledTaskId)}`;
  const { session, cookieStore } = await requireWorkbenchSession(requestedPath);
  const tab = resolveProjectScheduledTaskDetailTab(raw);
  const runStatus = resolveProjectScheduledTaskRunStatus(raw);
  const runId = getSingleWorkbenchSearchParam(raw, "run");
  const [view, model, filters, quickCreateProjects] = await Promise.all([
    getProjectHubView({ projectId, userId: session.context.userId }),
    readProjectScheduledTaskDetail({
      userId: session.context.userId,
      projectId,
      scheduledTaskId,
      ...(runId ? { runId } : {}),
    }),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
    getWorkbenchProjects({ userId: session.context.userId }),
  ]);
  if (!view || !model) notFound();
  const runs = runStatus === "all" ? model.runs : model.runs.filter((run) => run.status === runStatus);
  let selectedRun = model.selectedRun;
  let loopRun = model.loopRun;
  let report = model.report;
  if (runStatus !== "all") {
    const firstMatchingRun = runs[0] ?? null;
    if (runId) {
      if (selectedRun?.id !== runId || selectedRun.status !== runStatus) {
        selectedRun = null;
        loopRun = null;
        report = emptyReport(runStatus);
      }
    } else if (firstMatchingRun) {
      if (selectedRun?.id !== firstMatchingRun.id || selectedRun.status !== runStatus) {
        const matchingView = await readProjectScheduledTaskRunView({
          userId: session.context.userId,
          projectId,
          scheduledTaskId,
          runId: firstMatchingRun.id,
        });
        selectedRun = matchingView?.run ?? null;
        loopRun = matchingView?.loopRun ?? null;
        report = matchingView?.report ?? emptyReport(runStatus);
      }
    } else {
      selectedRun = null;
      loopRun = null;
      report = emptyReport(runStatus);
    }
  }
  const taskSnapshot = selectedRun && typeof selectedRun.taskSnapshot === "object" && selectedRun.taskSnapshot !== null && !Array.isArray(selectedRun.taskSnapshot)
    ? selectedRun.taskSnapshot as Record<string, unknown>
    : null;
  const taskName = selectedRun
    ? typeof taskSnapshot?.name === "string" && taskSnapshot.name.trim() ? taskSnapshot.name : "任务快照缺失"
    : model.task.name;

  const selected = getWorkbenchSelectedSpaceFilter({
    filters,
    searchParamValue: getSingleWorkbenchSearchParam(raw, PROJECT_SPACE_SEARCH_PARAM),
    cookieValue: cookieStore.get(WORKBENCH_SPACE_COOKIE)?.value,
  });
  return (
    <WorkbenchShell
      activeKey="projects"
      title={`${view.project.name} · ${PROJECT_SCHEDULED_TASK_DETAIL_PAGE_TITLE}`}
      subtitle={taskName}
      loginEmail={session.loginEmail}
      spaceLabel={selected.label}
      selectedSpaceKey={selected.key}
      spaceFilters={filters}
      quickCreateProjects={quickCreateProjects}
      {...getWorkbenchShellLoginProps(session)}
    >
      <ProjectScheduledTaskDetail
        projectId={projectId}
        model={{ ...model, runs, selectedRun, loopRun, report, selectedTab: tab, runStatus }}
      />
    </WorkbenchShell>
  );
}

function emptyReport(status: ProjectScheduledTaskRunStatusFilter) {
  return {
    status,
    durationMs: null,
    completedNodes: 0,
    totalNodes: 0,
    failures: [],
    artifactRefs: [],
    primaryArtifactRef: null,
  };
}
