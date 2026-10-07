import type { EmbeddingProvider } from "./embedding";
import type { KnowledgeIndexEngine } from "./qdrant";
import type { KnowledgeSparseVector } from "./sparse-vector";
import { buildKnowledgeSparseVector } from "./sparse-vector";
import { knowledgeAliasName } from "@humanthread/shared";

export interface KnowledgeSearchRequest {
  projectDigest: string;
  /** @deprecated Ignored: the alias is always derived from projectDigest. */
  aliasName?: string;
  query: string;
  limit: number;
  entryType?: string;
}

export interface KnowledgeSearchItem {
  score: number;
  entryId: string | null;
  version: number | null;
  stableKey: string | null;
  title: string | null;
  entryType: string | null;
  content: string | null;
  headingPath: string[];
  tags: string[];
  chunkIndex: number;
  contentDigest: string | null;
}

export interface KnowledgeSearchResult {
  items: KnowledgeSearchItem[];
}

export async function searchKnowledge(input: {
  request: KnowledgeSearchRequest;
  engine: KnowledgeIndexEngine;
  embedding: EmbeddingProvider;
}): Promise<KnowledgeSearchResult> {
  const query = input.request.query.trim();
  const projectDigest = input.request.projectDigest.trim();
  if (!/^[a-f0-9]{32}$/u.test(projectDigest)) throw validationError("Knowledge project digest is invalid");
  if (!query) throw validationError("Knowledge search query is required");
  if (!Number.isInteger(input.request.limit) || input.request.limit < 1 || input.request.limit > 50) {
    throw validationError("Knowledge search limit is invalid");
  }
  const dense = await input.embedding.embed([query]);
  const vector = dense[0];
  if (!vector) throw validationError("Knowledge query embedding is unavailable");
  const sparse: KnowledgeSparseVector = buildKnowledgeSparseVector(query);
  const filters = input.request.entryType
    ? { must: [{ key: "entryType", match: { value: input.request.entryType } }] }
    : undefined;
  const result = await input.engine.search({
    collectionName: knowledgeAliasName(projectDigest),
    dense: Array.from(vector),
    sparse,
    limit: input.request.limit,
    ...(filters ? { filters } : {}),
  });
  return {
    items: result.points.map((point) => {
      const payload = point.payload ?? {};
      return {
        score: point.score,
        entryId: stringValue(payload.entryId),
        version: numberValue(payload.version),
        stableKey: stringValue(payload.stableKey),
        title: stringValue(payload.title),
        entryType: stringValue(payload.entryType),
        content: stringValue(payload.content),
        headingPath: stringArray(payload.headingPath),
        tags: stringArray(payload.tags),
        chunkIndex: numberValue(payload.chunkIndex) ?? 0,
        contentDigest: stringValue(payload.contentDigest),
      };
    }),
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}
