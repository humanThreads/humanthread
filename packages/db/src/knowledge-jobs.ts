import { prisma } from "./prisma";
import { knowledgeId, knowledgeProjectDigest } from "./knowledge-reference";
import {
  isKnowledgeSourceSnapshotFresh,
  knowledgeSourceSnapshotDigest,
  parseKnowledgeSourceSnapshot,
} from "./knowledge-snapshot";

export interface CreateKnowledgeJobInput {
  projectId: string;
  taskId: string;
  mode: string;
  templateVersionId: string;
  dedupeIdentity: string;
  sourceSnapshot: Record<string, unknown>;
}

export interface KnowledgeJobProjection {
  id: string;
  projectDigest: string;
  taskId: string;
  mode: string;
  status: string;
  templateVersionId: string;
  policyVersion: number;
  dedupeKey: string;
  sourceSnapshot: unknown;
  sourceSnapshotDigest: string;
  failureCode: string | null;
  failureMessage: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

interface KnowledgeJobRow extends KnowledgeJobProjection {}

interface KnowledgeJobTx {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  project: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string } | null>;
  };
  knowledgeTemplateVersion: {
    findUnique(args: { where: { id: string } }): Promise<{
      id: string;
      version: number;
      contentHash: string;
      publishedAt: Date;
      template: {
        id: string;
        projectDigest: string;
        mode: string;
        status: string;
      };
    } | null>;
  };
  knowledgePolicy: {
    findUnique(args: { where: { projectDigest: string } }): Promise<{
      id: string;
      projectDigest: string;
      version: number;
      sourceTypeOverrides: unknown;
    } | null>;
  };
  knowledgeJob: {
    findUnique(args: { where: { id: string } | { dedupeKey: string } }): Promise<KnowledgeJobRow | null>;
    createMany(args: {
      data: KnowledgeJobRow[];
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
  };
}

export interface KnowledgeJobDependencies {
  db: Omit<KnowledgeJobTx, "$transaction"> & {
    $transaction<T>(
      callback: (tx: KnowledgeJobTx) => Promise<T>,
      options?: { maxWait?: number; timeout?: number },
    ): Promise<T>;
  };
  now?: () => Date;
}

export const KNOWLEDGE_TRANSACTION_OPTIONS = Object.freeze({
  maxWait: 5_000,
  timeout: 30_000,
});

const DEFAULT_DEPENDENCIES: KnowledgeJobDependencies = {
  db: prisma as unknown as KnowledgeJobDependencies["db"],
};

export async function createKnowledgeJob(
  input: CreateKnowledgeJobInput,
  dependencies: KnowledgeJobDependencies = DEFAULT_DEPENDENCIES,
): Promise<KnowledgeJobProjection> {
  const projectId = requiredText(input.projectId, "projectId");
  const taskId = requiredText(input.taskId, "taskId");
  const mode = requiredText(input.mode, "mode");
  const templateVersionId = requiredDigest(input.templateVersionId, "templateVersionId");
  const dedupeIdentity = requiredText(input.dedupeIdentity, "dedupeIdentity");
  const projectDigest = knowledgeProjectDigest(projectId);
  const normalizedTaskId = knowledgeId("knowledge-task", taskId);
  const snapshot = parseKnowledgeSourceSnapshot(input.sourceSnapshot);
  const now = dependencies.now?.() ?? new Date();
  if (!isKnowledgeSourceSnapshotFresh(snapshot, now)) {
    throw validationError("Knowledge source snapshot is stale or ahead of platform time");
  }
  const sourceSnapshotDigest = knowledgeSourceSnapshotDigest(snapshot.value);
  const id = knowledgeId("knowledge-job", projectDigest, mode, dedupeIdentity);
  const dedupeKey = `knowledge-job:${id}`;

  return dependencies.db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound("Project not found");

    const templateVersion = await tx.knowledgeTemplateVersion.findUnique({
      where: { id: templateVersionId },
    });
    if (
      !templateVersion
      || templateVersion.template.projectDigest !== projectDigest
      || templateVersion.template.mode !== mode
      || templateVersion.template.status !== "published"
    ) {
      throw versionConflict("Knowledge template does not match the Job project or mode");
    }

    const policy = await tx.knowledgePolicy.findUnique({ where: { projectDigest } });
    if (!policy || policy.projectDigest !== projectDigest) {
      throw versionConflict("Knowledge policy does not match the Job project");
    }

    const data: KnowledgeJobRow = {
      id,
      projectDigest,
      taskId: normalizedTaskId,
      mode,
      status: "queued",
      templateVersionId,
      policyVersion: policy.version,
      dedupeKey,
      sourceSnapshot: snapshot.value,
      sourceSnapshotDigest,
      failureCode: null,
      failureMessage: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const existing = await tx.knowledgeJob.findUnique({ where: { id } });
    if (existing) {
      assertSameJob(existing, data);
      return projectJob(existing);
    }
    const inserted = await tx.knowledgeJob.createMany({ data: [data], skipDuplicates: true });
    const canonical = inserted.count === 0
      ? await readKnowledgeJobCurrent(tx, id)
      : await tx.knowledgeJob.findUnique({ where: { dedupeKey } });
    if (!canonical) throw versionConflict("Knowledge Job insert conflicted without a canonical row");
    if (inserted.count === 0) assertSameJob(canonical, data);
    return projectJob(canonical);
  }, KNOWLEDGE_TRANSACTION_OPTIONS);
}

async function readKnowledgeJobCurrent(tx: KnowledgeJobTx, id: string): Promise<KnowledgeJobRow | null> {
  const rows = await tx.$queryRaw<KnowledgeJobRow[]>`
    SELECT id, projectDigest, taskId, mode, status, templateVersionId, policyVersion,
           dedupeKey, sourceSnapshot, sourceSnapshotDigest, failureCode, failureMessage,
           version, createdAt, updatedAt
    FROM KnowledgeJob
    WHERE id = ${id}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export interface StartKnowledgeJobInput {
  jobId: string;
  projectId: string;
}

export interface StartKnowledgeJobDependencies {
  db: {
    knowledgeJob: {
      findUnique(args: { where: { id: string } }): Promise<KnowledgeJobRow | null>;
      updateMany(args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }): Promise<{ count: number }>;
    };
  };
  now?: () => Date;
}

const STARTABLE_JOB_STATUS = "queued";
const ACTIVE_JOB_STATUSES = new Set(["worker_running", "awaiting_submission"]);
const TERMINAL_OR_INGESTING_JOB_STATUSES = new Set(["ingesting", "searchable"]);

/**
 * Moves a queued KnowledgeJob into `worker_running` so the worker (or MCP
 * caller) is allowed to submit a batch. Idempotent for a Job that already
 * started, is awaiting submission, or has moved further into ingestion, and
 * scoped to the owning Project so a Job can never be started through another
 * Project.
 */
export async function startKnowledgeJob(
  input: StartKnowledgeJobInput,
  dependencies: StartKnowledgeJobDependencies = {
    db: prisma as unknown as StartKnowledgeJobDependencies["db"],
  },
): Promise<KnowledgeJobProjection> {
  const jobId = requiredDigest(input.jobId, "jobId");
  const projectId = requiredText(input.projectId, "projectId");
  const projectDigest = knowledgeProjectDigest(projectId);
  const now = dependencies.now?.() ?? new Date();

  const current = await dependencies.db.knowledgeJob.findUnique({ where: { id: jobId } });
  if (!current || current.projectDigest !== projectDigest) {
    throw notFound("Knowledge job not found");
  }
  if (ACTIVE_JOB_STATUSES.has(current.status) || TERMINAL_OR_INGESTING_JOB_STATUSES.has(current.status)) {
    return projectJob(current);
  }
  if (current.status !== STARTABLE_JOB_STATUS) {
    throw versionConflict("Knowledge job is not startable in its current status");
  }

  const updated = await dependencies.db.knowledgeJob.updateMany({
    where: { id: jobId, status: STARTABLE_JOB_STATUS, version: current.version },
    data: { status: "worker_running", version: { increment: 1 }, updatedAt: now },
  });
  if (updated.count !== 1) {
    throw versionConflict("Knowledge job changed while starting");
  }
  const canonical = await dependencies.db.knowledgeJob.findUnique({ where: { id: jobId } });
  if (!canonical) throw notFound("Knowledge job not found");
  return projectJob(canonical);
}

function assertSameJob(existing: KnowledgeJobRow, requested: KnowledgeJobRow): void {
  const immutableFields: Array<keyof KnowledgeJobRow> = [
    "projectDigest",
    "taskId",
    "mode",
    "templateVersionId",
    "policyVersion",
    "dedupeKey",
    "sourceSnapshotDigest",
  ];
  if (immutableFields.some((field) => existing[field] !== requested[field])) {
    throw versionConflict("Knowledge Job identity was reused with changed immutable input");
  }
}

function projectJob(row: KnowledgeJobRow): KnowledgeJobProjection {
  return {
    id: row.id,
    projectDigest: row.projectDigest,
    taskId: row.taskId,
    mode: row.mode,
    status: row.status,
    templateVersionId: row.templateVersionId,
    policyVersion: row.policyVersion,
    dedupeKey: row.dedupeKey,
    sourceSnapshot: row.sourceSnapshot,
    sourceSnapshotDigest: row.sourceSnapshotDigest,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw validationError(`${field} is required`);
  return normalized;
}

function requiredDigest(value: string, field: string): string {
  const normalized = requiredText(value, field);
  if (!/^[a-f0-9]{32}$/u.test(normalized)) throw validationError(`${field} must be a lowercase MD5 digest`);
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
