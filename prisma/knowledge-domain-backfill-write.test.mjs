import { describe, expect, it, vi } from "vitest";

import { writeKnowledgeDomainBackfillPlan } from "./knowledge-domain-backfill-write.mjs";

describe("writeKnowledgeDomainBackfillPlan", () => {
  it("writes Jobs before Batches with explicit transaction bounds", async () => {
    const calls = [];
    const delegate = (name) => ({
      createMany: vi.fn(async ({ data }) => {
        calls.push(name);
        return { count: data.length };
      }),
    });
    const tx = {
      knowledgePolicy: delegate("policies"),
      knowledgeJob: delegate("jobs"),
      knowledgeBatch: delegate("batches"),
      knowledgeBatchItem: delegate("items"),
      knowledgeEntry: delegate("entries"),
      knowledgeEntryVersion: delegate("versions"),
      knowledgeRelation: delegate("relations"),
    };
    const prisma = {
      $transaction: vi.fn(async (callback, options) => {
        expect(options).toEqual({ maxWait: 5_000, timeout: 30_000 });
        return callback(tx);
      }),
    };
    const row = { id: "a".repeat(32) };
    const plan = {
      policies: [row],
      jobs: [row],
      batches: [row],
      items: [row],
      entries: [row],
      versions: [row],
      relations: [row],
    };

    await expect(writeKnowledgeDomainBackfillPlan(prisma, plan)).resolves.toEqual({
      policies: 1,
      jobs: 1,
      batches: 1,
      items: 1,
      entries: 1,
      versions: 1,
      relations: 1,
    });
    expect(calls.indexOf("jobs")).toBeLessThan(calls.indexOf("batches"));
  });
});
