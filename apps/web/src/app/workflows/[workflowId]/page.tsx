import { notFound } from "next/navigation";
import { getWorkflowTimeline } from "../../../lib/overviews/task-overviews";
import { getWorkbenchShellLoginProps } from "../../../lib/workbench/workbench-avatar";
import { getWorkbenchWorkflowDetail } from "../../../lib/workbench/workbench-workflow-detail";
import { requireWorkbenchSession } from "../../../lib/workbench/workbench-route-auth";
import { getWorkbenchCompanyFilters } from "../../../lib/workbench/workbench-companies";
import {
  PROJECT_SPACE_SEARCH_PARAM,
  getSingleWorkbenchSearchParam,
  getWorkbenchSelectedSpaceFilter,
  WORKBENCH_SPACE_COOKIE,
  type WorkbenchSearchParams,
} from "../../../lib/workbench/workbench-space-filters";
import { WorkbenchShell } from "../../components/workbench-shell";
import {
  formatWorkbenchDateTime,
  TimelinePanel,
} from "../../components/workbench-sections";
import {
  EmptyState,
  KpiCard,
  Panel,
  StatusPill,
  WorkbenchButton,
} from "../../components/workbench-ui";

export const dynamic = "force-dynamic";

export const WORKFLOW_DETAIL_SECTION_TITLES = [
  "工作流状态",
  "任务链",
  "工作流时间线",
  "项目上下文",
] as const;

interface WorkflowPageProps {
  params: Promise<{
    workflowId: string;
  }>;
  searchParams?: Promise<WorkbenchSearchParams>;
}

function statusTone(
  status: string,
): "default" | "success" | "danger" | "warning" | "blue" {
  if (status === "completed") {
    return "success";
  }

  if (status === "blocked" || status === "interrupted") {
    return "danger";
  }

  if (status === "pending") {
    return "warning";
  }

  if (status === "active" || status === "running") {
    return "blue";
  }

  return "default";
}

export default async function WorkflowPage({
  params,
  searchParams,
}: WorkflowPageProps) {
  const resolvedSearchParams = await searchParams;
  const { workflowId } = await params;
  const { session, cookieStore } = await requireWorkbenchSession(`/workflows/${workflowId}`);
  const companyFilters = await getWorkbenchCompanyFilters({
    userId: session.context.userId,
  });
  const [detail, timeline] = await Promise.all([
    getWorkbenchWorkflowDetail({
      workflowId,
    }),
    getWorkflowTimeline({
      workflowId,
    }),
  ]);

  if (!detail) {
    notFound();
  }
  const selectedSpaceFilter = getWorkbenchSelectedSpaceFilter({
    filters: companyFilters,
    searchParamValue: getSingleWorkbenchSearchParam(
      resolvedSearchParams,
      PROJECT_SPACE_SEARCH_PARAM,
    ),
    cookieValue: cookieStore.get(WORKBENCH_SPACE_COOKIE)?.value,
  });

  return (
    <WorkbenchShell
      activeKey="projects"
      title={detail.title}
      subtitle={`${detail.project.name} · ${detail.matterType.name} · ${detail.currentStepKey}`}
      loginEmail={session.loginEmail}
      spaceLabel={selectedSpaceFilter.label}
      selectedSpaceKey={selectedSpaceFilter.key}
      spaceFilters={companyFilters}
      {...getWorkbenchShellLoginProps(session)}
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)]">
        <div className="grid content-start gap-5">
          <Panel
            title="工作流状态"
            action={<StatusPill tone={statusTone(detail.status)}>{detail.status}</StatusPill>}
          >
            <div className="grid gap-3 md:grid-cols-3">
              <KpiCard label="状态" value={detail.status} caption="当前工作流状态" />
              <KpiCard
                label="当前步骤"
                value={detail.currentStepKey}
                caption={detail.matterType.name}
              />
              <KpiCard
                label="更新时间"
                value={formatWorkbenchDateTime(detail.updatedAt)}
                caption={`创建于 ${formatWorkbenchDateTime(detail.createdAt)}`}
              />
            </div>
            {detail.description ? (
              <div className="border-t border-[#d8dee4] px-4 py-3 text-sm leading-6 text-[#57606a]">
                {detail.description}
              </div>
            ) : null}
          </Panel>

          <Panel title="任务链">
            <div className="divide-y divide-[#d8dee4]">
              {detail.tasks.map((task) => (
                <div key={task.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#24292f]">
                        {task.title}
                      </div>
                      <div className="mt-1 text-xs text-[#57606a]">
                        {task.stepTemplateId} · {task.assignee?.name ?? "未指派"}
                      </div>
                    </div>
                    <StatusPill tone={statusTone(task.status)}>
                      {task.status}
                    </StatusPill>
                  </div>
                  <div className="mt-2 text-xs text-[#57606a]">
                    队列 #{task.queuePosition} · 更新于 {formatWorkbenchDateTime(task.updatedAt)}
                  </div>
                </div>
              ))}
              {detail.tasks.length === 0 ? (
                <EmptyState
                  title="暂无任务链"
                  description="当前工作流还没有关联任务。"
                />
              ) : null}
            </div>
          </Panel>
        </div>

        <div className="grid content-start gap-5">
          <TimelinePanel events={timeline.events} />
          <Panel
            title="项目上下文"
            action={
              <WorkbenchButton href={`/projects/${detail.project.id}`} size="small">
                返回项目
              </WorkbenchButton>
            }
          >
            <div className="space-y-3 text-sm text-[#57606a]">
              <div>项目：{detail.project.name}</div>
              <div>本地目录：{detail.project.localPath ?? "未配置"}</div>
              <div>默认命令：{detail.project.defaultCommand ?? "未配置"}</div>
            </div>
          </Panel>
        </div>
      </div>
    </WorkbenchShell>
  );
}
