import { createHash } from "node:crypto";

export const KNOWLEDGE_INDEX_STAGES = [
  "queued",
  "chunking",
  "embedding",
  "indexing",
  "activating",
  "active",
  "failed",
] as const;

export type KnowledgeIndexStage = (typeof KNOWLEDGE_INDEX_STAGES)[number];

export const KNOWLEDGE_INDEX_JOB_STATUSES = [
  "queued",
  "running",
  "active",
  "failed",
  "cancelled",
] as const;

export type KnowledgeIndexJobStatus = (typeof KNOWLEDGE_INDEX_JOB_STATUSES)[number];

export const KNOWLEDGE_CHUNKER_VERSION = "knowledge-chunker/v1";

export interface KnowledgeIndexJobProjection {
  id: string;
  projectDigest: string;
  batchId: string;
  embeddingProfileId: string;
  chunkerVersion: string;
  indexVersion: number;
  indexVersionId: string | null;
  status: KnowledgeIndexJobStatus;
  stage: KnowledgeIndexStage;
  failedStage: KnowledgeIndexStage | null;
  progress: number;
  processedChunks: number;
  totalChunks: number;
  retryCount: number;
  failureClass: string | null;
  failureMessage: string | null;
  claimedAt: Date | null;
  heartbeatAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeIndexVersionProjection {
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

export interface KnowledgeEmbeddingProfileInput {
  stableKey: string;
  provider: "onnx";
  modelId: string;
  modelRevision: string;
  modelDigest: string;
  tokenizerVersion: string;
  dimensions: number;
  maxSequenceLength: number;
  normalization: "l2";
  quantization: "int8" | "none";
  runtimeVersion: string;
  threadLimit: number;
  batchSize: number;
  localModelPath: string;
}

function digest(...parts: string[]): string {
  return createHash("md5")
    .update(parts.map((part) => part.trim()).join("\0"))
    .digest("hex");
}

export function knowledgeIndexJobId(input: {
  batchId: string;
  embeddingProfileId: string;
  chunkerVersion: string;
}): string {
  return digest("knowledge-index-job", input.batchId, input.embeddingProfileId, input.chunkerVersion);
}

export function knowledgeIndexVersionId(input: {
  projectDigest: string;
  embeddingProfileId: string;
  chunkerVersion: string;
  indexVersion: number;
}): string {
  return digest(
    "knowledge-index-version",
    input.projectDigest,
    input.embeddingProfileId,
    input.chunkerVersion,
    String(input.indexVersion),
  );
}

export function knowledgeCollectionName(input: {
  projectDigest: string;
  embeddingProfileId: string;
  chunkerVersion: string;
  indexVersion: number;
}): string {
  return `ht-k-${knowledgeIndexVersionId(input)}`;
}

export function knowledgeAliasName(projectDigest: string): string {
  return `ht-k-live-${digest("knowledge-alias", projectDigest)}`;
}
