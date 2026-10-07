import { assertCanReadProject, getKnowledgeArchitectureVersion, knowledgeProjectDigest, prisma } from "@humanthread/db";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getWorkbenchShellLoginProps } from "../../../../../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../../../../../lib/workbench/workbench-companies";
import { requireWorkbenchSession } from "../../../../../../lib/workbench/workbench-route-auth";
import { WorkbenchShell } from "../../../../../components/workbench-shell";
import { EmptyState, StatusPill, WorkbenchButton } from "../../../../../components/workbench-ui";
import { ArchitectureCustomView } from "../../../../../components/knowledge/architecture-custom-view";

export const dynamic = "force-dynamic";

export default async function KnowledgeArchitecturePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; viewId: string }>;
  searchParams?: Promise<{ node?: string }>;
}) {
  const [{ projectId, viewId }, query] = await Promise.all([params, searchParams]);
  const requestedPath = `/projects/${encodeURIComponent(projectId)}/knowledge/architecture/${encodeURIComponent(viewId)}`;
  const { session } = await requireWorkbenchSession(requestedPath);
  await assertCanReadProject({ userId: session.context.userId, projectId });
  const projectDigest = knowledgeProjectDigest(projectId);
  const [project, version, filters] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, spaceId: true } }),
    getKnowledgeArchitectureVersion({ projectDigest, viewId }),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
  ]);
  if (!project?.spaceId || !version) notFound();
  const selectedSpace = filters.find((filter) => filter.spaceId === project.spaceId);
  const manifest = version.manifest;
  const selectedKey = query?.node && manifest.nodes.some((node) => node.key === query.node)
    ? query.node
    : manifest.entryNodeKeys[0]!;
  const selected = manifest.nodes.find((node) => node.key === selectedKey)!;
  const upstream = manifest.edges.filter((edge) => edge.to === selectedKey);
  const downstream = manifest.edges.filter((edge) => edge.from === selectedKey);
  const relatedNodes = manifest.nodes.filter((node) => [...upstream.map((edge) => edge.from), ...downstream.map((edge) => edge.to)].includes(node.key));
  const knowledgeRefs = selected.documentRefs.filter((reference) => reference.kind === "knowledge");
  const documentRefs = selected.documentRefs.filter((reference) => reference.kind === "document");
  const bundleUrl = `/api/projects/${encodeURIComponent(projectId)}/knowledge/architecture-views/${encodeURIComponent(viewId)}/bundle/index.htm`;

  const standardView = (
    <div className="grid gap-4">
      <nav aria-label="架构节点" className="flex flex-wrap gap-2 rounded-lg border border-[#d0d7de] bg-white p-3">
        {manifest.nodes.map((node) => (
          <Link key={node.key} href={`?node=${encodeURIComponent(node.key)}`} className={node.key === selectedKey ? "rounded-md bg-[#0969da] px-3 py-1.5 text-xs font-semibold text-white" : "rounded-md border border-[#d0d7de] px-3 py-1.5 text-xs font-semibold text-[#57606a] hover:border-[#0969da] hover:text-[#0969da]"}>
            {node.title}
          </Link>
        ))}
      </nav>
      <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.8fr)_minmax(260px,1fr)_minmax(220px,0.8fr)]">
        <section className="rounded-lg border border-[#d0d7de] bg-white p-4">
          <h2 className="text-sm font-semibold text-[#24292f]">上游来源与依赖</h2>
          <ul className="mt-3 grid gap-2">{upstream.length === 0 ? <li className="text-xs text-[#57606a]">无上游依赖</li> : upstream.map((edge) => {
            const node = manifest.nodes.find((candidate) => candidate.key === edge.from)!;
            return <li key={edge.key}><Link href={`?node=${encodeURIComponent(node.key)}`} className="block rounded-md border border-[#d0d7de] p-3 hover:border-[#0969da]"><strong className="text-sm text-[#24292f]">{node.title}</strong><span className="mt-1 block text-xs text-[#57606a]">{edge.type} · {(edge.confidence * 100).toFixed(0)}% · {edge.origin === "inferred" ? "推断" : "显式"}</span></Link></li>;
          })}</ul>
        </section>
        <section className="rounded-lg border-2 border-[#0969da] bg-[#f6fbff] p-5">
          <div className="flex flex-wrap items-center gap-2"><StatusPill tone="blue">{selected.kind}</StatusPill><span className="text-xs text-[#57606a]">{selected.layer}</span></div>
          <h1 className="mt-3 text-xl font-semibold text-[#24292f]">{selected.title}</h1>
          <p className="mt-2 text-sm leading-6 text-[#57606a]">{selected.summary}</p>
          <dl className="mt-4 grid gap-2 border-t border-[#d8dee4] pt-3 text-xs">
            <div><dt className="font-semibold text-[#24292f]">节点键</dt><dd className="mt-1 break-all font-mono text-[#57606a]">{selected.key}</dd></div>
            <div><dt className="font-semibold text-[#24292f]">关联知识</dt><dd className="mt-1 break-all text-[#57606a]">{knowledgeRefs.length > 0 ? knowledgeRefs.map((reference) => reference.ref).join("、") : "无"}</dd></div>
            <div><dt className="font-semibold text-[#24292f]">关联文档</dt><dd className="mt-1 break-all text-[#57606a]">{documentRefs.length > 0 ? documentRefs.map((reference) => reference.title ?? reference.ref).join("、") : "无"}</dd></div>
          </dl>
        </section>
        <section className="rounded-lg border border-[#d0d7de] bg-white p-4">
          <h2 className="text-sm font-semibold text-[#24292f]">下游影响与演进</h2>
          <ul className="mt-3 grid gap-2">{downstream.length === 0 ? <li className="text-xs text-[#57606a]">无下游关系</li> : downstream.map((edge) => {
            const node = manifest.nodes.find((candidate) => candidate.key === edge.to)!;
            return <li key={edge.key}><Link href={`?node=${encodeURIComponent(node.key)}`} className="block rounded-md border border-[#d0d7de] p-3 hover:border-[#0969da]"><strong className="text-sm text-[#24292f]">{node.title}</strong><span className="mt-1 block text-xs text-[#57606a]">{edge.type} · {(edge.confidence * 100).toFixed(0)}% · {edge.origin === "inferred" ? "推断" : "显式"}</span></Link></li>;
          })}</ul>
        </section>
      </div>
      <section className="rounded-lg border border-[#d0d7de] bg-white p-4">
        <h2 className="text-sm font-semibold text-[#24292f]">相邻节点与文档入口</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{relatedNodes.map((node) => <Link key={node.key} href={`?node=${encodeURIComponent(node.key)}`} className="rounded-md border border-[#d0d7de] p-3 text-sm text-[#24292f] hover:border-[#0969da]">{node.title}</Link>)}</div>
      </section>
    </div>
  );

  return (
    <WorkbenchShell
      activeKey="projects"
      title={`${project.name} · ${manifest.title}`}
      subtitle="以当前节点为中心查看来源依赖、下游影响、关系置信度和关联文档"
      loginEmail={session.loginEmail}
      {...(selectedSpace ? { selectedSpaceKey: selectedSpace.key } : {})}
      spaceFilters={filters}
      actions={<WorkbenchButton href={`/projects/${encodeURIComponent(projectId)}/knowledge`} size="small">返回知识库</WorkbenchButton>}
      {...getWorkbenchShellLoginProps(session)}
    >
      {manifest.nodes.length === 0 ? <EmptyState title="架构视图为空" description="架构 Bundle 至少需要一个节点。" /> : (
        <div className="mx-auto grid w-full max-w-7xl gap-4">
          <ArchitectureCustomView
            projectId={projectId}
            viewId={viewId}
            bundleUrl={bundleUrl}
            selectedKey={selectedKey}
            manifest={manifest}
            fallback={standardView}
          />
        </div>
      )}
    </WorkbenchShell>
  );
}
