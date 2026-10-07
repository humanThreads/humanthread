import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getWorkbenchShellLoginProps } from "../../../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../../../lib/workbench/workbench-companies";
import { getProjectHubView, getWorkbenchProjects } from "../../../../lib/workbench/workbench-projects";
import { requireWorkbenchSession } from "../../../../lib/workbench/workbench-route-auth";
import { getSingleWorkbenchSearchParam, getWorkbenchSelectedSpaceFilter, PROJECT_SPACE_SEARCH_PARAM, WORKBENCH_SPACE_COOKIE, type WorkbenchSearchParams } from "../../../../lib/workbench/workbench-space-filters";
import { readProjectScheduledTaskList } from "../../../../lib/orchestration/scheduled-task-read-model";
import { ProjectScheduledTaskList, type ProjectScheduledTaskStatusFilter } from "../../../components/scheduled-tasks/project-scheduled-task-list";
import { WorkbenchShell } from "../../../components/workbench-shell";

export const dynamic = "force-dynamic";
export const PROJECT_SCHEDULED_TASKS_PAGE_TITLE = "定时任务";
export const PROJECT_SCHEDULED_TASK_STATUS_TABS = ["all", "inactive", "enabled", "disabled"] as const;

export function resolveProjectScheduledTaskStatus(
  searchParams: Record<string, string | string[] | undefined>,
): ProjectScheduledTaskStatusFilter {
  const raw = Array.isArray(searchParams.status) ? searchParams.status[0] : searchParams.status;
  return PROJECT_SCHEDULED_TASK_STATUS_TABS.includes(raw as ProjectScheduledTaskStatusFilter)
    ? raw as ProjectScheduledTaskStatusFilter
    : "all";
}

export default async function ProjectScheduledTasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<WorkbenchSearchParams>;
}) {
  const [{ projectId }, raw] = await Promise.all([params, searchParams ?? Promise.resolve({})]);
  const { session, cookieStore } = await requireWorkbenchSession(`/projects/${encodeURIComponent(projectId)}/scheduled-tasks`);
  const status = resolveProjectScheduledTaskStatus(raw);
  const [view, model, filters, quickCreateProjects] = await Promise.all([
    getProjectHubView({ projectId, userId: session.context.userId }),
    readProjectScheduledTaskList({
      userId: session.context.userId,
      projectId,
      ...(status === "all" ? {} : { status }),
    }),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
    getWorkbenchProjects({ userId: session.context.userId }),
  ]);
  if (!view || !model) notFound();
  const selected = getWorkbenchSelectedSpaceFilter({
    filters,
    searchParamValue: getSingleWorkbenchSearchParam(raw, PROJECT_SPACE_SEARCH_PARAM),
    cookieValue: cookieStore.get(WORKBENCH_SPACE_COOKIE)?.value,
  });

  return (
    <WorkbenchShell
      activeKey="projects"
      title={`${view.project.name} · ${PROJECT_SCHEDULED_TASKS_PAGE_TITLE}`}
      subtitle="按计划启动项目 Loop，控制任务状态并查看执行结果"
      loginEmail={session.loginEmail}
      spaceLabel={selected.label}
      selectedSpaceKey={selected.key}
      spaceFilters={filters}
      quickCreateProjects={quickCreateProjects}
      {...getWorkbenchShellLoginProps(session)}
    >
      <div className="grid min-w-0 w-full gap-4">
        <Link href={`/projects/${encodeURIComponent(projectId)}`} className="inline-flex w-fit items-center gap-2 text-sm font-medium text-[#0969da] hover:underline">
          <ArrowLeft aria-hidden="true" size={16} />返回项目
        </Link>
        <ProjectScheduledTaskList
          projectId={projectId}
          status={status}
          tasks={model.tasks}
          loopOptions={model.loopOptions}
          targetOptions={model.targetOptions}
          canEdit={model.canEdit}
        />
      </div>
    </WorkbenchShell>
  );
}
