import { describe, expect, it, vi } from "vitest";

import {
  appendRequirementMessage,
  confirmLatestWorkflowPosition,
  confirmRequirement,
  delegateWorkflowConflictSpeaker,
  decideWorkflowInteraction,
  openRequirementConversation,
  requestRuntimeIntervention,
  submitWorkflowIntervention,
} from "./workflow-interaction-commands";

const occurredAt = new Date("2026-08-05T10:00:00.000Z");

function createCommandDb(initialSequences: Record<string, number> = {}) {
  const receipts = new Map<string, { id: string; status: string; result: unknown }>();
  const sequences = new Map(Object.entries(initialSequences));
  const tx = {
    commandReceipt: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => receipts.get(where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        receipts.set(String(data.id), { id: String(data.id), status: String(data.status), result: null });
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        receipts.set(where.id, { id: where.id, status: String(data.status), result: data.result });
      }),
    },
    orchestrationAggregateSequence: {
      upsert: vi.fn(async ({ where, create }: {
        where: { aggregateType_aggregateId: { aggregateType: string; aggregateId: string } };
        create: { sequence: number };
      }) => {
        const aggregate = where.aggregateType_aggregateId;
        const key = `${aggregate.aggregateType}:${aggregate.aggregateId}`;
        const sequence = (sequences.get(key) ?? create.sequence - 1) + 1;
        sequences.set(key, sequence);
        return { sequence };
      }),
    },
    orchestrationEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    outboxMessage: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  return {
    tx,
    db: {
      $transaction: async <T>(callback: (value: typeof tx) => Promise<T>): Promise<T> => callback(tx),
    },
  };
}

function confirmationInput(commandId: string) {
  return {
    interactionId: "workflow-interaction:requirement-1",
    actorUserId: "user_assignee",
    commandId,
    expectedVersion: 3,
    reason: "需求已确认",
    occurredAt,
  };
}

function persistedEvent(eventType: string) {
  return {
    id: `event:${eventType}`,
    eventType,
    aggregateType: "workflow_interaction" as const,
    aggregateId: "interaction_1",
    aggregateVersion: 1,
    sequence: 1,
    correlationId: "interaction:interaction_1",
    commandId: "interaction-command:1",
    actorType: "agent" as const,
    actorId: "agent_1",
    occurredAt,
    payload: {},
  };
}

describe("workflow interaction commands", () => {
  it("forwards speaker confirmation and intervention submit to the atomic DB commands", async () => {
    const confirmRecord = vi.fn().mockResolvedValue({ interactionId: "interaction_1", messageId: "message_2", sequence: 2, version: 1 });
    const submitRecord = vi.fn().mockResolvedValue({ interactionId: "interaction_1", status: "confirmed", version: 2, recovered: true });

    await expect(confirmLatestWorkflowPosition({
      interactionId: "interaction_1",
      expectedLoopRunId: "loop_run_1",
      actorUserId: "user_a",
      commandId: "confirm:user_a:1",
      occurredAt,
    }, { confirmLatestWorkflowPosition: confirmRecord })).resolves.toMatchObject({ sequence: 2, version: 1 });

    await expect(submitWorkflowIntervention({
      interactionId: "interaction_1",
      expectedLoopRunId: "loop_run_1",
      actorUserId: "user_assignee",
      commandId: "submit:1",
      expectedVersion: 1,
      reason: "依赖已补齐",
      action: { type: "resume_checkpoint" },
      occurredAt,
    }, { submitWorkflowIntervention: submitRecord })).resolves.toMatchObject({ status: "confirmed", recovered: true });

    expect(confirmRecord).toHaveBeenCalledWith(expect.objectContaining({ expectedLoopRunId: "loop_run_1", actorUserId: "user_a" }));
    expect(submitRecord).toHaveBeenCalledWith(expect.objectContaining({ expectedLoopRunId: "loop_run_1", expectedVersion: 1 }));
  });

  it("forwards conflict speaker delegation to the version-fenced DB command", async () => {
    const delegateRecord = vi.fn().mockResolvedValue({
      interactionId: "interaction_1",
      version: 3,
      activeSpeakerKey: "4694a77b445ce31a90944f1c773e24c3",
    });

    await expect(delegateWorkflowConflictSpeaker({
      interactionId: "interaction_1",
      expectedLoopRunId: "loop_run_1",
      actorUserId: "project_owner",
      commandId: "delegate:user_a",
      expectedVersion: 2,
      speakerUserId: "user_a",
      occurredAt,
    }, { delegateWorkflowConflictSpeaker: delegateRecord })).resolves.toMatchObject({
      version: 3,
      activeSpeakerKey: "4694a77b445ce31a90944f1c773e24c3",
    });

    expect(delegateRecord).toHaveBeenCalledWith(expect.objectContaining({
      expectedLoopRunId: "loop_run_1",
      actorUserId: "project_owner",
      expectedVersion: 2,
      speakerUserId: "user_a",
    }));
  });

  it("resolves the active Attempt and authorizes Task collaboration before requesting intervention", async () => {
    const resolveAttemptTarget = vi.fn().mockResolvedValue({
      attemptId: "attempt_1",
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      projectId: "project_1",
      taskId: "task_1",
    });
    const assertCanCommentOnTask = vi.fn().mockResolvedValue({ role: "collaborator" });
    const requestRecord = vi.fn().mockResolvedValue({
      interactionId: "runtime_interaction_1",
      status: "open",
      version: 2,
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      recovered: false,
    });

    await expect(requestRuntimeIntervention({
      actor: { type: "user", id: "user_1" },
      actorUserId: "user_1",
      commandId: "cmd_intervention_1",
      loopRunId: "loop_run_1",
      reason: "缺少手机 App 源码",
      evidence: { issueType: "MOBILE_SOURCE_UNAVAILABLE" },
      occurredAt,
    }, {
      resolveAttemptTarget,
      assertCanCommentOnTask,
      assertCanDispatchTaskAgent: vi.fn(),
      requestRuntimeIntervention: requestRecord,
    })).resolves.toMatchObject({ interactionId: "runtime_interaction_1" });

    expect(resolveAttemptTarget).toHaveBeenCalledWith({ loopRunId: "loop_run_1" });
    expect(assertCanCommentOnTask).toHaveBeenCalledWith({ userId: "user_1", taskId: "task_1" });
    expect(requestRecord).toHaveBeenCalledWith(expect.objectContaining({ loopNodeAttemptId: "attempt_1" }));
  });

  it("opens the initial Agent question and pauses the active node in one command transaction", async () => {
    const fixture = createCommandDb({ "loop_node:node_run_1": 13 });
    const writes: string[] = [];
    const resolveInteractionNotificationRecipients = vi.fn().mockResolvedValue(["user_assignee"]);
    const enqueueInteractionNotifications = vi.fn().mockResolvedValue([]);
    const dependencies = {
      db: fixture.db,
      loadAuthorizedNodeForOpen: vi.fn().mockResolvedValue({
        permissionRole: "agent",
        terminal: false,
        projectId: "project_1",
        taskId: "task_1",
        loopRunId: "loop_run_1",
        loopNodeRunId: "node_run_1",
        activationNo: 1,
        agentRunId: "agent_run_1",
        policySnapshot: { kind: "requirement_conversation" },
        nodeRunVersion: 5,
        loopRunStatus: "running",
        loopRunVersion: 7,
        loopRunProjectionVersion: 11,
      }),
      createWorkflowInteractionRecord: vi.fn(async () => {
        writes.push("create");
        return {
          result: { id: "interaction_1", version: 1 },
          events: [persistedEvent("workflow.interaction.opened")],
        };
      }),
      appendWorkflowInteractionMessageRecord: vi.fn(async () => {
        writes.push("question");
        return {
          result: { interactionId: "interaction_1", messageId: "message_1", sequence: 1, version: 1 },
          events: [persistedEvent("workflow.interaction.message_appended")],
        };
      }),
      pauseNodeForRequirementInput: vi.fn(async () => {
        writes.push("pause");
        return { nodeVersion: 6, loopRunVersion: 8, loopRunProjectionVersion: 12 };
      }),
      resolveInteractionNotificationRecipients,
      enqueueInteractionNotifications,
    };

    await expect(openRequirementConversation({
      actor: { type: "agent", id: "mcp:user_assignee", runId: "interaction-open:1" },
      actorUserId: "user_assignee",
      commandId: "interaction-open:1",
      loopNodeRunId: "node_run_1",
      message: { body: "首期是否只支持单项目？", answers: {}, attachmentIds: [], mentionedUserIds: [] },
      occurredAt,
    }, dependencies as never)).resolves.toMatchObject({
      interactionId: "interaction_1",
      messageId: "message_1",
      version: 1,
      nodeVersion: 6,
    });

    expect(writes).toEqual(["create", "question", "pause"]);
    expect(dependencies.pauseNodeForRequirementInput).toHaveBeenCalledWith({
      agentRunId: "agent_run_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 5,
      loopRunId: "loop_run_1",
      loopRunStatus: "running",
      loopRunVersion: 7,
      loopRunProjectionVersion: 11,
      occurredAt,
    }, fixture.tx);
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ eventType: "workflow.interaction.opened" }),
        expect.objectContaining({ eventType: "workflow.interaction.message_appended" }),
        expect.objectContaining({ eventType: "loop.node.waiting_input" }),
      ]),
    });
    const persistedEvents = fixture.tx.orchestrationEvent.createMany.mock.calls[0]?.[0].data as Array<{
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      sequence: number;
    }>;
    expect(persistedEvents.find((event) => event.eventType === "loop.node.waiting_input")).toMatchObject({
      aggregateType: "loop_node",
      aggregateId: "node_run_1",
      sequence: 14,
    });
    expect(enqueueInteractionNotifications).toHaveBeenCalledWith(fixture.tx, expect.objectContaining({
      templateKey: "workflow_requirement_pending",
      recipientUserIds: ["user_assignee"],
      messageId: "message_1",
    }));
  });

  it("lets a current Task collaborator append an immutable reply", async () => {
    const fixture = createCommandDb();
    const dependencies = {
      db: fixture.db,
      loadAuthorizedForMutation: vi.fn().mockResolvedValue({
        permissionRole: "task_collaborator",
        terminal: false,
        interaction: {
          id: "interaction_1",
          kind: "requirement_conversation",
          status: "open",
          version: 2,
          loopRunId: "loop_run_1",
          loopNodeRunId: "node_run_1",
        },
        node: {
          id: "node_run_1",
          loopRunId: "loop_run_1",
          status: "waiting_input",
          version: 6,
          loopRunStatus: "waiting",
          loopRunVersion: 8,
          loopRunProjectionVersion: 12,
        },
      }),
      appendWorkflowInteractionMessageRecord: vi.fn().mockResolvedValue({
        result: { interactionId: "interaction_1", messageId: "message_2", sequence: 2, version: 2 },
        events: [persistedEvent("workflow.interaction.message_appended")],
      }),
    };

    await expect(appendRequirementMessage({
      interactionId: "interaction_1",
      actor: { type: "user", id: "user_collaborator" },
      actorUserId: "user_collaborator",
      commandId: "interaction-message:2",
      message: { body: "是，先支持单项目。", answers: {}, attachmentIds: [], mentionedUserIds: [] },
      occurredAt,
    }, dependencies as never)).resolves.toMatchObject({ messageId: "message_2", version: 2 });

    expect(dependencies.appendWorkflowInteractionMessageRecord).toHaveBeenCalledOnce();
  });

  it("revalidates mentioned Project members inside the message transaction", async () => {
    const fixture = createCommandDb();
    const resolveWorkflowMentions = vi.fn().mockResolvedValue(["user_2"]);
    const enqueueInteractionNotifications = vi.fn().mockResolvedValue([]);
    const appendWorkflowInteractionMessageRecord = vi.fn().mockResolvedValue({
      result: { interactionId: "interaction_1", messageId: "message_2", sequence: 2, version: 2 },
      events: [persistedEvent("workflow.interaction.message_appended")],
    });
    const state = {
      permissionRole: "task_collaborator",
      terminal: false,
      interaction: {
        id: "interaction_1",
        projectId: "project_1",
        taskId: "task_1",
        kind: "requirement_conversation",
        status: "open",
        version: 2,
        loopRunId: "loop_run_1",
        loopNodeRunId: "node_run_1",
      },
      node: {
        id: "node_run_1",
        loopRunId: "loop_run_1",
        status: "waiting_input",
        version: 6,
        loopRunStatus: "waiting",
        loopRunVersion: 8,
        loopRunProjectionVersion: 12,
      },
    };

    await appendRequirementMessage({
      interactionId: "interaction_1",
      actor: { type: "user", id: "user_collaborator" },
      actorUserId: "user_collaborator",
      commandId: "interaction-message:mention",
      message: { body: "请确认。", answers: {}, attachmentIds: [], mentionedUserIds: ["user_2"] },
      occurredAt,
    }, {
      db: fixture.db,
      loadAuthorizedForMutation: vi.fn().mockResolvedValue(state),
      resolveWorkflowMentions,
      enqueueInteractionNotifications,
      appendWorkflowInteractionMessageRecord,
    } as never);

    expect(resolveWorkflowMentions).toHaveBeenCalledWith({
      projectId: "project_1",
      mentionedUserIds: ["user_2"],
      actorUserId: "user_collaborator",
    }, expect.objectContaining({ db: fixture.tx }));
    expect(appendWorkflowInteractionMessageRecord).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.objectContaining({ mentionedUserIds: ["user_2"] }),
    }), fixture.tx);
    expect(enqueueInteractionNotifications).toHaveBeenCalledWith(fixture.tx, expect.objectContaining({
      templateKey: "workflow_mention",
      recipientUserIds: ["user_2"],
      messageId: "message_2",
    }));
  });

  it("closes a release approval and routes its selected edge atomically", async () => {
    const fixture = createCommandDb();
    const dependencies = {
      db: fixture.db,
      loadAuthorizedForMutation: vi.fn().mockResolvedValue({
        permissionRole: "release_approver",
        terminal: false,
        interaction: {
          id: "interaction_release_1",
          kind: "business_approval",
          status: "open",
          version: 1,
          loopRunId: "loop_release_1",
          loopNodeRunId: "node_approval_1",
        },
        node: {
          id: "node_approval_1",
          loopRunId: "loop_release_1",
          status: "waiting_approval",
          version: 3,
          loopRunStatus: "waiting",
          loopRunVersion: 4,
          loopRunProjectionVersion: 6,
        },
      }),
      closeWorkflowInteraction: vi.fn().mockResolvedValue({
        interactionId: "interaction_release_1",
        status: "approved",
        version: 2,
      }),
      routeGateDecision: vi.fn().mockResolvedValue({
        status: "routed",
        selectedEdgeId: "approval-production",
        targetNodeRunId: "node_production_1",
      }),
    };

    await expect(decideWorkflowInteraction({
      interactionId: "interaction_release_1",
      actorUserId: "user_release",
      commandId: "interaction-decision:release-1",
      expectedVersion: 1,
      decision: "approved",
      reason: "预发验证通过",
      selectedEdgeId: "approval-production",
      occurredAt,
    }, dependencies as never)).resolves.toMatchObject({
      status: "approved",
      selectedEdgeId: "approval-production",
    });

    expect(dependencies.routeGateDecision).toHaveBeenCalledWith(expect.objectContaining({
      loopRunId: "loop_release_1",
      loopNodeRunId: "node_approval_1",
      decision: expect.objectContaining({ outcome: "pass", selectedEdgeId: "approval-production" }),
    }), expect.any(Object));
  });

  it("resumes a waiting node only once under concurrent confirmation", async () => {
    const fixture = createCommandDb();
    let version = 3;
    let resumes = 0;
    const dependencies = {
      db: fixture.db,
      loadAuthorizedForMutation: vi.fn().mockResolvedValue({
        permissionRole: "task_assignee",
        terminal: false,
        interaction: {
          id: "workflow-interaction:requirement-1",
          kind: "requirement_conversation",
          status: "open",
          version: 3,
          loopRunId: "loop_run_1",
          loopNodeRunId: "node_run_1",
        },
        node: {
          id: "node_run_1",
          loopRunId: "loop_run_1",
          status: "waiting_input",
          version: 5,
          loopRunStatus: "waiting",
          loopRunVersion: 7,
          loopRunProjectionVersion: 11,
        },
      }),
      closeWorkflowInteraction: vi.fn(async (input: { expectedVersion: number }) => {
        await Promise.resolve();
        if (version !== input.expectedVersion) {
          throw Object.assign(new Error("Workflow interaction changed"), { code: "version_conflict" });
        }
        version += 1;
        return { interactionId: "workflow-interaction:requirement-1", status: "confirmed" as const, version };
      }),
      resumeWaitingInputNode: vi.fn(async () => {
        resumes += 1;
        return { nodeVersion: 6, loopRunVersion: 8, loopRunProjectionVersion: 12 };
      }),
    };

    const results = await Promise.allSettled([
      confirmRequirement(confirmationInput("interaction-confirm:a"), dependencies),
      confirmRequirement(confirmationInput("interaction-confirm:b"), dependencies),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")[0])
      .toMatchObject({ reason: { code: "version_conflict" } });
    expect(resumes).toBe(1);
  });

  it("rejects a current collaborator who cannot finally confirm requirements", async () => {
    const fixture = createCommandDb();
    const dependencies = {
      db: fixture.db,
      loadAuthorizedForMutation: vi.fn().mockResolvedValue({
        permissionRole: "task_collaborator",
        terminal: false,
        interaction: {
          id: "workflow-interaction:requirement-1",
          kind: "requirement_conversation",
          status: "open",
          version: 3,
          loopRunId: "loop_run_1",
          loopNodeRunId: "node_run_1",
        },
        node: {
          id: "node_run_1",
          loopRunId: "loop_run_1",
          status: "waiting_input",
          version: 5,
          loopRunStatus: "waiting",
          loopRunVersion: 7,
          loopRunProjectionVersion: 11,
        },
      }),
      closeWorkflowInteraction: vi.fn(),
      resumeWaitingInputNode: vi.fn(),
    };

    await expect(confirmRequirement(
      confirmationInput("interaction-confirm:denied"),
      dependencies,
    )).rejects.toMatchObject({ code: "authorization_denied" });

    expect(dependencies.closeWorkflowInteraction).not.toHaveBeenCalled();
    expect(dependencies.resumeWaitingInputNode).not.toHaveBeenCalled();
  });

  it("reports terminal interaction history as a version conflict instead of a role denial", async () => {
    const fixture = createCommandDb();
    const dependencies = {
      db: fixture.db,
      loadAuthorizedForMutation: vi.fn().mockResolvedValue({
        permissionRole: "project_admin",
        terminal: true,
        interaction: {
          id: "workflow-interaction:requirement-1",
          kind: "requirement_conversation",
          status: "confirmed",
          version: 4,
          loopRunId: "loop_run_1",
          loopNodeRunId: "node_run_1",
        },
        node: {
          id: "node_run_1",
          loopRunId: "loop_run_1",
          status: "succeeded",
          version: 6,
          loopRunStatus: "completed",
          loopRunVersion: 8,
          loopRunProjectionVersion: 12,
        },
      }),
      closeWorkflowInteraction: vi.fn(),
      resumeWaitingInputNode: vi.fn(),
    };

    await expect(confirmRequirement(
      confirmationInput("interaction-confirm:terminal"),
      dependencies,
    )).rejects.toMatchObject({ code: "version_conflict" });
  });
});
