import { describe, expect, it, vi } from "vitest";

import { readWorkflowTimeline } from "./workflow-timeline-query";

const run = { id: "run_1", projectId: "project_1", definitionVersion: 3, status: "waiting" };

const interactions = [{
  id: "interaction_1",
  projectId: "project_1",
  taskId: "task_1",
  loopRunId: "run_1",
  loopNodeRunId: "node_1",
  activationNo: 1,
  kind: "requirement_conversation" as const,
  status: "open" as const,
  version: 2,
  createdAt: "2026-08-05T10:00:00.000Z",
  closedAt: null,
  messages: [{
    id: "message_1",
    sequence: 1,
    actorType: "agent" as const,
    actorId: "agent_1",
    commandId: "cmd_1",
    body: "请确认单项目",
    answers: {},
    createdAt: "2026-08-05T10:01:00.000Z",
    attachmentIds: [],
    mentionedUserIds: [],
  }],
  decision: null,
}];

describe("workflow timeline query", () => {
  it("merges events and interactions in deterministic chronological order", async () => {
    const result = await readWorkflowTimeline({ userId: "user_1", loopRunId: "run_1", limit: 100 }, {
      loadRun: vi.fn().mockResolvedValue(run),
      assertCanReadProject: vi.fn().mockResolvedValue({ role: "maintainer" }),
      loadEvents: vi.fn().mockResolvedValue([{
        id: "event_1",
        eventType: "loop.node.waiting",
        occurredAt: new Date("2026-08-05T10:00:30.000Z"),
        aggregateType: "loop_node",
        aggregateId: "node_1",
        sequence: 1,
        payload: { summary: "等待需求" },
        actorType: "system",
        actorId: "loop-engine",
      }]),
      loadInteractions: vi.fn().mockResolvedValue(interactions),
    });

    expect(result.items.map((item) => item.kind)).toEqual(["loop_event", "requirement_message"]);
    expect(result.items[1]).toMatchObject({ interactionId: "interaction_1", body: "请确认单项目" });
    expect(result.capabilities).toMatchObject({ canReply: true, supportsInteractions: true });
  });

  it("filters redacted content and rejects foreign cursors", async () => {
    const dependencies = {
      loadRun: vi.fn().mockResolvedValue(run),
      assertCanReadProject: vi.fn().mockResolvedValue({ role: "viewer" }),
      loadEvents: vi.fn().mockResolvedValue([]),
      loadInteractions: vi.fn().mockResolvedValue(interactions),
    };
    await expect(readWorkflowTimeline({ userId: "user_1", loopRunId: "run_1", query: "secret", limit: 100 }, dependencies))
      .resolves.toMatchObject({ items: [] });
    await expect(readWorkflowTimeline({ userId: "user_1", loopRunId: "run_1", cursor: "run_other:1", limit: 100 }, dependencies))
      .rejects.toMatchObject({ code: "validation_failed" });
  });
});
