import { describe, expect, it, vi } from "vitest";

import type { EmbeddingProvider } from "./embedding";
import { runKnowledgeIndexJob } from "./pipeline";
import { createQdrantKnowledgeIndexEngine } from "./qdrant";

const profile = {
  id: "a".repeat(32),
  stableKey: "profile",
  provider: "onnx" as const,
  modelId: "model",
  modelRevision: "main",
  modelDigest: "b".repeat(32),
  tokenizerVersion: "tokenizer/v1",
  dimensions: 64,
  maxSequenceLength: 512,
  normalization: "l2" as const,
  quantization: "int8" as const,
  runtimeVersion: "onnxruntime-node/1.30.0",
  threadLimit: 1,
  batchSize: 2,
  localModelPath: "/data/model",
};

function engineFixture() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let pointCount = 0;
  const record = (method: string, result: unknown = {}) => vi.fn(async (...args: unknown[]) => {
    calls.push({ method, args });
    return result;
  });
  const client = {
    getCollections: record("getCollections", { collections: [] }),
    createCollection: record("createCollection"),
    collectionExists: vi.fn(async () => ({ exists: false })),
    getCollection: record("getCollection"),
    updateCollection: record("updateCollection"),
    createPayloadIndex: record("createPayloadIndex"),
    upsert: vi.fn(async (...args: unknown[]) => {
      calls.push({ method: "upsert", args });
      const options = args[1] as { points?: unknown[] } | undefined;
      pointCount += options?.points?.length ?? 0;
      return {};
    }),
    count: vi.fn(async (...args: unknown[]) => {
      calls.push({ method: "count", args });
      return { count: pointCount };
    }),
    query: record("query", { points: [] }),
    updateCollectionAliases: record("updateCollectionAliases"),
    createSnapshot: record("createSnapshot", { snapshot_name: "snap" }),
    deleteCollection: record("deleteCollection"),
  };
  return { engine: createQdrantKnowledgeIndexEngine(client), calls };
}

function embedding(dimensions = 64): EmbeddingProvider {
  return {
    profile: { ...profile, dimensions },
    async embed(texts) {
      return texts.map(() => Float32Array.from([1, ...Array(dimensions - 1).fill(0)]));
    },
  };
}

const version = {
  entryId: "c".repeat(32),
  stableKey: "rule.release",
  version: 1,
  title: "发布规则",
  entryType: "rule",
  summary: "发布必须检查。",
  bodyMarkdown: "# 发布规则\n\n必须运行测试。",
  tags: ["release"],
  status: "published" as const,
};

describe("knowledge index pipeline", () => {
  it("chunks, embeds, upserts, validates, and activates atomically", async () => {
    const { engine, calls } = engineFixture();
    const result = await runKnowledgeIndexJob({
      projectDigest: "d".repeat(32),
      indexVersion: 1,
      embeddingProfileId: profile.id,
      collectionName: `ht-k-${"e".repeat(32)}`,
      aliasName: `ht-k-live-${"d".repeat(32)}`,
      versions: [version],
      engine,
      embedding: embedding(),
    });

    expect(result.points).toBeGreaterThan(0);
    expect(result.progress.at(-1)).toMatchObject({ stage: "active", progress: 100 });
    expect(calls.map((call) => call.method)).toEqual(expect.arrayContaining([
      "createCollection", "createPayloadIndex", "upsert", "count", "updateCollectionAliases",
    ]));
    expect(calls.findIndex((call) => call.method === "updateCollectionAliases")).toBeGreaterThan(
      calls.findIndex((call) => call.method === "count"),
    );
  });

  it("uses a real chunk count in progress and handles empty snapshots", async () => {
    const { engine } = engineFixture();
    const result = await runKnowledgeIndexJob({
      projectDigest: "d".repeat(32),
      indexVersion: 2,
      embeddingProfileId: profile.id,
      collectionName: `ht-k-${"e".repeat(32)}`,
      aliasName: `ht-k-live-${"d".repeat(32)}`,
      versions: [],
      engine,
      embedding: embedding(),
    });
    expect(result.points).toBe(0);
    expect(result.progress).toEqual([
      { stage: "chunking", processed: 0, total: 0, progress: 100 },
      { stage: "active", processed: 0, total: 0, progress: 100 },
    ]);
  });

  it("does not switch alias when collection validation fails", async () => {
    const { engine, calls } = engineFixture();
    const invalid = {
      ...engine,
      validateCollection: vi.fn(async () => { throw Object.assign(new Error("count mismatch"), { code: "index_error" }); }),
    };
    await expect(runKnowledgeIndexJob({
      projectDigest: "d".repeat(32),
      indexVersion: 3,
      embeddingProfileId: profile.id,
      collectionName: `ht-k-${"e".repeat(32)}`,
      aliasName: `ht-k-live-${"d".repeat(32)}`,
      versions: [version],
      engine: invalid,
      embedding: embedding(),
    })).rejects.toMatchObject({ code: "index_error" });
    expect(calls.some((call) => call.method === "updateCollectionAliases")).toBe(false);
  });
});
