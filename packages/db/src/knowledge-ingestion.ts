import {
  getKnowledgeBatchProjection,
  submitKnowledgeBatch,
  type KnowledgeBatchDependencies,
  type KnowledgeBatchProjection,
  type SubmitKnowledgeBatchInput,
} from "./knowledge-batches";
import {
  decideKnowledgeBatch,
  publishKnowledgeBatch,
  type KnowledgeEntryDependencies,
  type PublishKnowledgeBatchResult,
} from "./knowledge-entries";
import { createKnowledgeIndexJob, type CreateKnowledgeIndexJobInput } from "./knowledge-index-jobs";
import { KNOWLEDGE_CHUNKER_VERSION } from "@humanthread/shared";
import { prisma } from "./prisma";

export interface SubmitKnowledgeBatchForIngestionInput extends SubmitKnowledgeBatchInput {
  actorDigest: string;
}

export interface KnowledgeIngestionDependencies {
  db: KnowledgeBatchDependencies["db"] & KnowledgeEntryDependencies["db"];
  now?: () => Date;
  enqueueIndex?: (input: CreateKnowledgeIndexJobInput) => Promise<unknown>;
  embeddingProfileId?: string;
}

const DEFAULT_DEPENDENCIES: KnowledgeIngestionDependencies = {
  db: prisma as unknown as KnowledgeIngestionDependencies["db"],
};

export async function submitKnowledgeBatchForIngestion(
  input: SubmitKnowledgeBatchForIngestionInput,
  dependencies: KnowledgeIngestionDependencies = DEFAULT_DEPENDENCIES,
): Promise<KnowledgeBatchProjection> {
  const { actorDigest, ...submission } = input;
  const batch = await submitKnowledgeBatch(submission, {
    db: dependencies.db,
    ...(dependencies.now ? { now: dependencies.now } : {}),
  });
  if (batch.status !== "policy_evaluating") return batch;

  await publishKnowledgeBatch(batch.id, actorDigest, {
    db: dependencies.db,
    ...(dependencies.now ? { now: dependencies.now } : {}),
  });
  const published = await getKnowledgeBatchProjection(batch.id, { db: dependencies.db });
  if (!published) throw notFound("Knowledge batch disappeared during publication");
  await enqueueKnowledgeIndex(batch.id, dependencies);
  return published;
}

/**
 * Applies a review decision through the same ingestion orchestration as an
 * automatic publication. A final approval publishes immutable entry versions
 * and must enqueue indexing; otherwise the batch stays in `archiving` and the
 * approved knowledge never becomes searchable.
 */
export async function decideKnowledgeBatchForIngestion(
  input: {
    batchId: string;
    actorDigest: string;
    commandId: string;
    decision: "approve" | "reject";
    itemIds?: string[];
    reason?: string;
  },
  dependencies: KnowledgeIngestionDependencies = DEFAULT_DEPENDENCIES,
): Promise<PublishKnowledgeBatchResult> {
  const result = await decideKnowledgeBatch(input, {
    db: dependencies.db,
    ...(dependencies.now ? { now: dependencies.now } : {}),
  });
  if (result.entries.length > 0 && result.unresolvedItemIds.length === 0) {
    await enqueueKnowledgeIndex(input.batchId, dependencies);
  }
  return result;
}

async function enqueueKnowledgeIndex(
  batchId: string,
  dependencies: KnowledgeIngestionDependencies,
): Promise<void> {
  const embeddingProfileId = dependencies.embeddingProfileId?.trim()
    ?? process.env.HUMANTHREAD_KNOWLEDGE_EMBEDDING_PROFILE_ID?.trim();
  if (!embeddingProfileId || !/^[a-f0-9]{32}$/u.test(embeddingProfileId)) return;
  const batchRow = await dependencies.db.knowledgeBatch.findUnique({
    where: { id: batchId },
  });
  if (!batchRow) throw notFound("Knowledge batch disappeared before index job creation");
  await (dependencies.enqueueIndex ?? ((input) => createKnowledgeIndexJob(input, dependencies.db as never)))({
    projectDigest: batchRow.projectDigest,
    batchId,
    embeddingProfileId,
    chunkerVersion: KNOWLEDGE_CHUNKER_VERSION,
  });
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: "not_found" });
}
