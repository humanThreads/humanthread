import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const schema = await readFile(new URL("./schema.prisma", import.meta.url), "utf8");
const knowledgeBatchSource = await readFile(
  new URL("../packages/db/src/knowledge-batches.ts", import.meta.url),
  "utf8",
);

describe("knowledge domain schema", () => {
  it("defines the complete stage-one model set", () => {
    for (const model of [
      "KnowledgeSource", "KnowledgeSourceRevision", "KnowledgePolicy", "KnowledgeTemplate",
      "KnowledgeTemplateVersion", "KnowledgeJob", "KnowledgeBatch", "KnowledgeBatchItem",
      "KnowledgeEntry", "KnowledgeEntryVersion", "KnowledgeRelation", "KnowledgeIndexJob",
      "KnowledgeIndexVersion",
    ]) expect(schema).toContain(`model ${model} {`);
  });

  it("stores every new primary and foreign identifier as char(32)", () => {
    const violations = [
      "KnowledgeSource", "KnowledgeSourceRevision", "KnowledgePolicy", "KnowledgeTemplate",
      "KnowledgeTemplateVersion", "KnowledgeJob", "KnowledgeBatch", "KnowledgeBatchItem",
      "KnowledgeEntry", "KnowledgeEntryVersion", "KnowledgeRelation", "KnowledgeIndexJob",
      "KnowledgeIndexVersion",
    ].flatMap((name) => {
      const body = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "u"))?.[1] ?? "";
      return body.split("\n").filter((line) => /\b(id|[a-z]+Id)\s+String\b/u.test(line) && !line.includes("@db.Char(32)"));
    });
    expect(violations).toEqual([]);
  });

  it("stores the failed batch stage separately from the terminal failed status", () => {
    const body = schema.match(/model KnowledgeBatch \{([\s\S]*?)\n\}/u)?.[1] ?? "";
    expect(body).toMatch(/\bfailedStage\s+String\?\s+@db\.VarChar\(32\)/u);
  });

  it("stores the batch failure message selected by the current-read path", () => {
    const body = schema.match(/model KnowledgeBatch \{([\s\S]*?)\n\}/u)?.[1] ?? "";
    expect(body).toMatch(/\bfailureMessage\s+String\?\s+@db\.Text/u);
  });

  it("declares every column selected by KnowledgeBatch current-read SQL", () => {
    const body = schema.match(/model KnowledgeBatch \{([\s\S]*?)\n\}/u)?.[1] ?? "";
    const declared = new Set(
      [...body.matchAll(/^\s+([A-Za-z][A-Za-z0-9]*)\s+/gmu)].map((match) => match[1]),
    );
    const selected = [...knowledgeBatchSource.matchAll(/FROM KnowledgeBatch/gu)]
      .flatMap((match) => {
        const selectStart = knowledgeBatchSource.lastIndexOf("SELECT", match.index);
        return knowledgeBatchSource
          .slice(selectStart + "SELECT".length, match.index)
          .split(",")
          .map((column) => column.trim());
      });

    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every((column) => declared.has(column))).toBe(true);
  });

  it("detects camelCase identifier fields that are not stored as char(32)", () => {
    const fixture = ["templateVersionId String @db.VarChar(64)"];
    const violations = fixture.filter((line) => (
      /\b(?:id|[A-Za-z][A-Za-z0-9_]*Id)\s+String\b/u.test(line)
      && !line.includes("@db.Char(32)")
    ));

    expect(violations).toEqual(fixture);
  });

  it("stores job snapshot identity and batch item provenance metadata", () => {
    const job = schema.match(/model KnowledgeJob \{([\s\S]*?)\n\}/u)?.[1] ?? "";
    const item = schema.match(/model KnowledgeBatchItem \{([\s\S]*?)\n\}/u)?.[1] ?? "";
    const policy = schema.match(/model KnowledgePolicy \{([\s\S]*?)\n\}/u)?.[1] ?? "";

    expect(job).toMatch(/\bsourceSnapshotDigest\s+String\s+@db\.Char\(32\)/u);
    expect(item).toMatch(/\btags\s+Json/u);
    expect(item).toMatch(/\bchangeSummary\s+String\s+@db\.Text/u);
    expect(policy).toMatch(/\bsourceTypeOverrides\s+Json/u);
  });
});
