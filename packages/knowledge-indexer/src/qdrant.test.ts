import { describe, expect, it, vi } from "vitest";

import { createQdrantKnowledgeIndexEngine } from "./qdrant";

function fixture() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const record = (method: string) => vi.fn(async (...args: unknown[]) => {
    calls.push({ method, args });
    if (method === "getCollections") return { collections: [] };
    if (method === "count") return { count: 2 };
    if (method === "query") return { points: [{ id: "p1", score: 1, payload: { versionId: "v1" } }] };
    if (method === "createSnapshot") return { snapshot_name: "snap-1" };
    return {};
  });
  const client = {
    getCollections: record("getCollections"),
    collectionExists: vi.fn(async () => ({ exists: false })),
    createCollection: record("createCollection"),
    getCollection: record("getCollection"),
    updateCollection: record("updateCollection"),
    createPayloadIndex: record("createPayloadIndex"),
    upsert: record("upsert"),
    count: record("count"),
    query: record("query"),
    updateCollectionAliases: record("updateCollectionAliases"),
    createSnapshot: record("createSnapshot"),
    deleteCollection: record("deleteCollection"),
  };
  return { client, calls };
}

describe("qdrant knowledge index engine", () => {
  it("creates dense and sparse collection, payload indexes, validates, and activates alias", async () => {
    const dependencies = fixture();
    const engine = createQdrantKnowledgeIndexEngine(dependencies.client);
    const collectionName = `ht-k-${"a".repeat(32)}`;
    await engine.createCollection({ collectionName, vectorSize: 512, onDiskPayload: true });
    await engine.createPayloadIndexes(collectionName);
    await engine.upsertChunks(collectionName, [{ id: "p1", vector: { dense: [1], sparse: { indices: [1], values: [1] } }, payload: {} }]);
    await expect(engine.validateCollection({ collectionName, expectedPoints: 2 })).resolves.toEqual({ pointCount: 2 });
    await engine.activateAlias({ aliasName: `ht-k-live-${"b".repeat(32)}`, collectionName });
    await expect(engine.snapshot(collectionName)).resolves.toBe("snap-1");

    expect(dependencies.calls.find((call) => call.method === "createCollection")?.args[1]).toMatchObject({
      vectors: { dense: { size: 512, distance: "Cosine" } },
      sparse_vectors: { sparse: {} },
      on_disk_payload: true,
    });
    expect(dependencies.calls.filter((call) => call.method === "createPayloadIndex")).toHaveLength(8);
    expect(dependencies.calls.find((call) => call.method === "updateCollectionAliases")?.args[0]).toMatchObject({
      actions: [
        { delete_alias: { alias_name: `ht-k-live-${"b".repeat(32)}` } },
        { create_alias: { collection_name: collectionName, alias_name: `ht-k-live-${"b".repeat(32)}` } },
      ],
    });
  });

  it("uses dense and sparse prefetch with RRF fusion", async () => {
    const dependencies = fixture();
    const engine = createQdrantKnowledgeIndexEngine(dependencies.client);
    await expect(engine.search({
      collectionName: `ht-k-${"a".repeat(32)}`,
      dense: [1, 0],
      sparse: { indices: [7], values: [0.5] },
      limit: 10,
      filters: { must: [{ key: "searchable", match: { value: true } }] },
    })).resolves.toMatchObject({ points: [{ id: "p1" }] });
    expect(dependencies.calls.find((call) => call.method === "query")?.args[1]).toMatchObject({
      prefetch: [
        { using: "dense", limit: 10 },
        { using: "sparse", limit: 10 },
      ],
      query: { fusion: "rrf" },
      with_payload: true,
    });
  });

  it("rejects invalid collection identities and point count mismatches", async () => {
    const dependencies = fixture();
    const engine = createQdrantKnowledgeIndexEngine(dependencies.client);
    await expect(engine.createCollection({ collectionName: "unsafe", vectorSize: 512 })).rejects.toMatchObject({ code: "index_error" });
    await expect(engine.validateCollection({ collectionName: `ht-k-${"a".repeat(32)}`, expectedPoints: 3 })).rejects.toMatchObject({ code: "index_error" });
  });

  it("rebuilds a deterministic collection instead of colliding with a partial one", async () => {
    const dependencies = fixture();
    vi.mocked(dependencies.client.collectionExists).mockResolvedValue({ exists: true });
    const engine = createQdrantKnowledgeIndexEngine(dependencies.client);
    await engine.createCollection({ collectionName: `ht-k-${"a".repeat(32)}`, vectorSize: 512, onDiskPayload: true });

    const deleteIndex = dependencies.calls.findIndex((call) => call.method === "deleteCollection");
    const createIndex = dependencies.calls.findIndex((call) => call.method === "createCollection");
    expect(deleteIndex).toBeGreaterThanOrEqual(0);
    expect(createIndex).toBeGreaterThan(deleteIndex);
  });
});
