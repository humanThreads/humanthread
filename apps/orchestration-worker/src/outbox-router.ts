import type { OutboxMessageRecord } from "@humanthread/db";

type OutboxTopicHandler = (payload: unknown) => Promise<void>;
type OutboxTopicConsumers = OutboxTopicHandler | readonly OutboxTopicHandler[];

export function createOutboxTopicRouter(
  handlers: Readonly<Record<string, OutboxTopicConsumers>>,
): (message: OutboxMessageRecord) => Promise<void> {
  return async (message) => {
    const consumers = handlers[message.topic];
    if (!consumers) throw new Error(`Unsupported outbox topic: ${message.topic}`);
    for (const consumer of Array.isArray(consumers) ? consumers : [consumers]) {
      await consumer(message.payload);
    }
  };
}
