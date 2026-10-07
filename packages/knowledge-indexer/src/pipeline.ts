import { KNOWLEDGE_CHUNKER_VERSION } from "@humanthread/shared";

import { chunkKnowledgeVersion, type KnowledgeChunk } from "./chunking";
import type { EmbeddingProvider } from "./embedding";
import type { KnowledgeIndexEngine } from "./qdrant";
import type { QdrantPoint } from "./qdrant-types";
import { buildKnowledgeSparseVector } from "./sparse-vector";

export interface KnowledgeVersionSnapshot {
  entryId: string;
  stableKey: string;
  version: number;
  title: string;
  entryType: string;
  summary: string;
  bodyMarkdown: string;
  tags: string[];
  status: "published";
}

export interface KnowledgeIndexProgress {
  stage: "chunking" | "embedding" | "indexing" | "activating" | "active";
  processed: number;
  total: number;
  progress: number;
}

export interface RunKnowledgeIndexJobInput {
  projectDigest: string;
  indexVersion: number;
  embeddingProfileId: string;
  collectionName: string;
  aliasName: string;
  versions: KnowledgeVersionSnapshot[];
  engine: KnowledgeIndexEngine;
  embedding: EmbeddingProvider;
  batchSize?: number;
}

export async function runKnowledgeIndexJob(
  input: RunKnowledgeIndexJobInput,
): Promise<{ points: number; progress: KnowledgeIndexProgress[] }> {
  const progress: KnowledgeIndexProgress[] = [];
  const chunks = input.versions.flatMap((version) => chunkKnowledgeVersion({
    entryId: version.entryId,
    version: version.version,
    stableKey: version.stableKey,
    title: version.title,
    entryType: version.entryType,
    summary: version.summary,
    bodyMarkdown: version.bodyMarkdown,
    tags: version.tags,
  }));
  progress.push(progressEvent("chunking", chunks.length, chunks.length));

  if (chunks.length === 0) {
    await input.engine.createCollection({
      collectionName: input.collectionName,
      vectorSize: input.embedding.profile.dimensions,
      onDiskPayload: true,
    });
    await input.engine.createPayloadIndexes(input.collectionName);
    await input.engine.validateCollection({ collectionName: input.collectionName, expectedPoints: 0 });
    await input.engine.activateAlias({ aliasName: input.aliasName, collectionName: input.collectionName });
    progress.push(progressEvent("active", 0, 0));
    return { points: 0, progress };
  }

  await input.engine.createCollection({
    collectionName: input.collectionName,
    vectorSize: input.embedding.profile.dimensions,
    onDiskPayload: true,
  });
  await input.engine.createPayloadIndexes(input.collectionName);

  let written = 0;
  const batchSize = input.batchSize ?? input.embedding.profile.batchSize;
  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    const batch = chunks.slice(offset, offset + batchSize);
    const dense = await input.embedding.embed(batch.map((chunk) => chunk.content));
    const points = batch.map((chunk, index) => toPoint(chunk, dense[index]!, input.projectDigest));
    written += await input.engine.upsertChunks(input.collectionName, points);
    progress.push(progressEvent(written === chunks.length ? "indexing" : "embedding", written, chunks.length));
  }

  await input.engine.validateCollection({
    collectionName: input.collectionName,
    expectedPoints: chunks.length,
  });
  progress.push(progressEvent("activating", chunks.length, chunks.length));
  await input.engine.activateAlias({
    aliasName: input.aliasName,
    collectionName: input.collectionName,
  });
  progress.push(progressEvent("active", chunks.length, chunks.length));
  return { points: written, progress };
}

export function toPoint(
  chunk: KnowledgeChunk,
  dense: Float32Array,
  projectDigest: string,
): QdrantPoint {
  return {
    id: chunk.id,
    vector: {
      dense: Array.from(dense),
      sparse: buildKnowledgeSparseVector(chunk.content),
    },
    payload: {
      projectDigest,
      entryId: chunk.entryId,
      version: chunk.version,
      stableKey: chunk.stableKey,
      title: chunk.title,
      headingPath: chunk.headingPath,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      contentDigest: chunk.contentDigest,
      entryType: chunk.entryType,
      tags: chunk.tags,
      chunkerVersion: KNOWLEDGE_CHUNKER_VERSION,
      searchable: true,
    },
  };
}

function progressEvent(
  stage: KnowledgeIndexProgress["stage"],
  processed: number,
  total: number,
): KnowledgeIndexProgress {
  return {
    stage,
    processed,
    total,
    progress: total === 0 ? 100 : Math.floor((processed / total) * 100),
  };
}
