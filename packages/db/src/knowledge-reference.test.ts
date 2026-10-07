import { describe, expect, it } from "vitest";
import { knowledgeDigest, knowledgeId, knowledgeProjectDigest } from "./knowledge-reference";

describe("knowledge reference identifiers", () => {
  it("creates stable lowercase MD5 identifiers", () => {
    expect(knowledgeDigest("project", "project_1")).toMatch(/^[a-f0-9]{32}$/u);
    expect(knowledgeDigest("project", "project_1")).toBe(knowledgeDigest("project", "project_1"));
    expect(knowledgeDigest("project", "project_1")).toBe("0aa9f00de807bdf1ddc78fc128c3e27f");
    expect(knowledgeId("knowledge-entry", "project_1", "rule.release.gate")).toMatch(/^[a-f0-9]{32}$/u);
    expect(knowledgeProjectDigest("project_1")).toBe(knowledgeDigest("project", "project_1"));
  });
});
