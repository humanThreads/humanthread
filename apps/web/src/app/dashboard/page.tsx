import { getWorkbenchCompanyFilters } from "../../lib/workbench/workbench-companies";
import { getWorkbenchShellLoginProps } from "../../lib/workbench/workbench-avatar";
import { getWorkbenchDashboardData } from "../../lib/workbench/workbench-dashboard";
import { getProjectListItems } from "../../lib/workbench/workbench-projects";
import { getAgentControlPlane } from "../../lib/orchestration/agent-read-model";
import { countAccessibleTasksAwaitingAcceptance } from "../../lib/workbench/workbench-delivery-health-report";
import { summarizeWorkbenchNotifications } from "../../lib/workbench/workbench-notification-summary";
import { requireWorkbenchSession } from "../../lib/workbench/workbench-route-auth";
import {
  PROJECT_SPACE_SEARCH_PARAM,
  WORKBENCH_SPACE_COOKIE,
  getSingleWorkbenchSearchParam,
  getWorkbenchSelectedSpaceFilter,
  type WorkbenchSearchParams,
} from "../../lib/workbench/workbench-space-filters";
import { WorkbenchShell } from "../components/workbench-shell";
import {
  TaskInboxPanel,
} from "../components/workbench-sections";
import { DashboardActionBand } from "../components/dashboard-action-band";
import { DashboardDecisionPanel } from "../components/dashboard-decision-panel";
import { DashboardSecondarySummary } from "../components/dashboard-secondary-summary";
import { DashboardLoopQueue } from "../components/dashboard-loop-queue";
import { EmptyState, WorkbenchButton } from "../components/workbench-ui";

export const dynamic = "force-dynamic";

export const DASHBOARD_PRIMARY_SECTION_ORDER = ["queue", "running", "confirmation", "secondary"] as const;

interface DashboardPageProps {
  searchParams?: Promise<WorkbenchSearchParams>;
}

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps = {}) {
  const resolvedSearchParams = await searchParams;
  const { session, cookieStore } = await requireWorkbenchSession("/dashboard");
  const { context, loginEmail } = session;
  const companyFilters = await getWorkbenchCompanyFilters({
    userId: context.userId,
  });
  const selectedFilter = getWorkbenchSelectedSpaceFilter({
    filters: companyFilters,
    searchParamValue: getSingleWorkbenchSearchParam(
      resolvedSearchParams,
      PROJECT_SPACE_SEARCH_PARAM,
    ),
    cookieValue: cookieStore.get(WORKBENCH_SPACE_COOKIE)?.value,
  });
  const filterKey = getSingleWorkbenchSearchParam(resolvedSearchParams, "filter");
  const viewKey = getSingleWorkbenchSearchParam(resolvedSearchParams, "view");
  const selectedTaskId = getSingleWorkbenchSearchParam(
    resolvedSearchParams,
    "taskId",
  );
  const [data, projects, controlPlane, awaitingAcceptance] = await Promise.all([getWorkbenchDashboardData({
    teamId: context.teamId,
    userId: context.userId,
    ...(filterKey ? { filterKey } : {}),
    ...(viewKey ? { viewKey } : {}),
    ...(selectedTaskId ? { selectedTaskId } : {}),
    ...(selectedFilter.companyId ? { companyId: selectedFilter.companyId } : {}),
    ...(selectedFilter.ownerType ? { ownerType: selectedFilter.ownerType } : {}),
  }), getProjectListItems({ userId: context.userId, ...(selectedFilter.companyId ? { companyId: selectedFilter.companyId } : {}), ...(selectedFilter.ownerType ? { ownerType: selectedFilter.ownerType } : {}) }), getAgentControlPlane({ userId: context.userId, ownerType: selectedFilter.ownerType, companyId: selectedFilter.companyId }), countAccessibleTasksAwaitingAcceptance({ userId: context.userId, ...(selectedFilter.spaceId ? { spaceId: selectedFilter.spaceId } : {}) })]);
  const notificationSummary = summarizeWorkbenchNotifications({
    currentTask: data.currentTask,
    timelineEvents: data.detail?.timelineEvents ?? [],
    documents: [],
  });
  const quickCreateInitialSpaceId = data.quickCreateProjects.find(
    (project) => project.id === context.projectId,
  )?.spaceId ?? selectedFilter.spaceId ?? undefined;
  const actionSignals = [
    ...data.actionSignals.map((signal) => ({ ...signal, href: `/tasks?spaceKey=${encodeURIComponent(selectedFilter.key)}&relation=${signal.key}` })),
    { key: "acceptance" as const, label: "待验收", count: awaitingAcceptance, description: "需要人工验收的任务。", href: `/tasks?spaceKey=${encodeURIComponent(selectedFilter.key)}&status=in_review` },
    { key: "confirmation" as const, label: "待确认", count: (controlPlane.approvals?.length ?? 0) + (controlPlane.loops?.filter((loop) => loop.status === "waiting_approval").length ?? 0), description: "Agent 或 Loop 等待人工确认。", href: `/agents?space=${encodeURIComponent(selectedFilter.key)}#approvals` },
  ];
  const selectedProject = projects.find((project) => project.id === data.detail?.task.project.id);

  return (
    <WorkbenchShell
      activeKey="workbench"
      title="我的工作台"
      subtitle="只聚焦当前任务。所有动作都围绕推进、转交、阻塞和协作上下文展开。"
      loginEmail={loginEmail}
      spaceLabel={selectedFilter.label}
      selectedSpaceKey={selectedFilter.key}
      spaceFilters={companyFilters}
      notificationUnreadCount={notificationSummary.unreadCount}
      {...(quickCreateInitialSpaceId ? { quickCreateInitialSpaceId } : {})}
      quickCreateProjects={data.quickCreateProjects}
      quickCreateSelectedProjectId={context.projectId}
      {...getWorkbenchShellLoginProps(session)}
    >
      <div className="grid gap-5">
        <DashboardActionBand signals={actionSignals} motionKey={`${selectedFilter.key}:${data.activeFilter}`} />
        {data.allTasks.length === 0 ? <EmptyState title="这个 Space 还没有待推进事项" description="从任务、项目或模板开始建立可追踪的交付上下文。" action={<div className="flex flex-wrap gap-2"><WorkbenchButton href="/tasks">创建首个事项</WorkbenchButton><WorkbenchButton href="/projects">新建项目</WorkbenchButton><WorkbenchButton href="/templates">打开模板库</WorkbenchButton></div>} /> : <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.95fr)]">
          <div className="grid gap-5">
            <DashboardLoopQueue tasks={data.allTasks} selectedSpaceKey={selectedFilter.key} />
            <TaskInboxPanel
              pathname="/dashboard"
              activeFilter={data.activeFilter}
              activeView={data.activeView}
              selectedTaskId={data.selectedTaskId}
              selectedSpaceKey={selectedFilter.key}
              groups={data.inboxGroups}
            />
          </div>
          <div className="order-1 grid content-start gap-5 xl:order-2">
            <DashboardDecisionPanel detail={data.detail} project={selectedProject} pendingConfirmations={actionSignals[3]?.count ?? 0} />
          </div>
        </div>}
        <DashboardSecondarySummary projects={projects} members={data.members} activeRuns={controlPlane.runs?.filter((run) => run.status === "running").length ?? 0} selectedSpaceKey={selectedFilter.key} />
      </div>
    </WorkbenchShell>
  );
}
