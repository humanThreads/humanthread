import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";
import { getWorkbenchShellLoginProps } from "../../../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../../../lib/workbench/workbench-companies";
import { getProjectMemberView } from "../../../../lib/workbench/workbench-project-members";
import { requireWorkbenchSession } from "../../../../lib/workbench/workbench-route-auth";
import { getWorkbenchSelectedSpaceFilter } from "../../../../lib/workbench/workbench-space-filters";
import { WorkbenchShell } from "../../../components/workbench-shell";
import { formatWorkbenchDateTime } from "../../../components/workbench-sections";
import { EmptyState, Panel, StatusPill } from "../../../components/workbench-ui";

export const dynamic = "force-dynamic";
export const PROJECT_MEMBER_PAGE_TITLE = "项目成员";

const ROLE_LABELS: Record<string, string> = {
  owner: "负责人",
  manager: "项目经理",
  maintainer: "维护者",
  member: "成员",
  viewer: "只读成员",
};

export default async function ProjectMemberPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { session } = await requireWorkbenchSession(`/projects/${projectId}/members`);
  const [view, filters] = await Promise.all([
    getProjectMemberView({ projectId, userId: session.context.userId }),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
  ]);
  if (!view) notFound();
  const selected = getWorkbenchSelectedSpaceFilter({ filters });

  return <WorkbenchShell
    activeKey="projects"
    title={`${view.project.name} · ${PROJECT_MEMBER_PAGE_TITLE}`}
    subtitle="当前有效的项目成员关系"
    loginEmail={session.loginEmail}
    spaceLabel={selected.label}
    selectedSpaceKey={selected.key}
    spaceFilters={filters}
    {...getWorkbenchShellLoginProps(session)}
  >
    <main className="h-full overflow-y-auto bg-[#f6f8fa] p-5">
      <div className="mx-auto grid max-w-5xl gap-4">
        <Link className="inline-flex w-fit items-center gap-2 text-sm font-medium text-[#0969da] hover:underline" href={`/projects/${projectId}`}><ArrowLeft size={16} />返回项目</Link>
        <Panel title={PROJECT_MEMBER_PAGE_TITLE} action={<span className="inline-flex items-center gap-2 text-xs text-[#57606a]"><Users size={14} />{view.members.length} 人</span>}>
          {view.members.length === 0 ? <EmptyState title="暂无项目成员" description="当前项目没有有效的成员关系。" /> : <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead><tr className="border-b border-[#d8dee4] text-left text-[#57606a]"><th className="pb-2 pr-4 font-semibold">成员</th><th className="pb-2 pr-4 font-semibold">邮箱</th><th className="pb-2 pr-4 font-semibold">项目角色</th><th className="pb-2 pr-4 font-semibold">加入时间</th><th className="pb-2 font-semibold">最近活跃</th></tr></thead>
              <tbody>{view.members.map((member) => <tr key={member.id} className="border-b border-[#d8dee4] last:border-b-0"><td className="py-3 pr-4 font-semibold text-[#24292f]">{member.user.name}</td><td className="py-3 pr-4 text-[#57606a]">{member.user.email ?? "未绑定"}</td><td className="py-3 pr-4"><StatusPill tone={member.role === "viewer" ? "default" : "blue"}>{ROLE_LABELS[member.role] ?? member.role}</StatusPill></td><td className="py-3 pr-4 text-[#57606a]">{formatWorkbenchDateTime(member.joinedAt)}</td><td className="py-3 text-[#57606a]">{formatWorkbenchDateTime(member.user.lastSeenAt)}</td></tr>)}</tbody>
            </table>
          </div>}
        </Panel>
      </div>
    </main>
  </WorkbenchShell>;
}
