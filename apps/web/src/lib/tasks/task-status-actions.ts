import {
  persistBlockedTaskResultWithPrisma,
  persistCompletedTaskResultWithPrisma,
  persistFollowUpTaskResultWithPrisma,
  persistInterruptedTaskResultWithPrisma,
  persistStartedTaskResultWithPrisma,
  persistTransferTaskResultWithPrisma,
  prisma,
} from "../../../../../packages/db/src/index";
import type { WorkflowTemplate } from "@humanthread/shared";
import { getWorkflowTemplateByMatterType } from "../templates/matter-templates";
import {
  blockTaskForUser,
  completeTaskForUser,
  followUpTaskForUser,
  interruptTaskForUser,
  startTaskForUser,
  transferTaskForUser,
} from "./update-task-status";
import { assertLegacyWorkflowTask } from "./legacy-workflow-task";
import { bestEffortLegacyUserTaskSync } from "./task-compatibility";

export function normalizeWorkflowTemplateForActor(
  template: WorkflowTemplate,
  actorUserId: string,
): WorkflowTemplate {
  return {
    ...template,
    steps: template.steps.map((step) =>
      step.executorType === "human" && !step.assigneeUserId
        ? {
            ...step,
            assigneeUserId: actorUserId,
          }
        : step,
    ),
  };
}

export async function startTaskAction(input: {
  taskId: string;
  actorUserId: string;
  now?: Date;
}) {
  const result = await startTaskForUser(
    {
      actorUserId: input.actorUserId,
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

        return {
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
        };
      },
      persist: async ({ result }) => {
        await persistStartedTaskResultWithPrisma({
          prisma,
          result,
        });
      },
    },
  );
  await bestEffortLegacyUserTaskSync({ taskId: input.taskId, actorUserId: input.actorUserId, legacyStatus: "active" });
  return result;
}

export async function completeTaskAction(input: {
  taskId: string;
  actorUserId: string;
  now?: Date;
}) {
  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    include: { workflowInstance: true },
  });
  if (!task) throw new Error(`Task not found: ${input.taskId}`);
  assertLegacyWorkflowTask(task);
  const template = normalizeWorkflowTemplateForActor(
    getWorkflowTemplateByMatterType(task.workflowInstance.matterTypeId),
    input.actorUserId,
  );
  const result = await completeTaskForUser(
    {
      teamId: task.teamId,
      actorUserId: input.actorUserId,
      now: input.now ?? new Date(),
    },
    {
      loadTaskContext: async () => {
        return {
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
          template,
        };
      },
      persist: async ({ teamId, result }) => {
        await persistCompletedTaskResultWithPrisma({
          prisma,
          teamId,
          result,
        });
      },
    },
  );
  await bestEffortLegacyUserTaskSync({ taskId: input.taskId, actorUserId: input.actorUserId, legacyStatus: "completed" });
  return result;
}

export async function blockTaskAction(input: {
  taskId: string;
  actorUserId: string;
  reason: string;
  now?: Date;
}) {
  const result = await blockTaskForUser(
    {
      actorUserId: input.actorUserId,
      reason: input.reason,
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

        return {
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
        };
      },
      persist: async ({ result }) => {
        await persistBlockedTaskResultWithPrisma({
          prisma,
          result,
        });
      },
    },
  );
  await bestEffortLegacyUserTaskSync({ taskId: input.taskId, actorUserId: input.actorUserId, legacyStatus: "blocked", reason: input.reason });
  return result;
}

export async function interruptTaskAction(input: {
  taskId: string;
  actorUserId: string;
  reason: string;
  now?: Date;
}) {
  const result = await interruptTaskForUser(
    {
      actorUserId: input.actorUserId,
      reason: input.reason,
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

        return {
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
        };
      },
      persist: async ({ result }) => {
        await persistInterruptedTaskResultWithPrisma({
          prisma,
          result,
        });
      },
    },
  );
  await bestEffortLegacyUserTaskSync({
    taskId: input.taskId,
    actorUserId: input.actorUserId,
    legacyStatus: "interrupted",
    reason: input.reason,
  });
  return result;
}

export async function followUpTaskAction(input: {
  taskId: string;
  actorUserId: string;
  reason: string;
  now?: Date;
}) {
  const result = await followUpTaskForUser(
    {
      actorUserId: input.actorUserId,
      reason: input.reason,
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

        return {
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
        };
      },
      persist: async ({ result }) => {
        await persistFollowUpTaskResultWithPrisma({
          prisma,
          result,
        });
      },
    },
  );
  await bestEffortLegacyUserTaskSync({
    taskId: input.taskId,
    actorUserId: input.actorUserId,
    legacyStatus: "follow_up",
    reason: input.reason,
  });
  return result;
}

export async function transferTaskAction(input: {
  taskId: string;
  actorUserId: string;
  targetUserId: string;
  reason: string;
  now?: Date;
}) {
  const result = await transferTaskForUser(
    {
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      reason: input.reason,
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

        return {
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
        };
      },
      persist: async ({ result }) => {
        await persistTransferTaskResultWithPrisma({
          prisma,
          result,
        });
      },
    },
  );
  await bestEffortLegacyUserTaskSync({
    taskId: input.taskId,
    actorUserId: input.actorUserId,
    legacyStatus: "transferred",
    reason: input.reason,
  });
  return result;
}
