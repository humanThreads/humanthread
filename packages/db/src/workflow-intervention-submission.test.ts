import { describe, expect, it, vi } from "vitest";

import {
  appendWorkflowInteractionMessage,
  confirmLatestWorkflowPosition,
  delegateWorkflowConflictSpeaker,
  submitWorkflowIntervention,
  type WorkflowInteractionDb,
  type WorkflowInterventionTx,
} from "./workflow-interactions";

const now = new Date("2026-08-15T10:00:00.000Z");
const positionADigest = "f1337fb9ca7bf4eea5e9f4cc5e6635205b8f24eb685ac80d95a7b1861b5e7ed7";
const existingSourceDigest = "08ee1c4f3b1e8a45a9e87a09ffe3fa1a539916763b3f45e9ff2411dcd9c71c83";
const newSourceDigest = "d5fa66d8644ee4d8b60ca55e4137170fe35811ae74b8c427f7ce20fc2feb14de";

function position(input: {
  sequence: number;
  actorUserId: string;
  body: string;
  conclusion?: { topicKey: string; optionKey: string; exclusive: boolean };
}) {
  return storedMessage({
    sequence: input.sequence,
    actorUserId: input.actorUserId,
    body: input.body,
    discussion: { event: "position", ...(input.conclusion ? { conclusion: input.conclusion } : {}) },
  });
}

function confirmation(input: {
  sequence: number;
  actorUserId: string;
  positionSequence: number;
  positionDigest: string;
}) {
  return storedMessage({
    sequence: input.sequence,
    actorUserId: input.actorUserId,
    body: "",
    discussion: {
      event: "speaker_confirmation",
      positionSequence: input.positionSequence,
      positionDigest: input.positionDigest,
    },
  });
}

function storedMessage(input: {
  sequence: number;
  actorUserId: string;
  body: string;
  discussion: Record<string, unknown>;
}) {
  return {
    id: `message_${input.sequence}`,
    interactionId: "interaction_1",
    sequence: input.sequence,
    actorType: "user",
    actorId: input.actorUserId,
    actorUserId: input.actorUserId,
    actorUser: { id: input.actorUserId, name: input.actorUserId === "user_a" ? "Alice" : "Bob", avatarUrl: null },
    commandId: `message-command:${input.sequence}`,
    body: input.body,
    structuredAnswers: {
      __humanthread_workflow_message_v1: { answers: {}, discussion: input.discussion },
    },
    createdAt: new Date(now.getTime() + input.sequence * 1_000),
    attachments: [],
    mentions: [],
  };
}

function legacyPlainMessage(input: {
  sequence: number;
  actorUserId: string;
  body: string;
}) {
  return {
    ...storedMessage({
      sequence: input.sequence,
      actorUserId: input.actorUserId,
      body: input.body,
      discussion: { event: "position" },
    }),
    structuredAnswers: {},
  };
}

function createFixture(initialMessages: Array<Record<string, unknown>> = []) {
  const state = {
    interaction: {
      id: "interaction_1",
      projectId: "project_1",
      taskId: "task_1",
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      activationNo: 1,
      kind: "runtime_intervention",
      status: "open",
      version: 1,
      messageSequence: initialMessages.length,
      policySnapshot: { discussion: { phase: "ordinary" } } as Record<string, unknown>,
      createdAt: now,
      closedAt: null as Date | null,
      messages: [...initialMessages],
      decision: null as Record<string, unknown> | null,
      task: {
        assigneeUserId: "user_assignee",
        createdById: "user_creator",
        members: [{ userId: "user_a" }, { userId: "user_b" }],
      },
      project: { managerUserId: "project_owner" },
      loopNodeRun: {
        id: "node_run_1",
        loopRunId: "loop_run_1",
        nodeKey: "implement",
        activationNo: 1,
        status: "waiting_intervention",
        version: 4,
        attemptCount: 1,
        inputSnapshot: { task: "build" },
        attempts: [{ id: "attempt_1", attempt: 1, executorType: "local", inputFingerprint: "input:1", checkpoint: { step: 2 } }],
        loopRun: {
          id: "loop_run_1",
          status: "waiting",
          statusReason: "intervention:MOBILE_SOURCE_UNAVAILABLE",
          version: 7,
          projectionVersion: 3,
          transitionCount: 0,
          repeatCount: 0,
          runGraphSnapshot: null,
          loopVersion: { graph: null },
        },
      },
    },
    nodeStatus: "waiting_intervention",
    nodeVersion: 4,
    runStatus: "waiting",
    runVersion: 7,
    runProjectionVersion: 3,
    receipts: new Map<string, Record<string, unknown>>(),
    decisions: [] as Record<string, unknown>[],
    effects: [] as Record<string, unknown>[],
    events: [] as Record<string, unknown>[],
  };
  let transactionTail: Promise<unknown> = Promise.resolve();

  const row = () => ({
    ...state.interaction,
    status: state.interaction.status,
    version: state.interaction.version,
    messageSequence: state.interaction.messageSequence,
    closedAt: state.interaction.closedAt,
    messages: state.interaction.messages,
    decision: state.interaction.decision,
    loopNodeRun: {
      ...state.interaction.loopNodeRun,
      status: state.nodeStatus,
      version: state.nodeVersion,
      loopRun: {
        ...state.interaction.loopNodeRun.loopRun,
        status: state.runStatus,
        version: state.runVersion,
        projectionVersion: state.runProjectionVersion,
      },
    },
  });

  const tx = {
    commandReceipt: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.receipts.get(where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { state.receipts.set(String(data.id), { ...data, result: null }); }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { state.receipts.set(where.id, { id: where.id, ...data }); }),
    },
    orchestrationAggregateSequence: {
      upsert: vi.fn(async () => ({ sequence: state.events.length + 1 })),
    },
    orchestrationEvent: {
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        state.events.push(...data);
        return { count: data.length };
      }),
    },
    outboxMessage: { createMany: vi.fn(async () => ({ count: 1 })) },
    workflowInteraction: {
      create: vi.fn(),
      findUnique: vi.fn(async () => row()),
      findMany: vi.fn(async () => [row()]),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (where.status !== undefined && where.status !== state.interaction.status) return { count: 0 };
        if (where.version !== undefined && where.version !== state.interaction.version) return { count: 0 };
        if (data.messageSequence) state.interaction.messageSequence += 1;
        if (typeof data.status === "string") state.interaction.status = data.status;
        if (data.version) state.interaction.version += 1;
        if (data.closedAt instanceof Date) state.interaction.closedAt = data.closedAt;
        if (data.policySnapshot && typeof data.policySnapshot === "object") state.interaction.policySnapshot = data.policySnapshot as Record<string, unknown>;
        return { count: 1 };
      }),
    },
    workflowInteractionMessage: {
      findUnique: vi.fn(async ({ where }: { where: { interactionId_commandId: { commandId: string } } }) => {
        const found = state.interaction.messages.find((entry) => entry.commandId === where.interactionId_commandId.commandId);
        return found ? { ...found, interaction: { version: state.interaction.version } } : null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.interaction.messages.push({
          ...data,
          actorUser: { id: data.actorUserId, name: data.actorUserId, avatarUrl: null },
          attachments: [],
          mentions: [],
        });
        return data;
      }),
    },
    workflowInteractionAttachment: { updateMany: vi.fn(async () => ({ count: 0 })) },
    workflowInteractionMention: { createMany: vi.fn(async () => ({ count: 0 })) },
    workflowInteractionDecision: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (state.decisions.length > 0) throw Object.assign(new Error("duplicate decision"), { code: "P2002" });
        state.decisions.push(data);
        state.interaction.decision = data;
        return data;
      }),
    },
    effectExecution: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (state.effects.length > 0) throw Object.assign(new Error("duplicate effect"), { code: "P2002" });
        state.effects.push(data);
        return data;
      }),
    },
    loopNodeRun: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (where.status !== state.nodeStatus || where.version !== state.nodeVersion) return { count: 0 };
        if (typeof data.status === "string") state.nodeStatus = data.status;
        if (data.version) state.nodeVersion += 1;
        return { count: 1 };
      }),
    },
    loopRun: {
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (where.status !== state.runStatus || where.version !== state.runVersion || where.projectionVersion !== state.runProjectionVersion) return { count: 0 };
        if (typeof data.status === "string") state.runStatus = data.status;
        if (data.version) state.runVersion += 1;
        if (data.projectionVersion) state.runProjectionVersion += 1;
        return { count: 1 };
      }),
    },
  } satisfies WorkflowInterventionTx;

  const db = {
    workflowInteraction: tx.workflowInteraction,
    $transaction: vi.fn(<T>(callback: (value: typeof tx) => Promise<T>) => {
      const result = transactionTail.then(() => callback(tx));
      transactionTail = result.then(() => undefined, () => undefined);
      return result;
    }),
  } satisfies WorkflowInteractionDb;
  return { state, tx, db };
}

describe("workflow intervention collaboration persistence", () => {
  it("lets a speaker confirm only their own latest position", async () => {
    const fixture = createFixture([position({ sequence: 1, actorUserId: "user_a", body: "意见 A" })]);

    await expect(confirmLatestWorkflowPosition({
      interactionId: "interaction_1",
      actorUserId: "user_a",
      commandId: "confirm:user_a:1",
      occurredAt: now,
    }, { db: fixture.db })).resolves.toMatchObject({ sequence: 2, version: 1 });

    expect(fixture.tx.workflowInteractionMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "user_a",
        structuredAnswers: {
          __humanthread_workflow_message_v1: {
            answers: {},
            discussion: {
              event: "speaker_confirmation",
              positionSequence: 1,
              positionDigest: positionADigest,
            },
          },
        },
      }),
    });

    await expect(confirmLatestWorkflowPosition({
      interactionId: "interaction_1",
      actorUserId: "user_b",
      commandId: "confirm:user_b:1",
      occurredAt: now,
    }, { db: fixture.db })).rejects.toMatchObject({ code: "authorization_denied" });
  });

  it("runs the confirmation notification hook inside the same serializable transaction", async () => {
    const fixture = createFixture([position({ sequence: 1, actorUserId: "user_a", body: "意见 A" })]);
    const notify = vi.fn().mockResolvedValue(undefined);

    await confirmLatestWorkflowPosition({
      interactionId: "interaction_1",
      actorUserId: "user_a",
      commandId: "confirm:user_a:notification",
      occurredAt: now,
    }, { db: fixture.db, notify });

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      event: "all_speakers_confirmed",
      interactionId: "interaction_1",
      messageId: expect.any(String),
      version: 1,
    }), expect.anything());
    expect(notify.mock.calls[0]?.[1]).toBeDefined();
  });

  it("allows the Task assignee to submit directly when nobody spoke", async () => {
    const fixture = createFixture();

    await expect(submitWorkflowIntervention({
      interactionId: "interaction_1",
      actorUserId: "user_assignee",
      commandId: "submit:1",
      expectedVersion: 1,
      reason: "依赖已补齐",
      action: { type: "resume_checkpoint" },
      occurredAt: now,
    }, { db: fixture.db })).resolves.toMatchObject({
      interactionId: "interaction_1",
      status: "confirmed",
      version: 2,
      recovered: true,
    });

    expect(fixture.state.decisions).toHaveLength(1);
    expect(fixture.state.effects).toHaveLength(1);
    expect(fixture.state.nodeStatus).toBe("ready");
    expect(fixture.state.runStatus).toBe("running");
  });

  it("rejects non-assignees and any submission with a missing speaker confirmation", async () => {
    const fixture = createFixture([position({ sequence: 1, actorUserId: "user_a", body: "意见 A" })]);
    const input = {
      interactionId: "interaction_1",
      commandId: "submit:blocked",
      expectedVersion: 1,
      reason: "继续",
      action: { type: "resume_checkpoint" } as const,
      occurredAt: now,
    };

    await expect(submitWorkflowIntervention({ ...input, actorUserId: "user_a" }, { db: fixture.db }))
      .rejects.toMatchObject({ code: "authorization_denied" });
    await expect(submitWorkflowIntervention({ ...input, actorUserId: "user_assignee", commandId: "submit:missing" }, { db: fixture.db }))
      .rejects.toMatchObject({ code: "validation_failed" });
    expect(fixture.state.decisions).toHaveLength(0);
    expect(fixture.state.effects).toHaveLength(0);
  });

  it("enters conflict resolution without recovering the Loop", async () => {
    const fixture = createFixture([
      position({ sequence: 1, actorUserId: "user_a", body: "选择现有源码", conclusion: { topicKey: "source", optionKey: "existing", exclusive: true } }),
      confirmation({ sequence: 2, actorUserId: "user_a", positionSequence: 1, positionDigest: existingSourceDigest }),
      position({ sequence: 3, actorUserId: "user_b", body: "新建手机应用", conclusion: { topicKey: "source", optionKey: "new", exclusive: true } }),
      confirmation({ sequence: 4, actorUserId: "user_b", positionSequence: 3, positionDigest: newSourceDigest }),
    ]);

    await expect(submitWorkflowIntervention({
      interactionId: "interaction_1",
      actorUserId: "user_assignee",
      commandId: "submit:conflict",
      expectedVersion: 1,
      reason: "存在冲突",
      action: { type: "resume_checkpoint" },
      occurredAt: now,
    }, { db: fixture.db })).resolves.toMatchObject({
      status: "conflict_resolution",
      version: 2,
      recovered: false,
      activeSpeakerKey: "f78dca74b5b2d233948386cdeb815e71",
    });

    expect(fixture.state.interaction.status).toBe("open");
    expect(fixture.state.decisions).toHaveLength(0);
    expect(fixture.state.effects).toHaveLength(0);
    expect(fixture.state.nodeStatus).toBe("waiting_intervention");
  });

  it("allows exactly one of two concurrent final submissions to recover", async () => {
    const fixture = createFixture();
    const submit = (commandId: string) => submitWorkflowIntervention({
      interactionId: "interaction_1",
      actorUserId: "user_assignee",
      commandId,
      expectedVersion: 1,
      reason: "依赖已补齐",
      action: { type: "resume_checkpoint" },
      occurredAt: now,
    }, { db: fixture.db });

    const results = await Promise.allSettled([submit("submit:a"), submit("submit:b")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(fixture.state.decisions).toHaveLength(1);
    expect(fixture.state.effects).toHaveLength(1);
    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledTimes(1);
    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledTimes(1);
  });

  it("terminates the waiting Node and Loop atomically", async () => {
    const fixture = createFixture();

    await expect(submitWorkflowIntervention({
      interactionId: "interaction_1",
      actorUserId: "user_assignee",
      commandId: "submit:terminate",
      expectedVersion: 1,
      reason: "当前任务不包含手机 App",
      action: { type: "terminate" },
      occurredAt: now,
    }, { db: fixture.db })).resolves.toMatchObject({ action: { type: "terminate" }, recovered: true });

    expect(fixture.state.nodeStatus).toBe("cancelled");
    expect(fixture.state.runStatus).toBe("cancelled");
    expect(fixture.state.decisions).toHaveLength(1);
    expect(fixture.state.effects).toHaveLength(1);
  });

  it("routes through a validated feedback edge into one new upstream activation", async () => {
    const fixture = createFixture();
    fixture.state.interaction.loopNodeRun.loopRun.runGraphSnapshot = {
      schemaVersion: 1,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      limits: { maxStages: 8, maxRepeatCount: 4 },
      nodes: [
        { key: "analyze", label: "Analyze", type: "agent_action", executionTarget: "local", promptTemplate: "Analyze" },
        { key: "implement", label: "Implement", type: "agent_action", executionTarget: "local", promptTemplate: "Implement" },
      ],
      edges: [{ id: "feedback_1", source: "implement", target: "analyze", kind: "feedback", outcome: "rework", maxTraversals: 3 }],
    } as never;
    fixture.tx.loopNodeRun.findFirst.mockResolvedValue({ activationNo: 1, inputSnapshot: { task: "analyze" } });
    fixture.tx.loopNodeRun.create.mockResolvedValue({});

    await expect(submitWorkflowIntervention({
      interactionId: "interaction_1",
      actorUserId: "user_assignee",
      commandId: "submit:route",
      expectedVersion: 1,
      reason: "重新确认任务范围",
      action: { type: "route_upstream", targetNodeKey: "analyze" },
      occurredAt: now,
    }, { db: fixture.db })).resolves.toMatchObject({
      action: { type: "route_upstream", targetNodeKey: "analyze" },
      recovered: true,
    });

    expect(fixture.tx.loopNodeRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ nodeKey: "analyze", activationNo: 2, status: "ready" }),
    });
    expect(fixture.state.nodeStatus).toBe("blocked");
    expect(fixture.state.runStatus).toBe("running");
  });

  it("lets only the Project responsible person delegate conflict speech to one current Task participant", async () => {
    const fixture = createFixture();
    fixture.state.interaction.version = 2;
    fixture.state.interaction.policySnapshot = {
      discussion: {
        phase: "conflict_resolution",
        activeSpeakerKey: "f78dca74b5b2d233948386cdeb815e71",
        conflictStartedSequence: 0,
      },
    };

    await expect(delegateWorkflowConflictSpeaker({
      interactionId: "interaction_1",
      actorUserId: "project_owner",
      commandId: "delegate:user_a",
      expectedVersion: 2,
      speakerUserId: "user_a",
      occurredAt: now,
    }, { db: fixture.db })).resolves.toMatchObject({
      interactionId: "interaction_1",
      version: 3,
      activeSpeakerKey: "4694a77b445ce31a90944f1c773e24c3",
    });

    await expect(delegateWorkflowConflictSpeaker({
      interactionId: "interaction_1",
      actorUserId: "user_assignee",
      commandId: "delegate:denied",
      expectedVersion: 3,
      speakerUserId: "user_b",
      occurredAt: now,
    }, { db: fixture.db })).rejects.toMatchObject({ code: "authorization_denied" });

    await expect(delegateWorkflowConflictSpeaker({
      interactionId: "interaction_1",
      actorUserId: "project_owner",
      commandId: "delegate:outsider",
      expectedVersion: 3,
      speakerUserId: "user_outsider",
      occurredAt: now,
    }, { db: fixture.db })).rejects.toMatchObject({ code: "authorization_denied" });
  });

  it("allows only the active conflict speaker to post during conflict resolution", async () => {
    const fixture = createFixture();
    fixture.state.interaction.version = 2;
    fixture.state.interaction.policySnapshot = {
      discussion: {
        phase: "conflict_resolution",
        activeSpeakerKey: "4694a77b445ce31a90944f1c773e24c3",
        conflictStartedSequence: 0,
      },
    };
    const append = (actorUserId: string, commandId: string) => appendWorkflowInteractionMessage({
      command: {
        commandId,
        correlationId: "interaction:interaction_1",
        actor: { type: "user", id: actorUserId },
        payload: {},
        issuedAt: now,
      },
      interactionId: "interaction_1",
      message: {
        body: "二次确认意见",
        answers: {},
        attachmentIds: [],
        mentionedUserIds: [],
        discussion: { event: "position" },
      },
    }, { db: fixture.db });

    await expect(append("user_b", "position:denied")).rejects.toMatchObject({ code: "authorization_denied" });
    await expect(append("user_a", "position:active")).resolves.toMatchObject({ sequence: 1, version: 2 });
  });

  it("revokes delegated conflict authority when the speaker is no longer a current participant", async () => {
    const fixture = createFixture([position({ sequence: 1, actorUserId: "user_a", body: "二次确认意见" })]);
    fixture.state.interaction.version = 2;
    fixture.state.interaction.task.members = [];
    fixture.state.interaction.policySnapshot = {
      discussion: {
        phase: "conflict_resolution",
        activeSpeakerKey: "4694a77b445ce31a90944f1c773e24c3",
        conflictStartedSequence: 0,
      },
    };

    await expect(appendWorkflowInteractionMessage({
      command: {
        commandId: "position:removed",
        correlationId: "interaction:interaction_1",
        actor: { type: "user", id: "user_a" },
        payload: {},
        issuedAt: now,
      },
      interactionId: "interaction_1",
      message: {
        body: "仍然尝试发言",
        answers: {},
        attachmentIds: [],
        mentionedUserIds: [],
        discussion: { event: "position" },
      },
    }, { db: fixture.db })).rejects.toMatchObject({ code: "authorization_denied" });

    await expect(submitWorkflowIntervention({
      interactionId: "interaction_1",
      actorUserId: "user_a",
      commandId: "submit:removed",
      expectedVersion: 2,
      reason: "继续",
      action: { type: "resume_checkpoint" },
      occurredAt: now,
    }, { db: fixture.db })).rejects.toMatchObject({ code: "authorization_denied" });
  });

  it("requires a new conflict-stage position before the active speaker confirms and submits directly", async () => {
    const fixture = createFixture([
      position({ sequence: 1, actorUserId: "user_a", body: "普通讨论意见" }),
      position({ sequence: 2, actorUserId: "project_owner", body: "二次确认结论" }),
    ]);
    fixture.state.interaction.version = 2;
    fixture.state.interaction.policySnapshot = {
      discussion: {
        phase: "conflict_resolution",
        activeSpeakerKey: "f78dca74b5b2d233948386cdeb815e71",
        conflictStartedSequence: 1,
      },
    };

    await expect(submitWorkflowIntervention({
      interactionId: "interaction_1",
      actorUserId: "project_owner",
      commandId: "submit:conflict-speaker",
      expectedVersion: 2,
      reason: "以现有源码为准",
      action: { type: "resume_checkpoint" },
      occurredAt: now,
    }, { db: fixture.db })).resolves.toMatchObject({
      status: "confirmed",
      version: 3,
      recovered: true,
    });

    expect(fixture.state.decisions).toEqual([
      expect.objectContaining({ actorUserId: "project_owner", commandId: "submit:conflict-speaker" }),
    ]);
    expect(fixture.state.effects).toHaveLength(1);
    expect(fixture.state.interaction.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorUserId: "project_owner",
        commandId: "submit:conflict-speaker",
        structuredAnswers: expect.objectContaining({
          __humanthread_workflow_message_v1: expect.objectContaining({
            discussion: expect.objectContaining({ event: "speaker_confirmation", positionSequence: 2 }),
          }),
        }),
      }),
    ]));
  });

  it("treats legacy plain intervention messages as positions during conflict resolution", async () => {
    const fixture = createFixture([
      legacyPlainMessage({ sequence: 1, actorUserId: "project_owner", body: "冲突前意见" }),
      legacyPlainMessage({ sequence: 2, actorUserId: "project_owner", body: "二次确认结论" }),
    ]);
    fixture.state.interaction.version = 2;
    fixture.state.interaction.policySnapshot = {
      discussion: {
        phase: "conflict_resolution",
        activeSpeakerKey: "f78dca74b5b2d233948386cdeb815e71",
        conflictStartedSequence: 1,
      },
    };

    await expect(submitWorkflowIntervention({
      interactionId: "interaction_1",
      actorUserId: "project_owner",
      commandId: "submit:legacy-plain-conflict-speaker",
      expectedVersion: 2,
      reason: "本期不含 mobile 客户端",
      action: { type: "terminate" },
      occurredAt: now,
    }, { db: fixture.db })).resolves.toMatchObject({
      status: "confirmed",
      recovered: true,
      action: { type: "terminate" },
    });

    expect(fixture.state.interaction.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorUserId: "project_owner",
        commandId: "submit:legacy-plain-conflict-speaker",
        structuredAnswers: expect.objectContaining({
          __humanthread_workflow_message_v1: expect.objectContaining({
            discussion: expect.objectContaining({ event: "speaker_confirmation", positionSequence: 2 }),
          }),
        }),
      }),
    ]));
  });

  it("rejects conflict submit without a new active-speaker position and fences ordinary submit", async () => {
    const fixture = createFixture([position({ sequence: 1, actorUserId: "project_owner", body: "冲突前意见" })]);
    fixture.state.interaction.version = 2;
    fixture.state.interaction.policySnapshot = {
      discussion: {
        phase: "conflict_resolution",
        activeSpeakerKey: "f78dca74b5b2d233948386cdeb815e71",
        conflictStartedSequence: 1,
      },
    };

    await expect(submitWorkflowIntervention({
      interactionId: "interaction_1",
      actorUserId: "project_owner",
      commandId: "submit:no-new-position",
      expectedVersion: 2,
      reason: "继续",
      action: { type: "resume_checkpoint" },
      occurredAt: now,
    }, { db: fixture.db })).rejects.toMatchObject({ code: "validation_failed" });

    await expect(submitWorkflowIntervention({
      interactionId: "interaction_1",
      actorUserId: "user_assignee",
      commandId: "submit:ordinary-after-conflict",
      expectedVersion: 2,
      reason: "继续",
      action: { type: "resume_checkpoint" },
      occurredAt: now,
    }, { db: fixture.db })).rejects.toMatchObject({ code: "authorization_denied" });

    expect(fixture.state.decisions).toHaveLength(0);
    expect(fixture.state.effects).toHaveLength(0);
  });

  it("allows only one of two concurrent conflict-speaker delegations", async () => {
    const fixture = createFixture();
    fixture.state.interaction.version = 2;
    fixture.state.interaction.policySnapshot = {
      discussion: {
        phase: "conflict_resolution",
        activeSpeakerKey: "f78dca74b5b2d233948386cdeb815e71",
        conflictStartedSequence: 0,
      },
    };
    const delegate = (commandId: string, speakerUserId: string) => delegateWorkflowConflictSpeaker({
      interactionId: "interaction_1",
      actorUserId: "project_owner",
      commandId,
      expectedVersion: 2,
      speakerUserId,
      occurredAt: now,
    }, { db: fixture.db });

    const results = await Promise.allSettled([
      delegate("delegate:a", "user_a"),
      delegate("delegate:b", "user_b"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(fixture.state.interaction.version).toBe(3);
  });
});
