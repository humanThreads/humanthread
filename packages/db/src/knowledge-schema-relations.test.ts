import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const schema = await readFile(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");

/**
 * Prisma rejects relational filters and includes that are not declared as
 * relations in the schema. Unit tests for the knowledge domain use in-memory
 * fakes, so they cannot observe that mismatch; this guard keeps the schema and
 * the relational queries in `packages/db` in sync.
 */
const REQUIRED_RELATIONS: Array<{ model: string; field: string }> = [
  { model: "KnowledgeArchitectureViewVersion", field: "view" },
  { model: "KnowledgeTemplateVersion", field: "template" },
];

function modelBody(name: string): string {
  return schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "u"))?.[1] ?? "";
}

describe("knowledge schema relations", () => {
  it("declares every relation used by knowledge relational queries", () => {
    const missing = REQUIRED_RELATIONS.filter(({ model, field }) => (
      !new RegExp(`^\\s+${field}\\s+[A-Z]`, "mu").test(modelBody(model))
    ));

    expect(missing).toEqual([]);
  });

  it("keeps relation fields out of the identifier char(32) rule", () => {
    for (const { model, field } of REQUIRED_RELATIONS) {
      const relationLine = modelBody(model)
        .split("\n")
        .find((line) => new RegExp(`^\\s+${field}\\s+[A-Z]`, "u").test(line));
      expect(relationLine).toBeDefined();
      expect(relationLine).not.toContain("@db.Char(32)");
    }
  });
});
