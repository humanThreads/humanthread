import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getWorkbenchShellLoginProps } from "../../../../lib/workbench/workbench-avatar";
import { getProjectActivityView } from "../../../../lib/workbench/workbench-project-activity";
import { getWorkbenchCompanyFilters } from "../../../../lib/workbench/workbench-companies";
import { requireWorkbenchSession } from "../../../../lib/workbench/workbench-route-auth";
import { getWorkbenchSelectedSpaceFilter } from "../../../../lib/workbench/workbench-space-filters";
import { ProjectDecisionActivity } from "../../../components/projects/project-decision-activity";
import { WorkbenchShell } from "../../../components/workbench-shell";

export const dynamic = "force-dynamic";
export const PROJECT_ACTIVITY_PAGE_TITLE = "决策与活动";

export default async function ProjectActivityPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { session } = await requireWorkbenchSession(`/projects/${projectId}/activity`);
  const [view, filters] = await Promise.all([getProjectActivityView({ projectId, userId: session.context.userId }), getWorkbenchCompanyFilters({ userId: session.context.userId })]);
  if (!view) notFound();
  const selected = getWorkbenchSelectedSpaceFilter({ filters });
  return <WorkbenchShell activeKey="projects" title={`${view.project.name} · ${PROJECT_ACTIVITY_PAGE_TITLE}`} subtitle="项目决策审计与执行动态" loginEmail={session.loginEmail} spaceLabel={selected.label} selectedSpaceKey={selected.key} spaceFilters={filters} {...getWorkbenchShellLoginProps(session)}>
    <main className="h-full overflow-y-auto bg-[#f6f8fa] p-5"><div className="mx-auto grid max-w-5xl gap-4"><Link className="inline-flex w-fit items-center gap-2 text-sm font-medium text-[#0969da] hover:underline" href={`/projects/${projectId}`}><ArrowLeft size={16} />返回项目</Link><ProjectDecisionActivity view={view} /></div></main>
  </WorkbenchShell>;
}
