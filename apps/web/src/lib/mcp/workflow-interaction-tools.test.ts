import { describe, expect, it, vi } from "vitest";

import {
  dispatchMcpWorkflowInteractionTool,
  resolveActiveAttemptIdentity,
} from "./workflow-interaction-tools";

const interaction = {
  id: "interaction_1",
  projectId: "project_1",
  taskId: "task_1",
  loopRunId: "loop_run_1",
  loopNodeRunId: "node_run_1",
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
    commandId: "cmd_question",
    body: "是否只支持单项目？",
    answers: {},
    createdAt: "2026-08-05T10:00:00.000Z",
    attachmentIds: ["attachment_1"],
    mentionedUserIds: ["user_2"],
  }],
  decision: null,
};

describe("MCP workflow interaction tools", () => {
  it("requests a runtime intervention from the active Attempt without accepting caller Run or Node ids", async () => {
    const requestRuntimeIntervention = vi.fn().mockResolvedValue({
      interactionId: "runtime_interaction_1",
      status: "open",
      version: 1,
      recovered: false,
    });
    const resolveActiveAttemptIdentity = vi.fn().mockResolvedValue({
      agentRunId: "agent_run_1",
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "loop_attempt_1",
    });

    await expect(dispatchMcpWorkflowInteractionTool({
      tool: "request_workflow_intervention",
      actorUserId: "user_assignee",
      arguments: {
        commandId: "cmd_intervention_1",
        loopNodeAttemptId: "loop_attempt_1",
        reason: "缺少手机 App 源码",
        evidence: { issueType: "MOBILE_SOURCE_UNAVAILABLE" },
      },
    }, { requestRuntimeIntervention, resolveActiveAttemptIdentity } as never)).resolves.toMatchObject({
      interactionId: "runtime_interaction_1",
      recovered: false,
    });

    expect(requestRuntimeIntervention).toHaveBeenCalledWith(expect.objectContaining({
      actor: { type: "agent", id: "mcp:user_assignee", runId: "agent_run_1" },
      actorUserId: "user_assignee",
      loopNodeAttemptId: "loop_attempt_1",
      reason: "缺少手机 App 源码",
      evidence: { issueType: "MOBILE_SOURCE_UNAVAILABLE" },
    }));
    expect(requestRuntimeIntervention.mock.calls[0]?.[0]).not.toHaveProperty("loopRunId", "caller_run");
  });

  it("opens a requirement interaction as the credential's delegated Agent", async () => {
    const openRequirementConversation = vi.fn().mockResolvedValue({
      interactionId: "interaction_1",
      messageId: "message_1",
      sequence: 1,
      version: 1,
      nodeVersion: 6,
      loopRunVersion: 8,
      loopRunProjectionVersion: 12,
    });
    const resolveActiveAttemptIdentity = vi.fn().mockResolvedValue({
      agentRunId: "agent_run_1",
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
    });

    await expect(dispatchMcpWorkflowInteractionTool({
      tool: "open_workflow_interaction",
      actorUserId: "user_assignee",
      arguments: {
        commandId: "cmd_question",
        loopNodeAttemptId: "loop_attempt_1",
        body: "是否只支持单项目？",
        answers: {},
      },
    }, { openRequirementConversation, resolveActiveAttemptIdentity })).resolves.toMatchObject({
      interactionId: "interaction_1",
      recovered: false,
      version: 1,
      path: "/loop-runs/loop_run_1?interaction=interaction_1",
    });

    expect(openRequirementConversation).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_assignee",
      actor: { type: "agent", id: "mcp:user_assignee", runId: "agent_run_1" },
      loopNodeRunId: "node_run_1",
      expectedLoopRunId: "loop_run_1",
    }));
    expect(resolveActiveAttemptIdentity).toHaveBeenCalledWith("loop_attempt_1");
  });

  it("appends an Agent message without an interaction version", async () => {
    const appendRequirementMessage = vi.fn().mockResolvedValue({
      interactionId: "interaction_1",
      messageId: "message_2",
      sequence: 2,
      version: 1,
    });

    await expect(dispatchMcpWorkflowInteractionTool({
      tool: "append_workflow_interaction_message",
      actorUserId: "user_assignee",
      arguments: {
        interactionId: "interaction_1",
        loopRunId: "loop_run_1",
        commandId: "cmd_reply",
        body: "补充现有迁移路径。",
      },
    }, { appendRequirementMessage })).resolves.toMatchObject({
      messageId: "message_2",
      sequence: 2,
      version: 1,
      path: "/loop-runs/loop_run_1?interaction=interaction_1",
    });

    expect(appendRequirementMessage).toHaveBeenCalledWith(expect.objectContaining({
      interactionId: "interaction_1",
      actorUserId: "user_assignee",
      commandId: "cmd_reply",
      expectedLoopRunId: "loop_run_1",
    }));
    expect(appendRequirementMessage.mock.calls[0]?.[0]).not.toHaveProperty("expectedVersion");
  });

  it("recovers the confirmed interaction when a resumed Attempt reopens the same node", async () => {
    const confirmedInteraction = {
      ...interaction,
      status: "confirmed" as const,
      version: 4,
      closedAt: "2026-08-05T10:05:00.000Z",
      messages: [
        interaction.messages[0],
        {
          id: "message_2",
          sequence: 2,
          actorType: "user" as const,
          actorId: "user_assignee",
          commandId: "cmd_answer",
          body: "Q1-A、Q1-C、Q1-D；Q2-A",
          answers: { Q1: ["Q1-A", "Q1-C", "Q1-D"], Q2: ["Q2-A"] },
          createdAt: "2026-08-05T10:04:00.000Z",
          attachmentIds: [],
          mentionedUserIds: [],
        },
      ],
      decision: {
        id: "decision_1",
        decision: "confirmed" as const,
        actorType: "user" as const,
        actorId: "user_assignee",
        reason: null,
        createdAt: "2026-08-05T10:05:00.000Z",
        selectedEdgeId: null,
      },
    };
    const openRequirementConversation = vi.fn();
    const getWorkflowInteraction = vi.fn().mockResolvedValue(confirmedInteraction);
    const assertCanReadProject = vi.fn().mockResolvedValue({ role: "contributor" });
    const resolveActiveAttemptIdentity = vi.fn().mockResolvedValue({
      agentRunId: "agent_run_2",
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      interactionId: "interaction_1",
    });

    await expect(dispatchMcpWorkflowInteractionTool({
      tool: "open_workflow_interaction",
      actorUserId: "user_assignee",
      arguments: {
        commandId: "cmd_resume_question",
        loopNodeAttemptId: "loop_attempt_2",
        body: "不应再次创建的问题",
      },
    }, {
      openRequirementConversation,
      getWorkflowInteraction,
      assertCanReadProject,
      resolveActiveAttemptIdentity,
    })).resolves.toMatchObject({
      interactionId: "interaction_1",
      status: "confirmed",
      version: 4,
      recovered: true,
      messages: [
        expect.objectContaining({ actorType: "agent" }),
        expect.objectContaining({ actorType: "user", body: "Q1-A、Q1-C、Q1-D；Q2-A" }),
      ],
      path: "/loop-runs/loop_run_1?interaction=interaction_1",
    });
    expect(assertCanReadProject).toHaveBeenCalledWith({
      userId: "user_assignee",
      projectId: "project_1",
    });
    expect(openRequirementConversation).not.toHaveBeenCalled();
  });

  it("recovers a confirmed interaction through the manual retry activation chain", async () => {
    const db = {
      loopNodeAttempt: {
        findUnique: vi.fn().mockResolvedValue({
          attempt: 1,
          executorType: "local",
          status: "running",
          agentRunId: "agent_run_retry",
          loopNodeRun: {
            id: "node_run_retry_2",
            loopRunId: "loop_run_1",
            attemptCount: 1,
            status: "running",
            loopRun: { status: "running" },
            workflowInteractions: [],
          },
        }),
      },
      workflowInteraction: {
        findFirst: vi.fn().mockResolvedValue({ id: "interaction_confirmed_1" }),
      },
      orchestrationEvent: {
        findFirst: vi.fn().mockResolvedValue({
          payload: { retryOfNodeRunId: "node_run_retry_1" },
        }),
      },
    };

    await expect(resolveActiveAttemptIdentity("loop_attempt_retry_2", db))
      .resolves.toMatchObject({ interactionId: "interaction_confirmed_1" });
    expect(db.orchestrationEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        aggregateId: "node_run_retry_2",
        eventType: "loop.node.ready",
      }),
    }));
    expect(db.workflowInteraction.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        loopNodeRunId: "node_run_retry_1",
        kind: "requirement_conversation",
        status: "confirmed",
      },
    }));
  });

  it("does not treat a normal node-ready event as retry ancestry", async () => {
    const db = {
      loopNodeAttempt: {
        findUnique: vi.fn().mockResolvedValue({
          attempt: 1,
          executorType: "local",
          status: "running",
          agentRunId: "agent_run_first",
          loopNodeRun: {
            id: "node_run_first",
            loopRunId: "loop_run_1",
            attemptCount: 1,
            status: "running",
            loopRun: { status: "running" },
            workflowInteractions: [],
          },
        }),
      },
      workflowInteraction: { findFirst: vi.fn() },
      orchestrationEvent: {
        findFirst: vi.fn().mockResolvedValue({
          payload: { loopRunId: "loop_run_1", nodeKey: "analyze_requirement" },
        }),
      },
    };

    await expect(resolveActiveAttemptIdentity("loop_attempt_first", db))
      .resolves.toMatchObject({ interactionId: null });
    expect(db.workflowInteraction.findFirst).not.toHaveBeenCalled();
  });

  it("returns a compact authorized interaction view without storage keys", async () => {
    const getWorkflowInteraction = vi.fn().mockResolvedValue(interaction);
    const assertCanReadProject = vi.fn().mockResolvedValue({ role: "viewer" });

    await expect(dispatchMcpWorkflowInteractionTool({
      tool: "get_workflow_interaction",
      actorUserId: "user_viewer",
      arguments: { interactionId: "interaction_1" },
    }, { getWorkflowInteraction, assertCanReadProject })).resolves.toEqual({
      interaction: {
        id: "interaction_1",
        status: "open",
        version: 2,
        latestMessage: expect.objectContaining({ id: "message_1", body: "是否只支持单项目？" }),
        path: "/loop-runs/loop_run_1?interaction=interaction_1",
      },
    });
    expect(JSON.stringify(await dispatchMcpWorkflowInteractionTool({
      tool: "get_workflow_interaction",
      actorUserId: "user_viewer",
      arguments: { interactionId: "interaction_1" },
    }, { getWorkflowInteraction, assertCanReadProject }))).not.toContain("storageKey");
  });

  it("does not read an interaction when Project authorization fails", async () => {
    const getWorkflowInteraction = vi.fn().mockResolvedValue(interaction);
    const assertCanReadProject = vi.fn().mockRejectedValue(new Error("Project access denied"));

    await expect(dispatchMcpWorkflowInteractionTool({
      tool: "get_workflow_interaction",
      actorUserId: "user_other",
      arguments: { interactionId: "interaction_1" },
    }, { getWorkflowInteraction, assertCanReadProject })).rejects.toMatchObject({ code: "authorization_denied" });
  });

  it("requires command identity and expected version for confirmation", async () => {
    const confirmRequirement = vi.fn().mockResolvedValue({ interactionId: "interaction_1", status: "confirmed", version: 3 });

    await expect(dispatchMcpWorkflowInteractionTool({
      tool: "confirm_workflow_interaction",
      actorUserId: "user_assignee",
      arguments: { interactionId: "interaction_1", commandId: "cmd_confirm", expectedVersion: 2 },
    }, { confirmRequirement })).resolves.toMatchObject({ status: "confirmed", version: 3 });
    expect(confirmRequirement).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: "user_assignee", expectedVersion: 2 }));
  });
});
