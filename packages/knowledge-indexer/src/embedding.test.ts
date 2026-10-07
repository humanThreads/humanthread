import { describe, expect, it, vi } from "vitest";

import { normalizeEmbedding, validateKnowledgeEmbeddingProfile } from "./embedding";
import { createOnnxEmbeddingProvider } from "./onnx-embedding";

const profile = validateKnowledgeEmbeddingProfile({
  id: "a".repeat(32),
  stableKey: "bge-small-zh-v1.5-int8",
  provider: "onnx",
  modelId: "BAAI/bge-small-zh-v1.5",
  modelRevision: "main",
  modelDigest: "b".repeat(32),
  tokenizerVersion: "tokenizer/v1",
  dimensions: 64,
  maxSequenceLength: 512,
  normalization: "l2",
  quantization: "int8",
  runtimeVersion: "onnxruntime-node/1.30.0",
  threadLimit: 1,
  batchSize: 2,
  localModelPath: "/data/models/bge-small-zh-v1.5",
});

describe("knowledge embedding", () => {
  it("validates local profile bounds and normalizes vectors", () => {
    expect(profile.threadLimit).toBe(1);
    const normalized = Array.from(normalizeEmbedding(Float32Array.from([3, 4])));
    expect(normalized[0]).toBeCloseTo(0.6);
    expect(normalized[1]).toBeCloseTo(0.8);
    expect(() => validateKnowledgeEmbeddingProfile({ ...profile, threadLimit: 4 })).toThrow(/thread limit/u);
  });

  it("batches, limits concurrency, validates dimensions, and normalizes output", async () => {
    let active = 0;
    let maxActive = 0;
    const extractor = vi.fn(async (texts: string[]) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { data: Float32Array.from(texts.flatMap(() => [3, 4, ...Array(62).fill(0)])), dims: [texts.length, 64] };
    });
    const provider = await createOnnxEmbeddingProvider(profile, { createFeatureExtractor: async () => extractor });
    const vectors = await provider.embed(["一", "二", "三"]);
    expect(vectors).toHaveLength(3);
    expect(vectors[0]![0]).toBeCloseTo(0.6);
    expect(vectors[0]![1]).toBeCloseTo(0.8);
    expect(maxActive).toBeLessThanOrEqual(profile.threadLimit);
    expect(extractor).toHaveBeenCalledTimes(2);
  });

  it("rejects a provider with wrong dimensions", async () => {
    const provider = await createOnnxEmbeddingProvider(profile, {
      createFeatureExtractor: async () => async () => ({ data: Float32Array.from([1, 2]), dims: [1, 2] }),
    });
    await expect(provider.embed(["一"])).rejects.toMatchObject({ code: "validation_failed" });
  });
});
