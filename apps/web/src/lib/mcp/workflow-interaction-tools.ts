import {
  assertCanReadProject,
  getWorkflowInteraction,
  prisma,
} from "@humanthread/db";
import type { WorkflowInteractionView } from "@humanthread/shared";

import {
  appendRequirementMessage,
  confirmRequirement,
  openRequirementConversation,
  requestRuntimeIntervention,
} from "../orchestration/workflow-interaction-commands";

type MessageArguments = {
  body: string;
  answers?: Record<string, string[]>;
  attachmentIds?: string[];
  mentionedUserIds?: string[];
};

interface ActiveAttemptIdentityDb {
  loopNodeAttempt: {
    findUnique(args: unknown): Promise<{
      attempt: number;
      executorType: string;
      status: string;
      agentRunId: string | null;
      loopNodeRun: {
        id: string;
        loopRunId: string;
        attemptCount: number;
        status: string;
        loopRun: { status: string };
        workflowInteractions: { id: string; kind?: string }[];
      };
    } | null>;
  };
  workflowInteraction: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
  orchestrationEvent: {
    findFirst(args: unknown): Promise<{ payload: unknown } | null>;
  };
}

export type McpWorkflowInteractionToolRequest =
  | {
      tool: "open_workflow_interaction";
      actorUserId: string;
      arguments: MessageArguments & {
        commandId: string;
        loopNodeAttemptId: string;
      };
    }
  | {
      tool: "append_workflow_interaction_message";
      actorUserId: string;
      arguments: MessageArguments & {
        interactionId: string;
        loopRunId: string;
        commandId: string;
      };
    }
  | {
      tool: "request_workflow_intervention";
      actorUserId: string;
      arguments: {
        commandId: string;
        loopNodeAttemptId: string;
        reason: string;
        evidence?: unknown;
      };
    }
  | {
      tool: "confirm_workflow_interaction";
      actorUserId: string;
      arguments: {
        interactionId: string;
        loopRunId?: string;
        commandId: string;
        expectedVersion: number;
        reason?: string;
      };
    }
  | {
      tool: "get_workflow_interaction";
      actorUserId: string;
      arguments: { interactionId: string };
    };

type Dependencies = Partial<{
  resolveActiveAttemptIdentity: typeof resolveActiveAttemptIdentity;
  openRequirementConversation: typeof openRequirementConversation;
  appendRequirementMessage: typeof appendRequirementMessage;
  confirmRequirement: typeof confirmRequirement;
  requestRuntimeIntervention: typeof requestRuntimeIntervention;
  getWorkflowInteraction: typeof getWorkflowInteraction;
  assertCanReadProject: typeof assertCanReadProject;
}>;

export async function dispatchMcpWorkflowInteractionTool(
  request: McpWorkflowInteractionToolRequest,
  overrides: Dependencies = {},
) {
  const dependencies = {
    resolveActiveAttemptIdentity,
    openRequirementConversation,
    appendRequirementMessage,
    confirmRequirement,
    requestRuntimeIntervention,
    getWorkflowInteraction,
    assertCanReadProject,
    ...overrides,
  };

  switch (request.tool) {
    case "open_workflow_interaction": {
      const identity = await dependencies.resolveActiveAttemptIdentity(request.arguments.loopNodeAttemptId);
      if (!identity.agentRunId) throw toolError("version_conflict", "Workflow interaction AgentRun is unavailable");
      if (identity.interactionId) {
        const interaction = await dependencies.getWorkflowInteraction({ id: identity.interactionId });
        if (!interaction) throw toolError("version_conflict", "Workflow interaction changed");
        try {
          await dependencies.assertCanReadProject({
            userId: request.actorUserId,
            projectId: interaction.projectId,
          });
        } catch (error) {
          if (isAuthorizationError(error)) {
            throw toolError("authorization_denied", "Workflow interaction access denied");
          }
          throw error;
        }
        return {
          interactionId: interaction.id,
          status: interaction.status,
          version: interaction.version,
          recovered: true,
          messages: interaction.messages,
          latestMessage: interaction.messages.at(-1) ?? null,
          decision: interaction.decision,
          path: interactionPath(interaction.loopRunId, interaction.id),
        };
      }
      const result = await dependencies.openRequirementConversation({
        actorUserId: request.actorUserId,
        actor: delegatedAgent(request.actorUserId, identity.agentRunId),
        commandId: request.arguments.commandId,
        loopNodeRunId: identity.loopNodeRunId,
        expectedLoopRunId: identity.loopRunId,
        message: messageInput(request.arguments),
        occurredAt: new Date(),
      });
      return {
        ...result,
        recovered: false,
        path: interactionPath(identity.loopRunId, result.interactionId),
      };
    }
    case "append_workflow_interaction_message": {
      const result = await dependencies.appendRequirementMessage({
        interactionId: request.arguments.interactionId,
        actorUserId: request.actorUserId,
        actor: delegatedAgent(request.actorUserId, request.arguments.commandId),
        commandId: request.arguments.commandId,
        expectedLoopRunId: request.arguments.loopRunId,
        message: messageInput(request.arguments),
        occurredAt: new Date(),
      });
      return {
        ...result,
        path: interactionPath(request.arguments.loopRunId, request.arguments.interactionId),
      };
    }
    case "request_workflow_intervention": {
      const identity = await dependencies.resolveActiveAttemptIdentity(request.arguments.loopNodeAttemptId);
      if (!identity.agentRunId) throw toolError("version_conflict", "Workflow intervention AgentRun is unavailable");
      const result = await dependencies.requestRuntimeIntervention({
        actor: delegatedAgent(request.actorUserId, identity.agentRunId),
        actorUserId: request.actorUserId,
        commandId: request.arguments.commandId,
        loopNodeAttemptId: request.arguments.loopNodeAttemptId,
        reason: request.arguments.reason,
        ...(request.arguments.evidence === undefined ? {} : { evidence: request.arguments.evidence }),
        occurredAt: new Date(),
      });
      return {
        ...result,
        path: interactionPath(result.loopRunId, result.interactionId),
      };
    }
    case "confirm_workflow_interaction": {
      const result = await dependencies.confirmRequirement({
        interactionId: request.arguments.interactionId,
        actorUserId: request.actorUserId,
        commandId: request.arguments.commandId,
        expectedVersion: request.arguments.expectedVersion,
        ...(request.arguments.loopRunId ? { expectedLoopRunId: request.arguments.loopRunId } : {}),
        reason: request.arguments.reason ?? "",
        occurredAt: new Date(),
      });
      return {
        ...result,
        ...(request.arguments.loopRunId
          ? { path: interactionPath(request.arguments.loopRunId, request.arguments.interactionId) }
          : {}),
      };
    }
    case "get_workflow_interaction": {
      const interaction = await dependencies.getWorkflowInteraction({ id: request.arguments.interactionId });
      if (!interaction) throw toolError("not_found", "Workflow interaction not found");
      try {
        await dependencies.assertCanReadProject({
          userId: request.actorUserId,
          projectId: interaction.projectId,
        });
      } catch (error) {
        if (isAuthorizationError(error)) {
          throw toolError("authorization_denied", "Workflow interaction access denied");
        }
        throw error;
      }
      return { interaction: compactInteraction(interaction) };
    }
  }
}

function delegatedAgent(actorUserId: string, runId: string) {
  return { type: "agent" as const, id: `mcp:${actorUserId}`, runId };
}

export async function resolveActiveAttemptIdentity(
  loopNodeAttemptId: string,
  db: ActiveAttemptIdentityDb = prisma as unknown as ActiveAttemptIdentityDb,
) {
  const attempt = await db.loopNodeAttempt.findUnique({
    where: { id: loopNodeAttemptId },
    select: {
      attempt: true,
      executorType: true,
      status: true,
      agentRunId: true,
      loopNodeRun: {
        select: {
          id: true,
          loopRunId: true,
          attemptCount: true,
          status: true,
          loopRun: { select: { status: true } },
          workflowInteractions: {
            where: { kind: { in: ["requirement_conversation", "runtime_intervention"] } },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 2,
            select: { id: true, kind: true },
          },
        },
      },
    },
  });
  const runtimeIntervention = attempt?.loopNodeRun.workflowInteractions.find((interaction) => interaction.kind === "runtime_intervention");
  const isActiveAttempt = Boolean(
    attempt?.agentRunId
    && attempt.executorType === "local"
    && attempt.status === "running"
    && attempt.attempt === attempt.loopNodeRun.attemptCount
    && attempt.loopNodeRun.status === "running"
    && ["pending", "running"].includes(attempt.loopNodeRun.loopRun.status),
  );
  if (!attempt || (!isActiveAttempt && !runtimeIntervention)) throw toolError("version_conflict", "Workflow interaction attempt is not active");
  const directInteractionId = attempt.loopNodeRun.workflowInteractions.find((interaction) => !interaction.kind || interaction.kind === "requirement_conversation")?.id ?? null;
  const interactionId = directInteractionId
    ?? await resolveRetryInteractionId(attempt.loopNodeRun.id, db);
  return {
    agentRunId: attempt.agentRunId,
    loopRunId: attempt.loopNodeRun.loopRunId,
    loopNodeRunId: attempt.loopNodeRun.id,
    interactionId,
    runtimeInterventionId: runtimeIntervention?.id ?? null,
  };
}

async function resolveRetryInteractionId(
  nodeRunId: string,
  db: ActiveAttemptIdentityDb,
): Promise<string | null> {
  const visited = new Set([nodeRunId]);
  let currentNodeRunId = nodeRunId;
  for (let depth = 0; depth < 32; depth += 1) {
    const readyEvent = await db.orchestrationEvent.findFirst({
      where: {
        aggregateType: "loop_node",
        aggregateId: currentNodeRunId,
        eventType: "loop.node.ready",
      },
      orderBy: [{ occurredAt: "desc" }, { sequence: "desc" }],
      select: { payload: true },
    });
    if (!readyEvent) return null;
    const retryOfNodeRunId = retrySourceNodeRunId(readyEvent.payload);
    if (!retryOfNodeRunId) return null;
    if (visited.has(retryOfNodeRunId)) {
      throw toolError("version_conflict", "Workflow interaction retry lineage is invalid");
    }
    visited.add(retryOfNodeRunId);
    const interaction = await db.workflowInteraction.findFirst({
      where: {
        loopNodeRunId: retryOfNodeRunId,
        kind: "requirement_conversation",
        status: "confirmed",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (interaction) return interaction.id;
    currentNodeRunId = retryOfNodeRunId;
  }
  throw toolError("version_conflict", "Workflow interaction retry lineage is too deep");
}

function retrySourceNodeRunId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>).retryOfNodeRunId;
  return typeof value === "string" && value.length > 0 && value.length <= 96 ? value : null;
}

function messageInput(input: MessageArguments) {
  return {
    body: input.body,
    answers: input.answers ?? {},
    attachmentIds: input.attachmentIds ?? [],
    mentionedUserIds: input.mentionedUserIds ?? [],
  };
}

function compactInteraction(interaction: WorkflowInteractionView) {
  return {
    id: interaction.id,
    status: interaction.status,
    version: interaction.version,
    latestMessage: interaction.messages.at(-1) ?? null,
    path: interactionPath(interaction.loopRunId, interaction.id),
  };
}

function interactionPath(loopRunId: string, interactionId: string) {
  return `/loop-runs/${encodeURIComponent(loopRunId)}?interaction=${encodeURIComponent(interactionId)}`;
}

function isAuthorizationError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? String(error.code) : "";
  return code === "authorization_denied" || /access denied/iu.test(error.message);
}

function toolError(code: "authorization_denied" | "not_found" | "version_conflict", message: string) {
  return Object.assign(new Error(message), { code });
}
