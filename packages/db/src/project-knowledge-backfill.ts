import { prisma } from "./prisma";
import { createKnowledgeGenerationTask } from "./knowledge-generation";
import { initializeProjectKnowledge } from "./project-knowledge-initialization";
import { knowledgeId, knowledgeProjectDigest } from "./knowledge-reference";

export interface BackfillProjectKnowledgeInput {
  projectId: string;
  actorUserId: string;
}

export interface BackfillProjectKnowledgeResult {
  projectId: string;
  policyId: string;
  templateId: string;
  templateVersionId: string;
  templateVersionIds: ReturnType<typeof initializeProjectKnowledge> extends Promise<infer Result>
    ? Result extends { templateVersionIds: infer Versions }
      ? Versions
      : never
    : never;
  jobId: string;
  taskId: string;
  duplicate: boolean;
}

interface ExistingGenerationIdentity {
  jobId: string;
  taskId: string;
  templateVersionId: string;
}

/**
 * Repairs a Project whose knowledge domain was never initialized (created
 * before the knowledge bootstrap shipped). Idempotent end to end: policy,
 * template, template version, Job and Task all use deterministic identities, so
 * running it again returns the same records instead of duplicating them.
 */
export async function backfillProjectKnowledge(
  input: BackfillProjectKnowledgeInput,
  dependencies: {
    initialize: typeof initializeProjectKnowledge;
    createGenerationTask: typeof createKnowledgeGenerationTask;
    loadProject: (projectId: string) => Promise<{ id: string; name: string; objective: string | null; createdAt: Date } | null>;
    loadExistingJob?: (projectId: string) => Promise<ExistingGenerationIdentity | null>;
  } = {
    initialize: initializeProjectKnowledge,
    createGenerationTask: createKnowledgeGenerationTask,
    loadProject: (projectId) => prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, objective: true, createdAt: true },
    }),
    loadExistingJob: async (projectId) => {
      const jobId = knowledgeBackfillJobId(projectId);
      const job = await prisma.knowledgeJob.findUnique({
        where: { id: jobId },
        select: { id: true, taskId: true, templateVersionId: true },
      });
      return job ? { jobId: job.id, taskId: job.taskId, templateVersionId: job.templateVersionId } : null;
    },
  },
): Promise<BackfillProjectKnowledgeResult> {
  const project = await dependencies.loadProject(input.projectId);
  if (!project) throw notFound("Project not found");

  const initialized = await dependencies.initialize({
    projectId: project.id,
    actorUserId: input.actorUserId,
  });
  const existing = await dependencies.loadExistingJob?.(project.id);
  if (existing) {
    return {
      projectId: project.id,
      policyId: initialized.policyId,
      templateId: initialized.templateId,
      templateVersionId: existing.templateVersionId,
      templateVersionIds: initialized.templateVersionIds,
      jobId: existing.jobId,
      taskId: existing.taskId,
      duplicate: true,
    };
  }
  const generated = await dependencies.createGenerationTask({
    projectId: project.id,
    actorUserId: input.actorUserId,
    mode: "project_initialization",
    dedupeIdentity: `project-initialization:${project.id}`,
    templateVersionId: initialized.templateVersionId,
    sourceSnapshot: {
      observedAt: project.createdAt.toISOString(),
      sourceRefs: [{ kind: "document", sourceType: "project_initialization", ref: `project:${project.id}` }],
    },
    title: `初始化项目知识库：${project.name}`,
    contentMarkdown: `# 项目知识初始化\n\n项目：${project.name}\n\n目标：${project.objective ?? ""}\n\n请按项目初始化模板生成知识候选和架构视图。`,
  });

  return {
    projectId: project.id,
    policyId: initialized.policyId,
    templateId: initialized.templateId,
    templateVersionId: initialized.templateVersionId,
    templateVersionIds: initialized.templateVersionIds,
    jobId: generated.jobId,
    taskId: generated.taskId,
    duplicate: generated.duplicate,
  };
}

export function knowledgeBackfillJobId(projectId: string): string {
  return knowledgeId(
    "knowledge-job",
    knowledgeProjectDigest(projectId),
    "project_initialization",
    `project-initialization:${projectId}`,
  );
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: "not_found" });
}
