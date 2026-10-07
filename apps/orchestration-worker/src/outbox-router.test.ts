import { describe, expect, it, vi } from "vitest";
import { createOutboxTopicRouter } from "./outbox-router";

describe("createOutboxTopicRouter", () => {
  it("routes each supported topic payload to its registered handler", async () => {
    const orchestrationEvent = vi.fn().mockResolvedValue(undefined);
    const loopSchedule = vi.fn().mockResolvedValue(undefined);
    const router = createOutboxTopicRouter({
      "orchestration.event": orchestrationEvent,
      "loop.schedule": loopSchedule,
    });

    await router({ id: "outbox_1", topic: "orchestration.event", payload: { eventId: "event_1" }, attempts: 0 });
    await router({ id: "outbox_2", topic: "loop.schedule", payload: { loopRunId: "run_1" }, attempts: 0 });

    expect(orchestrationEvent).toHaveBeenCalledWith({ eventId: "event_1" });
    expect(loopSchedule).toHaveBeenCalledWith({ loopRunId: "run_1" });
  });

  it("rejects an unsupported topic so the durable publisher retries it", async () => {
    const router = createOutboxTopicRouter({});

    await expect(router({
      id: "outbox_unknown",
      topic: "unknown.topic",
      payload: {},
      attempts: 0,
    })).rejects.toThrow("Unsupported outbox topic: unknown.topic");
  });

  it("fans one durable topic out to every registered consumer", async () => {
    const taskTrigger = vi.fn().mockResolvedValue(undefined);
    const developmentEvidence = vi.fn().mockResolvedValue(undefined);
    const router = createOutboxTopicRouter({
      "orchestration.event": [taskTrigger, developmentEvidence],
    });
    const payload = { eventType: "loop.node.completed", aggregateId: "node_1" };

    await router({ id: "outbox_3", topic: "orchestration.event", payload, attempts: 0 });

    expect(taskTrigger).toHaveBeenCalledWith(payload);
    expect(developmentEvidence).toHaveBeenCalledWith(payload);
  });

  it("retries a fanned-out topic when any consumer fails", async () => {
    const router = createOutboxTopicRouter({
      "orchestration.event": [
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockRejectedValue(new Error("evidence persistence unavailable")),
      ],
    });

    await expect(router({
      id: "outbox_4",
      topic: "orchestration.event",
      payload: {},
      attempts: 0,
    })).rejects.toThrow("evidence persistence unavailable");
  });
});
