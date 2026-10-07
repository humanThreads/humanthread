import {
  knowledgeAliasName,
  knowledgeCollectionName,
  knowledgeIndexVersionId,
  type KnowledgeIndexProgress,
  type KnowledgeVersionSnapshot,
} from "@humanthread/knowledge-indexer";

export interface KnowledgeIndexJobServiceRecord {
  id: string;
  projectDigest: string;
  batchId: string;
  embeddingProfileId: string;
  chunkerVersion: string;
  indexVersion: number;
  collectionName?: string;
  aliasName?: string;
  status: string;
  stage: string;
  failedStage: string | null;
  version: number;
}

export interface KnowledgeIndexJobProgressWriter {
  claim(jobId: string): Promise<KnowledgeIndexJobServiceRecord | null>;
  recordProgress(jobId: string, stage: KnowledgeIndexProgress["stage"], processed: number, total: number, version: number): Promise<number>;
  complete(jobId: string, input: { indexVersionId: string; collectionName: string; aliasName: string; pointCount: number }): Promise<void>;
  fail(jobId: string, input: { stage: string; failureClass: "transient" | "input" | "permanent"; failureMessage: string }): Promise<void>;
}

export interface KnowledgeIndexJobRunner {
  run(input: {
    job: KnowledgeIndexJobServiceRecord;
    versions: KnowledgeVersionSnapshot[];
  }): Promise<{ points: number; progress: KnowledgeIndexProgress[] }>;
}

export async function processKnowledgeIndexJob(input: {
  jobId: string;
  writer: KnowledgeIndexJobProgressWriter;
  runner: KnowledgeIndexJobRunner;
  loadVersions(job: KnowledgeIndexJobServiceRecord): Promise<KnowledgeVersionSnapshot[]>;
}): Promise<KnowledgeIndexJobServiceRecord> {
  const claimed = await input.writer.claim(input.jobId);
  if (!claimed) {
    throw conflict(`Knowledge index job ${input.jobId} cannot be claimed`);
  }
  let currentVersion = claimed.version;
  try {
    const versions = await input.loadVersions(claimed);
    const result = await input.runner.run({ job: claimed, versions });
    for (const event of result.progress) {
      currentVersion = await input.writer.recordProgress(
        claimed.id,
        event.stage,
        event.processed,
        event.total,
        currentVersion,
      );
    }
    const identity = {
      projectDigest: claimed.projectDigest,
      embeddingProfileId: claimed.embeddingProfileId,
      chunkerVersion: claimed.chunkerVersion,
      indexVersion: claimed.indexVersion,
    };
    await input.writer.complete(claimed.id, {
      indexVersionId: knowledgeIndexVersionId(identity),
      collectionName: knowledgeCollectionName(identity),
      aliasName: knowledgeAliasName(claimed.projectDigest),
      pointCount: result.points,
    });
    return { ...claimed, status: "active", stage: "active", version: currentVersion + 1 };
  } catch (error) {
    const stage = error && typeof error === "object" && "stage" in error && typeof error.stage === "string"
      ? error.stage
      : claimed.stage;
    const failureClass = error && typeof error === "object" && "failureClass" in error && ["transient", "input", "permanent"].includes(String(error.failureClass))
      ? error.failureClass as "transient" | "input" | "permanent"
      : "transient";
    await input.writer.fail(claimed.id, {
      stage,
      failureClass,
      failureMessage: error instanceof Error ? error.message : "Knowledge index job failed",
    });
    throw error;
  }
}

function conflict(message: string): Error {
  return Object.assign(new Error(message), { code: "conflict" });
}
