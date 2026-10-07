import {
  createWorkflowInstanceRecordsWithPrisma,
  prisma,
} from "../../../../../packages/db/src/index";
import { getWorkflowTemplateByMatterType } from "../templates/matter-templates";
import {
  blockTaskAction,
  completeTaskAction,
  followUpTaskAction,
  interruptTaskAction,
  startTaskAction,
  transferTaskAction,
} from "../tasks/task-status-actions";
import { createWorkflowFromTemplate } from "../workflows/create-workflow-from-template";
import type { WorkbenchContext } from "./workbench-context";

function createWorkflowId(): string {
  return `workflow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeOptionalText(value: string | undefined): string {
  return value?.trim() ?? "";
}

export interface CreateWorkbenchWorkflowInput {
  title: string;
  description?: string;
  context: WorkbenchContext;
}

interface CreateWorkbenchWorkflowDependencies {
  getWorkflowTemplateByMatterType: typeof getWorkflowTemplateByMatterType;
  createWorkflowFromTemplate: typeof createWorkflowFromTemplate;
  createId: () => string;
  persist: (input: Parameters<typeof createWorkflowInstanceRecordsWithPrisma>[0]) => Promise<void>;
}

export async function createWorkbenchWorkflow(
  input: CreateWorkbenchWorkflowInput,
  dependencies: CreateWorkbenchWorkflowDependencies = {
    getWorkflowTemplateByMatterType,
    createWorkflowFromTemplate,
    createId: createWorkflowId,
    persist: createWorkflowInstanceRecordsWithPrisma,
  },
) {
  const title = input.title.trim();

  if (!title) {
    throw new Error("Title is required");
  }

  const description = normalizeOptionalText(input.description);
  const template = dependencies.getWorkflowTemplateByMatterType(input.context.matterTypeId);

  return dependencies.createWorkflowFromTemplate(
    {
      teamId: input.context.teamId,
      projectId: input.context.projectId,
      matterTypeId: input.context.matterTypeId,
      title,
      description,
      createdById: input.context.userId,
      template,
      now: new Date(),
    },
    {
      createId: dependencies.createId,
      persist: async ({ teamId, result }) => {
        await dependencies.persist({
          prisma,
          teamId,
          result,
        });
      },
    },
  );
}

export type WorkbenchTaskActionType =
  | "start"
  | "complete"
  | "block"
  | "interrupt"
  | "follow_up"
  | "transfer";

export interface PerformWorkbenchTaskActionInput {
  taskId: string;
  actionType: WorkbenchTaskActionType;
  reason?: string;
  targetUserId?: string;
  context: WorkbenchContext;
}

interface PerformWorkbenchTaskActionDependencies {
  startTaskAction: typeof startTaskAction;
  completeTaskAction: typeof completeTaskAction;
  blockTaskAction: typeof blockTaskAction;
  interruptTaskAction: typeof interruptTaskAction;
  followUpTaskAction: typeof followUpTaskAction;
  transferTaskAction: typeof transferTaskAction;
}

export async function performWorkbenchTaskAction(
  input: PerformWorkbenchTaskActionInput,
  dependencies: PerformWorkbenchTaskActionDependencies = {
    startTaskAction,
    completeTaskAction,
    blockTaskAction,
    interruptTaskAction,
    followUpTaskAction,
    transferTaskAction,
  },
) {
  const now = new Date();
  const reason = normalizeOptionalText(input.reason);
  const targetUserId = normalizeOptionalText(input.targetUserId);

  switch (input.actionType) {
    case "start":
      return dependencies.startTaskAction({
        taskId: input.taskId,
        actorUserId: input.context.userId,
        now,
      });
    case "complete":
      return dependencies.completeTaskAction({
        taskId: input.taskId,
        actorUserId: input.context.userId,
        now,
      });
    case "block":
      return dependencies.blockTaskAction({
        taskId: input.taskId,
        actorUserId: input.context.userId,
        reason,
        now,
      });
    case "interrupt":
      return dependencies.interruptTaskAction({
        taskId: input.taskId,
        actorUserId: input.context.userId,
        reason,
        now,
      });
    case "follow_up":
      return dependencies.followUpTaskAction({
        taskId: input.taskId,
        actorUserId: input.context.userId,
        reason,
        now,
      });
    case "transfer":
      if (!targetUserId) {
        throw new Error("Target user is required");
      }

      if (targetUserId === input.context.userId) {
        throw new Error("Target user must be different from actor");
      }

      return dependencies.transferTaskAction({
        taskId: input.taskId,
        actorUserId: input.context.userId,
        targetUserId,
        reason,
        now,
      });
  }
}
