import type { OrchestrationActor, OrchestrationEventEnvelope } from "@humanthread/shared";
import { describe, expect, it, vi } from "vitest";

import {
  appendRequirementMessage,
  confirmRequirement,
  openRequirementConversation,
} from "./workflow-interaction-commands";

const occurredAt = new Date("2026-08-05T10:00:00.000Z");

describe("workflow interaction transaction journey", () => {
  it("opens, discusses, confirms, and resumes one node exactly once", async () => {
    const fixture = createJourneyFixture();

    await fixture.open("cmd_open");
    await fixture.append("cmd_reply", "user", "先支持单项目。");
    await fixture.append("cmd_follow_up", "agent", "是否保留扩展接口？");
    await fixture.confirm("cmd_confirm", 1);
    await fixture.confirm("cmd_confirm", 1);

    expect(fixture.snapshot()).toMatchObject({
      interactionStatus: "confirmed",
      interactionVersion: 2,
      messageBodies: ["首期是否只支持单项目？", "先支持单项目。", "是否保留扩展接口？"],
      nodeStatus: "ready",
      loopRunStatus: "running",
      resumeCount: 1,
      receiptCount: 4,
      eventTypes: [
        "workflow.interaction.opened",
        "workflow.interaction.message_appended",
        "loop.node.waiting_input",
        "workflow.interaction.message_appended",
        "workflow.interaction.message_appended",
        "workflow.interaction.confirmed",
        "loop.node.ready",
      ],
    });
  });

  it.each(["after_decision", "before_event_append"] as const)(
    "rolls back terminal state when confirmation fails %s",
    async (failurePoint) => {
      const fixture = createJourneyFixture();
      await fixture.open("cmd_open");
      await fixture.append("cmd_reply", "user", "采用方案 A。");
      fixture.failNextConfirmationAt(failurePoint);

      await expect(fixture.confirm("cmd_confirm_failed", 1)).rejects.toThrow("Injected confirmation failure");

      expect(fixture.snapshot()).toMatchObject({
        interactionStatus: "open",
        interactionVersion: 1,
        decision: null,
        nodeStatus: "waiting_input",
        loopRunStatus: "waiting",
        resumeCount: 0,
        receiptCount: 2,
        eventTypes: [
          "workflow.interaction.opened",
          "workflow.interaction.message_appended",
          "loop.node.waiting_input",
          "workflow.interaction.message_appended",
        ],
      });
    },
  );

  it("scopes deterministic confirmation event IDs to the interaction", async () => {
    const left = createJourneyFixture("interaction_left");
    const right = createJourneyFixture("interaction_right");
    await left.open("cmd_open_left");
    await right.open("cmd_open_right");

    await left.confirm("shared_confirmation_command", 1);
    await right.confirm("shared_confirmation_command", 1);

    expect(left.confirmationEventIds()).not.toEqual(right.confirmationEventIds());
  });
});

function createJourneyFixture(interactionId = "interaction_1") {
  type State = {
    interactionStatus: "absent" | "open" | "confirmed";
    interactionVersion: number;
    messageSequence: number;
    messages: string[];
    decision: null | "confirmed";
    nodeStatus: "running" | "waiting_input" | "ready";
    nodeVersion: number;
    loopRunStatus: "running" | "waiting";
    loopRunVersion: number;
    projectionVersion: number;
    resumeCount: number;
  };
  let state: State = {
    interactionStatus: "absent",
    interactionVersion: 0,
    messageSequence: 0,
    messages: [],
    decision: null,
    nodeStatus: "running",
    nodeVersion: 5,
    loopRunStatus: "running",
    loopRunVersion: 7,
    projectionVersion: 11,
    resumeCount: 0,
  };
  const receipts = new Map<string, unknown>();
  let aggregateSequences = new Map<string, number>();
  let events: Array<Record<string, unknown>> = [];
  let outbox: Array<Record<string, unknown>> = [];
  let failurePoint: "after_decision" | "before_event_append" | null = null;

  const tx = {
    commandReceipt: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => receipts.get(where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        receipts.set(String(data.id), { ...data, result: null });
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        receipts.set(where.id, { id: where.id, ...data });
      }),
    },
    orchestrationAggregateSequence: {
      upsert: vi.fn(async ({ where, create }: {
        where: { aggregateType_aggregateId: { aggregateType: string; aggregateId: string } };
        create: { sequence: number };
      }) => {
        const aggregate = where.aggregateType_aggregateId;
        const key = `${aggregate.aggregateType}:${aggregate.aggregateId}`;
        const sequence = (aggregateSequences.get(key) ?? create.sequence - 1) + 1;
        aggregateSequences.set(key, sequence);
        return { sequence };
      }),
    },
    orchestrationEvent: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        if (failurePoint === "before_event_append") {
          failurePoint = null;
          throw new Error("Injected confirmation failure before event append");
        }
        events.push(...data);
        return { count: data.length };
      }),
    },
    outboxMessage: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        outbox.push(...data);
        return { count: data.length };
      }),
    },
  };
  const db = {
    $transaction: async <T>(callback: (value: typeof tx) => Promise<T>): Promise<T> => {
      const beforeState = structuredClone(state);
      const beforeReceipts = new Map(receipts);
      const beforeAggregateSequences = new Map(aggregateSequences);
      const beforeEvents = [...events];
      const beforeOutbox = [...outbox];
      try {
        return await callback(tx);
      } catch (error) {
        state = beforeState;
        receipts.clear();
        for (const [key, value] of beforeReceipts) receipts.set(key, value);
        aggregateSequences = beforeAggregateSequences;
        events = beforeEvents;
        outbox = beforeOutbox;
        throw error;
      }
    },
  };

  const mutationState = (actorType?: OrchestrationActor["type"]) => ({
    permissionRole: actorType === "agent" ? "agent" : "task_assignee",
    terminal: state.interactionStatus !== "open",
    interaction: {
      id: interactionId,
      kind: "requirement_conversation",
      status: state.interactionStatus,
      version: state.interactionVersion,
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
    },
    node: {
      id: "node_run_1",
      loopRunId: "loop_run_1",
      status: state.nodeStatus,
      version: state.nodeVersion,
      loopRunStatus: state.loopRunStatus,
      loopRunVersion: state.loopRunVersion,
      loopRunProjectionVersion: state.projectionVersion,
    },
  });
  const messageEvent = (commandId: string, version: number): OrchestrationEventEnvelope => ({
    id: `event:message:${interactionId}:${commandId}`,
    eventType: "workflow.interaction.message_appended",
    aggregateType: "workflow_interaction",
    aggregateId: interactionId,
    aggregateVersion: version,
    sequence: version,
    correlationId: `interaction:${interactionId}`,
    commandId,
    actorType: "user",
    actorId: "user_assignee",
    occurredAt,
    payload: {},
  });
  const appendRecord = vi.fn(async (input: {
    command: { commandId: string };
    message: { body: string };
  }) => {
    state.messages.push(input.message.body);
    state.messageSequence += 1;
    return {
      result: {
        interactionId,
        messageId: `message_${state.messages.length}`,
        sequence: state.messageSequence,
        version: state.interactionVersion,
      },
      events: [messageEvent(input.command.commandId, state.interactionVersion)],
    };
  });

  return {
    open: (commandId: string) => openRequirementConversation({
      actor: { type: "agent", id: "agent_1", runId: commandId },
      actorUserId: "user_assignee",
      commandId,
      loopNodeRunId: "node_run_1",
      expectedLoopRunId: "loop_run_1",
      message: { body: "首期是否只支持单项目？", answers: {}, attachmentIds: [], mentionedUserIds: [] },
      occurredAt,
    }, {
      db,
      loadAuthorizedNodeForOpen: vi.fn(async () => ({
        permissionRole: "agent",
        terminal: false,
        projectId: "project_1",
        taskId: "task_1",
        loopRunId: "loop_run_1",
        loopNodeRunId: "node_run_1",
        activationNo: 1,
        agentRunId: "agent_run_1",
        policySnapshot: { kind: "requirement_conversation" },
        nodeRunVersion: state.nodeVersion,
        loopRunStatus: "running",
        loopRunVersion: state.loopRunVersion,
        loopRunProjectionVersion: state.projectionVersion,
      })),
      createWorkflowInteractionRecord: vi.fn(async (input) => {
        state.interactionStatus = "open";
        state.interactionVersion = 1;
        state.messageSequence = 0;
        return {
          result: { id: interactionId, version: 1 },
          events: [{
            ...messageEvent(input.command.commandId, 1),
            id: `event:opened:${interactionId}:${input.command.commandId}`,
            eventType: "workflow.interaction.opened",
          }],
        };
      }),
      appendWorkflowInteractionMessageRecord: appendRecord,
      pauseNodeForRequirementInput: vi.fn(async () => {
        state.nodeStatus = "waiting_input";
        state.nodeVersion += 1;
        state.loopRunStatus = "waiting";
        state.loopRunVersion += 1;
        state.projectionVersion += 1;
        return {
          nodeVersion: state.nodeVersion,
          loopRunVersion: state.loopRunVersion,
          loopRunProjectionVersion: state.projectionVersion,
        };
      }),
    } as never),
    append: (commandId: string, actorType: "user" | "agent", body: string) =>
      appendRequirementMessage({
        interactionId,
        actor: actorType === "agent"
          ? { type: "agent", id: "agent_1", runId: commandId }
          : { type: "user", id: "user_assignee" },
        actorUserId: "user_assignee",
        commandId,
        expectedLoopRunId: "loop_run_1",
        message: { body, answers: {}, attachmentIds: [], mentionedUserIds: [] },
        occurredAt,
      }, {
        db,
        loadAuthorizedForMutation: vi.fn(async (_transaction, input) => mutationState(input.actorType)),
        appendWorkflowInteractionMessageRecord: appendRecord,
      } as never),
    confirm: (commandId: string, expectedVersion: number) => confirmRequirement({
      interactionId,
      actorUserId: "user_assignee",
      commandId,
      expectedVersion,
      expectedLoopRunId: "loop_run_1",
      reason: "需求已确认",
      occurredAt,
    }, {
      db,
      loadAuthorizedForMutation: vi.fn(async () => mutationState()),
      closeWorkflowInteraction: vi.fn(async (input) => {
        if (state.interactionVersion !== input.expectedVersion) {
          throw Object.assign(new Error("Workflow interaction changed"), { code: "version_conflict" });
        }
        state.interactionStatus = "confirmed";
        state.interactionVersion += 1;
        state.decision = "confirmed";
        if (failurePoint === "after_decision") {
          failurePoint = null;
          throw new Error("Injected confirmation failure after decision");
        }
        return { interactionId, status: "confirmed", version: state.interactionVersion };
      }),
      resumeWaitingInputNode: vi.fn(async () => {
        state.nodeStatus = "ready";
        state.nodeVersion += 1;
        state.loopRunStatus = "running";
        state.loopRunVersion += 1;
        state.projectionVersion += 1;
        state.resumeCount += 1;
        return {
          nodeVersion: state.nodeVersion,
          loopRunVersion: state.loopRunVersion,
          loopRunProjectionVersion: state.projectionVersion,
        };
      }),
    } as never),
    failNextConfirmationAt: (point: "after_decision" | "before_event_append") => {
      failurePoint = point;
    },
    confirmationEventIds: () => events
      .filter((event) => ["workflow.interaction.confirmed", "loop.node.ready"].includes(String(event.eventType)))
      .map((event) => String(event.id)),
    snapshot: () => ({
      interactionStatus: state.interactionStatus,
      interactionVersion: state.interactionVersion,
      messageBodies: [...state.messages],
      decision: state.decision,
      nodeStatus: state.nodeStatus,
      loopRunStatus: state.loopRunStatus,
      resumeCount: state.resumeCount,
      receiptCount: receipts.size,
      eventTypes: events.map((event) => event.eventType),
      outboxCount: outbox.length,
    }),
  };
}
