import { describe, expect, it } from "vitest";

import {
  knowledgeAliasName,
  knowledgeCollectionName,
  knowledgeIndexJobId,
  knowledgeIndexVersionId,
} from "./knowledge-index";

describe("knowledge index identities", () => {
  it("is deterministic and excludes opaque project identifiers", () => {
    const projectDigest = "a".repeat(32);
    const input = {
      projectDigest,
      embeddingProfileId: "b".repeat(32),
      chunkerVersion: "knowledge-chunker/v1",
      indexVersion: 2,
    };
    expect(knowledgeIndexJobId({
      batchId: "c".repeat(32),
      embeddingProfileId: input.embeddingProfileId,
      chunkerVersion: input.chunkerVersion,
    })).toMatch(/^[a-f0-9]{32}$/u);
    expect(knowledgeIndexVersionId(input)).toBe(knowledgeIndexVersionId(input));
    expect(knowledgeCollectionName(input)).toBe(`ht-k-${knowledgeIndexVersionId(input)}`);
    expect(knowledgeAliasName(projectDigest)).toBe(`ht-k-live-${knowledgeAliasName(projectDigest).split("-").at(-1)}`);
    expect(knowledgeAliasName(projectDigest)).not.toContain("project_");
  });
});
