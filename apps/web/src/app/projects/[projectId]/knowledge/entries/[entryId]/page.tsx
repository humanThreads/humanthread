import { assertCanReadProject, getKnowledgeEntry, listKnowledgeEntryVersions, prisma } from "@humanthread/db";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getWorkbenchShellLoginProps } from "../../../../../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../../../../../lib/workbench/workbench-companies";
import { requireWorkbenchSession } from "../../../../../../lib/workbench/workbench-route-auth";
import { WorkbenchShell } from "../../../../../components/workbench-shell";
import { StatusPill, WorkbenchButton } from "../../../../../components/workbench-ui";

export const dynamic = "force-dynamic";

export default async function KnowledgeEntryPage({
  params,
}: {
  params: Promise<{ projectId: string; entryId: string }>;
}) {
  const { projectId, entryId } = await params;
  const requestedPath = `/projects/${encodeURIComponent(projectId)}/knowledge/entries/${encodeURIComponent(entryId)}`;
  const { session } = await requireWorkbenchSession(requestedPath);
  await assertCanReadProject({ userId: session.context.userId, projectId });
  const [project, entry, versions, filters] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, spaceId: true } }),
    getKnowledgeEntry(entryId),
    listKnowledgeEntryVersions(entryId),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
  ]);
  if (!project?.spaceId || !entry || entry.projectDigest === undefined) notFound();
  const selectedSpace = filters.find((filter) => filter.spaceId === project.spaceId);
  const current = versions.find((version) => version.version === entry.publishedVersion) ?? versions[0];

  return (
    <WorkbenchShell
      activeKey="projects"
      title={`${project.name} · ${entry.title}`}
      subtitle="知识条目、来源、版本历史和关联上下文"
      loginEmail={session.loginEmail}
      {...(selectedSpace ? { selectedSpaceKey: selectedSpace.key } : {})}
      spaceFilters={filters}
      actions={<WorkbenchButton href={`/projects/${encodeURIComponent(projectId)}/knowledge`} size="small">返回知识库</WorkbenchButton>}
      {...getWorkbenchShellLoginProps(session)}
    >
      <div className="mx-auto grid w-full max-w-5xl gap-4">
        <article className="rounded-lg border border-[#d0d7de] bg-white p-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={entry.status === "published" ? "success" : "default"}>{entry.status}</StatusPill>
            <span className="text-xs text-[#57606a]">{entry.entryType}</span>
            {entry.publishedVersion !== null ? <span className="text-xs text-[#57606a]">v{entry.publishedVersion}</span> : null}
          </div>
          <h1 className="mt-3 text-xl font-semibold text-[#24292f]">{entry.title}</h1>
          <p className="mt-2 text-xs font-mono text-[#57606a]">{entry.stableKey}</p>
          {current ? <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-[#24292f]">{current.summary}{"\n\n"}{current.bodyMarkdown}</div> : null}
        </article>
        <section className="rounded-lg border border-[#d0d7de] bg-white p-5">
          <h2 className="text-sm font-semibold text-[#24292f]">版本历史</h2>
          <ol className="mt-3 grid gap-2">{versions.map((version) => <li key={version.id} className="flex flex-wrap items-center gap-3 rounded-md border border-[#d0d7de] px-3 py-2 text-xs"><strong className="text-[#24292f]">v{version.version}</strong><span className="mr-auto text-[#57606a]">{version.changeSummary}</span><StatusPill tone={version.status === "published" ? "success" : "default"}>{version.status}</StatusPill></li>)}</ol>
        </section>
        <div className="flex flex-wrap gap-2">
          <WorkbenchButton href={`/documents?project=${encodeURIComponent(projectId)}`} size="small">打开项目文档</WorkbenchButton>
          <Link href={`/projects/${encodeURIComponent(projectId)}/knowledge`} className="text-xs font-semibold text-[#0969da] hover:underline">继续查询相关知识</Link>
        </div>
      </div>
    </WorkbenchShell>
  );
}
