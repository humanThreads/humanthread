import { KNOWLEDGE_CHUNKER_VERSION } from "@humanthread/shared";

import { prisma } from "./prisma";
import { knowledgeId, knowledgeProjectDigest } from "./knowledge-reference";
import { knowledgeSourceSnapshotDigest, parseKnowledgeSourceSnapshot } from "./knowledge-snapshot";

export const KNOWLEDGE_GENERATION_MODES = [
  "project_initialization",
  "task_completion",
  "scheduled_update",
  "manual_update",
] as const;

export type KnowledgeGenerationMode = (typeof KNOWLEDGE_GENERATION_MODES)[number];

export interface CreateKnowledgeGenerationTaskInput {
  projectId: string;
  actorUserId: string;
  mode: KnowledgeGenerationMode;
  dedupeIdentity: string;
  templateVersionId: string;
  sourceSnapshot: Record<string, unknown>;
  title: string;
  contentMarkdown: string;
}

export interface KnowledgeGenerationTaskProjection {
  jobId: string;
  taskId: string;
  projectDigest: string;
  mode: KnowledgeGenerationMode;
  duplicate: boolean;
}

interface KnowledgeGenerationDb {
  project: { findUnique(args: unknown): Promise<{ id: string; spaceId: string | null; teamId: string } | null> };
  knowledgeTemplateVersion: { findUnique(args: unknown): Promise<{ id: string; template: { projectDigest: string; mode: string; status: string } } | null> };
  knowledgePolicy: { findUnique(args: unknown): Promise<{ projectDigest: string; version: number } | null> };
  knowledgeJob: {
    findUnique(args: unknown): Promise<Record<string, unknown> | null>;
    createMany(args: unknown): Promise<{ count: number }>;
  };
  task: { createMany(args: unknown): Promise<{ count: number }> };
  $transaction<T>(callback: (tx: KnowledgeGenerationDb) => Promise<T>, options?: { maxWait?: number; timeout?: number }): Promise<T>;
}

const TRANSACTION_OPTIONS = Object.freeze({ maxWait: 5_000, timeout: 30_000 });

export async function createKnowledgeGenerationTask(
  input: CreateKnowledgeGenerationTaskInput,
  db: KnowledgeGenerationDb = prisma as unknown as KnowledgeGenerationDb,
): Promise<KnowledgeGenerationTaskProjection> {
  const projectId = requiredText(input.projectId, "projectId");
  const actorUserId = requiredText(input.actorUserId, "actorUserId");
  const dedupeIdentity = requiredText(input.dedupeIdentity, "dedupeIdentity");
  const title = requiredText(input.title, "title");
  if (!KNOWLEDGE_GENERATION_MODES.includes(input.mode)) throw validationError("Knowledge generation mode is invalid");
  const projectDigest = knowledgeProjectDigest(projectId);
  const snapshot = parseKnowledgeSourceSnapshot(input.sourceSnapshot);
  const snapshotDigest = knowledgeSourceSnapshotDigest(snapshot.value);
  const jobId = knowledgeId("knowledge-job", projectDigest, input.mode, dedupeIdentity);
  const taskId = knowledgeId("knowledge-generation-task", jobId);

  return db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, spaceId: true, teamId: true } });
    if (!project?.spaceId) throw notFound("Knowledge generation project not found");
    const template = await tx.knowledgeTemplateVersion.findUnique({
      where: { id: input.templateVersionId },
      include: { template: true },
    });
    if (!template || template.template.projectDigest !== projectDigest
      || template.template.mode !== input.mode || template.template.status !== "published") {
      throw versionConflict("Knowledge generation template does not match the project and mode");
    }
    const policy = await tx.knowledgePolicy.findUnique({ where: { projectDigest } });
    if (!policy) throw notFound("Knowledge policy not found");
    const existing = await tx.knowledgeJob.findUnique({ where: { id: jobId } });
    if (existing) {
      if (existing.sourceSnapshotDigest !== snapshotDigest) throw versionConflict("Knowledge generation dedupe identity changed");
      return { jobId, taskId, projectDigest, mode: input.mode, duplicate: true };
    }
    const now = new Date();
    await tx.task.createMany({
      data: [{
        id: taskId,
        teamId: project.teamId,
        projectId,
        spaceId: project.spaceId,
        createdById: actorUserId,
        statusCategory: "todo",
        visibility: "project",
        title,
        description: input.contentMarkdown,
        contentMarkdown: input.contentMarkdown,
        status: "todo",
        executorType: "ai",
        queuePosition: 0,
        acceptanceMode: "none",
        executionMode: "agent",
        objective: title,
        taskType: "knowledge_generation",
        dispatchPolicy: {
          knowledge: {
            mode: input.mode,
            templateVersionId: input.templateVersionId,
            snapshotDigest,
            chunkerVersion: KNOWLEDGE_CHUNKER_VERSION,
          },
        },
        version: 1,
        createdAt: now,
        updatedAt: now,
      }],
      skipDuplicates: true,
    });
    const inserted = await tx.knowledgeJob.createMany({
      data: [{
        id: jobId,
        projectDigest,
        taskId,
        mode: input.mode,
        status: "queued",
        templateVersionId: input.templateVersionId,
        policyVersion: policy.version,
        dedupeKey: `knowledge-job:${jobId}`,
        sourceSnapshot: snapshot.value,
        sourceSnapshotDigest: snapshotDigest,
        failureCode: null,
        failureMessage: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      }],
      skipDuplicates: true,
    });
    if (inserted.count === 0) return { jobId, taskId, projectDigest, mode: input.mode, duplicate: true };
    return { jobId, taskId, projectDigest, mode: input.mode, duplicate: false };
  }, TRANSACTION_OPTIONS);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw validationError(`${field} is required`);
  return normalized;
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}

function versionConflict(message: string): Error {
  return Object.assign(new Error(message), { code: "version_conflict" });
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: "not_found" });
}
