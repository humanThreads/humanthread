import { assertCanReadProject, assertCanWriteProject } from "./access-control";
import { knowledgeProjectDigest } from "./knowledge-reference";
import { prisma } from "./prisma";

export interface KnowledgeBatchAccess {
  id: string;
  jobId: string;
  projectDigest: string;
  status: string;
  progress: number;
  processedChunks: number;
  totalChunks: number;
  retryCount: number;
  failureClass: string | null;
  receivedAt: Date;
  completedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeJobAccess {
  id: string;
  projectDigest: string;
  taskId: string;
  mode: string;
  status: string;
  templateVersionId: string;
  policyVersion: number;
  dedupeKey: string;
  sourceSnapshot: unknown;
  failureCode: string | null;
  failureMessage: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeReviewItemProjection {
  id: string;
  batchId: string;
  ordinal: number;
  stableKey: string;
  changeType: string;
  sourceType: string;
  entryType: string;
  title: string;
  summary: string;
  confidence: number;
  tags: string[];
  decision: string | null;
  decisionReason: string | null;
  publishedVersion: number | null;
}

export interface KnowledgeReviewBatchProjection {
  batchId: string;
  jobId: string;
  submissionId: string;
  status: string;
  progress: number;
  receivedAt: Date;
  updatedAt: Date;
  items: KnowledgeReviewItemProjection[];
}

interface KnowledgeAccessDependencies {
  assertCanReadProject: typeof assertCanReadProject;
  assertCanWriteProject: typeof assertCanWriteProject;
  loadBatch(input: { batchId: string; projectDigest: string }): Promise<KnowledgeBatchAccess | null>;
  loadJob(input: { jobId: string; projectDigest: string }): Promise<KnowledgeJobAccess | null>;
}

interface KnowledgeReviewQueueDependencies {
  assertCanReadProject: typeof assertCanReadProject;
  listBatches(input: { projectDigest: string; limit: number }): Promise<Array<{
    id: string;
    jobId: string;
    submissionId: string;
    status: string;
    progress: number;
    receivedAt: Date;
    updatedAt: Date;
  }>>;
  listItems(input: { batchIds: string[] }): Promise<Array<{
    id: string;
    batchId: string;
    ordinal: number;
    stableKey: string;
    changeType: string;
    sourceType: string;
    entryType: string;
    title: string;
    summary: string;
    confidence: number;
    tags: unknown;
    decision: string | null;
    decisionReason: string | null;
    publishedVersion: number | null;
  }>>;
}

const DEFAULT_REVIEW_QUEUE_DEPENDENCIES: KnowledgeReviewQueueDependencies = {
  assertCanReadProject,
  listBatches: ({ projectDigest, limit }) => prisma.knowledgeBatch.findMany({
    where: { projectDigest, status: "review_required" },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      jobId: true,
      submissionId: true,
      status: true,
      progress: true,
      receivedAt: true,
      updatedAt: true,
    },
  }),
  listItems: ({ batchIds }) => batchIds.length === 0 ? Promise.resolve([]) : prisma.knowledgeBatchItem.findMany({
    where: { batchId: { in: batchIds } },
    orderBy: [{ batchId: "asc" }, { ordinal: "asc" }],
    select: {
      id: true,
      batchId: true,
      ordinal: true,
      stableKey: true,
      changeType: true,
      sourceType: true,
      entryType: true,
      title: true,
      summary: true,
      confidence: true,
      tags: true,
      decision: true,
      decisionReason: true,
      publishedVersion: true,
    },
  }),
};

export async function listKnowledgeReviewQueue(
  input: { userId: string; projectId: string; limit?: number },
  dependencies: KnowledgeReviewQueueDependencies = DEFAULT_REVIEW_QUEUE_DEPENDENCIES,
): Promise<KnowledgeReviewBatchProjection[]> {
  await dependencies.assertCanReadProject({ userId: input.userId, projectId: input.projectId });
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const rows = await dependencies.listBatches({
    projectDigest: knowledgeProjectDigest(input.projectId),
    limit,
  });
  const items = await dependencies.listItems({ batchIds: rows.map((row) => row.id) });
  const itemsByBatch = new Map<string, typeof items>();
  for (const item of items) {
    const bucket = itemsByBatch.get(item.batchId) ?? [];
    bucket.push(item);
    itemsByBatch.set(item.batchId, bucket);
  }
  return rows.map((row) => ({
    batchId: row.id,
    jobId: row.jobId,
    submissionId: row.submissionId,
    status: row.status,
    progress: row.progress,
    receivedAt: row.receivedAt,
    updatedAt: row.updatedAt,
    items: (itemsByBatch.get(row.id) ?? []).map((item) => ({
      id: item.id,
      batchId: row.id,
      ordinal: item.ordinal,
      stableKey: item.stableKey,
      changeType: item.changeType,
      sourceType: item.sourceType,
      entryType: item.entryType,
      title: item.title,
      summary: item.summary,
      confidence: item.confidence,
      tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [],
      decision: item.decision,
      decisionReason: item.decisionReason,
      publishedVersion: item.publishedVersion,
    })),
  }));
}

interface KnowledgeAccessOptions {
  dependencies?: Partial<KnowledgeAccessDependencies>;
}

interface KnowledgeBatchAccessInput extends KnowledgeAccessOptions {
  userId: string;
  projectId: string;
  batchId: string;
}

interface KnowledgeJobAccessInput extends KnowledgeAccessOptions {
  userId: string;
  projectId: string;
  jobId: string;
}

const DEFAULT_DEPENDENCIES: KnowledgeAccessDependencies = {
  assertCanReadProject,
  assertCanWriteProject,
  loadBatch: ({ batchId, projectDigest }) => prisma.knowledgeBatch.findFirst({
    where: { id: batchId, projectDigest },
    select: {
      id: true,
      jobId: true,
      projectDigest: true,
      status: true,
      progress: true,
      processedChunks: true,
      totalChunks: true,
      retryCount: true,
      failureClass: true,
      receivedAt: true,
      completedAt: true,
      version: true,
      createdAt: true,
      updatedAt: true,
    },
  }),
  loadJob: ({ jobId, projectDigest }) => prisma.knowledgeJob.findFirst({
    where: { id: jobId, projectDigest },
    select: {
      id: true,
      projectDigest: true,
      taskId: true,
      mode: true,
      status: true,
      templateVersionId: true,
      policyVersion: true,
      dedupeKey: true,
      sourceSnapshot: true,
      failureCode: true,
      failureMessage: true,
      version: true,
      createdAt: true,
      updatedAt: true,
    },
  }),
};

function resolveDependencies(
  dependencies?: Partial<KnowledgeAccessDependencies>,
): KnowledgeAccessDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...dependencies };
}

export async function readKnowledgeBatchAccess(
  input: KnowledgeBatchAccessInput,
  dependencies: Partial<KnowledgeAccessDependencies> = {},
): Promise<KnowledgeBatchAccess | null> {
  const resolved = resolveDependencies({ ...input.dependencies, ...dependencies });
  await resolved.assertCanReadProject({
    userId: input.userId,
    projectId: input.projectId,
  });
  const projectDigest = knowledgeProjectDigest(input.projectId);
  const batch = await resolved.loadBatch({
    batchId: requiredId(input.batchId, "batchId"),
    projectDigest,
  });
  return batch?.projectDigest === projectDigest ? batch : null;
}

export async function assertCanReadKnowledgeBatch(
  input: KnowledgeBatchAccessInput,
  dependencies: Partial<KnowledgeAccessDependencies> = {},
): Promise<KnowledgeBatchAccess> {
  const batch = await readKnowledgeBatchAccess(input, dependencies);
  if (!batch) throw notFound("Knowledge batch not found");
  return batch;
}

export async function assertCanWriteKnowledgeBatch(
  input: KnowledgeBatchAccessInput,
  dependencies: Partial<KnowledgeAccessDependencies> = {},
): Promise<KnowledgeBatchAccess> {
  const resolved = resolveDependencies({ ...input.dependencies, ...dependencies });
  await resolved.assertCanWriteProject({
    userId: input.userId,
    projectId: input.projectId,
  });
  const projectDigest = knowledgeProjectDigest(input.projectId);
  const batch = await resolved.loadBatch({
    batchId: requiredId(input.batchId, "batchId"),
    projectDigest,
  });
  if (!batch || batch.projectDigest !== projectDigest) {
    throw notFound("Knowledge batch not found");
  }
  return batch;
}

export async function readKnowledgeJobAccess(
  input: KnowledgeJobAccessInput,
  dependencies: Partial<KnowledgeAccessDependencies> = {},
): Promise<KnowledgeJobAccess | null> {
  const resolved = resolveDependencies({ ...input.dependencies, ...dependencies });
  await resolved.assertCanReadProject({
    userId: input.userId,
    projectId: input.projectId,
  });
  const projectDigest = knowledgeProjectDigest(input.projectId);
  const job = await resolved.loadJob({
    jobId: requiredId(input.jobId, "jobId"),
    projectDigest,
  });
  return job?.projectDigest === projectDigest ? job : null;
}

function requiredId(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw Object.assign(new Error(`${field} is required`), { code: "validation_failed" });
  return normalized;
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: "not_found" });
}
