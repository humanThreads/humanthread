import Link from "next/link";
import { getWorkbenchCompanyFilters } from "../../lib/workbench/workbench-companies";
import { listAccessibleProjectDocuments } from "../../lib/workbench/workbench-documents";
import { getWorkbenchOverview } from "../../lib/workbench/workbench-overview";
import { getWorkbenchDashboardData } from "../../lib/workbench/workbench-dashboard";
import { getWorkbenchShellLoginProps } from "../../lib/workbench/workbench-avatar";
import { requireWorkbenchSession } from "../../lib/workbench/workbench-route-auth";
import {
  WORKBENCH_SPACE_COOKIE,
  getSingleWorkbenchSearchParam,
  getWorkbenchSelectedSpaceFilter,
  type WorkbenchSearchParams,
} from "../../lib/workbench/workbench-space-filters";
import {
  buildWorkbenchNotificationFeed,
  listAccessibleLoopNotificationIntents,
} from "../../lib/workbench/workbench-notifications";
import { getReadWorkbenchNotificationIds } from "../../lib/workbench/workbench-notification-state";
import { collectWorkbenchNotificationIds } from "../../lib/workbench/workbench-notifications";
import { WorkbenchShell } from "../components/workbench-shell";
import {
  SelectedTaskContextPanel,
  formatWorkbenchDateTime,
} from "../components/workbench-sections";
import { EmptyState, KpiCard, Panel, StatusPill, WorkbenchButton } from "../components/workbench-ui";

export const dynamic = "force-dynamic";

export const NOTIFICATIONS_PAGE_SECTION_TITLES = [
  "当前关注任务",
  "站内信概览",
  "最近动态",
  "项目入口",
] as const;

interface NotificationsPageProps {
  searchParams?: Promise<WorkbenchSearchParams>;
}

export default async function NotificationsPage({
  searchParams,
}: NotificationsPageProps = {}) {
  const resolvedSearchParams = await searchParams;
  const { session, cookieStore } = await requireWorkbenchSession("/notifications");
  const { context, loginEmail } = session;
  const companyFilters = await getWorkbenchCompanyFilters({
    userId: context.userId,
  });
  const selectedSpaceKey = cookieStore.get(WORKBENCH_SPACE_COOKIE)?.value ?? "all";
  const selectedFilter = getWorkbenchSelectedSpaceFilter({
    filters: companyFilters,
    searchParamValue: selectedSpaceKey,
    cookieValue: undefined,
  });
  const selectedTaskId =
    getSingleWorkbenchSearchParam(resolvedSearchParams, "taskId") ?? null;
  const [overview, documents, dashboardData, loopNotifications] = await Promise.all([
    getWorkbenchOverview({
      teamId: context.teamId,
      userId: context.userId,
      ...(selectedFilter.companyId ? { companyId: selectedFilter.companyId } : {}),
      ...(selectedFilter.ownerType ? { ownerType: selectedFilter.ownerType } : {}),
    }),
    listAccessibleProjectDocuments({
      userId: context.userId,
      ...(selectedFilter.companyId ? { companyId: selectedFilter.companyId } : {}),
      ...(selectedFilter.ownerType ? { ownerType: selectedFilter.ownerType } : {}),
    }),
    selectedTaskId
      ? getWorkbenchDashboardData({
          teamId: context.teamId,
          userId: context.userId,
          selectedTaskId,
          ...(selectedFilter.companyId ? { companyId: selectedFilter.companyId } : {}),
          ...(selectedFilter.ownerType ? { ownerType: selectedFilter.ownerType } : {}),
        })
      : Promise.resolve(null),
    listAccessibleLoopNotificationIntents({
      userId: context.userId,
      ...(selectedFilter.companyId ? { companyId: selectedFilter.companyId } : {}),
      ...(selectedFilter.ownerType ? { ownerType: selectedFilter.ownerType } : {}),
    }),
  ]);
  const readNotificationIds = await getReadWorkbenchNotificationIds({
    userId: context.userId,
    notificationIds: collectWorkbenchNotificationIds({
      currentTask: overview.currentTask,
      timelineEvents: overview.timeline.events,
      documents,
    }),
  });
  const feed = buildWorkbenchNotificationFeed({
    currentTask: overview.currentTask,
    timelineEvents: overview.timeline.events,
    documents,
    loopNotifications,
    readNotificationIds,
  });

  return (
    <WorkbenchShell
      activeKey="notifications"
      title="通知中心"
      subtitle="集中查看当前任务、工作流事件、文档更新和协作提醒，并回到任务执行入口。"
      loginEmail={loginEmail}
      spaceLabel={selectedFilter.label}
      selectedSpaceKey={selectedFilter.key}
      spaceFilters={companyFilters}
      notificationUnreadCount={feed.summary.unreadCount}
      {...getWorkbenchShellLoginProps(session)}
    >
      <div className="grid gap-5">
        <SelectedTaskContextPanel detail={dashboardData?.detail ?? null} />
        <Panel
          title={`站内信概览 · ${selectedFilter.label}`}
          action={<StatusPill tone="blue">{feed.summary.unreadCount} 条未读</StatusPill>}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <KpiCard
              label="未读"
              value={feed.summary.unreadCount}
              caption="当前汇总的站内信"
            />
            <KpiCard
              label="今日"
              value={feed.summary.todayCount}
              caption="今天产生的动态"
            />
            <KpiCard
              label="来源"
              value={4}
              caption="任务 / Loop / 时间线 / 文档"
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {companyFilters.map((filter) => (
              <div
                key={filter.key}
                className={
                  filter.key === selectedFilter.key
                    ? "rounded-md border border-[#0969da] bg-[#ddf4ff] px-3 py-1.5 text-xs font-semibold text-[#0969da]"
                    : "rounded-md border border-[#d0d7de] bg-white px-3 py-1.5 text-xs font-semibold text-[#24292f]"
                }
              >
                {filter.label}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="最近动态">
          <div className="grid gap-3">
            {feed.items.map((notification) => (
              <Link
                key={notification.id}
                href={notification.openHref}
                className="block rounded-lg border border-transparent px-1 py-1 transition hover:bg-[#f6f8fa]"
              >
                <div className="flex items-center gap-3">
                  <StatusPill tone={notification.tone}>
                    {notification.isUnread ? "未读" : "已读"}
                  </StatusPill>
                  <div className="min-w-0 flex-1 truncate text-sm text-[#24292f]">
                    {notification.title} · {notification.description}
                  </div>
                  <span className="shrink-0 text-xs font-medium text-[#8c959f]">
                    {notification.timeLabel}
                  </span>
                </div>
              </Link>
            ))}
            {feed.items.length === 0 ? (
              <EmptyState
                title="通知中心暂时为空"
                description="当前空间还没有新的任务提醒、时间线更新或文档变更。可以先去任务中心查看待推进事项，或到文档中心补齐上下文。"
                action={<WorkbenchButton href="/tasks">打开任务中心</WorkbenchButton>}
              />
            ) : null}
          </div>
        </Panel>

        <Panel title="执行入口">
          <div className="grid gap-2 md:grid-cols-4">
            <WorkbenchButton href="/tasks">任务中心</WorkbenchButton>
            <WorkbenchButton href="/projects">项目空间</WorkbenchButton>
            <WorkbenchButton href="/documents">文档中心</WorkbenchButton>
            <WorkbenchButton href="/team">团队协作</WorkbenchButton>
          </div>
          <div className="mt-4 text-xs leading-5 text-[#57606a]">
            最近更新时间：{formatWorkbenchDateTime(overview.timeline.events.at(-1)?.createdAt)}
          </div>
        </Panel>
      </div>
    </WorkbenchShell>
  );
}
