import { createHash } from "node:crypto";
import type { OrchestrationActor, OrchestrationCommand } from "@humanthread/shared";
import { deriveTaskBranch } from "@humanthread/orchestration-core";
import { executeTaskCommand, prisma } from "@humanthread/db";
import { userTaskCommandDependencies, type UserTaskCommandDependencies } from "./task-commands";
import { UserTaskCommandError } from "./task-errors";

interface BranchTask {
  id: string;
  spaceId: string;
  projectId: string | null;
  createdById: string;
  assigneeUserId: string | null;
  version: number;
  createdAt: Date;
  shortId: string | null;
  taskBranch: string | null;
  developmentTemplateKey: string | null;
  developmentTemplateKind?: string | null;
}

interface BranchTaskTx {
  task: { updateMany(input: unknown): Promise<{ count: number }> };
}

interface BranchDependencies {
  loadTask(input: { taskId: string }): Promise<BranchTask | null>;
  authorize: UserTaskCommandDependencies["authorize"];
  execute(input: {
    command: OrchestrationCommand<unknown> & { expectedVersion: number };
    taskId: string;
    eventType: string;
    eventPayload: unknown;
    activity: { id: string; type: string; actorType: string; actorUserId?: string; message?: string; payload?: unknown };
    persist(tx: BranchTaskTx): Promise<{ rows: number; result: BranchAssignmentResult }>;
  }): Promise<BranchAssignmentResult>;
}

const defaultDependencies: BranchDependencies = {
  loadTask: async ({ taskId }) => {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true, spaceId: true, projectId: true, createdById: true, assigneeUserId: true,
        version: true, createdAt: true, shortId: true, taskBranch: true,
        project: { select: { developmentTemplateKey: true, developmentTemplate: { select: { kind: true } } } },
      },
    });
    return task ? {
      ...task,
      developmentTemplateKey: task.project?.developmentTemplateKey ?? null,
      developmentTemplateKind: task.project?.developmentTemplate?.kind ?? null,
    } : null;
  },
  authorize: userTaskCommandDependencies.authorize,
  execute: (input) => executeTaskCommand(input),
};

export interface AssignTaskBranchInput {
  actor: OrchestrationActor;
  commandId: string;
  correlationId: string;
  taskId: string;
  expectedVersion: number;
}

export interface BranchAssignmentResult {
  taskId: string;
  taskBranch: string;
  version: number;
}

export async function assignTaskBranch(
  input: AssignTaskBranchInput,
  dependencies: BranchDependencies = defaultDependencies,
): Promise<BranchAssignmentResult> {
  const task = await dependencies.loadTask({ taskId: input.taskId });
  if (!task) throw new UserTaskCommandError("not_found", "Task not found");
  await dependencies.authorize({ actor: input.actor, action: "edit_content", taskId: input.taskId });
  const isBranchDevelopment = task.developmentTemplateKind === "branch-development"
    || (!task.developmentTemplateKind && task.developmentTemplateKey === "branch-development");
  if (!isBranchDevelopment) {
    throw new UserTaskCommandError("validation_failed", "Task Project does not use branch-development mode");
  }
  if (task.taskBranch) {
    return { taskId: task.id, taskBranch: task.taskBranch, version: task.version };
  }
  if (!task.shortId) throw new UserTaskCommandError("validation_failed", "Task has no platform short ID");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new UserTaskCommandError("validation_failed", "Task version is invalid");
  }

  const taskBranch = deriveTaskBranch({ createdAt: task.createdAt, shortId: task.shortId });
  const command: OrchestrationCommand<unknown> & { expectedVersion: number } = {
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    expectedVersion: input.expectedVersion,
    payload: { taskId: input.taskId, taskBranch },
    issuedAt: new Date(),
  };
  const assignmentPayload = {
    taskId: task.id,
    branch: taskBranch,
    year: task.createdAt.getUTCFullYear(),
    shortId: task.shortId,
    assignedAt: command.issuedAt.toISOString(),
    assignedByActor: input.actor.id,
  };
  return dependencies.execute({
    command,
    taskId: task.id,
    eventType: "task.branch_assigned",
    eventPayload: assignmentPayload,
    activity: {
      id: boundedActivityId(input.commandId),
      type: "branch_assigned",
      actorType: input.actor.type,
      ...(input.actor.type === "user" ? { actorUserId: input.actor.id } : {}),
      message: `Task branch assigned: ${taskBranch}`,
      payload: assignmentPayload,
    },
    persist: async (tx) => {
      const updated = await tx.task.updateMany({
        where: { id: task.id, version: input.expectedVersion, taskBranch: null },
        data: {
          taskBranch,
          taskBranchAssignedAt: command.issuedAt,
          taskBranchAssignedByActor: input.actor.id,
          version: { increment: 1 },
        },
      });
      return {
        rows: updated.count,
        result: { taskId: task.id, taskBranch, version: input.expectedVersion + 1 },
      };
    },
  });
}

function boundedActivityId(commandId: string): string {
  const readable = `task-activity:${commandId}`;
  if (readable.length <= 128) return readable;
  return `task-activity:${createHash("sha256").update(commandId).digest("hex")}`;
}
