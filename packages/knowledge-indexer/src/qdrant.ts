import type { QdrantClientLike, QdrantPoint, QdrantSearchResult } from "./qdrant-types";

export interface KnowledgeIndexEngineSearchInput {
  collectionName: string;
  dense: number[];
  sparse: { indices: number[]; values: number[] };
  limit: number;
  filters?: Record<string, unknown>;
}

export interface KnowledgeIndexEngine {
  createCollection(input: {
    collectionName: string;
    vectorSize: number;
    onDiskPayload?: boolean;
  }): Promise<void>;
  createPayloadIndexes(collectionName: string): Promise<void>;
  upsertChunks(collectionName: string, points: QdrantPoint[]): Promise<number>;
  countPoints(collectionName: string): Promise<number>;
  validateCollection(input: {
    collectionName: string;
    expectedPoints: number;
  }): Promise<{ pointCount: number }>;
  activateAlias(input: {
    aliasName: string;
    collectionName: string;
  }): Promise<void>;
  snapshot(collectionName: string): Promise<string | null>;
  deleteCollection(collectionName: string): Promise<void>;
  search(input: KnowledgeIndexEngineSearchInput): Promise<QdrantSearchResult>;
}

export function createQdrantKnowledgeIndexEngine(client: QdrantClientLike): KnowledgeIndexEngine {
  return {
    async createCollection(input) {
      assertCollectionName(input.collectionName);
      // The collection name is deterministic per index version, so a retried job
      // must rebuild from a clean collection instead of colliding with a partial
      // collection left by a previous failed attempt.
      const existing = await client.collectionExists(input.collectionName);
      if (existing.exists) {
        await client.deleteCollection(input.collectionName);
      }
      await client.createCollection(input.collectionName, {
        vectors: { dense: { size: input.vectorSize, distance: "Cosine" } },
        sparse_vectors: { sparse: {} },
        on_disk_payload: input.onDiskPayload ?? true,
      });
    },
    async createPayloadIndexes(collectionName) {
      const indexes: Array<[string, "keyword" | "integer" | "datetime" | "bool"]> = [
        ["entryType", "keyword"],
        ["status", "keyword"],
        ["tags", "keyword"],
        ["sourceKind", "keyword"],
        ["architectureViewId", "keyword"],
        ["validFrom", "datetime"],
        ["validUntil", "datetime"],
        ["searchable", "bool"],
      ];
      for (const [fieldName, fieldSchema] of indexes) {
        await client.createPayloadIndex(collectionName, {
          wait: true,
          field_name: fieldName,
          field_schema: fieldSchema,
        });
      }
    },
    async upsertChunks(collectionName, points) {
      if (points.length === 0) return 0;
      await client.upsert(collectionName, { wait: true, points });
      return points.length;
    },
    async countPoints(collectionName) {
      return (await client.count(collectionName, { exact: true })).count;
    },
    async validateCollection(input) {
      const pointCount = await this.countPoints(input.collectionName);
      if (pointCount !== input.expectedPoints) {
        throw indexError(`Qdrant collection point count mismatch: expected ${input.expectedPoints}, got ${pointCount}`);
      }
      return { pointCount };
    },
    async activateAlias(input) {
      assertAliasName(input.aliasName);
      await client.updateCollectionAliases({
        actions: [
          { delete_alias: { alias_name: input.aliasName } },
          { create_alias: { collection_name: input.collectionName, alias_name: input.aliasName } },
        ],
      });
    },
    async snapshot(collectionName) {
      const result = await client.createSnapshot(collectionName);
      return result.snapshot_name ?? result.name ?? null;
    },
    async deleteCollection(collectionName) {
      await client.deleteCollection(collectionName);
    },
    async search(input) {
      return client.query(input.collectionName, {
        prefetch: [
          { query: input.dense, using: "dense", limit: input.limit, filter: input.filters },
          { query: input.sparse, using: "sparse", limit: input.limit, filter: input.filters },
        ],
        query: { fusion: "rrf" },
        limit: input.limit,
        with_payload: true,
      });
    },
  };
}

export function createQdrantClientAdapter(client: unknown): QdrantClientLike {
  if (!client || typeof client !== "object") throw indexError("Qdrant client is required");
  return client as QdrantClientLike;
}

function assertCollectionName(value: string): void {
  if (!/^ht-k-[a-f0-9]{32}$/u.test(value)) throw indexError("Knowledge collection name is invalid");
}

function assertAliasName(value: string): void {
  if (!/^ht-k-live-[a-f0-9]{32}$/u.test(value)) throw indexError("Knowledge alias name is invalid");
}

function indexError(message: string): Error {
  return Object.assign(new Error(message), { code: "index_error" });
}
