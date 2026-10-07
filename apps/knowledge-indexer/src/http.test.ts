import { describe, expect, it, vi } from "vitest";

import { createKnowledgeIndexerServer } from "./http";

function dependencies() {
  return {
    writer: {
      claim: vi.fn(async () => ({
        id: "a".repeat(32), projectDigest: "b".repeat(32), batchId: "c".repeat(32), embeddingProfileId: "d".repeat(32),
        chunkerVersion: "knowledge-chunker/v1", indexVersion: 1, collectionName: `ht-k-${"e".repeat(32)}`,
        aliasName: `ht-k-live-${"b".repeat(32)}`, status: "running", stage: "chunking", failedStage: null, version: 2,
      })),
      recordProgress: vi.fn(async (_id, _stage, _processed, _total, version) => version + 1),
      complete: vi.fn(async () => {}),
      fail: vi.fn(async () => {}),
    },
    runner: { run: vi.fn(async () => ({ points: 0, progress: [] })) },
    loadVersions: vi.fn(async () => []),
    health: vi.fn(async () => ({ ok: true, qdrant: true })),
    search: { search: vi.fn(async () => ({ items: [] })) },
  };
}

describe("knowledge indexer HTTP", () => {
  it("reports health and rejects an invalid job request", async () => {
    const server = createKnowledgeIndexerServer(dependencies());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing address");
    try {
      const health = await fetch(`http://127.0.0.1:${address.port}/health`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toEqual({ ok: true, qdrant: true });
      const invalid = await fetch(`http://127.0.0.1:${address.port}/v1/index-jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(invalid.status).toBe(400);
      const search = await fetch(`http://127.0.0.1:${address.port}/v1/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectDigest: "b".repeat(32), aliasName: `ht-k-live-${"b".repeat(32)}`, query: "发布", limit: 5 }),
      });
      expect(search.status).toBe(200);
      await expect(search.json()).resolves.toEqual({ ok: true, result: { items: [] } });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
