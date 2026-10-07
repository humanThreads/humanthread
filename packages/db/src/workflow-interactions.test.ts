import type { OrchestrationCommand } from "@humanthread/shared";
import { describe, expect, it, vi } from "vitest";

import {
  appendWorkflowInteractionMessage,
  closeWorkflowInteraction,
  createWorkflowInteraction,
  getWorkflowInteraction,
  listLoopRunInteractions,
  pauseNodeForRequirementInput,
  resumeWaitingInputNode,
  type WorkflowInteractionDb,
  type WorkflowInteractionTx,
} from "./workflow-interactions";

const now = new Date("2026-08-05T09:00:00.000Z");
const command: OrchestrationCommand<unknown> = {
  commandId: "interaction-command:create-1",
  correlationId: "loop:loop_run_1",
  actor: { type: "agent", id: "agent_1", runId: "agent_run_1" },
  payload: {},
  issuedAt: now,
};

function interactionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "workflow-interaction:loop_node_run_1:1:requirement_conversation",
    projectId: "project_1",
    taskId: "task_1",
    loopRunId: "loop_run_1",
    loopNodeRunId: "loop_node_run_1",
    activationNo: 1,
    kind: "requirement_conversation",
    status: "open",
    version: 1,
    messageSequence: 0,
    createdAt: now,
    closedAt: null,
    messages: [],
    decision: null,
    ...overrides,
  };
}

function createFixture(overrides: {
  interaction?: ReturnType<typeof interactionRow> | null;
  receipt?: unknown;
  closeCount?: number;
  nodeStatus?: string;
  runStatus?: string;
} = {}) {
  const interaction = overrides.interaction === undefined ? interactionRow() : overrides.interaction;
  let messageSequence = Number(interaction?.messageSequence ?? 0);
  const messages = new Map<string, {
    id: string;
    interactionId: string;
    sequence: number;
    interaction: { version: number };
  }>();
  const aggregateSequences = new Map<string, number>();
  const tx = {
    commandReceipt: {
      findUnique: vi.fn().mockResolvedValue(overrides.receipt ?? null),
      create: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
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
    orchestrationEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    outboxMessage: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    loopNodeRun: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        loopRunId: "loop_run_1",
        activationNo: Number(where.id.split("_").at(-1)),
        status: overrides.nodeStatus ?? "running",
        loopRun: {
          id: "loop_run_1",
          projectId: "project_1",
          taskId: "task_1",
          status: overrides.runStatus ?? "running",
        },
      })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    loopRun: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    agentRun: {
      findUnique: vi.fn().mockResolvedValue({
        id: "agent_run_1",
        taskId: null,
        loopRunId: "loop_run_1",
        loopNodeRunId: "loop_node_run_1",
        attempt: 1,
        status: "running",
        workerId: "local-worker:device_1",
        leaseGeneration: 3,
        loopNodeAttempt: {
          id: "loop_attempt_1",
          loopNodeRunId: "loop_node_run_1",
          attempt: 1,
          executorType: "local",
          status: "running",
          agentRunId: "agent_run_1",
          version: 2,
        },
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    agentWorker: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    loopNodeAttempt: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    workflowInteraction: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => interactionRow(data)),
      findUnique: vi.fn(async () => interaction ? { ...interaction, messageSequence } : null),
      findMany: vi.fn().mockResolvedValue(interaction ? [interaction] : []),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (data.messageSequence) messageSequence += 1;
        return { count: overrides.closeCount ?? 1 };
      }),
    },
    workflowInteractionMessage: {
      findUnique: vi.fn(async ({ where }: { where: { interactionId_commandId: { commandId: string } } }) => (
        messages.get(where.interactionId_commandId.commandId) ?? null
      )),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...(() => {
          messages.set(String(data.commandId), {
            id: String(data.id),
            interactionId: String(data.interactionId),
            sequence: Number(data.sequence),
            interaction: { version: Number(interaction?.version ?? 1) },
          });
          return data;
        })(),
        attachments: [],
        mentions: [],
      })),
    },
    workflowInteractionAttachment: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    workflowInteractionMention: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    workflowInteractionDecision: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
  } satisfies WorkflowInteractionTx;
  let transactionTail: Promise<unknown> = Promise.resolve();
  const db = {
    $transaction: vi.fn(<T>(callback: (value: typeof tx) => Promise<T>) => {
      const result = transactionTail.then(() => callback(tx));
      transactionTail = result.then(() => undefined, () => undefined);
      return result;
    }),
    workflowInteraction: tx.workflowInteraction,
  } satisfies WorkflowInteractionDb;
  return { tx, db };
}

function createInput(activationNo: number) {
  return {
    command: { ...command, commandId: `interaction-command:create-${activationNo}` },
    projectId: "project_1",
    taskId: "task_1",
    loopRunId: "loop_run_1",
    loopNodeRunId: `loop_node_run_${activationNo}`,
    activationNo,
    kind: "requirement_conversation" as const,
  };
}

describe("workflow interaction persistence", () => {
  it("isolates repeated node activations in the persisted identity", async () => {
    const fixture = createFixture();

    await createWorkflowInteraction(createInput(1), { db: fixture.db });
    await createWorkflowInteraction(createInput(2), { db: fixture.db });

    expect(fixture.tx.workflowInteraction.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ activationNo: 1 }),
      include: expect.any(Object),
    });
    expect(fixture.tx.workflowInteraction.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({ activationNo: 2 }),
      include: expect.any(Object),
    });
  });

  it.each([
    ["terminal LoopRun", { runStatus: "completed" }],
    ["terminal LoopNodeRun", { nodeStatus: "cancelled" }],
  ])("rejects creation for a %s", async (_label, statuses) => {
    const fixture = createFixture(statuses);

    await expect(createWorkflowInteraction(createInput(1), { db: fixture.db }))
      .rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.workflowInteraction.create).not.toHaveBeenCalled();
  });

  it("returns the stored result for a repeated message command ID", async () => {
    const stored = {
      interactionId: interactionRow().id,
      messageId: "workflow-message:stored",
      sequence: 1,
      version: 1,
    };
    const fixture = createFixture({
      receipt: { id: "interaction-command:message-1", status: "completed", result: stored },
    });

    await expect(appendWorkflowInteractionMessage({
      command: { ...command, commandId: "interaction-command:message-1" },
      interactionId: interactionRow().id,
      message: {
        body: "先支持单项目。",
        answers: { rollout: ["single_project"] },
        attachmentIds: [],
        mentionedUserIds: [],
      },
    }, { db: fixture.db })).resolves.toEqual(stored);

    expect(fixture.tx.workflowInteractionMessage.create).not.toHaveBeenCalled();
    expect(fixture.tx.workflowInteraction.updateMany).not.toHaveBeenCalled();
  });

  it("rejects message appends when the interaction is terminal", async () => {
    const fixture = createFixture({ interaction: interactionRow({ status: "confirmed" }) });

    await expect(appendWorkflowInteractionMessage({
      command: { ...command, commandId: "interaction-command:message-terminal" },
      interactionId: interactionRow().id,
      message: { body: "补充", answers: {}, attachmentIds: [], mentionedUserIds: [] },
    }, { db: fixture.db })).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.workflowInteractionMessage.create).not.toHaveBeenCalled();
  });

  it("binds uploaded attachments and persists eligible mentions with the immutable message", async () => {
    const fixture = createFixture();
    fixture.tx.workflowInteractionAttachment.updateMany.mockResolvedValue({ count: 2 });
    fixture.tx.workflowInteractionMention.createMany.mockResolvedValue({ count: 2 });

    await appendWorkflowInteractionMessage({
      command: { ...command, commandId: "interaction-command:message-relations" },
      interactionId: interactionRow().id,
      message: {
        body: "请查看证据。",
        answers: {},
        attachmentIds: ["attachment_1", "attachment_2"],
        mentionedUserIds: ["user_2", "user_3"],
      },
    }, { db: fixture.db });

    expect(fixture.tx.workflowInteractionAttachment.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["attachment_1", "attachment_2"] },
        interactionId: interactionRow().id,
        messageId: null,
        scanStatus: "safe",
      },
      data: { messageId: expect.any(String) },
    });
    expect(fixture.tx.workflowInteractionMention.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ userId: "user_2" }),
        expect.objectContaining({ userId: "user_3" }),
      ],
    });
  });

  it("persists discussion metadata in a forward-compatible structured message envelope", async () => {
    const fixture = createFixture();

    await appendWorkflowInteractionMessage({
      command: { ...command, commandId: "interaction-command:position-1" },
      interactionId: interactionRow().id,
      message: {
        body: "选择现有源码",
        answers: { rollout: ["existing"] },
        attachmentIds: [],
        mentionedUserIds: [],
        discussion: {
          event: "position",
          conclusion: { topicKey: "source", optionKey: "existing", exclusive: true },
        },
      },
    }, { db: fixture.db });

    expect(fixture.tx.workflowInteractionMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        structuredAnswers: {
          __humanthread_workflow_message_v1: {
            answers: { rollout: ["existing"] },
            discussion: {
              event: "position",
              conclusion: { topicKey: "source", optionKey: "existing", exclusive: true },
            },
          },
        },
      }),
    });
  });

  it("marks new plain runtime-intervention messages as positions", async () => {
    const fixture = createFixture({ interaction: interactionRow({ kind: "runtime_intervention" }) });

    await appendWorkflowInteractionMessage({
      command: { ...command, actor: { type: "user", id: "user_1" }, commandId: "interaction-command:legacy-position" },
      interactionId: interactionRow().id,
      message: {
        body: "本期不含 mobile 客户端",
        answers: {},
        attachmentIds: [],
        mentionedUserIds: [],
      },
    }, { db: fixture.db });

    expect(fixture.tx.workflowInteractionMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        structuredAnswers: {
          __humanthread_workflow_message_v1: {
            answers: {},
            discussion: { event: "position" },
          },
        },
      }),
    });
  });

  it("reserves distinct message sequences without incrementing the interaction version", async () => {
    const fixture = createFixture();
    const first = appendWorkflowInteractionMessage({
      command: { ...command, commandId: "interaction-command:message-concurrent-1" },
      interactionId: interactionRow().id,
      message: { body: "意见 A", answers: {}, attachmentIds: [], mentionedUserIds: [] },
    }, { db: fixture.db });
    const second = appendWorkflowInteractionMessage({
      command: { ...command, commandId: "interaction-command:message-concurrent-2" },
      interactionId: interactionRow().id,
      message: { body: "意见 B", answers: {}, attachmentIds: [], mentionedUserIds: [] },
    }, { db: fixture.db });

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ sequence: 1, version: 1 }),
      expect.objectContaining({ sequence: 2, version: 1 }),
    ]);
    expect(fixture.tx.workflowInteraction.updateMany).toHaveBeenCalledWith({
      where: { id: interactionRow().id, status: "open" },
      data: { messageSequence: { increment: 1 } },
    });
  });

  it("closes an open interaction with a version-fenced update and immutable decision", async () => {
    const fixture = createFixture();

    await expect(closeWorkflowInteraction({
      interactionId: interactionRow().id,
      expectedVersion: 1,
      status: "confirmed",
      actor: { type: "user", id: "user_1" },
      commandId: "interaction-command:confirm-1",
      reason: "需求已确认",
      selectedEdgeId: null,
      occurredAt: now,
    }, fixture.tx)).resolves.toEqual({
      interactionId: interactionRow().id,
      status: "confirmed",
      version: 2,
    });

    expect(fixture.tx.workflowInteraction.updateMany).toHaveBeenCalledWith({
      where: { id: interactionRow().id, status: "open", version: 1 },
      data: { status: "confirmed", version: { increment: 1 }, closedAt: now },
    });
    expect(fixture.tx.workflowInteractionDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        interactionId: interactionRow().id,
        commandId: "interaction-command:confirm-1",
        decision: "confirmed",
        actorType: "user",
        actorId: "user_1",
      }),
    });
  });

  it("reports version conflict without persisting a decision when close CAS loses", async () => {
    const fixture = createFixture({ closeCount: 0 });

    await expect(closeWorkflowInteraction({
      interactionId: interactionRow().id,
      expectedVersion: 1,
      status: "approved",
      actor: { type: "user", id: "user_1" },
      commandId: "interaction-command:approve-1",
      reason: null,
      selectedEdgeId: "release-production",
      occurredAt: now,
    }, fixture.tx)).rejects.toMatchObject({ code: "version_conflict" });

    expect(fixture.tx.workflowInteractionDecision.create).not.toHaveBeenCalled();
  });

  it("resumes a waiting-input node and its LoopRun with fenced versions", async () => {
    const fixture = createFixture();

    await expect(resumeWaitingInputNode({
      nodeRunId: "loop_node_run_1",
      nodeRunVersion: 5,
      loopRunId: "loop_run_1",
      loopRunVersion: 7,
      loopRunProjectionVersion: 11,
      occurredAt: now,
    }, fixture.tx)).resolves.toEqual({
      nodeVersion: 6,
      loopRunVersion: 8,
      loopRunProjectionVersion: 12,
    });

    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledWith({
      where: { id: "loop_node_run_1", loopRunId: "loop_run_1", status: "waiting_input", version: 5 },
      data: { status: "ready", waitingReason: null, readyAt: now, version: { increment: 1 } },
    });
    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: "loop_run_1",
        status: "waiting",
        version: 7,
        projectionVersion: 11,
      },
      data: { status: "running", version: { increment: 1 }, projectionVersion: { increment: 1 } },
    });
  });

  it("pauses a running node and LoopRun when requirement input is requested", async () => {
    const fixture = createFixture();

    await expect(pauseNodeForRequirementInput({
      agentRunId: "agent_run_1",
      nodeRunId: "loop_node_run_1",
      nodeRunVersion: 5,
      loopRunId: "loop_run_1",
      loopRunStatus: "running",
      loopRunVersion: 7,
      loopRunProjectionVersion: 11,
      occurredAt: now,
    }, fixture.tx)).resolves.toEqual({
      nodeVersion: 6,
      loopRunVersion: 8,
      loopRunProjectionVersion: 12,
    });

    expect(fixture.tx.loopNodeAttempt.updateMany).toHaveBeenCalledWith({
      where: {
        id: "loop_attempt_1",
        loopNodeRunId: "loop_node_run_1",
        attempt: 1,
        executorType: "local",
        agentRunId: "agent_run_1",
        status: "running",
        version: 2,
      },
      data: {
        status: "cancelled",
        error: { code: "requirement_input", agentRunId: "agent_run_1" },
        finishedAt: now,
        version: { increment: 1 },
      },
    });
    expect(fixture.tx.agentRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: "agent_run_1",
        taskId: null,
        loopRunId: "loop_run_1",
        loopNodeRunId: "loop_node_run_1",
        attempt: 1,
        leaseGeneration: 3,
        status: { in: ["claimed", "starting", "running", "waiting_approval"] },
      },
      data: {
        status: "cancelled",
        leaseGeneration: 4,
        leaseExpiresAt: now,
        exitReason: "requirement_input",
        finishedAt: now,
        version: { increment: 1 },
      },
    });
    expect(fixture.tx.agentWorker.updateMany).toHaveBeenCalledWith({
      where: { id: "local-worker:device_1", activeRunCount: { gt: 0 } },
      data: { activeRunCount: { decrement: 1 }, version: { increment: 1 } },
    });

    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledWith({
      where: { id: "loop_node_run_1", loopRunId: "loop_run_1", status: "running", version: 5 },
      data: { status: "waiting_input", waitingReason: "requirement_input", version: { increment: 1 } },
    });
    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledWith({
      where: { id: "loop_run_1", status: "running", version: 7, projectionVersion: 11 },
      data: { status: "waiting", version: { increment: 1 }, projectionVersion: { increment: 1 } },
    });
  });

  it("projects persistence rows into additive interaction views", async () => {
    const row = interactionRow({
      createdAt: new Date("2026-08-05T09:00:00.000Z"),
      messages: [{
        id: "workflow-message:1",
        sequence: 1,
        actorType: "user",
        actorId: "user_1",
        commandId: "interaction-command:message-1",
        body: "确认单项目。",
        structuredAnswers: { rollout: ["single_project"] },
        createdAt: new Date("2026-08-05T09:01:00.000Z"),
        attachments: [{ id: "attachment_1" }],
        mentions: [{ userId: "user_2" }],
      }],
      decision: null,
      updatedAt: new Date("2026-08-05T09:02:00.000Z"),
    });
    const fixture = createFixture({ interaction: row });

    await expect(getWorkflowInteraction({ id: row.id }, { db: fixture.db })).resolves.toEqual({
      id: row.id,
      projectId: "project_1",
      taskId: "task_1",
      loopRunId: "loop_run_1",
      loopNodeRunId: "loop_node_run_1",
      activationNo: 1,
      kind: "requirement_conversation",
      status: "open",
      version: 1,
      createdAt: "2026-08-05T09:00:00.000Z",
      closedAt: null,
      messages: [{
        id: "workflow-message:1",
        sequence: 1,
        actorType: "user",
        actorId: "user_1",
        commandId: "interaction-command:message-1",
        body: "确认单项目。",
        answers: { rollout: ["single_project"] },
        createdAt: "2026-08-05T09:01:00.000Z",
        attachmentIds: ["attachment_1"],
        mentionedUserIds: ["user_2"],
      }],
      decision: null,
      discussionState: {
        phase: "ordinary",
        activeSpeakerKey: null,
        speakers: [],
        conflicts: [],
        missingSpeakerKeys: [],
        missingConfirmationCount: 0,
        allSpeakersConfirmed: true,
        hasConflict: false,
      },
    });
  });

  it("projects persisted positions, confirmations, and speaker display identities", async () => {
    const row = interactionRow({
      messages: [{
        id: "workflow-message:position-1",
        sequence: 1,
        actorType: "user",
        actorId: "user_a",
        actorUserId: "user_a",
        actorUser: { id: "user_a", name: "Alice", avatarUrl: "/avatar/alice.png" },
        commandId: "interaction-command:position-1",
        body: "意见 A",
        structuredAnswers: {
          __humanthread_workflow_message_v1: {
            answers: {},
            discussion: { event: "position" },
          },
        },
        createdAt: new Date("2026-08-05T09:01:00.000Z"),
        attachments: [],
        mentions: [],
      }, {
        id: "workflow-message:confirmation-1",
        sequence: 2,
        actorType: "user",
        actorId: "user_a",
        actorUserId: "user_a",
        actorUser: { id: "user_a", name: "Alice", avatarUrl: "/avatar/alice.png" },
        commandId: "interaction-command:confirmation-1",
        body: "",
        structuredAnswers: {
          __humanthread_workflow_message_v1: {
            answers: {},
            discussion: {
              event: "speaker_confirmation",
              positionSequence: 1,
              positionDigest: "f1337fb9ca7bf4eea5e9f4cc5e6635205b8f24eb685ac80d95a7b1861b5e7ed7",
            },
          },
        },
        createdAt: new Date("2026-08-05T09:02:00.000Z"),
        attachments: [],
        mentions: [],
      }],
    });
    const fixture = createFixture({ interaction: row });

    await expect(getWorkflowInteraction({ id: row.id }, { db: fixture.db })).resolves.toMatchObject({
      messages: [
        expect.objectContaining({ discussion: expect.objectContaining({ event: "position" }) }),
        expect.objectContaining({ discussion: expect.objectContaining({ event: "speaker_confirmation", positionSequence: 1 }) }),
      ],
      discussionState: {
        phase: "ordinary",
        activeSpeakerKey: null,
        speakers: [expect.objectContaining({
          speakerKey: "4694a77b445ce31a90944f1c773e24c3",
          actorUserId: "user_a",
          displayName: "Alice",
          avatarUrl: "/avatar/alice.png",
          latestSequence: 1,
          confirmed: true,
        })],
        conflicts: [],
        missingSpeakerKeys: [],
        missingConfirmationCount: 0,
        allSpeakersConfirmed: true,
        hasConflict: false,
      },
    });
  });

  it("projects attachment-only legacy runtime-intervention messages as positions", async () => {
    const row = interactionRow({
      kind: "runtime_intervention",
      messages: [{
        id: "workflow-message:legacy-attachment",
        sequence: 1,
        actorType: "user",
        actorId: "user_a",
        actorUserId: "user_a",
        actorUser: { id: "user_a", name: "Alice", avatarUrl: null },
        commandId: "interaction-command:legacy-attachment",
        body: "",
        structuredAnswers: {},
        createdAt: new Date("2026-08-05T09:01:00.000Z"),
        attachments: [{ id: "attachment_1" }],
        mentions: [],
      }],
    });
    const fixture = createFixture({ interaction: row });

    await expect(getWorkflowInteraction({ id: row.id }, { db: fixture.db })).resolves.toMatchObject({
      messages: [expect.objectContaining({
        attachmentIds: ["attachment_1"],
        discussion: { event: "position" },
      })],
      discussionState: {
        speakers: [expect.objectContaining({
          actorUserId: "user_a",
          latestSequence: 1,
          confirmed: false,
        })],
        missingConfirmationCount: 1,
        allSpeakersConfirmed: false,
      },
    });
  });

  it("does not reinterpret an unknown structured runtime message as a legacy position", async () => {
    const row = interactionRow({
      kind: "runtime_intervention",
      messages: [{
        id: "workflow-message:future-event",
        sequence: 1,
        actorType: "user",
        actorId: "user_a",
        actorUserId: "user_a",
        actorUser: { id: "user_a", name: "Alice", avatarUrl: null },
        commandId: "interaction-command:future-event",
        body: "未来版本消息",
        structuredAnswers: {
          __humanthread_workflow_message_v1: {
            answers: {},
            discussion: { event: "future_event" },
          },
        },
        createdAt: new Date("2026-08-05T09:01:00.000Z"),
        attachments: [],
        mentions: [],
      }],
    });
    const fixture = createFixture({ interaction: row });

    await expect(getWorkflowInteraction({ id: row.id }, { db: fixture.db })).resolves.toMatchObject({
      messages: [expect.not.objectContaining({ discussion: expect.anything() })],
      discussionState: {
        speakers: [],
        missingConfirmationCount: 0,
        allSpeakersConfirmed: true,
      },
    });
  });

  it("lists LoopRun interactions in stable activation and creation order", async () => {
    const fixture = createFixture();

    await listLoopRunInteractions({ loopRunId: "loop_run_1" }, { db: fixture.db });

    expect(fixture.tx.workflowInteraction.findMany).toHaveBeenCalledWith({
      where: { loopRunId: "loop_run_1" },
      orderBy: [{ createdAt: "asc" }, { activationNo: "asc" }, { id: "asc" }],
      include: expect.any(Object),
    });
  });
});
