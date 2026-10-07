import { describe, expect, it, vi } from "vitest";
import {
  createOutboxPublisherStore,
  publishOutboxBatch,
} from "./outbox-publisher";

const now = new Date("2026-07-21T00:00:00.000Z");

describe("publishOutboxBatch", () => {
  it("claims candidates through per-row CAS and returns only won messages", async () => {
    const candidates = [
      { id: "message_1", topic: "orchestration.event", payload: { id: 1 }, attempts: 0 },
      { id: "message_2", topic: "loop.schedule", payload: { id: 2 }, attempts: 1 },
    ];
    const tx = {
      outboxMessage: {
        findMany: vi.fn().mockResolvedValue(candidates),
        updateMany: vi.fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
      },
    };
    const db = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
      outboxMessage: { updateMany: vi.fn() },
    };
    const store = createOutboxPublisherStore(db, {
      topics: ["orchestration.event", "loop.schedule"],
    });

    await expect(store.claimBatch({
      limit: 10,
      now,
      claimToken: "claim_1",
      claimExpiresAt: new Date("2026-07-21T00:01:00.000Z"),
    })).resolves.toEqual([candidates[0]]);

    expect(tx.outboxMessage.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ id: "message_1", publishedAt: null, deadLetteredAt: null }),
      data: expect.objectContaining({ claimToken: "claim_1", claimedAt: now }),
    }));
    expect(tx.outboxMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        topic: { in: ["orchestration.event", "loop.schedule"] },
      }),
    }));
  });

  it("publishes a bounded claimed batch and acknowledges each message", async () => {
    const messages = [
      { id: "message_1", topic: "task.ready", payload: { taskId: "task_1" }, attempts: 0 },
      { id: "message_2", topic: "task.ready", payload: { taskId: "task_2" }, attempts: 0 },
    ];
    const store = {
      claimBatch: vi.fn().mockResolvedValue(messages),
      markPublished: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    };
    const publish = vi.fn().mockResolvedValue(undefined);

    await expect(publishOutboxBatch({
      store,
      limit: 2,
      now,
      claimToken: "claim_1",
      publish,
    })).resolves.toEqual({ claimed: 2, published: 2, retried: 0, deadLettered: 0 });

    expect(store.claimBatch).toHaveBeenCalledWith({
      limit: 2,
      now,
      claimToken: "claim_1",
      claimExpiresAt: new Date("2026-07-21T00:01:00.000Z"),
    });
    expect(publish).toHaveBeenNthCalledWith(1, messages[0]);
    expect(store.markPublished).toHaveBeenCalledTimes(2);
  });

  it("uses exponential retry and dead-letters the twelfth failure", async () => {
    const retryMessage = {
      id: "message_retry",
      topic: "task.ready",
      payload: {},
      attempts: 2,
    };
    const deadMessage = {
      id: "message_dead",
      topic: "task.ready",
      payload: {},
      attempts: 11,
    };
    const store = {
      claimBatch: vi.fn().mockResolvedValue([retryMessage, deadMessage]),
      markPublished: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    };
    const publish = vi.fn().mockRejectedValue(new Error("broker unavailable"));

    await expect(publishOutboxBatch({
      store,
      limit: 10,
      now,
      claimToken: "claim_2",
      publish,
    })).resolves.toEqual({ claimed: 2, published: 0, retried: 1, deadLettered: 1 });

    expect(store.markFailed).toHaveBeenNthCalledWith(1, {
      id: "message_retry",
      claimToken: "claim_2",
      attempts: 3,
      availableAt: new Date("2026-07-21T00:00:08.000Z"),
      deadLetteredAt: null,
      lastError: "broker unavailable",
    });
    expect(store.markFailed).toHaveBeenNthCalledWith(2, expect.objectContaining({
      id: "message_dead",
      attempts: 12,
      deadLetteredAt: now,
    }));
  });
});
