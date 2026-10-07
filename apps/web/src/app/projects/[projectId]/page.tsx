import { notFound, redirect } from "next/navigation";
import { getTaskCollection } from "../../../lib/tasks/task-read-model";
import { parseTaskQuery } from "../../../lib/tasks/task-query";
import { getWorkbenchCompanyFilters } from "../../../lib/workbench/workbench-companies";
import { getWorkbenchShellLoginProps } from "../../../lib/workbench/workbench-avatar";
import { listProjectDocuments } from "../../../lib/workbench/workbench-documents";
import { countProjectActivityFacts } from "../../../lib/workbench/workbench-project-activity";
import { getProjectHubView, getWorkbenchProjects } from "../../../lib/workbench/workbench-projects";
import { requireWorkbenchSession } from "../../../lib/workbench/workbench-route-auth";
import { PROJECT_SPACE_SEARCH_PARAM, getSingleWorkbenchSearchParam, getWorkbenchSelectedSpaceFilter, WORKBENCH_SPACE_COOKIE, type WorkbenchSearchParams } from "../../../lib/workbench/workbench-space-filters";
import { ProjectHealthSummary } from "../../components/projects/project-health-summary";
import { ProjectHubHeader } from "../../components/projects/project-hub-header";
import { ProjectResourcePanel } from "../../components/projects/project-resource-panel";
import { ProjectRoadmap } from "../../components/projects/project-roadmap";
import { ProjectRoadmapEditor } from "../../components/projects/project-roadmap-editor";
import { WorkbenchShell } from "../../components/workbench-shell";

export const dynamic = "force-dynamic";
export const PROJECT_DETAIL_CONTENT_MODE = "workspace" as const;
export const PROJECT_DETAIL_SECTION_TITLES = ["项目目标", "交付阶段", "里程碑", "任务队列", "项目资源"] as const;
export function resolveLegacyProjectSettingsHref(projectId: string, searchParams: Record<string, string | string[] | undefined>): string | null {
  const tab = typeof searchParams.tab === "string" ? searchParams.tab : undefined;
  if (tab === "loops") return `/projects/${encodeURIComponent(projectId)}/settings?tab=loops`;
  if (tab === "settings" || searchParams.settings === "1") return `/projects/${encodeURIComponent(projectId)}/settings?tab=overview`;
  return null;
}

export default async function ProjectDetailPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams?: Promise<WorkbenchSearchParams> }) {
  const raw = await searchParams ?? {};
  const { projectId } = await params;
  const legacySettingsHref = resolveLegacyProjectSettingsHref(projectId, raw);
  if (legacySettingsHref) redirect(legacySettingsHref);
  const { session, cookieStore } = await requireWorkbenchSession(`/projects/${projectId}`);
  const filters = await getWorkbenchCompanyFilters({ userId: session.context.userId });
  const selected = getWorkbenchSelectedSpaceFilter({ filters, searchParamValue: getSingleWorkbenchSearchParam(raw, PROJECT_SPACE_SEARCH_PARAM), cookieValue: cookieStore.get(WORKBENCH_SPACE_COOKIE)?.value });
  const view = await getProjectHubView({ projectId, userId: session.context.userId });
  if (!view) notFound();
  const query = parseTaskQuery({ ...raw, project: [projectId], view: "list" });
  const [collection, documents, quickCreateProjects, activityCount] = await Promise.all([
    getTaskCollection({ userId: session.context.userId, ...(view.project.spaceId ? { spaceId: view.project.spaceId } : {}), query, timeZone: "Asia/Shanghai" }),
    listProjectDocuments({ projectId, userId: session.context.userId }),
    getWorkbenchProjects({ userId: session.context.userId }),
    countProjectActivityFacts(projectId),
  ]);
  const resourceView = { ...view, resources: { ...view.resources, documents: documents.length, activities: activityCount } };

  return <WorkbenchShell activeKey="projects" title={view.project.name} subtitle="项目交付路线图" contentMode={PROJECT_DETAIL_CONTENT_MODE} loginEmail={session.loginEmail} spaceLabel={selected.label} selectedSpaceKey={selected.key} spaceFilters={filters} quickCreateProjects={quickCreateProjects} {...getWorkbenchShellLoginProps(session)}>
    <div className="h-full min-h-0 overflow-y-auto bg-[#f6f8fa]"><ProjectHubHeader project={view.project} /><main className="grid gap-5 p-5"><ProjectHealthSummary view={resourceView} />{view.project.capabilities.manageRoadmap ? <ProjectRoadmapEditor projectId={projectId} projectVersion={view.project.version} roadmap={view.roadmap} projectTasks={collection.listRows} /> : <ProjectRoadmap projectId={projectId} roadmap={view.roadmap} projectTasks={collection.listRows} />}<ProjectResourcePanel projectId={projectId} resources={resourceView.resources} /></main></div>
  </WorkbenchShell>;
}
