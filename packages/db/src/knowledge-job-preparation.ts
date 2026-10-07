import { prisma } from "./prisma";
import {
  KNOWLEDGE_GENERATION_MODES,
  createKnowledgeGenerationTask,
  type KnowledgeGenerationMode,
} from "./knowledge-generation";
import { knowledgeId, knowledgeProjectDigest } from "./knowledge-reference";
import { backfillProjectKnowledge } from "./project-knowledge-backfill";
import { startKnowledgeJob } from "./knowledge-jobs";

export interface PrepareKnowledgeJobInput {
  projectId: string;
  actorUserId: string;
  mode?: KnowledgeGenerationMode;
  dedupeIdentity?: string;
  title?: string;
}

export interface PreparedKnowledgeJob {
  jobId: string;
  taskId: string;
  projectDigest: string;
  mode: string;
  status: string;
  templateVersionId: string;
  templateDigest: string;
  sourceSnapshot: unknown;
  sourceSnapshotDigest: string;
  policyVersion: number;
  repaired: boolean;
  duplicate: boolean;
}

/**
 * Makes a Project knowledge Job ready for batch submission:
 * repairs the knowledge domain when it was never initialized, starts the Job so
 * it accepts a submission, and returns the exact `jobId` / `templateDigest`
 * pair the caller must echo back. Safe to call repeatedly.
 */
export async function prepareKnowledgeJobForSubmission(
  input: PrepareKnowledgeJobInput,
  dependencies: {
    backfill: typeof backfillProjectKnowledge;
    createGenerationTask: typeof createKnowledgeGenerationTask;
    start: typeof startKnowledgeJob;
    readJob: (jobId: string) => Promise<{
      id: string;
      projectDigest: string;
      taskId: string;
      mode: string;
      status: string;
      templateVersionId: string;
      policyVersion: number;
      sourceSnapshot: unknown;
      sourceSnapshotDigest: string;
    } | null>;
    readTemplateDigest: (templateVersionId: string) => Promise<string | null>;
    now?: () => Date;
  } = {
    backfill: backfillProjectKnowledge,
    createGenerationTask: createKnowledgeGenerationTask,
    start: startKnowledgeJob,
    readJob: (jobId) => prisma.knowledgeJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        projectDigest: true,
        taskId: true,
        mode: true,
        status: true,
        templateVersionId: true,
        policyVersion: true,
        sourceSnapshot: true,
        sourceSnapshotDigest: true,
      },
    }),
    readTemplateDigest: async (templateVersionId) => {
      const version = await prisma.knowledgeTemplateVersion.findUnique({
        where: { id: templateVersionId },
        select: { contentHash: true },
      });
      return version?.contentHash ?? null;
    },
  },
): Promise<PreparedKnowledgeJob> {
  if (input.mode !== undefined && !KNOWLEDGE_GENERATION_MODES.includes(input.mode)) {
    throw validationError("Knowledge generation mode is invalid");
  }
  if (input.mode !== undefined && input.mode !== "project_initialization" && !input.dedupeIdentity?.trim()) {
    throw validationError("dedupeIdentity is required for follow-up knowledge Jobs");
  }
  if (input.mode === "project_initialization" && input.dedupeIdentity !== undefined) {
    throw validationError("project_initialization uses the built-in Job identity");
  }
  const backfilled = await dependencies.backfill({
    projectId: input.projectId,
    actorUserId: input.actorUserId,
  });

  const requestedMode = input.mode ?? "project_initialization";
  let preparedJobId = backfilled.jobId;
  let duplicate = backfilled.duplicate;
  if (requestedMode !== "project_initialization") {
    const templateVersionId = backfilled.templateVersionIds[requestedMode];
    if (!templateVersionId) throw notFound("Knowledge template version not found after preparation");
    const dedupeIdentity = input.dedupeIdentity!.trim();
    const existingJobId = knowledgeFollowUpJobId(
      backfilled.projectId,
      requestedMode,
      dedupeIdentity,
    );
    const existingJob = await dependencies.readJob(existingJobId);
    if (existingJob) {
      preparedJobId = existingJob.id;
      duplicate = true;
    } else {
      const generated = await dependencies.createGenerationTask({
        projectId: backfilled.projectId,
        actorUserId: input.actorUserId,
        mode: requestedMode,
        dedupeIdentity,
        templateVersionId,
        sourceSnapshot: followUpSourceSnapshot(backfilled.projectId, requestedMode, dedupeIdentity, dependencies.now?.() ?? new Date()),
        title: input.title?.trim() || followUpTitle(requestedMode, dedupeIdentity),
        contentMarkdown: `# ${followUpTitle(requestedMode, dedupeIdentity)}\n\n请按项目知识模板提交结构化候选项，不直接发布正式知识。`,
      });
      preparedJobId = generated.jobId;
      duplicate = generated.duplicate;
    }
  }
  await dependencies.start({ jobId: preparedJobId, projectId: input.projectId });

  const job = await dependencies.readJob(preparedJobId);
  if (!job) throw notFound("Knowledge job not found after preparation");
  const templateDigest = await dependencies.readTemplateDigest(job.templateVersionId);
  if (!templateDigest) throw notFound("Knowledge template version not found");

  return {
    jobId: job.id,
    taskId: job.taskId,
    projectDigest: job.projectDigest,
    mode: job.mode,
    status: job.status,
    templateVersionId: job.templateVersionId,
    templateDigest,
    sourceSnapshot: job.sourceSnapshot,
    sourceSnapshotDigest: job.sourceSnapshotDigest,
    policyVersion: job.policyVersion,
    repaired: !duplicate,
    duplicate,
  };
}

function knowledgeFollowUpJobId(
  projectId: string,
  mode: KnowledgeGenerationMode,
  dedupeIdentity: string,
): string {
  return knowledgeId("knowledge-job", knowledgeProjectDigest(projectId), mode, dedupeIdentity);
}

function followUpSourceSnapshot(
  projectId: string,
  mode: KnowledgeGenerationMode,
  dedupeIdentity: string,
  now: Date,
): Record<string, unknown> {
  return {
    observedAt: now.toISOString(),
    sourceRefs: [{
      kind: "task",
      sourceType: mode,
      ref: `task:${knowledgeId(
        "knowledge-generation-task",
        knowledgeFollowUpJobId(projectId, mode, dedupeIdentity),
      )}`,
    }],
  };
}

function followUpTitle(mode: KnowledgeGenerationMode, dedupeIdentity: string): string {
  if (mode === "task_completion") return `归纳任务知识：${dedupeIdentity}`;
  if (mode === "scheduled_update") return `执行定时知识更新：${dedupeIdentity}`;
  return `补交项目知识：${dedupeIdentity}`;
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: "not_found" });
}
