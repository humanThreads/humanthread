import { getTaskCollection, getTaskDetailView, listTaskSavedViews } from "../../lib/tasks/task-read-model";
import { parseTaskQuery } from "../../lib/tasks/task-query";
import { listTaskLabelDefinitions, listTaskStatusDefinitions } from "../../lib/tasks/task-settings";
import { getWorkbenchShellLoginProps } from "../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../lib/workbench/workbench-companies";
import { getWorkbenchProjects } from "../../lib/workbench/workbench-projects";
import { requireWorkbenchSession } from "../../lib/workbench/workbench-route-auth";
import { getWorkbenchCompanyMembers } from "../../lib/workbench/workbench-settings";
import { listTaskAgentProfiles } from "../../lib/orchestration/agent-read-model";
import { WORKBENCH_SPACE_COOKIE, getSingleWorkbenchSearchParam, getWorkbenchSelectedSpaceFilter, type WorkbenchSearchParams } from "../../lib/workbench/workbench-space-filters";
import { TaskCenter } from "../components/tasks/task-center";
import { WorkbenchShell } from "../components/workbench-shell";
import { getUserTaskRollout } from "../../lib/tasks/task-rollout";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const TASK_CENTER_SECTION_TITLES = ["关系视图", "筛选与排序", "任务列表", "批量操作", "保存视图", "空间设置"] as const;
export const TASK_CENTER_SUMMARY_TITLES = ["分配给我", "我创建的", "我参与的", "我关注的"] as const;
export const TASK_CENTER_SAVED_VIEW_LABELS = ["我的待办", "本周到期", "待验收", "已阻塞", "已完成"] as const;
export const TASK_CENTER_TABLE_COLUMNS = ["任务", "状态", "负责人", "优先级", "截止时间", "项目", "子任务"] as const;

export default async function TaskCenterPage({ searchParams }: { searchParams?: Promise<WorkbenchSearchParams> } = {}) {
  if (!getUserTaskRollout().reads) redirect("/dashboard");
  const raw = await searchParams ?? {};
  const { session, cookieStore } = await requireWorkbenchSession("/tasks");
  const filters = await getWorkbenchCompanyFilters({ userId: session.context.userId });
  const selected = getWorkbenchSelectedSpaceFilter({ filters, searchParamValue: getSingleWorkbenchSearchParam(raw, "spaceKey"), cookieValue: cookieStore.get(WORKBENCH_SPACE_COOKIE)?.value });
  const query = parseTaskQuery(raw);
  const page = Math.max(Number(getSingleWorkbenchSearchParam(raw, "page") ?? "1") || 1, 1);
  const spaceId = selected.spaceId ?? undefined;
  const [collection, savedViews, projects, companyMembers, selectedDetail] = await Promise.all([
    getTaskCollection({ userId: session.context.userId, ...(spaceId ? { spaceId } : {}), query, timeZone: "Asia/Shanghai", page, pageSize: 50 }),
    listTaskSavedViews({ userId: session.context.userId }),
    getWorkbenchProjects({ userId: session.context.userId, ...(selected.companyId ? { companyId: selected.companyId } : {}), ...(selected.ownerType ? { ownerType: selected.ownerType } : {}) }),
    selected.companyId ? getWorkbenchCompanyMembers({ userId: session.context.userId, companyId: selected.companyId }) : Promise.resolve({ company: null, members: [] }),
    query.taskId ? getTaskDetailView({ userId: session.context.userId, taskId: query.taskId, includeArchived: query.relation === "archived" }) : Promise.resolve(null),
  ]);
  const canManageSettings = selected.ownerType === "personal"
    ? selected.role === "owner"
    : selected.ownerType === "company" && ["owner", "admin"].includes(selected.role ?? "");
  const [statusDefinitions, labels] = await Promise.all([
    spaceId && canManageSettings ? listTaskStatusDefinitions({ userId: session.context.userId, spaceId }) : Promise.resolve([]),
    spaceId ? listTaskLabelDefinitions({ userId: session.context.userId, spaceId }) : Promise.resolve([]),
  ]);
  const queryString = new URLSearchParams(Object.entries(raw).flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => [key, item]) : value ? [[key, value]] : [])).toString();
  const members = selected.ownerType === "company"
    ? companyMembers.members.map((member) => ({ id: member.user.id, name: member.user.name }))
    : [{ id: session.context.userId, name: session.account.name }];
  const detailSpaceId = selectedDetail?.task.space?.id ?? null;
  const detailFilter = filters.find((filter) => filter.spaceId === detailSpaceId);
  const [detailCompanyMembers, detailProjects, detailLabels, agentProfiles] = selectedDetail && detailSpaceId ? await Promise.all([
    detailFilter?.companyId ? getWorkbenchCompanyMembers({ userId: session.context.userId, companyId: detailFilter.companyId }) : Promise.resolve({ company: null, members: [] }),
    getWorkbenchProjects({ userId: session.context.userId, ...(detailFilter?.companyId ? { companyId: detailFilter.companyId } : {}), ...(detailFilter?.ownerType ? { ownerType: detailFilter.ownerType } : {}) }),
    listTaskLabelDefinitions({ userId: session.context.userId, spaceId: detailSpaceId }),
    listTaskAgentProfiles({ userId: session.context.userId, taskId: selectedDetail.task.id }),
  ]) : [{ company: null, members: [] }, [], [], []];
  const detailMembers = detailFilter?.ownerType === "company"
    ? detailCompanyMembers.members.map((member) => ({ id: member.user.id, name: member.user.name }))
    : [{ id: session.context.userId, name: session.account.name }];
  return <WorkbenchShell activeKey="tasks" title="任务" subtitle="任务" contentMode="workspace" loginEmail={session.loginEmail} spaceLabel={selected.label} selectedSpaceKey={selected.key} spaceFilters={filters} quickCreateProjects={projects} {...(spaceId ? { quickCreateInitialSpaceId: spaceId } : {})} {...getWorkbenchShellLoginProps(session)}>
    <TaskCenter collection={collection} query={query} queryString={queryString} {...(spaceId ? { spaceId } : {})} canManageSettings={canManageSettings} savedViews={savedViews as Array<{ id: string; name: string; filters?: unknown }>} statusDefinitions={statusDefinitions as never[]} labels={labels as never[]} projects={projects.map((project) => ({ id: project.id, name: project.name }))} members={members} selectedDetail={selectedDetail as never} detailMembers={detailMembers} detailProjects={detailProjects.map((project) => ({ id: project.id, name: project.name }))} detailLabels={detailLabels as never[]} agentProfiles={agentProfiles} />
  </WorkbenchShell>;
}
