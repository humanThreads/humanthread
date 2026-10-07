import { describe, expect, it } from "vitest";

import { KNOWLEDGE_CHUNKER_VERSION } from "@humanthread/shared";

import { chunkKnowledgeVersion } from "./chunking";

const input = {
  entryId: "a".repeat(32),
  version: 2,
  stableKey: "rule.release.gate",
  title: "发布门禁",
  entryType: "rule",
  summary: "发布前必须通过检查。",
  bodyMarkdown: "# 发布门禁\n\n## 规则\n\n必须运行测试。\n\n## 证据\n\n```bash\npnpm test\n```\n",
  tags: ["release", "quality"],
};

describe("knowledge chunking", () => {
  it("preserves heading paths, code fences, and deterministic chunk identity", () => {
    const first = chunkKnowledgeVersion(input);
    const second = chunkKnowledgeVersion(input);

    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
    expect(first[0]).toMatchObject({
      entryId: input.entryId,
      version: 2,
      stableKey: input.stableKey,
      entryType: "rule",
      tags: ["release", "quality"],
    });
    expect(first.some((chunk) => chunk.headingPath.includes("规则"))).toBe(true);
    expect(first.some((chunk) => chunk.content.includes("```bash"))).toBe(true);
    expect(first.every((chunk) => /^[a-f0-9]{32}$/u.test(chunk.id))).toBe(true);
    expect(KNOWLEDGE_CHUNKER_VERSION).toBe("knowledge-chunker/v1");
  });

  it("returns no chunks for empty content", () => {
    expect(chunkKnowledgeVersion({ ...input, summary: "", bodyMarkdown: "" })).toEqual([]);
  });

  it("splits oversized Chinese content into bounded chunks", () => {
    const chunks = chunkKnowledgeVersion({
      ...input,
      summary: "",
      bodyMarkdown: "第一章。".repeat(1_500),
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length <= 1_200)).toBe(true);
  });
});
