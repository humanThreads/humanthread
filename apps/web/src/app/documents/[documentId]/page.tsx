import { notFound } from "next/navigation";
import { getWorkbenchShellLoginProps } from "../../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../../lib/workbench/workbench-companies";
import {
  getWorkbenchDocument,
  listWorkbenchDocumentRevisions,
  listWorkbenchDocumentTree,
} from "../../../lib/workbench/workbench-documents";
import { requireWorkbenchSession } from "../../../lib/workbench/workbench-route-auth";
import { listWorkbenchSpaces } from "../../../lib/workbench/workbench-spaces";
import { getProjectListItems } from "../../../lib/workbench/workbench-projects";
import { DocumentWorkspace } from "../../components/document-workspace";
import { WorkbenchShell } from "../../components/workbench-shell";

export const dynamic = "force-dynamic";
export const DOCUMENT_ACCESS_DENIED_MESSAGE = "当前账号无权限查看此文档。请联系文档所属项目或文件夹管理员。";

export const DOCUMENT_ROOT_DETAIL_SECTION_TITLES = [
  "文档目录",
  "Markdown 正文",
  "修订记录",
] as const;

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  const { session } = await requireWorkbenchSession(`/documents/${documentId}`);
  const userId = session.context.userId;
  let document;
  try {
    document = await getWorkbenchDocument({ documentId, userId });
  } catch (error) {
    if (error instanceof Error && /access denied|permission/iu.test(error.message)) {
      return <DocumentAccessDeniedPage />;
    }
    if (error instanceof Error && error.message.toLowerCase().includes("not found")) notFound();
    throw error;
  }
  const [tree, revisions, companyFilters, spaces] = await Promise.all([
    listWorkbenchDocumentTree({ userId, spaceId: document.spaceId, ...(document.projectId ? { projectId: document.projectId } : {}) }),
    listWorkbenchDocumentRevisions({ documentId, userId }),
    getWorkbenchCompanyFilters({ userId }),
    listWorkbenchSpaces({ userId }),
  ]);
  const space = spaces.find((item) => item.id === document.spaceId);
  const projectItems = space?.companyId
    ? (await getProjectListItems({ userId, companyId: space.companyId })).filter((project) => project.spaceId === document.spaceId)
    : [];
  const selectedFilter = space?.type === "personal"
    ? companyFilters.find((filter) => filter.key === "personal")
    : companyFilters.find((filter) => filter.companyId === space?.companyId);
  const groupKey = document.projectId
    ? `project:${document.projectId}`
    : `space:${document.spaceId}`;
  const canWrite = tree.groups.find((group) => group.key === groupKey)?.canWrite ?? false;

  return (
    <WorkbenchShell
      activeKey="documents"
      title={document.title}
      subtitle={`${document.path} · v${document.version}`}
      contentMode="workspace"
      loginEmail={session.loginEmail}
      spaceLabel={space?.name ?? "文档空间"}
      selectedSpaceKey={selectedFilter?.key ?? "personal"}
      spaceFilters={companyFilters}
      spaceSwitchPath="/documents"
      {...getWorkbenchShellLoginProps(session)}
    >
      <DocumentWorkspace tree={tree} document={document} canWrite={canWrite} revisions={revisions} projects={projectItems.map((project) => ({ id: project.id, name: project.name }))} {...(document.projectId ? { selectedProjectId: document.projectId } : {})} />
    </WorkbenchShell>
  );
}

function DocumentAccessDeniedPage() {
  return (
    <WorkbenchShell activeKey="documents" title="文档不可用" subtitle="当前账号无法访问该文档。" contentMode="page" loginEmail={null}>
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 px-6 py-16 text-center">
        <h1 className="text-xl font-semibold">无权限查看文档</h1>
        <p className="text-sm text-[#57606a]">{DOCUMENT_ACCESS_DENIED_MESSAGE}</p>
      </div>
    </WorkbenchShell>
  );
}
