import { describe, expect, it, vi } from "vitest";

import type { EmbeddingProvider } from "./embedding";
import { searchKnowledge } from "./search";
import { knowledgeAliasName } from "@humanthread/shared";
import type { KnowledgeIndexEngine } from "./qdrant";

const profile = {
  id: "a".repeat(32),
  stableKey: "profile",
  provider: "onnx" as const,
  modelId: "model",
  modelRevision: "main",
  modelDigest: "b".repeat(32),
  tokenizerVersion: "tokenizer/v1",
  dimensions: 3,
  maxSequenceLength: 512,
  normalization: "l2" as const,
  quantization: "int8" as const,
  runtimeVersion: "onnxruntime-node/1.30.0",
  threadLimit: 1,
  batchSize: 1,
  localModelPath: "/model",
};

const embedding: EmbeddingProvider = {
  profile,
  embed: vi.fn(async () => [Float32Array.from([1, 0, 0])]),
};

const engine = {
  search: vi.fn(async () => ({
    points: [{
      id: "chunk_1",
      score: 0.91,
      payload: {
        entryId: "c".repeat(32),
        version: 2,
        stableKey: "rule.release",
        title: "发布规则",
        entryType: "rule",
        content: "发布必须测试",
        headingPath: ["发布"],
        tags: ["release"],
        chunkIndex: 0,
        contentDigest: "d".repeat(32),
      },
    }],
  })),
} as unknown as KnowledgeIndexEngine;

describe("knowledge search", () => {
  it("derives the collection alias from the project digest instead of trusting the client", async () => {
    await searchKnowledge({
      request: { projectDigest: "e".repeat(32), query: "发布规则", limit: 5 } as never,
      engine,
      embedding,
    });
    expect(engine.search).toHaveBeenCalledWith(expect.objectContaining({
      collectionName: knowledgeAliasName("e".repeat(32)),
    }));
  });

  it("queries the project alias with dense and sparse vectors and projects payload", async () => {
    const result = await searchKnowledge({
      request: { projectDigest: "e".repeat(32), aliasName: `ht-k-live-${"e".repeat(32)}`, query: "发布规则", limit: 5 },
      engine,
      embedding,
    });
    expect(result.items[0]).toMatchObject({ entryId: "c".repeat(32), version: 2, score: 0.91, contentDigest: "d".repeat(32) });
    expect(engine.search).toHaveBeenCalledWith(expect.objectContaining({
      collectionName: knowledgeAliasName("e".repeat(32)),
      dense: [1, 0, 0],
      sparse: expect.objectContaining({ indices: expect.any(Array) }),
      limit: 5,
    }));
  });

  it("rejects empty queries and invalid limits", async () => {
    await expect(searchKnowledge({ request: { projectDigest: "e".repeat(32), aliasName: "alias", query: " ", limit: 5 }, engine, embedding })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(searchKnowledge({ request: { projectDigest: "e".repeat(32), aliasName: "alias", query: "x", limit: 0 }, engine, embedding })).rejects.toMatchObject({ code: "validation_failed" });
  });
});
