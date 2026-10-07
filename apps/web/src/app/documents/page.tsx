import { getWorkbenchShellLoginProps } from "../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../lib/workbench/workbench-companies";
import { listWorkbenchDocumentTree } from "../../lib/workbench/workbench-documents";
import { requireWorkbenchSession } from "../../lib/workbench/workbench-route-auth";
import {
  PROJECT_SPACE_SEARCH_PARAM,
  getPreferredWorkbenchSpaceKey,
  getSingleWorkbenchSearchParam,
  selectWorkbenchProjectSpaceFilter,
  WORKBENCH_SPACE_COOKIE,
  type WorkbenchSearchParams,
} from "../../lib/workbench/workbench-space-filters";
import {
  listWorkbenchSpaces,
  selectWorkbenchRootDocumentSpaceId,
} from "../../lib/workbench/workbench-spaces";
import { DocumentWorkspace } from "../components/document-workspace";
import { WorkbenchShell } from "../components/workbench-shell";
import { getProjectListItems } from "../../lib/workbench/workbench-projects";

export const dynamic = "force-dynamic";

export const DOCUMENTS_PAGE_SECTION_TITLES = [
  "文档目录",
  "空间文档",
  "项目文档",
  "回收站",
] as const;

interface DocumentsPageProps {
  searchParams?: Promise<WorkbenchSearchParams>;
}

export default async function DocumentsPage({ searchParams }: DocumentsPageProps) {
  const resolvedSearchParams = await searchParams;
  const { session, cookieStore } = await requireWorkbenchSession("/documents");
  const { context, loginEmail } = session;
  const [companyFilters, spaces] = await Promise.all([
    getWorkbenchCompanyFilters({ userId: context.userId }),
    listWorkbenchSpaces({ userId: context.userId }),
  ]);
  const requestedFilter = selectWorkbenchProjectSpaceFilter(
    companyFilters,
    getPreferredWorkbenchSpaceKey({
      searchParamValue: getSingleWorkbenchSearchParam(
        resolvedSearchParams,
        PROJECT_SPACE_SEARCH_PARAM,
      ),
      cookieValue: cookieStore.get(WORKBENCH_SPACE_COOKIE)?.value,
    }),
  );
  const requestedSpaceId = selectWorkbenchRootDocumentSpaceId(spaces, requestedFilter);
  const selectedSpace = spaces.find((space) => space.id === requestedSpaceId) ?? spaces[0];
  const selectedFilter = selectedSpace?.type === "personal"
    ? companyFilters.find((filter) => filter.key === "personal")
    : companyFilters.find((filter) => filter.companyId === selectedSpace?.companyId);
  const selectedProjectId = getSingleWorkbenchSearchParam(resolvedSearchParams, "project");
  const projects = selectedSpace?.companyId
    ? (await getProjectListItems({ userId: context.userId, companyId: selectedSpace.companyId })).filter((project) => project.spaceId === selectedSpace.id)
    : [];
  const validProjectId = projects.some((project) => project.id === selectedProjectId) ? selectedProjectId : undefined;
  const tree = selectedSpace
    ? await listWorkbenchDocumentTree({ userId: context.userId, spaceId: selectedSpace.id, ...(validProjectId ? { projectId: validProjectId } : {}) })
    : { spaceId: "", groups: [], trash: [] };

  return (
    <WorkbenchShell
      activeKey="documents"
      title="文档中心"
      subtitle="按空间与项目组织 Markdown 文档，目录和正文保持同一工作上下文。"
      contentMode="workspace"
      loginEmail={loginEmail}
      spaceLabel={selectedSpace?.name ?? "暂无空间"}
      selectedSpaceKey={selectedFilter?.key ?? "personal"}
      spaceFilters={companyFilters}
      {...getWorkbenchShellLoginProps(session)}
    >
      <DocumentWorkspace tree={tree} projects={projects.map((project) => ({ id: project.id, name: project.name }))} {...(validProjectId ? { selectedProjectId: validProjectId } : {})} />
    </WorkbenchShell>
  );
}
