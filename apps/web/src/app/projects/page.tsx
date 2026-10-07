import { getWorkbenchProjects, getProjectListItems, type ProjectHealth } from "../../lib/workbench/workbench-projects";
import { getWorkbenchCompanyFilters } from "../../lib/workbench/workbench-companies";
import { getWorkbenchShellLoginProps } from "../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyMembers } from "../../lib/workbench/workbench-settings";
import { requireWorkbenchSession } from "../../lib/workbench/workbench-route-auth";
import {
  PROJECT_SPACE_SEARCH_PARAM,
  getPreferredWorkbenchSpaceKey,
  getSingleWorkbenchSearchParam,
  getWorkbenchSelectedSpaceFilter,
  selectWorkbenchProjectSpaceFilter,
  WORKBENCH_SPACE_COOKIE,
  type WorkbenchSearchParams,
} from "../../lib/workbench/workbench-space-filters";
import { WorkbenchShell } from "../components/workbench-shell";
import { ProjectCenter } from "../components/projects/project-center";

export const dynamic = "force-dynamic";
export const PROJECTS_CONTENT_MODE = "workspace" as const;

export const PROJECTS_PAGE_SECTION_TITLES = [
  "项目列表",
  "项目概览",
  "项目入口",
] as const;

interface ProjectsPageProps {
  searchParams?: Promise<WorkbenchSearchParams>;
}

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const resolvedSearchParams = await searchParams;
  const { session, cookieStore } = await requireWorkbenchSession("/projects");
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
  const rawSearch = getSingleWorkbenchSearchParam(resolvedSearchParams, "search") ?? "";
  const status = getSingleWorkbenchSearchParam(resolvedSearchParams, "status") ?? "";
  const health = getSingleWorkbenchSearchParam(resolvedSearchParams, "health") ?? "";
  const createOpen = getSingleWorkbenchSearchParam(resolvedSearchParams, "create") === "1";
  const writableSpaces = companyFilters.filter((filter) => filter.spaceId && filter.ownerType && filter.role !== "viewer");
  const [projects, quickCreateProjects, companyMemberCollections] = await Promise.all([
    getProjectListItems({
      userId: context.userId,
      ...(selectedFilter.companyId ? { companyId: selectedFilter.companyId } : {}),
      ...(selectedFilter.ownerType ? { ownerType: selectedFilter.ownerType } : {}),
      search: rawSearch,
      status,
      health: health as ProjectHealth,
    }),
    getWorkbenchProjects({
      userId: context.userId,
      ...(selectedFilter.companyId ? { companyId: selectedFilter.companyId } : {}),
      ...(selectedFilter.ownerType ? { ownerType: selectedFilter.ownerType } : {}),
    }),
    Promise.all(writableSpaces.flatMap((space) => space.companyId ? [getWorkbenchCompanyMembers({ userId: context.userId, companyId: space.companyId })] : [])),
  ]);
  const projectSpaces = writableSpaces.map((space) => ({ id: space.spaceId!, name: space.label, type: space.ownerType! }));
  const personalManagers = writableSpaces.flatMap((space) => space.ownerType === "personal" ? [{ id: context.userId, name: session.account.name, spaceId: space.spaceId! }] : []);
  const companyManagers = writableSpaces.flatMap((space) => {
    if (!space.companyId) return [];
    const collection = companyMemberCollections.find((candidate) => candidate.company?.id === space.companyId);
    return (collection?.members ?? []).map((member) => ({ id: member.user.id, name: member.user.name, spaceId: space.spaceId! }));
  });

  return (
    <WorkbenchShell
      activeKey="projects"
      title="项目空间"
      subtitle="围绕目标、阶段和里程碑推进交付，任务在统一任务中心执行。"
      contentMode={PROJECTS_CONTENT_MODE}
      loginEmail={loginEmail}
      spaceLabel={selectedSpaceFilter.label}
      selectedSpaceKey={selectedSpaceFilter.key}
      spaceFilters={companyFilters}
      quickCreateProjects={quickCreateProjects}
      {...getWorkbenchShellLoginProps(session)}
    >
      <div className="h-full min-h-0 overflow-y-auto bg-[#f6f8fa] p-5"><ProjectCenter projects={projects} spaceLabel={selectedFilter.label} search={rawSearch} status={status} health={health} spaces={projectSpaces} managers={[...personalManagers, ...companyManagers]} {...(selectedSpaceFilter.spaceId ? { initialSpaceId: selectedSpaceFilter.spaceId } : {})} initialCreateOpen={createOpen} /></div>
    </WorkbenchShell>
  );
}
