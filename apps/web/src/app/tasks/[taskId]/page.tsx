import { notFound } from "next/navigation";
import { listTaskAgentProfiles } from "../../../lib/orchestration/agent-read-model";
import { getTaskDetailView } from "../../../lib/tasks/task-read-model";
import { listTaskLabelDefinitions } from "../../../lib/tasks/task-settings";
import { getWorkbenchShellLoginProps } from "../../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../../lib/workbench/workbench-companies";
import { getWorkbenchProjects } from "../../../lib/workbench/workbench-projects";
import { requireWorkbenchSession } from "../../../lib/workbench/workbench-route-auth";
import { getWorkbenchCompanyMembers } from "../../../lib/workbench/workbench-settings";
import { TaskDetail } from "../../components/tasks/task-detail";
import { WorkbenchShell } from "../../components/workbench-shell";

export const dynamic = "force-dynamic";
export const TASK_DETAIL_SECTION_TITLES = ["任务字段", "正文", "协作", "关联", "Loop"] as const;

export default async function TaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const taskId = decodeURIComponent((await params).taskId);
  const { session } = await requireWorkbenchSession(`/tasks/${taskId}`);
  const [filters, detail] = await Promise.all([
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
    getTaskDetailView({ userId: session.context.userId, taskId, includeArchived: true }),
  ]);
  if (!detail?.task.space?.id) notFound();
  const spaceId = detail.task.space.id;
  const selected = filters.find((filter) => filter.spaceId === spaceId);
  const [companyMembers, projects, labels, agentProfiles] = await Promise.all([
    selected?.companyId ? getWorkbenchCompanyMembers({ userId: session.context.userId, companyId: selected.companyId }) : Promise.resolve({ company: null, members: [] }),
    getWorkbenchProjects({ userId: session.context.userId, ...(selected?.companyId ? { companyId: selected.companyId } : {}), ...(selected?.ownerType ? { ownerType: selected.ownerType } : {}) }),
    listTaskLabelDefinitions({ userId: session.context.userId, spaceId }),
    listTaskAgentProfiles({ userId: session.context.userId, taskId }),
  ]);
  const members = selected?.ownerType === "company"
    ? companyMembers.members.map((member) => ({ id: member.user.id, name: member.user.name }))
    : [{ id: session.context.userId, name: session.account.name }];
  return <WorkbenchShell activeKey="tasks" title={detail.task.title} subtitle="任务详情" contentMode="workspace" loginEmail={session.loginEmail} spaceLabel={selected?.label ?? "任务空间"} selectedSpaceKey={selected?.key ?? "all"} spaceFilters={filters} {...getWorkbenchShellLoginProps(session)}>
    <TaskDetail detail={detail as never} layout="page" queryString="" members={members} projects={projects.map((project) => ({ id: project.id, name: project.name }))} labels={labels as never[]} agentProfiles={agentProfiles} />
  </WorkbenchShell>;
}
