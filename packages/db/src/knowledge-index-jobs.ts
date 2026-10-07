import type {
  KnowledgeIndexJobProjection,
  KnowledgeIndexJobStatus,
  KnowledgeIndexStage,
  KnowledgeIndexVersionProjection,
} from "@humanthread/shared";

import { knowledgeId } from "./knowledge-reference";
import { KNOWLEDGE_TRANSACTION_OPTIONS } from "./knowledge-jobs";
import { prisma } from "./prisma";

interface KnowledgeIndexJobRow {
  id: string;
  projectDigest: string;
  batchId: string;
  embeddingProfileId: string;
  chunkerVersion: string;
  indexVersion: number;
  indexVersionId: string | null;
  status: string;
  stage: string;
  failedStage: string | null;
  progress: number;
  processedChunks: number;
  totalChunks: number;
  retryCount: number;
  claimedAt: Date | null;
  heartbeatAt: Date | null;
  failureClass: string | null;
  failureMessage: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

interface KnowledgeIndexVersionRow {
  id: string;
  projectDigest: string;
  embeddingProfileId: string;
  chunkerVersion: string;
  indexVersion: number;
  collectionName: string;
  aliasName: string;
  status: string;
  pointCount: number;
  activatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface KnowledgeIndexJobTx {
  knowledgeIndexJob: {
    findUnique(args: { where: { id: string } }): Promise<KnowledgeIndexJobRow | null>;
    createMany(args: { data: KnowledgeIndexJobRow[]; skipDuplicates: boolean }): Promise<{ count: number }>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
  knowledgeIndexVersion: {
    findUnique(args: { where: { id: string } }): Promise<KnowledgeIndexVersionRow | null>;
    createMany(args: { data: KnowledgeIndexVersionRow[]; skipDuplicates: boolean }): Promise<{ count: number }>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
  knowledgeBatch: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string; jobId: string } | null>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
  knowledgeJob: {
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
}

interface KnowledgeIndexJobDb extends KnowledgeIndexJobTx {
  $transaction<T>(callback: (tx: KnowledgeIndexJobTx) => Promise<T>, options?: { maxWait?: number; timeout?: number }): Promise<T>;
}

const STAGE_ORDER: KnowledgeIndexStage[] = ["queued", "chunking", "embedding", "indexing", "activating", "active"];

export interface CreateKnowledgeIndexJobInput {
  projectDigest: string;
  batchId: string;
  embeddingProfileId: string;
  chunkerVersion: string;
}

export async function createKnowledgeIndexJob(
  input: CreateKnowledgeIndexJobInput,
  db: KnowledgeIndexJobDb = prisma as unknown as KnowledgeIndexJobDb,
): Promise<KnowledgeIndexJobProjection> {
  const id = knowledgeId("knowledge-index-job", input.batchId, input.embeddingProfileId, input.chunkerVersion);
  const now = new Date();
  return db.$transaction(async (tx) => {
    const existing = await tx.knowledgeIndexJob.findUnique({ where: { id } });
    if (existing) return projectJob(existing);
    await tx.knowledgeIndexJob.createMany({
      data: [{
        id,
        projectDigest: requiredDigest(input.projectDigest, "projectDigest"),
        batchId: requiredDigest(input.batchId, "batchId"),
        embeddingProfileId: requiredDigest(input.embeddingProfileId, "embeddingProfileId"),
        chunkerVersion: requiredText(input.chunkerVersion, "chunkerVersion"),
        indexVersion: 1,
        indexVersionId: null,
        status: "queued",
        stage: "queued",
        failedStage: null,
        progress: 0,
        processedChunks: 0,
        totalChunks: 0,
        retryCount: 0,
        claimedAt: null,
        heartbeatAt: null,
        failureClass: null,
        failureMessage: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      }],
      skipDuplicates: true,
    });
    const created = await tx.knowledgeIndexJob.findUnique({ where: { id } });
    if (!created) throw notFound("Knowledge index job was not created");
    return projectJob(created);
  }, KNOWLEDGE_TRANSACTION_OPTIONS);
}

export async function claimKnowledgeIndexJob(
  id: string,
  db: KnowledgeIndexJobDb = prisma as unknown as KnowledgeIndexJobDb,
): Promise<KnowledgeIndexJobProjection | null> {
  const now = new Date();
  return db.$transaction(async (tx) => {
    const current = await tx.knowledgeIndexJob.findUnique({ where: { id: requiredDigest(id, "id") } });
    if (!current || current.status !== "queued") return null;
    const claimed = await tx.knowledgeIndexJob.updateMany({
      where: { id, status: "queued", version: current.version },
      data: { status: "running", stage: "chunking", claimedAt: now, heartbeatAt: now, version: { increment: 1 }, updatedAt: now },
    });
    if (claimed.count !== 1) return null;
    return projectJob(await requiredRow(tx, id));
  }, KNOWLEDGE_TRANSACTION_OPTIONS);
}

export async function updateKnowledgeIndexProgress(
  input: {
    id: string;
    stage: KnowledgeIndexStage;
    processedChunks: number;
    totalChunks: number;
    version: number;
  },
  db: KnowledgeIndexJobDb = prisma as unknown as KnowledgeIndexJobDb,
): Promise<KnowledgeIndexJobProjection> {
  if (!Number.isInteger(input.processedChunks) || !Number.isInteger(input.totalChunks)
    || input.processedChunks < 0 || input.totalChunks < 0 || input.processedChunks > input.totalChunks) {
    throw validationError("Knowledge index progress counts are invalid");
  }
  if (input.stage === "queued" || input.stage === "failed") {
    throw validationError("Knowledge index progress stage is invalid");
  }
  const progress = input.totalChunks === 0 ? 0 : Math.floor((input.processedChunks / input.totalChunks) * 100);
  return db.$transaction(async (tx) => {
    const current = await requiredRow(tx, input.id);
    assertStageTransition(current.stage as KnowledgeIndexStage, input.stage);
    const updated = await tx.knowledgeIndexJob.updateMany({
      where: { id: input.id, status: "running", version: input.version },
      data: {
        stage: input.stage,
        progress,
        processedChunks: input.processedChunks,
        totalChunks: input.totalChunks,
        heartbeatAt: new Date(),
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (updated.count !== 1) throw versionConflict("Knowledge index job changed while updating progress");
    return projectJob(await requiredRow(tx, input.id));
  }, KNOWLEDGE_TRANSACTION_OPTIONS);
}

export async function completeKnowledgeIndexJob(
  input: { id: string; indexVersionId: string; indexVersion: number; embeddingProfileId: string; chunkerVersion: string; collectionName: string; aliasName: string; pointCount: number; version: number },
  db: KnowledgeIndexJobDb = prisma as unknown as KnowledgeIndexJobDb,
): Promise<KnowledgeIndexJobProjection> {
  return db.$transaction(async (tx) => {
    const current = await requiredRow(tx, input.id);
    if (current.status === "active") return projectJob(current);
    if (current.status !== "running" || current.stage !== "activating") {
      throw conflict("Knowledge index job is not ready for activation");
    }
    const now = new Date();
    await tx.knowledgeIndexVersion.createMany({
      data: [{
        id: input.indexVersionId,
        projectDigest: current.projectDigest,
        embeddingProfileId: input.embeddingProfileId,
        chunkerVersion: input.chunkerVersion,
        indexVersion: input.indexVersion,
        collectionName: input.collectionName,
        aliasName: input.aliasName,
        status: "active",
        pointCount: input.pointCount,
        activatedAt: now,
        createdAt: now,
        updatedAt: now,
      }],
      skipDuplicates: true,
    });
    const updated = await tx.knowledgeIndexJob.updateMany({
      where: { id: input.id, status: "running", version: input.version },
      data: {
        status: "active",
        stage: "active",
        indexVersionId: input.indexVersionId,
        progress: 100,
        processedChunks: input.pointCount,
        totalChunks: input.pointCount,
        failureClass: null,
        failureMessage: null,
        heartbeatAt: now,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    if (updated.count !== 1) throw versionConflict("Knowledge index job changed while activating");

    // The index is now active, so the batch and its KnowledgeJob must leave the
    // intermediate archiving/ingesting states. Without this the pipeline stalls
    // forever even though the entries are already searchable.
    const batch = await tx.knowledgeBatch.findUnique({ where: { id: current.batchId } });
    if (!batch) throw notFound("Knowledge batch not found while activating its index");
    await tx.knowledgeBatch.updateMany({
      where: { id: current.batchId },
      data: {
        status: "searchable",
        progress: 100,
        completedAt: now,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    await tx.knowledgeJob.updateMany({
      where: { id: batch.jobId, status: "ingesting" },
      data: { status: "searchable", version: { increment: 1 }, updatedAt: now },
    });
    return projectJob(await requiredRow(tx, input.id));
  }, KNOWLEDGE_TRANSACTION_OPTIONS);
}

export async function failKnowledgeIndexJob(
  input: { id: string; stage: KnowledgeIndexStage; failureClass: "transient" | "input" | "permanent"; failureMessage: string; version: number },
  db: KnowledgeIndexJobDb = prisma as unknown as KnowledgeIndexJobDb,
): Promise<KnowledgeIndexJobProjection> {
  const now = new Date();
  return db.$transaction(async (tx) => {
    const updated = await tx.knowledgeIndexJob.updateMany({
      where: { id: input.id, status: "running", version: input.version },
      data: {
        status: "failed",
        stage: input.stage,
        failedStage: input.stage,
        failureClass: input.failureClass,
        failureMessage: safeFailureMessage(input.failureMessage),
        heartbeatAt: now,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    if (updated.count !== 1) throw versionConflict("Knowledge index job changed while failing");
    return projectJob(await requiredRow(tx, input.id));
  }, KNOWLEDGE_TRANSACTION_OPTIONS);
}

export async function retryKnowledgeIndexJob(
  input: { id: string; commandId: string },
  db: KnowledgeIndexJobDb = prisma as unknown as KnowledgeIndexJobDb,
): Promise<KnowledgeIndexJobProjection> {
  return db.$transaction(async (tx) => {
    const current = await requiredRow(tx, input.id);
    if (current.status !== "failed") throw conflict("Knowledge index job is not failed");
    if (!current.failedStage) throw validationError("Knowledge index job failed stage is missing");
    const updated = await tx.knowledgeIndexJob.updateMany({
      where: { id: input.id, status: "failed", version: current.version },
      data: {
        status: "running",
        stage: current.failedStage,
        failedStage: null,
        failureClass: null,
        failureMessage: null,
        retryCount: { increment: 1 },
        claimedAt: new Date(),
        heartbeatAt: new Date(),
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (updated.count !== 1) throw versionConflict("Knowledge index job changed while retrying");
    return projectJob(await requiredRow(tx, input.id));
  }, KNOWLEDGE_TRANSACTION_OPTIONS);
}

function assertStageTransition(from: KnowledgeIndexStage, to: KnowledgeIndexStage): void {
  const fromIndex = STAGE_ORDER.indexOf(from);
  const toIndex = STAGE_ORDER.indexOf(to);
  if (fromIndex < 0 || toIndex < 0 || toIndex < fromIndex) {
    throw validationError(`Invalid knowledge index stage transition: ${from} -> ${to}`);
  }
}

async function requiredRow(tx: KnowledgeIndexJobTx, id: string): Promise<KnowledgeIndexJobRow> {
  const row = await tx.knowledgeIndexJob.findUnique({ where: { id } });
  if (!row) throw notFound("Knowledge index job not found");
  return row;
}

function projectJob(row: KnowledgeIndexJobRow): KnowledgeIndexJobProjection {
  return {
    ...row,
    status: row.status as KnowledgeIndexJobStatus,
    stage: row.stage as KnowledgeIndexStage,
    failedStage: row.failedStage as KnowledgeIndexStage | null,
  };
}

function requiredDigest(value: string, field: string): string {
  const normalized = requiredText(value, field);
  if (!/^[a-f0-9]{32}$/u.test(normalized)) throw validationError(`${field} must be a lowercase MD5 digest`);
  return normalized;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw validationError(`${field} is required`);
  return normalized;
}

function safeFailureMessage(value: string): string {
  return value.replace(/\b(?:Bearer\s+)?[A-Za-z0-9._~+\/-]{24,}\b/gu, "[REDACTED]").slice(0, 2_000);
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}

function versionConflict(message: string): Error {
  return Object.assign(new Error(message), { code: "version_conflict" });
}

function conflict(message: string): Error {
  return Object.assign(new Error(message), { code: "conflict" });
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: "not_found" });
}
