import type { CreateWorkflowInstanceResult } from "@humanthread/workflow-core";

export interface MapCreateWorkflowInstanceResultToPrismaInput {
  teamId: string;
  result: CreateWorkflowInstanceResult;
}

export interface CreateWorkflowInstancePrismaPayload {
  workflow: {
    id: string;
    teamId: string;
    projectId: string;
    matterTypeId: string;
    workflowTemplateId: string;
    title: string;
    description: string;
    status: string;
    currentStepKey: string;
    createdById: string;
    createdAt: Date;
    updatedAt: Date;
  };
  tasks: Array<{
    id: string;
    teamId: string;
    workflowInstanceId: string;
    projectId: string;
    stepTemplateId: string;
    title: string;
    description: string;
    status: string;
    executorType: string;
    assigneeUserId?: string;
    queuePosition: number;
    localPath?: string;
    command?: string;
    startedAt?: Date;
    completedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
  }>;
  events: Array<{
    id: string;
    taskId: string;
    workflowInstanceId: string;
    type: string;
    actorType: string;
    actorUserId?: string;
    message?: string;
    createdAt: Date;
  }>;
}

export function mapCreateWorkflowInstanceResultToPrisma(
  input: MapCreateWorkflowInstanceResultToPrismaInput,
): CreateWorkflowInstancePrismaPayload {
  return {
    workflow: {
      ...input.result.workflow,
      teamId: input.teamId,
    },
    tasks: input.result.tasks.map((task) => ({
      ...task,
      teamId: input.teamId,
    })),
    events: input.result.events.map((event) => ({
      id: event.id,
      taskId: event.taskId,
      workflowInstanceId: event.workflowInstanceId,
      type: event.type,
      actorType: event.actorType,
      ...(event.actorUserId ? { actorUserId: event.actorUserId } : {}),
      ...(event.message ? { message: event.message } : {}),
      createdAt: event.createdAt,
    })),
  };
}
