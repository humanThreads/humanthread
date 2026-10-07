import type { TaskEvent } from "@humanthread/shared";

interface LegacyTaskEventTx {
  orchestrationAggregateSequence: {
    upsert(args: {
      where: { aggregateType_aggregateId: { aggregateType: string; aggregateId: string } };
      create: { aggregateType: string; aggregateId: string; sequence: number };
      update: { sequence: { increment: number } };
      select: { sequence: true };
    }): Promise<{ sequence: number }>;
  };
  orchestrationEvent: {
    createMany(args: { data: Array<Record<string, unknown>> }): Promise<unknown>;
  };
  outboxMessage: {
    createMany(args: { data: Array<Record<string, unknown>> }): Promise<unknown>;
  };
}

export function mapLegacyTaskEvent(
  event: TaskEvent,
  sequence: number,
): Record<string, unknown> {
  const actor = event.actorType === "system"
    ? { actorType: "system", actorId: event.actorUserId ?? "workflow-core" }
    : event.actorUserId
      ? { actorType: "user", actorId: event.actorUserId }
      : { actorType: "system", actorId: "workflow-core" };

  return {
    id: `legacy:${event.id}`,
    eventType: event.type.replaceAll("_", "."),
    aggregateType: "task",
    aggregateId: event.taskId,
    aggregateVersion: sequence,
    sequence,
    correlationId: `workflow:${event.workflowInstanceId}`,
    causationId: event.id,
    commandId: null,
    actorType: actor.actorType,
    actorId: actor.actorId,
    occurredAt: event.createdAt.toISOString(),
    payload: {
      legacyTaskEventId: event.id,
      ...(event.message ? { message: event.message } : {}),
      ...(event.payload === undefined ? {} : { legacyPayload: event.payload }),
    },
  };
}

export async function appendLegacyTaskEvents(input: {
  tx: LegacyTaskEventTx;
  events: readonly TaskEvent[];
}): Promise<void> {
  if (input.events.length === 0) return;

  const taskIds = new Set(input.events.map((event) => event.taskId));
  if (taskIds.size !== 1) {
    throw new Error("Legacy task event append requires one task aggregate per transaction");
  }

  const [taskId] = [...taskIds];
  if (!taskId) return;

  const sequence = await input.tx.orchestrationAggregateSequence.upsert({
    where: { aggregateType_aggregateId: { aggregateType: "task", aggregateId: taskId } },
    create: { aggregateType: "task", aggregateId: taskId, sequence: input.events.length },
    update: { sequence: { increment: input.events.length } },
    select: { sequence: true },
  });
  const firstSequence = sequence.sequence - input.events.length + 1;
  const orchestrationEvents = input.events.map((event, index) =>
    mapLegacyTaskEvent(event, firstSequence + index),
  );

  await input.tx.orchestrationEvent.createMany({ data: orchestrationEvents });
  await input.tx.outboxMessage.createMany({
    data: orchestrationEvents.map((event) => ({
      id: `outbox:${event.id}`,
      topic: "orchestration.event",
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event,
      availableAt: new Date(String(event.occurredAt)),
    })),
  });
}
