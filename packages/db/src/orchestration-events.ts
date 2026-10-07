import type {
  AggregateRef,
  OrchestrationCommand,
  OrchestrationEventEnvelope,
} from "@humanthread/shared";
import { boundedPersistenceId } from "./bounded-id";

export class OrchestrationPersistenceError extends Error {
  readonly code: "version_conflict" | "validation_failed" | "authorization_denied";

  constructor(code: "version_conflict" | "validation_failed" | "authorization_denied", message: string) {
    super(message);
    this.name = "OrchestrationPersistenceError";
    this.code = code;
  }
}

export interface OrchestrationEventsTx {
  commandReceipt: {
    findUnique(args: { where: { id: string } }): Promise<{
      id: string;
      status: string;
      result: unknown;
    } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  orchestrationEvent: {
    createMany(args: { data: Array<Record<string, unknown>> }): Promise<unknown>;
  };
  orchestrationAggregateSequence: {
    upsert(args: {
      where: { aggregateType_aggregateId: { aggregateType: string; aggregateId: string } };
      create: { aggregateType: string; aggregateId: string; sequence: number };
      update: { sequence: { increment: number } };
    }): Promise<{ sequence: number }>;
  };
  outboxMessage: {
    createMany(args: { data: Array<Record<string, unknown>> }): Promise<unknown>;
  };
}

export interface OrchestrationCommandDb<TTx extends OrchestrationEventsTx> {
  $transaction<T>(
    callback: (tx: TTx) => Promise<T>,
    options?: { isolationLevel: "Serializable" },
  ): Promise<T>;
}

interface ApplyResult<TResult, TTx extends OrchestrationEventsTx> {
  result: TResult;
  events: OrchestrationEventEnvelope[];
  persist(tx: TTx): Promise<number | void>;
}

export async function appendOrchestrationEvents(
  tx: OrchestrationEventsTx,
  events: readonly OrchestrationEventEnvelope[],
): Promise<void> {
  if (events.length === 0) return;

  const sequencedEvents: OrchestrationEventEnvelope[] = [];
  for (const event of events) {
    const aggregateSequence = await tx.orchestrationAggregateSequence.upsert({
      where: { aggregateType_aggregateId: { aggregateType: event.aggregateType, aggregateId: event.aggregateId } },
      create: { aggregateType: event.aggregateType, aggregateId: event.aggregateId, sequence: 1 },
      update: { sequence: { increment: 1 } },
    });
    sequencedEvents.push({ ...event, sequence: aggregateSequence.sequence });
  }

  await tx.orchestrationEvent.createMany({
    data: sequencedEvents.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      aggregateVersion: event.aggregateVersion,
      sequence: event.sequence,
      correlationId: event.correlationId,
      ...(event.causationId === undefined ? {} : { causationId: event.causationId }),
      ...(event.commandId === undefined ? {} : { commandId: event.commandId }),
      actorType: event.actorType,
      actorId: event.actorId,
      occurredAt: event.occurredAt.toISOString(),
      payload: event.payload,
    })),
  });

  await tx.outboxMessage.createMany({
    data: sequencedEvents.map((event) => {
      const payload = {
        ...event,
        occurredAt: event.occurredAt.toISOString(),
      };
      return {
        id: boundedPersistenceId("outbox", [event.id]),
        topic: "orchestration.event",
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload,
        availableAt: event.occurredAt,
      };
    }),
  });
}

export async function executeIdempotentCommand<TResult, TTx extends OrchestrationEventsTx>(input: {
  command: OrchestrationCommand<unknown>;
  aggregate: Omit<AggregateRef, "version">;
  db: OrchestrationCommandDb<TTx>;
  transactionOptions?: { isolationLevel: "Serializable" };
  apply(tx: TTx): Promise<ApplyResult<TResult, TTx>>;
}): Promise<TResult> {
  return input.db.$transaction(async (tx) => {
    const existing = await tx.commandReceipt.findUnique({
      where: { id: input.command.commandId },
    });

    if (existing?.status === "completed") {
      return existing.result as TResult;
    }

    if (existing) {
      throw new OrchestrationPersistenceError(
        "validation_failed",
        `Command is already ${existing.status}: ${input.command.commandId}`,
      );
    }

    await tx.commandReceipt.create({
      data: {
        id: input.command.commandId,
        aggregateType: input.aggregate.type,
        aggregateId: input.aggregate.id,
        status: "processing",
        createdAt: input.command.issuedAt,
      },
    });

    const applied = await input.apply(tx);
    const persistedRows = await applied.persist(tx);

    if (persistedRows === 0) {
      throw new OrchestrationPersistenceError(
        "version_conflict",
        `Aggregate changed while processing command: ${input.command.commandId}`,
      );
    }

    await appendOrchestrationEvents(tx, applied.events);
    await tx.commandReceipt.update({
      where: { id: input.command.commandId },
      data: {
        status: "completed",
        result: applied.result,
        completedAt: input.command.issuedAt,
      },
    });

    return applied.result;
  }, input.transactionOptions);
}
