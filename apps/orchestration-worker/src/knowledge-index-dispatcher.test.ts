import { describe, expect, it, vi } from "vitest";

import { dispatchQueuedKnowledgeIndexJobs } from "./knowledge-index-dispatcher";

describe("dispatchQueuedKnowledgeIndexJobs", () => {
  it("claims queued jobs and dispatches them idempotently by job id", async () => {
    const jobs = [
      { id: "a".repeat(32), status: "queued", version: 1 },
      { id: "b".repeat(32), status: "queued", version: 1 },
    ];
    const listQueued = vi.fn(async () => jobs);
    const markDispatched = vi.fn(async () => undefined);
    const dispatch = vi.fn(async () => ({ ok: true }));

    const result = await dispatchQueuedKnowledgeIndexJobs({
      limit: 10,
      indexerUrl: "http://indexer.local",
      dependencies: { listQueued, markDispatched, dispatch },
    });

    expect(result).toEqual({ dispatched: 2, skipped: 0, failed: 0 });
    expect(dispatch).toHaveBeenCalledWith({ jobId: "a".repeat(32), indexerUrl: "http://indexer.local", token: undefined });
    expect(dispatch).toHaveBeenCalledWith({ jobId: "b".repeat(32), indexerUrl: "http://indexer.local", token: undefined });
    expect(markDispatched).toHaveBeenCalledTimes(2);
  });

  it("does not dispatch when the indexer is not configured", async () => {
    const listQueued = vi.fn();
    const dispatch = vi.fn();
    await expect(dispatchQueuedKnowledgeIndexJobs({
      limit: 10,
      indexerUrl: "",
      dependencies: { listQueued, markDispatched: vi.fn(), dispatch },
    })).resolves.toEqual({ dispatched: 0, skipped: 0, failed: 0 });
    expect(listQueued).not.toHaveBeenCalled();
  });

  it("keeps a failed dispatch queued for a later retry", async () => {
    const listQueued = vi.fn(async () => [{ id: "a".repeat(32), status: "queued", version: 1 }]);
    const markDispatched = vi.fn(async () => undefined);
    const dispatch = vi.fn(async () => { throw new Error("indexer down"); });

    const result = await dispatchQueuedKnowledgeIndexJobs({
      limit: 10,
      indexerUrl: "http://indexer.local",
      dependencies: { listQueued, markDispatched, dispatch },
    });

    expect(result).toEqual({ dispatched: 0, skipped: 0, failed: 1 });
    expect(markDispatched).not.toHaveBeenCalled();
  });
});
