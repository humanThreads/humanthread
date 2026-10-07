import { getWorkbenchOverview } from "../../lib/workbench/workbench-overview";
import { getWorkbenchDashboardData } from "../../lib/workbench/workbench-dashboard";
import { getWorkbenchCompanyFilters } from "../../lib/workbench/workbench-companies";
import { getWorkbenchShellLoginProps } from "../../lib/workbench/workbench-avatar";
import { requireWorkbenchSession } from "../../lib/workbench/workbench-route-auth";
import {
  PROJECT_SPACE_SEARCH_PARAM,
  buildWorkbenchSpaceHref,
  getPreferredWorkbenchSpaceKey,
  getSingleWorkbenchSearchParam,
  getWorkbenchSelectedSpaceFilter,
  selectWorkbenchProjectSpaceFilter,
  WORKBENCH_SPACE_COOKIE,
  type WorkbenchSearchParams,
} from "../../lib/workbench/workbench-space-filters";
import { setWorkbenchSpaceAction } from "../workbench/actions";
import { WorkbenchShell } from "../components/workbench-shell";
import {
  SelectedTaskContextPanel,
  formatWorkbenchDateTime,
  TeamSnapshotPanel,
  TimelinePanel,
} from "../components/workbench-sections";
import {
  EmptyState,
  KpiCard,
  Panel,
  StatusPill,
  WorkbenchButton,
} from "../components/workbench-ui";

export const dynamic = "force-dynamic";

export const TEAM_PAGE_SECTION_TITLES = [
  "当前关注任务",
  "成员线程",
  "阻塞与中断",
  "团队概览",
] as const;

interface TeamPageProps {
  searchParams?: Promise<WorkbenchSearchParams>;
}

export default async function TeamPage({ searchParams }: TeamPageProps) {
  const resolvedSearchParams = await searchParams;
  const { session, cookieStore } = await requireWorkbenchSession("/team");
  const { context, loginEmail } = session;
  const companyFilters = await getWorkbenchCompanyFilters({
    userId: context.userId,
  });
  const selectedFilter = selectWorkbenchProjectSpaceFilter(
    companyFilters,
    getPreferredWorkbenchSpaceKey({
      searchParamValue: getSingleWorkbenchSearchParam(
        resolvedSearchParams,
        PROJECT_SPACE_SEARCH_PARAM,
      ),
      cookieValue: cookieStore.get(WORKBENCH_SPACE_COOKIE)?.value,
    }),
  );
  const selectedSpaceFilter = getWorkbenchSelectedSpaceFilter({
    filters: companyFilters,
    searchParamValue: getSingleWorkbenchSearchParam(
      resolvedSearchParams,
      PROJECT_SPACE_SEARCH_PARAM,
    ),
    cookieValue: cookieStore.get(WORKBENCH_SPACE_COOKIE)?.value,
  });
  const data = await getWorkbenchOverview({
    teamId: context.teamId,
    userId: context.userId,
    ...(selectedFilter.companyId ? { companyId: selectedFilter.companyId } : {}),
    ...(selectedFilter.ownerType ? { ownerType: selectedFilter.ownerType } : {}),
  });
  const selectedTaskId =
    getSingleWorkbenchSearchParam(resolvedSearchParams, "taskId") ?? null;
  const taskContext = selectedTaskId
    ? await getWorkbenchDashboardData({
        teamId: context.teamId,
        userId: context.userId,
        selectedTaskId,
        ...(selectedFilter.companyId ? { companyId: selectedFilter.companyId } : {}),
        ...(selectedFilter.ownerType ? { ownerType: selectedFilter.ownerType } : {}),
      })
    : null;
  const busyMembers = data.members.filter((member) => member.currentTask);
  const idleMembers = data.members.filter((member) => !member.currentTask);

  return (
    <WorkbenchShell
      activeKey="team"
      title="团队协作"
      subtitle="查看每个人类线程的占用、队列和最近交接。"
      loginEmail={loginEmail}
      spaceLabel={selectedSpaceFilter.label}
      selectedSpaceKey={selectedSpaceFilter.key}
      spaceFilters={companyFilters}
      {...getWorkbenchShellLoginProps(session)}
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.95fr)]">
        <div className="grid content-start gap-5">
          <SelectedTaskContextPanel detail={taskContext?.detail ?? null} />
          <Panel
            title={`成员线程 · ${selectedFilter.label}`}
            action={
              <div className="flex flex-wrap gap-2">
                {companyFilters.map((filter) => (
                  <form key={filter.key} action={setWorkbenchSpaceAction}>
                    <input type="hidden" name="spaceKey" value={filter.key} />
                    <button
                      type="submit"
                      className={
                        filter.key === selectedFilter.key
                          ? "rounded-md border border-[#0969da] bg-[#ddf4ff] px-3 py-1.5 text-xs font-semibold text-[#0969da]"
                          : "rounded-md border border-[#d0d7de] bg-white px-3 py-1.5 text-xs font-semibold text-[#24292f] hover:bg-[#f3f4f6]"
                      }
                    >
                      {filter.label}
                    </button>
                  </form>
                ))}
                <noscript>
                  {companyFilters.map((filter) => (
                    <a key={filter.key} href={buildWorkbenchSpaceHref("/team", filter)}>
                      {filter.label}
                    </a>
                  ))}
                </noscript>
              </div>
            }
          >
            <div className="divide-y divide-[#d8dee4]">
              {data.members.map((member) => (
                <div key={member.user.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#24292f]">
                        {member.user.name}
                      </div>
                      <div className="mt-1 text-xs text-[#57606a]">
                        {member.user.status} · 队列 {member.queueLength}
                      </div>
                    </div>
                    <StatusPill tone={member.currentTask ? "blue" : "default"}>
                      {member.currentTask ? "处理中" : "空闲"}
                    </StatusPill>
                  </div>
                  <div className="mt-3 rounded-md border border-[#d0d7de] bg-[#f6f8fa] p-3 text-sm text-[#57606a]">
                    {member.currentTask
                      ? `${member.currentTask.workflow.title} · ${member.currentTask.task.title}`
                      : "当前空闲"}
                  </div>
                  <div className="mt-2 text-xs text-[#57606a]">
                    最近活跃：{formatWorkbenchDateTime(member.user.lastSeenAt)}
                  </div>
                </div>
              ))}
              {data.members.length === 0 ? (
                <EmptyState
                  title="暂无成员线程"
                  description="当前空间还没有可展示的成员任务。"
                />
              ) : null}
            </div>
          </Panel>

          <Panel title="阻塞与中断">
            <div className="space-y-3 text-sm leading-6 text-[#57606a]">
              <div>当前 MVP 先从成员当前任务和时间线判断阻塞状态；后续再补专门的阻塞列表。</div>
              <div className="flex flex-wrap gap-2">
                <WorkbenchButton href="/tasks?filter=blocked" size="small">
                  查看阻塞任务
                </WorkbenchButton>
                <WorkbenchButton href="/notifications" size="small" variant="ghost">
                  打开通知中心
                </WorkbenchButton>
              </div>
            </div>
          </Panel>
        </div>

        <div className="grid content-start gap-5">
          <Panel title="团队概览">
            <div className="grid grid-cols-2 gap-3">
              <KpiCard label="处理中" value={busyMembers.length} caption="有当前任务" />
              <KpiCard label="空闲" value={idleMembers.length} caption="暂无当前任务" />
            </div>
          </Panel>
          <TeamSnapshotPanel
            members={data.members}
            selectedUserId={context.userId}
            allowUserSwitch={!loginEmail}
          />
          <TimelinePanel events={data.timeline.events} />
        </div>
      </div>
    </WorkbenchShell>
  );
}
