import {
  assertCanReadProject,
  knowledgeProjectDigest,
  listKnowledgeArchitectureViews,
  readKnowledgePolicySettings,
  listKnowledgeReviewQueue,
  prisma,
} from "@humanthread/db";
import { notFound } from "next/navigation";

import { getWorkbenchShellLoginProps } from "../../../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../../../lib/workbench/workbench-companies";
import { requireWorkbenchSession } from "../../../../lib/workbench/workbench-route-auth";
import { KnowledgeWorkspace } from "../../../components/knowledge/knowledge-workspace";
import { KnowledgeReviewQueue } from "../../../components/knowledge/knowledge-review-queue";
import { KnowledgePolicySettings } from "../../../components/knowledge/knowledge-policy-settings";
import { WorkbenchShell } from "../../../components/workbench-shell";
import { WorkbenchButton } from "../../../components/workbench-ui";

export const dynamic = "force-dynamic";
export const PROJECT_KNOWLEDGE_PAGE_TITLE = "项目知识库";

export default async function ProjectKnowledgePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const requestedPath = `/projects/${encodeURIComponent(projectId)}/knowledge`;
  const { session } = await requireWorkbenchSession(requestedPath);
  await assertCanReadProject({ userId: session.context.userId, projectId });
  const projectDigest = knowledgeProjectDigest(projectId);
  const [project, reviewBatches, filters, architectureViews, indexJobs, knowledgePolicy] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, spaceId: true },
    }),
    listKnowledgeReviewQueue({ userId: session.context.userId, projectId }),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
    listKnowledgeArchitectureViews(projectDigest),
    prisma.knowledgeIndexJob.findMany({
      where: { projectDigest },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, status: true, stage: true, progress: true, processedChunks: true, totalChunks: true, failureMessage: true },
    }),
    readKnowledgePolicySettings({ userId: session.context.userId, projectId }),
  ]);
  if (!project?.spaceId) notFound();
  const selectedSpace = filters.find((filter) => filter.spaceId === project.spaceId);

  return (
    <WorkbenchShell
      activeKey="projects"
      title={PROJECT_KNOWLEDGE_PAGE_TITLE}
      subtitle={`${project.name} · 查询知识、追踪入库进度、审核候选并浏览架构视图`}
      loginEmail={session.loginEmail}
      {...(selectedSpace ? { selectedSpaceKey: selectedSpace.key } : {})}
      spaceFilters={filters}
      actions={<WorkbenchButton href={`/projects/${encodeURIComponent(projectId)}/loops`} size="small">Loop 设置</WorkbenchButton>}
      {...getWorkbenchShellLoginProps(session)}
    >
      <KnowledgeWorkspace
        projectId={projectId}
        architectureViews={architectureViews.map((view) => ({ ...view, updatedAt: view.updatedAt.toISOString() }))}
        progress={indexJobs}
        reviewPanel={<div className="grid gap-4">
          {knowledgePolicy ? <KnowledgePolicySettings
            projectId={projectId}
            initialPolicy={{
              autoPublishEnabled: knowledgePolicy.autoPublishEnabled,
              minimumConfidence: knowledgePolicy.minimumConfidence,
              allowedSourceTypes: knowledgePolicy.allowedSourceTypes,
              allowedEntryTypes: knowledgePolicy.allowedEntryTypes,
              allowAutomaticDelete: knowledgePolicy.allowAutomaticDelete,
              allowAutomaticExpire: knowledgePolicy.allowAutomaticExpire,
              allowAutomaticSupersede: knowledgePolicy.allowAutomaticSupersede,
              subscribeSpaceKnowledge: knowledgePolicy.subscribeSpaceKnowledge,
              version: knowledgePolicy.version,
            }}
          /> : null}
          <KnowledgeReviewQueue
            projectId={projectId}
            initialBatches={reviewBatches.map((batch) => ({
              ...batch,
              receivedAt: batch.receivedAt.toISOString(),
              updatedAt: batch.updatedAt.toISOString(),
            }))}
          />
        </div>}
      />
    </WorkbenchShell>
  );
}
