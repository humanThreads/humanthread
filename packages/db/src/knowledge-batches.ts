import type {
  KnowledgeBatchStatus,
  KnowledgeChangeType,
  KnowledgeEntryType,
} from "@humanthread/shared";
import {
  KNOWLEDGE_BATCH_ITEM_LIMIT,
  scanKnowledgeSensitiveValue,
} from "@humanthread/shared";

import {
  evaluateKnowledgePublish,
  PLATFORM_SAFE_KNOWLEDGE_POLICY,
  resolveKnowledgePolicy,
  type KnowledgePolicyOverride,
  type KnowledgePolicySnapshot,
} from "./knowledge-policy";
import { KNOWLEDGE_TRANSACTION_OPTIONS } from "./knowledge-jobs";
import { knowledgeDigest, knowledgeId } from "./knowledge-reference";
import {
  isKnowledgeSourceSnapshotFresh,
  knowledgeSourceSnapshotDigest,
  parseKnowledgeSourceSnapshot,
  type KnowledgeSourceSnapshot,
} from "./knowledge-snapshot";
import { resolveKnowledgeSources } from "./knowledge-source-resolution";
import { prisma } from "./prisma";

export const MAX_KNOWLEDGE_BATCH_ITEMS = KNOWLEDGE_BATCH_ITEM_LIMIT;

export interface KnowledgeBatchProjection {
  id: string;
  jobId: string;
  status: KnowledgeBatchStatus;
  failedStage: string | null;
  progress: number;
  processedChunks: number;
  totalChunks: number;
  retryCount: number;
  failureClass: string | null;
  failureMessage: string | null;
  receivedAt: Date;
  updatedAt: Date;
}

export interface SubmitKnowledgeBatchInput {
  commandId: string;
  jobId: string;
  submissionId: string;
  templateDigest: string;
  sourceSnapshot: Record<string, unknown>;
  items: Array<{
    stableKey: string;
    changeType: KnowledgeChangeType;
    sourceType: string;
    entryType: KnowledgeEntryType;
    scope: "project" | "space";
    title: string;
    summary: string;
    bodyMarkdown: string;
    confidence: number;
    tags?: string[];
    changeSummary?: string | undefined;
    baseVersion?: number | null;
    validFrom?: Date | string | null;
    validUntil?: Date | string | null;
    evidence: unknown;
    relations: unknown;
  }>;
}

export interface RetryKnowledgeBatchInput {
  batchId: string;
  commandId: string;
}

interface KnowledgeBatchRow {
  id: string;
  jobId: string;
  projectDigest: string;
  status: KnowledgeBatchStatus;
  failedStage: string | null;
  progress: number;
  processedChunks: number;
  totalChunks: number;
  retryCount: number;
  failureClass: string | null;
  failureMessage: string | null;
  receivedAt: Date;
  updatedAt: Date;
  version?: number;
}

interface KnowledgeBatchTx {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  knowledgeJob: {
    findUnique(args: { where: { id: string } }): Promise<KnowledgeJobRow | null>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  knowledgePolicy: {
    findUnique(args: { where: { projectDigest: string } }): Promise<KnowledgePolicyRow | null>;
  };
  knowledgeTemplateVersion: {
    findUnique(args: {
      where: { id: string };
      include: { template: true };
    }): Promise<KnowledgeTemplateVersionRow | null>;
  };
  knowledgeEntry: {
    findUnique(args: {
      where: {
        projectDigest_stableKey: { projectDigest: string; stableKey: string };
      };
    }): Promise<KnowledgeEntryConflictRow | null>;
  };
  knowledgeRelation: {
    findMany(args: {
      where: { projectDigest: string; fromEntryId: string; active: true };
    }): Promise<KnowledgeRelationConflictRow[]>;
  };
  knowledgeBatch: {
    findUnique(args: {
      where: { id: string } | { jobId_submissionId: { jobId: string; submissionId: string } };
    }): Promise<KnowledgeBatchRow | null>;
    findUniqueOrThrow(args: { where: { id: string } }): Promise<KnowledgeBatchRow>;
    createMany(args: {
      data: Array<Record<string, unknown>>;
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  knowledgeBatchItem: {
    createMany(args: {
      data: Array<Record<string, unknown>>;
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
  };
  commandReceipt: CommandReceiptStore;
}

interface KnowledgeJobRow {
  id: string;
  projectDigest: string;
  taskId: string;
  mode: string;
  status: string;
  templateVersionId: string;
  policyVersion: number;
  dedupeKey: string;
  sourceSnapshot: Record<string, unknown>;
  sourceSnapshotDigest: string;
  version: number;
}

interface KnowledgePolicyRow extends KnowledgePolicySnapshot {
  id: string;
  projectDigest: string;
  version: number;
  sourceTypeOverrides: unknown;
}

interface KnowledgeTemplateVersionRow {
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
}

interface KnowledgeEntryConflictRow {
  id: string;
  projectDigest: string;
  stableKey: string;
  status: string;
  latestVersion: number;
  publishedVersion: number | null;
  version?: number;
}

interface KnowledgeRelationConflictRow {
  id: string;
  fromEntryId: string;
  fromVersion: number;
  toStableKey: string;
  relationType: string;
  active: boolean;
}

interface CommandReceiptStore {
  findUnique(args: { where: { id: string } }): Promise<{
    id: string;
    status: string;
    result: unknown;
  } | null>;
  createMany(args: {
    data: Array<Record<string, unknown>>;
    skipDuplicates: boolean;
  }): Promise<{ count: number }>;
}

export interface KnowledgeBatchDependencies {
  db: Omit<KnowledgeBatchTx, "$transaction"> & {
    $transaction<T>(
      callback: (tx: KnowledgeBatchTx) => Promise<T>,
      options?: { maxWait?: number; timeout?: number },
    ): Promise<T>;
  };
  now?: () => Date;
}

const DEFAULT_DEPENDENCIES: KnowledgeBatchDependencies = {
  db: prisma as unknown as KnowledgeBatchDependencies["db"],
};

interface EvaluatedSubmissionItem {
  item: SubmitKnowledgeBatchInput["items"][number];
  outcome: "auto_publish" | "review_required";
  reason: string | null;
}

async function evaluateSubmissionItems(input: {
  tx: KnowledgeBatchTx;
  job: KnowledgeJobRow;
  policy: KnowledgePolicyRow;
  snapshot: KnowledgeSourceSnapshot;
  items: SubmitKnowledgeBatchInput["items"];
  now: Date;
}): Promise<EvaluatedSubmissionItem[]> {
  const overrides = parsePolicyOverrides(input.policy.sourceTypeOverrides);
  const batchStableKeys = new Set(input.items.map((item) => item.stableKey));
  const snapshotFresh = isKnowledgeSourceSnapshotFresh(input.snapshot, input.now);

  return Promise.all(input.items.map(async (rawItem) => {
    const scanned = scanKnowledgeSensitiveValue(rawItem);
    const item = {
      ...scanned.safeValue,
      tags: normalizeTags(scanned.safeValue.tags),
      changeSummary: scanned.safeValue.changeSummary?.trim() || scanned.safeValue.summary,
    };
    const evidence = parseEvidence(item.evidence);
    const resolvedSources = evidence.length === 0
      ? []
      : await resolveKnowledgeSources({
          projectDigest: input.job.projectDigest,
          references: evidence.map((reference) => ({
            kind: String(reference.kind),
            ref: String(reference.ref),
            sourceType: String(reference.sourceType ?? item.sourceType),
          })),
        }, input.tx as never);
    const provenanceComplete = evidence.length > 0 && resolvedSources.every((source) => source.accessible && !source.missing);
    const matchingSources = resolvedSources.filter((source) => source.sourceType === item.sourceType);
    const sourceActivity = matchingSources.length > 0 && matchingSources.every((source) => source.active)
      ? { active: true, reason: null }
      : { active: false, reason: matchingSources.length === 0 ? "source_reference_missing" : "source_inactive" };
    const conflict = await deriveConflictState(
      input.tx,
      input.job.projectDigest,
      item,
      batchStableKeys,
    );
    const resolvedPolicy = resolveKnowledgePolicy(input.policy, {
      sourceType: item.sourceType,
      entryType: item.entryType,
      overrides,
    });
    const decision = evaluateKnowledgePublish({
      sourceType: item.sourceType,
      entryType: item.entryType,
      changeType: item.changeType,
      confidence: item.confidence,
      provenanceComplete,
      redactionClean: scanned.redactionResult.status === "clean",
      conflictFree: conflict.conflictFree,
      sourceActive: snapshotFresh && sourceActivity.active,
    }, resolvedPolicy);
    const reasons = Array.from(new Set([
      ...decision.reasons,
      ...(!snapshotFresh ? ["source_snapshot_stale"] : []),
      ...(sourceActivity.reason ? [sourceActivity.reason] : []),
      ...(conflict.reason ? [conflict.reason] : []),
    ]));
    return {
      item,
      outcome: reasons.length === 0 ? "auto_publish" : "review_required",
      reason: reasons.length === 0 ? null : reasons.join(","),
    };
  }));
}

function assertJobSubmittable(job: KnowledgeJobRow): void {
  if (job.status !== "worker_running" && job.status !== "awaiting_submission") {
    throw conflict("Knowledge Job is not accepting a submission");
  }
}

function parseEvidence(value: unknown): Array<Record<string, unknown> & { kind: string; ref: string }> {
  if (!Array.isArray(value) || value.length === 0) return [];
  return value.flatMap((evidence) => {
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return [];
    const record = evidence as Record<string, unknown>;
    if (!nonEmptyString(record.kind) || !nonEmptyString(record.ref)) return [];
    return [{ ...record, kind: record.kind, ref: record.ref }];
  });
}

async function deriveConflictState(
  tx: KnowledgeBatchTx,
  projectDigest: string,
  item: SubmitKnowledgeBatchInput["items"][number],
  batchStableKeys: Set<string>,
): Promise<{ conflictFree: boolean; reason: string | null }> {
  try {
    const current = await tx.knowledgeEntry.findUnique({
      where: { projectDigest_stableKey: { projectDigest, stableKey: item.stableKey } },
    });
    if (item.changeType === "create") {
      if (current) return { conflictFree: false, reason: "conflict_detected" };
      return validateRelationConflicts(tx, projectDigest, current, item, batchStableKeys);
    }
    if (!current) return { conflictFree: false, reason: "conflict_detected" };
    if (item.baseVersion !== current.latestVersion) {
      return { conflictFree: false, reason: "conflict_detected" };
    }
    if (
      (item.changeType === "update" || item.changeType === "expire" || item.changeType === "supersede")
      && current.status !== "published"
    ) {
      return { conflictFree: false, reason: "conflict_detected" };
    }
    if (
      item.changeType === "delete"
      && current.status !== "published"
      && current.status !== "expired"
    ) {
      return { conflictFree: false, reason: "conflict_detected" };
    }
    return validateRelationConflicts(tx, projectDigest, current, item, batchStableKeys);
  } catch {
    return { conflictFree: false, reason: "conflict_check_unavailable" };
  }
}

async function validateRelationConflicts(
  tx: KnowledgeBatchTx,
  projectDigest: string,
  current: KnowledgeEntryConflictRow | null,
  item: SubmitKnowledgeBatchInput["items"][number],
  batchStableKeys: Set<string>,
): Promise<{ conflictFree: boolean; reason: string | null }> {
  if (!Array.isArray(item.relations)) return { conflictFree: false, reason: "conflict_detected" };
  const seen = new Set<string>();
  for (const rawRelation of item.relations) {
    if (!rawRelation || typeof rawRelation !== "object" || Array.isArray(rawRelation)) {
      return { conflictFree: false, reason: "conflict_detected" };
    }
    const relation = rawRelation as Record<string, unknown>;
    const targetKey = String(relation.targetKey ?? relation.toStableKey ?? relation.target ?? "").trim();
    const relationType = String(relation.type ?? relation.relationType ?? "").trim();
    if (!targetKey || !relationType) return { conflictFree: false, reason: "conflict_detected" };
    const identity = `${targetKey}\0${relationType}`;
    if (seen.has(identity)) return { conflictFree: false, reason: "conflict_detected" };
    seen.add(identity);
    if (batchStableKeys.has(targetKey)) continue;
    const target = await tx.knowledgeEntry.findUnique({
      where: { projectDigest_stableKey: { projectDigest, stableKey: targetKey } },
    });
    if (!target || target.status !== "published" || target.publishedVersion === null) {
      return { conflictFree: false, reason: "conflict_detected" };
    }
  }

  if (current) {
    await tx.knowledgeRelation.findMany({
      where: { projectDigest, fromEntryId: current.id, active: true },
    });
  }
  return { conflictFree: true, reason: null };
}

function parsePolicyOverrides(value: unknown): KnowledgePolicyOverride[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw validationError(`Knowledge policy override ${index} is invalid`);
    }
    const record = entry as Record<string, unknown>;
    const sourceType = requiredId(String(record.sourceType ?? ""), "policyOverride.sourceType");
    const entryType = String(record.entryType ?? "");
    if (!isKnowledgeEntryType(entryType)) {
      throw validationError("Knowledge policy override entryType is invalid");
    }
    return { ...record, sourceType, entryType } as KnowledgePolicyOverride;
  });
}

function normalizeTags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw validationError("Knowledge tags must be an array");
  return Array.from(new Set(value.map((tag) => requiredText(String(tag), "tag"))));
}

function isKnowledgeEntryType(value: string): value is KnowledgeEntryType {
  return ["rule", "decision", "experience", "interface", "term", "risk", "procedure"].includes(value);
}

export async function submitKnowledgeBatch(
  input: SubmitKnowledgeBatchInput,
  dependencies: KnowledgeBatchDependencies = DEFAULT_DEPENDENCIES,
): Promise<KnowledgeBatchProjection> {
  const jobId = requiredId(input.jobId, "jobId");
  const commandId = requiredId(input.commandId, "commandId");
  assertBatchItemCount(input.items);
  assertUniqueItems(input.items);
  const templateDigest = requiredDigest(input.templateDigest, "templateDigest");
  const submissionId = knowledgeDigest("knowledge-submission", input.submissionId);
  const batchId = knowledgeId("knowledge-batch", jobId, submissionId);
  const receiptId = knowledgeId("knowledge-submit", jobId, commandId);
  const now = dependencies.now?.() ?? new Date();

  return dependencies.db.$transaction(async (tx) => {
    const job = await lockKnowledgeJob(tx, jobId);
    const existingReceipt = await readCommandReceiptCurrent(tx, receiptId);
    if (existingReceipt) return projectReceiptBatch(tx, existingReceipt);
    const existing = await tx.knowledgeBatch.findUnique({
      where: { jobId_submissionId: { jobId, submissionId } },
    });
    if (existing) {
      const replayed = await claimCommandReceipt(tx, {
        id: receiptId,
        aggregateType: "knowledge_batch",
        aggregateId: existing.id,
        result: { batchId: existing.id },
        now,
      });
      return replayed ?? projectKnowledgeBatch(existing);
    }

    assertJobSubmittable(job);
    const snapshot = parseKnowledgeSourceSnapshot(input.sourceSnapshot);
    if (knowledgeSourceSnapshotDigest(snapshot.value) !== job.sourceSnapshotDigest) {
      throw versionConflict("Knowledge source snapshot does not match the Job snapshot");
    }

    const templateVersion = await tx.knowledgeTemplateVersion.findUnique({
      where: { id: job.templateVersionId },
      include: { template: true },
    });
    if (
      !templateVersion
      || templateVersion.id !== job.templateVersionId
      || templateVersion.contentHash !== templateDigest
      || templateVersion.template.projectDigest !== job.projectDigest
      || templateVersion.template.mode !== job.mode
      || templateVersion.template.status !== "published"
    ) {
      throw versionConflict("Knowledge template does not match the Job submission");
    }

    const projectPolicy = await tx.knowledgePolicy.findUnique({ where: { projectDigest: job.projectDigest } });
    if (projectPolicy && (
      projectPolicy.projectDigest !== job.projectDigest
      || projectPolicy.version !== job.policyVersion
    )) {
      throw versionConflict("Knowledge policy version is stale for the Job");
    }
    const policy: KnowledgePolicyRow = projectPolicy ?? {
      id: knowledgeId("knowledge-policy", job.projectDigest),
      projectDigest: job.projectDigest,
      version: job.policyVersion,
      sourceTypeOverrides: [],
      ...PLATFORM_SAFE_KNOWLEDGE_POLICY,
    };

    const decisions = await evaluateSubmissionItems({
      tx,
      job,
      policy,
      snapshot,
      items: input.items,
      now,
    });
    const status: KnowledgeBatchStatus = decisions.every((decision) => decision.outcome === "auto_publish")
      ? "policy_evaluating"
      : "review_required";
    const claimedProjection = await claimCommandReceipt(tx, {
      id: receiptId,
      aggregateType: "knowledge_batch",
      aggregateId: batchId,
      result: { batchId },
      now,
    });
    if (claimedProjection) return claimedProjection;

    const inserted = await tx.knowledgeBatch.createMany({
      data: [{
        id: batchId,
        jobId,
        projectDigest: job.projectDigest,
        submissionId,
        templateDigest,
        status,
        failedStage: null,
        progress: status === "review_required" ? 30 : 10,
        processedChunks: 0,
        totalChunks: 0,
        retryCount: 0,
        failureClass: null,
        failureMessage: null,
        receivedAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      }],
      skipDuplicates: true,
    });
    if (inserted.count === 0) {
      return projectKnowledgeBatch(await readBatchBySubmissionCurrent(tx, jobId, submissionId));
    }

    if (input.items.length > 0) {
      const insertedItems = await tx.knowledgeBatchItem.createMany({
        data: decisions.map(({ item, outcome, reason }, index) => ({
          id: knowledgeId("knowledge-batch-item", batchId, item.stableKey, item.changeType),
          batchId,
          ordinal: index,
          stableKey: item.stableKey,
          changeType: item.changeType,
          sourceType: item.sourceType,
          entryType: item.entryType,
          title: item.title,
          scope: item.scope,
          summary: item.summary,
          bodyMarkdown: item.bodyMarkdown,
          confidence: item.confidence,
          tags: item.tags ?? [],
          changeSummary: item.changeSummary,
          evidence: item.evidence,
          relations: item.relations,
          baseVersion: item.baseVersion ?? null,
          validFrom: optionalDateTime(item.validFrom, "validFrom"),
          validUntil: optionalDateTime(item.validUntil, "validUntil"),
          decision: outcome,
          decisionReason: reason,
          publishedVersion: null,
          createdAt: now,
        })),
        skipDuplicates: false,
      });
      if (insertedItems.count !== input.items.length) {
        throw validationError("Knowledge batch items were not persisted atomically");
      }
    }

    const updatedJob = await tx.knowledgeJob.updateMany({
      where: {
        id: job.id,
        status: job.status,
        ...(job.version === undefined ? {} : { version: job.version }),
      },
      data: {
        status: "ingesting",
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    if (updatedJob.count !== 1) throw versionConflict("Knowledge Job changed while accepting the batch");

    return projectKnowledgeBatch(await tx.knowledgeBatch.findUniqueOrThrow({ where: { id: batchId } }));
  }, KNOWLEDGE_TRANSACTION_OPTIONS);
}

export async function getKnowledgeBatchProjection(
  batchId: string,
  dependencies: KnowledgeBatchDependencies = DEFAULT_DEPENDENCIES,
): Promise<KnowledgeBatchProjection | null> {
  const row = await dependencies.db.knowledgeBatch.findUnique({
    where: { id: requiredId(batchId, "batchId") },
  });
  return row ? projectKnowledgeBatch(row) : null;
}

export async function retryKnowledgeBatch(
  input: RetryKnowledgeBatchInput,
  dependencies: KnowledgeBatchDependencies = DEFAULT_DEPENDENCIES,
): Promise<KnowledgeBatchProjection> {
  const batchId = requiredId(input.batchId, "batchId");
  const commandId = requiredId(input.commandId, "commandId");
  const receiptId = knowledgeId("knowledge-retry", batchId, commandId);

  return dependencies.db.$transaction(async (tx) => {
    const current = await lockKnowledgeBatchRow(tx, batchId);
    if (!current) throw notFound("Knowledge batch not found");
    const existingReceipt = await readCommandReceiptCurrent(tx, receiptId);
    if (existingReceipt) return projectReceiptBatch(tx, existingReceipt);

    if (current.status !== "failed") throw notRetryable("Knowledge batch is not failed");
    if (current.failureClass === "permanent") {
      throw permanentFailure("Permanent knowledge batch failures require a new submission");
    }
    if (current.failureClass !== "transient") {
      throw notRetryable("Knowledge batch failure is not transient");
    }
    const failedStage = current.failedStage;
    if (!failedStage || !failedStage.trim()) {
      throw failedStageMissing("Knowledge batch failed stage is missing");
    }

    const now = new Date();
    const claimedProjection = await claimCommandReceipt(tx, {
      id: receiptId,
      aggregateType: "knowledge_batch",
      aggregateId: batchId,
      result: { batchId },
      now,
    });
    if (claimedProjection) return claimedProjection;
    const updated = await tx.knowledgeBatch.updateMany({
      where: {
        id: batchId,
        status: "failed",
        failureClass: "transient",
        failedStage,
        ...(current.version === undefined ? {} : { version: current.version }),
      },
      data: {
        status: failedStage,
        failedStage: null,
        failureClass: null,
        failureMessage: null,
        retryCount: { increment: 1 },
        version: { increment: 1 },
        completedAt: null,
        updatedAt: now,
      },
    });
    if (updated.count !== 1) {
      throw versionConflict("Knowledge batch changed while retrying");
    }

    return projectKnowledgeBatch(await tx.knowledgeBatch.findUniqueOrThrow({ where: { id: batchId } }));
  }, KNOWLEDGE_TRANSACTION_OPTIONS);
}

async function lockKnowledgeJob(
  tx: KnowledgeBatchTx,
  jobId: string,
): Promise<KnowledgeJobRow> {
  const rows = await tx.$queryRaw<KnowledgeJobRow[]>`
    SELECT id, projectDigest, taskId, mode, status, templateVersionId, policyVersion,
           dedupeKey, sourceSnapshot, sourceSnapshotDigest, version
    FROM KnowledgeJob
    WHERE id = ${jobId}
    FOR UPDATE
  `;
  const job = rows[0];
  if (!job) throw notFound("Knowledge job not found");
  return job;
}

async function lockKnowledgeBatchRow(
  tx: KnowledgeBatchTx,
  batchId: string,
): Promise<KnowledgeBatchRow | null> {
  const rows = await tx.$queryRaw<KnowledgeBatchRow[]>`
    SELECT id, jobId, status, failedStage, progress, processedChunks, totalChunks, retryCount,
           failureClass, failureMessage, receivedAt, updatedAt, version
    FROM KnowledgeBatch
    WHERE id = ${batchId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function readBatchBySubmissionCurrent(
  tx: KnowledgeBatchTx,
  jobId: string,
  submissionId: string,
): Promise<KnowledgeBatchRow> {
  const rows = await tx.$queryRaw<KnowledgeBatchRow[]>`
    SELECT id, jobId, status, failedStage, progress, processedChunks, totalChunks, retryCount,
           failureClass, failureMessage, receivedAt, updatedAt, version
    FROM KnowledgeBatch
    WHERE jobId = ${jobId} AND submissionId = ${submissionId}
    FOR UPDATE
  `;
  const batch = rows[0];
  if (!batch) throw versionConflict("Knowledge batch insert conflicted without a canonical row");
  return batch;
}

async function claimCommandReceipt(
  tx: KnowledgeBatchTx,
  input: {
    id: string;
    aggregateType: string;
    aggregateId: string;
    result: { batchId: string };
    now: Date;
  },
): Promise<KnowledgeBatchProjection | null> {
  const claimed = await tx.commandReceipt.createMany({
    data: [{
      id: input.id,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      status: "completed",
      result: input.result,
      createdAt: input.now,
      completedAt: input.now,
    }],
    skipDuplicates: true,
  });
  if (claimed.count === 1) return null;

  const racedReceipt = await readCommandReceiptCurrent(tx, input.id);
  if (racedReceipt) return projectReceiptBatch(tx, racedReceipt);
  throw versionConflict("Knowledge command receipt conflicted without a canonical row");
}

async function projectReceiptBatch(
  tx: KnowledgeBatchTx,
  receipt: { id: string; status: string; result: unknown },
): Promise<KnowledgeBatchProjection> {
  if (receipt.status !== "completed") {
    throw commandInProgress("Knowledge command is not completed");
  }
  const batchId = receiptBatchId(receipt.result);
  const rows = await tx.$queryRaw<KnowledgeBatchRow[]>`
    SELECT id, jobId, status, failedStage, progress, processedChunks, totalChunks, retryCount,
           failureClass, failureMessage, receivedAt, updatedAt, version
    FROM KnowledgeBatch
    WHERE id = ${batchId}
    FOR UPDATE
  `;
  const batch = rows[0];
  if (!batch) throw invalidReceipt("Knowledge command receipt has no canonical batch");
  return projectKnowledgeBatch(batch);
}

async function readCommandReceiptCurrent(
  tx: KnowledgeBatchTx,
  receiptId: string,
): Promise<{ id: string; status: string; result: unknown } | null> {
  const rows = await tx.$queryRaw<Array<{ id: string; status: string; result: unknown }>>`
    SELECT id, status, result FROM CommandReceipt WHERE id = ${receiptId} FOR UPDATE
  `;
  return rows[0] ?? null;
}

function receiptBatchId(result: unknown): string {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw invalidReceipt("Knowledge command receipt result is invalid");
  }
  const batchId = (result as Record<string, unknown>).batchId;
  if (typeof batchId !== "string" || !batchId.trim()) {
    throw invalidReceipt("Knowledge command receipt batch is missing");
  }
  return batchId;
}

function assertUniqueItems(items: SubmitKnowledgeBatchInput["items"]): void {
  const keys = new Set<string>();
  for (const item of items) {
    // Reject malformed evidence and relations at intake. Persisting them here
    // would only fail much later during publication, leaving a batch that can
    // never be approved.
    if (!Array.isArray(item.evidence)) {
      throw validationError("Knowledge item evidence must be an array");
    }
    if (!Array.isArray(item.relations)) {
      throw validationError("Knowledge item relations must be an array");
    }
    const key = `${item.stableKey}\0${item.changeType}`;
    if (keys.has(key)) throw validationError("Knowledge batch item keys must be unique");
    keys.add(key);
  }
}

function assertBatchItemCount(items: SubmitKnowledgeBatchInput["items"]): void {
  if (items.length > MAX_KNOWLEDGE_BATCH_ITEMS) {
    throw validationError(`Knowledge batch cannot exceed ${MAX_KNOWLEDGE_BATCH_ITEMS} items`);
  }
}

function projectKnowledgeBatch(row: KnowledgeBatchRow): KnowledgeBatchProjection {
  return {
    id: row.id,
    jobId: row.jobId,
    status: row.status,
    failedStage: row.failedStage,
    progress: row.progress,
    processedChunks: row.processedChunks,
    totalChunks: row.totalChunks,
    retryCount: row.retryCount,
    failureClass: row.failureClass,
    failureMessage: row.failureMessage,
    receivedAt: row.receivedAt,
    updatedAt: row.updatedAt,
  };
}

function requiredId(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw validationError(`${field} is required`);
  return normalized;
}

function requiredDigest(value: string, field: string): string {
  const normalized = requiredId(value, field);
  if (!/^[a-f0-9]{32}$/u.test(normalized)) {
    throw validationError(`${field} must be a lowercase MD5 digest`);
  }
  return normalized;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalDateTime(value: Date | string | null | undefined, field: string): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw validationError(`${field} is invalid`);
  return date;
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: "not_found" });
}

function permanentFailure(message: string): Error {
  return Object.assign(new Error(message), { code: "permanent_failure" });
}

function notRetryable(message: string): Error {
  return Object.assign(new Error(message), { code: "not_retryable" });
}

function failedStageMissing(message: string): Error {
  return Object.assign(new Error(message), { code: "failed_stage_missing" });
}

function conflict(message: string): Error {
  return Object.assign(new Error(message), { code: "conflict" });
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}

function commandInProgress(message: string): Error {
  return Object.assign(new Error(message), { code: "command_in_progress" });
}

function invalidReceipt(message: string): Error {
  return Object.assign(new Error(message), { code: "invalid_command_receipt" });
}

function versionConflict(message: string): Error {
  return Object.assign(new Error(message), { code: "version_conflict" });
}
