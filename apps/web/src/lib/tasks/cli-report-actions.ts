import { prisma } from "../../../../../packages/db/src/index";
import { getWorkflowTemplateByMatterType } from "../templates/matter-templates";
import { normalizeWorkflowTemplateForActor } from "./task-status-actions";
import { reportCliTaskStatus } from "./report-cli-task-status";
import {
  persistBlockedTaskResultWithPrisma,
  persistCompletedTaskResultWithPrisma,
  persistFollowUpTaskResultWithPrisma,
  persistInterruptedTaskResultWithPrisma,
} from "../../../../../packages/db/src/index";
import { assertLegacyWorkflowTask } from "./legacy-workflow-task";
import { changeUserTaskStatus } from "./task-commands";
import { getUserTaskRollout } from "./task-rollout";
import { authenticateAgentRequest } from "../agent/agent-auth";

export async function authenticateCliTaskReport(input: {
  taskId: string;
  authorizationHeader: string | null;
}) {
  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: {
      teamId: true,
      assigneeUserId: true,
      workflowInstance: { select: { createdById: true } },
    },
  });
  if (!task?.workflowInstance) throw new Error(`Task not found: ${input.taskId}`);
  const userId = task.assigneeUserId ?? task.workflowInstance.createdById;
  return authenticateAgentRequest({
    authorizationHeader: input.authorizationHeader,
    userId,
    expectedTeamId: task.teamId,
  });
}

export async function reportCliTaskStatusAction(input: {
  taskId: string;
  status: "completed" | "interrupted" | "follow_up" | "blocked";
  exitCode?: number | null;
  durationSeconds?: number;
  outputSummary?: string;
  payload?: unknown;
  now?: Date;
}) {
  const rollout = getUserTaskRollout();
  return reportCliTaskStatus(
    {
      status: input.status,
      ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
      ...(input.durationSeconds !== undefined ? { durationSeconds: input.durationSeconds } : {}),
      ...(input.outputSummary !== undefined ? { outputSummary: input.outputSummary } : {}),
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
      now: input.now ?? new Date(),
    },
    {
      loadTaskContext: async () => {
        const task = await prisma.task.findUnique({
          where: { id: input.taskId },
          include: {
            workflowInstance: true,
          },
        });

        if (!task) {
          throw new Error(`Task not found: ${input.taskId}`);
        }
        assertLegacyWorkflowTask(task);

        const actorUserId = task.assigneeUserId ?? task.workflowInstance.createdById;
        const template =
          input.status === "completed"
            ? normalizeWorkflowTemplateForActor(
                getWorkflowTemplateByMatterType(task.workflowInstance.matterTypeId),
                actorUserId,
              )
            : undefined;

        return {
          teamId: task.teamId,
          actorUserId,
          workflow: {
            id: task.workflowInstance.id,
            projectId: task.workflowInstance.projectId,
            matterTypeId: task.workflowInstance.matterTypeId,
            workflowTemplateId: task.workflowInstance.workflowTemplateId,
            title: task.workflowInstance.title,
            description: task.workflowInstance.description ?? "",
            status: task.workflowInstance.status as
              | "running"
              | "completed"
              | "blocked"
              | "cancelled",
            currentStepKey: task.workflowInstance.currentStepKey,
            createdById: task.workflowInstance.createdById,
            createdAt: task.workflowInstance.createdAt,
            updatedAt: task.workflowInstance.updatedAt,
          },
          task: {
            id: task.id,
            workflowInstanceId: task.workflowInstanceId,
            projectId: task.projectId,
            stepTemplateId: task.stepTemplateId,
            title: task.title,
            description: task.description,
            status: task.status as
              | "pending"
              | "active"
              | "completed"
              | "blocked"
              | "interrupted"
              | "follow_up"
              | "transferred"
              | "cancelled",
            executorType: task.executorType as "human" | "ai",
            queuePosition: task.queuePosition,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            ...(task.assigneeUserId ? { assigneeUserId: task.assigneeUserId } : {}),
            ...(task.localPath ? { localPath: task.localPath } : {}),
            ...(task.command ? { command: task.command } : {}),
            ...(task.startedAt ? { startedAt: task.startedAt } : {}),
            ...(task.completedAt ? { completedAt: task.completedAt } : {}),
          },
          ...(template ? { template } : {}),
          ...(rollout.writes && task.statusCategory && task.acceptanceMode
            ? {
                userTask: {
                  statusCategory: task.statusCategory,
                  acceptanceMode: task.acceptanceMode as "none" | "human" | "automated" | "hybrid",
                  version: task.version,
                },
              }
            : {}),
        };
      },
      persistCompleted: async ({ teamId, result }) => {
        await persistCompletedTaskResultWithPrisma({
          prisma,
          teamId,
          result,
        });
      },
      persistInterrupted: async ({ result }) => {
        await persistInterruptedTaskResultWithPrisma({
          prisma,
          result,
        });
      },
      persistBlocked: async ({ result }) => {
        await persistBlockedTaskResultWithPrisma({
          prisma,
          result,
        });
      },
      persistFollowUp: async ({ result }) => {
        await persistFollowUpTaskResultWithPrisma({
          prisma,
          result,
        });
      },
      persistCandidate: async ({ taskId, actorUserId, expectedVersion, event }) => {
        const eventPayload = event.payload && typeof event.payload === "object"
          ? event.payload as Record<string, unknown>
          : {};
        await changeUserTaskStatus({
          actor: { type: "user", id: actorUserId },
          commandId: `cli-candidate:${taskId}:${expectedVersion}`,
          correlationId: `legacy-task:${taskId}`,
          taskId,
          expectedVersion,
          command: "submit_for_review",
          ...(event.message ? { reason: event.message } : {}),
          activity: {
            type: "cli_candidate_submitted",
            ...(event.message ? { message: event.message } : {}),
            payload: {
              status: "completed",
              ...(typeof eventPayload.exitCode === "number" || eventPayload.exitCode === null
                ? { exitCode: eventPayload.exitCode }
                : {}),
              ...(typeof eventPayload.durationSeconds === "number"
                ? { durationSeconds: eventPayload.durationSeconds }
                : {}),
            },
          },
        });
      },
    },
  );
}
