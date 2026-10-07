import { prisma } from "./prisma";

export interface OutboxMessageRecord {
  id: string;
  topic: string;
  payload: unknown;
  attempts: number;
}

interface OutboxStoreTx {
  outboxMessage: {
    findMany(args: unknown): Promise<OutboxMessageRecord[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

interface OutboxStoreDb {
  $transaction<T>(callback: (tx: OutboxStoreTx) => Promise<T>): Promise<T>;
  outboxMessage: {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

export interface OutboxPublisherStore {
  claimBatch(input: {
    limit: number;
    now: Date;
    claimToken: string;
    claimExpiresAt: Date;
  }): Promise<OutboxMessageRecord[]>;
  markPublished(input: { id: string; claimToken: string; publishedAt: Date }): Promise<void>;
  markFailed(input: {
    id: string;
    claimToken: string;
    attempts: number;
    availableAt: Date;
    deadLetteredAt: Date | null;
    lastError: string;
  }): Promise<void>;
}

export function createOutboxPublisherStore(
  db: OutboxStoreDb = prisma as unknown as OutboxStoreDb,
  options: { topics?: readonly string[] } = {},
): OutboxPublisherStore {
  const availableWhere = (now: Date) => ({
    publishedAt: null,
    deadLetteredAt: null,
    availableAt: { lte: now },
    ...(options.topics === undefined ? {} : { topic: { in: [...options.topics] } }),
    OR: [
      { claimToken: null },
      { claimExpiresAt: { lte: now } },
    ],
  });

  return {
    claimBatch: (input) => db.$transaction(async (tx) => {
      const candidates = await tx.outboxMessage.findMany({
        where: availableWhere(input.now),
        orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        take: input.limit,
        select: { id: true, topic: true, payload: true, attempts: true },
      });
      const claimed: OutboxMessageRecord[] = [];
      for (const candidate of candidates) {
        const result = await tx.outboxMessage.updateMany({
          where: { id: candidate.id, ...availableWhere(input.now) },
          data: {
            claimedAt: input.now,
            claimToken: input.claimToken,
            claimExpiresAt: input.claimExpiresAt,
          },
        });
        if (result.count === 1) claimed.push(candidate);
      }
      return claimed;
    }),
    markPublished: async (input) => {
      const result = await db.outboxMessage.updateMany({
        where: {
          id: input.id,
          claimToken: input.claimToken,
          publishedAt: null,
          deadLetteredAt: null,
        },
        data: {
          publishedAt: input.publishedAt,
          claimToken: null,
          claimExpiresAt: null,
          lastError: null,
        },
      });
      if (result.count !== 1) throw staleClaimError();
    },
    markFailed: async (input) => {
      const result = await db.outboxMessage.updateMany({
        where: {
          id: input.id,
          claimToken: input.claimToken,
          publishedAt: null,
          deadLetteredAt: null,
        },
        data: {
          attempts: input.attempts,
          availableAt: input.availableAt,
          deadLetteredAt: input.deadLetteredAt,
          lastError: input.lastError,
          claimToken: null,
          claimExpiresAt: null,
        },
      });
      if (result.count !== 1) throw staleClaimError();
    },
  };
}

function addMilliseconds(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

function retryDelayMs(attempts: number): number {
  return Math.min(2 ** attempts * 1000, 300_000);
}

export async function publishOutboxBatch(input: {
  store: OutboxPublisherStore;
  limit: number;
  now: Date;
  claimToken: string;
  publish(message: OutboxMessageRecord): Promise<void>;
}): Promise<{ claimed: number; published: number; retried: number; deadLettered: number }> {
  const messages = await input.store.claimBatch({
    limit: input.limit,
    now: input.now,
    claimToken: input.claimToken,
    claimExpiresAt: addMilliseconds(input.now, 60_000),
  });
  let published = 0;
  let retried = 0;
  let deadLettered = 0;

  for (const message of messages) {
    try {
      await input.publish(message);
      await input.store.markPublished({
        id: message.id,
        claimToken: input.claimToken,
        publishedAt: input.now,
      });
      published += 1;
    } catch (error) {
      const attempts = message.attempts + 1;
      const isDeadLetter = attempts >= 12;
      await input.store.markFailed({
        id: message.id,
        claimToken: input.claimToken,
        attempts,
        availableAt: isDeadLetter ? input.now : addMilliseconds(input.now, retryDelayMs(attempts)),
        deadLetteredAt: isDeadLetter ? input.now : null,
        lastError: error instanceof Error ? error.message : String(error),
      });
      if (isDeadLetter) deadLettered += 1;
      else retried += 1;
    }
  }

  return { claimed: messages.length, published, retried, deadLettered };
}

function staleClaimError(): Error {
  return Object.assign(new Error("Outbox claim is stale"), { code: "stale_lease" });
}
