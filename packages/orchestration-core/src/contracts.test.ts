import { describe, expect, it } from "vitest";
import { createEventEnvelope } from "./contracts";

describe("createEventEnvelope", () => {
  it("preserves command correlation, causation and aggregate sequence", () => {
    expect(createEventEnvelope({
      id: "event_1",
      eventType: "task.ready",
      aggregate: { type: "task", id: "task_1", version: 3 },
      sequence: 3,
      correlationId: "project_1:delivery",
      causationId: "event_0",
      commandId: "command_1",
      actor: { type: "user", id: "user_1" },
      occurredAt: new Date("2026-07-21T00:00:00.000Z"),
      payload: { projectId: "project_1" },
    })).toEqual({
      id: "event_1",
      eventType: "task.ready",
      aggregateType: "task",
      aggregateId: "task_1",
      aggregateVersion: 3,
      sequence: 3,
      correlationId: "project_1:delivery",
      causationId: "event_0",
      commandId: "command_1",
      actorType: "user",
      actorId: "user_1",
      occurredAt: new Date("2026-07-21T00:00:00.000Z"),
      payload: { projectId: "project_1" },
    });
  });

  it("omits optional correlation fields when they are absent", () => {
    const event = createEventEnvelope({
      id: "event_2",
      eventType: "project.created",
      aggregate: { type: "project", id: "project_1", version: 1 },
      sequence: 1,
      correlationId: "project_1",
      actor: { type: "system", id: "orchestration-kernel" },
      occurredAt: new Date("2026-07-21T00:00:00.000Z"),
      payload: {},
    });

    expect(event).not.toHaveProperty("causationId");
    expect(event).not.toHaveProperty("commandId");
  });
});
