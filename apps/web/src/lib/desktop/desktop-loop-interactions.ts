import { prisma } from "@humanthread/db";
import type {
  DesktopLoopInteractionConfirmRequest,
  DesktopLoopInteractionDecisionRequest,
  DesktopLoopInteractionMessageRequest,
} from "@humanthread/workbench-client";

import {
  appendRequirementMessage,
  confirmRequirement,
  decideWorkflowInteraction,
} from "../orchestration/workflow-interaction-commands";
import { resolveDesktopReadContext } from "./desktop-read-models";

type MutationResult = { id: string; status: string; version: number };

interface DesktopLoopInteractionDependencies {
  resolveDesktopReadContext: typeof resolveDesktopReadContext;
  findInteractionScope(interactionId: string): Promise<{ loopRunId: string; spaceId: string } | null>;
  appendRequirementMessage: typeof appendRequirementMessage;
  confirmRequirement: typeof confirmRequirement;
  decideWorkflowInteraction: typeof decideWorkflowInteraction;
}

const DEFAULT_DEPENDENCIES: DesktopLoopInteractionDependencies = {
  resolveDesktopReadContext,
  findInteractionScope: async (interactionId) => {
    const interaction = await prisma.workflowInteraction.findUnique({
      where: { id: interactionId },
      select: {
        loopRunId: true,
        project: { select: { spaceId: true } },
      },
    });
    return interaction?.project.spaceId
      ? { loopRunId: interaction.loopRunId, spaceId: interaction.project.spaceId }
      : null;
  },
  appendRequirementMessage,
  confirmRequirement,
  decideWorkflowInteraction,
};

export async function appendDesktopLoopInteractionMessage(
  request: Request,
  loopRunId: string,
  interactionId: string,
  input: DesktopLoopInteractionMessageRequest,
  overrides: Partial<DesktopLoopInteractionDependencies> = {},
): Promise<MutationResult> {
  const { dependencies, actorUserId } = await authorizeInteraction(
    request,
    loopRunId,
    interactionId,
    overrides,
  );
  const result = await dependencies.appendRequirementMessage({
    interactionId,
    expectedLoopRunId: loopRunId,
    actor: { type: "user", id: actorUserId },
    actorUserId,
    commandId: input.commandId,
    message: input.message,
    occurredAt: new Date(),
  });
  return { id: result.interactionId, status: "open", version: result.version };
}

export async function confirmDesktopLoopInteraction(
  request: Request,
  loopRunId: string,
  interactionId: string,
  input: DesktopLoopInteractionConfirmRequest,
  overrides: Partial<DesktopLoopInteractionDependencies> = {},
): Promise<MutationResult> {
  const { dependencies, actorUserId } = await authorizeInteraction(
    request,
    loopRunId,
    interactionId,
    overrides,
  );
  const result = await dependencies.confirmRequirement({
    interactionId,
    expectedLoopRunId: loopRunId,
    actorUserId,
    commandId: input.commandId,
    expectedVersion: input.expectedVersion,
    reason: input.reason,
    occurredAt: new Date(),
  });
  return { id: result.interactionId, status: result.status, version: result.version };
}

export async function decideDesktopLoopInteraction(
  request: Request,
  loopRunId: string,
  interactionId: string,
  input: DesktopLoopInteractionDecisionRequest,
  overrides: Partial<DesktopLoopInteractionDependencies> = {},
): Promise<MutationResult> {
  const { dependencies, actorUserId } = await authorizeInteraction(
    request,
    loopRunId,
    interactionId,
    overrides,
  );
  const result = await dependencies.decideWorkflowInteraction({
    interactionId,
    expectedLoopRunId: loopRunId,
    actorUserId,
    commandId: input.commandId,
    expectedVersion: input.expectedVersion,
    decision: input.decision,
    reason: input.reason,
    selectedEdgeId: input.selectedEdgeId,
    occurredAt: new Date(),
  });
  return { id: result.interactionId, status: result.status, version: result.version };
}

async function authorizeInteraction(
  request: Request,
  loopRunId: string,
  interactionId: string,
  overrides: Partial<DesktopLoopInteractionDependencies>,
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  const context = await dependencies.resolveDesktopReadContext(request);
  const scope = await dependencies.findInteractionScope(interactionId);
  if (
    !scope
    || scope.spaceId !== context.space.id
    || scope.loopRunId !== loopRunId
  ) {
    throw Object.assign(new Error("Loop interaction not found"), { code: "not_found" as const });
  }
  return { dependencies, actorUserId: context.actor.userId };
}
