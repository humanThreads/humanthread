import { describe, expect, it } from "vitest";

import { buildKnowledgeSparseVector, tokenizeKnowledgeText } from "./sparse-vector";

describe("knowledge sparse vectors", () => {
  it("tokenizes Chinese text into character n-grams and keeps stable dimensions", () => {
    expect(tokenizeKnowledgeText("发布门禁")).toEqual([
      "发", "发布", "发布门", "布", "布门", "布门禁", "门", "门禁", "禁",
    ]);
    const first = buildKnowledgeSparseVector("发布门禁 发布门禁");
    const second = buildKnowledgeSparseVector("发布门禁 发布门禁");
    expect(second).toEqual(first);
    expect(first.indices).toEqual([...first.indices].sort((left, right) => left - right));
    expect(first.values.every((value) => value > 0 && value <= 1)).toBe(true);
  });

  it("returns empty vectors for empty text", () => {
    expect(buildKnowledgeSparseVector("")).toEqual({ indices: [], values: [] });
  });
});
