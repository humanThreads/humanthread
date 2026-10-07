import type {
  AggregateRef,
  OrchestrationActor,
  OrchestrationEventEnvelope,
} from "@humanthread/shared";

export function createEventEnvelope<TPayload>(input: {
  id: string;
  eventType: string;
  aggregate: AggregateRef;
  sequence: number;
  correlationId: string;
  causationId?: string;
  commandId?: string;
  actor: OrchestrationActor;
  occurredAt: Date;
  payload: TPayload;
}): OrchestrationEventEnvelope<TPayload> {
  return {
    id: input.id,
    eventType: input.eventType,
    aggregateType: input.aggregate.type,
    aggregateId: input.aggregate.id,
    aggregateVersion: input.aggregate.version,
    sequence: input.sequence,
    correlationId: input.correlationId,
    ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
    ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
    actorType: input.actor.type,
    actorId: input.actor.id,
    occurredAt: input.occurredAt,
    payload: input.payload,
  };
}
