import type {
  Task,
  TaskEvent,
  WorkflowInstance,
  WorkflowTemplate,
} from "@humanthread/shared";

export interface CreateWorkflowInstanceInput {
  id: string;
  projectId: string;
  matterTypeId: string;
  title: string;
  description: string;
  createdById: string;
  template: WorkflowTemplate;
  now: Date;
}

export interface CreateWorkflowInstanceResult {
  workflow: WorkflowInstance;
  tasks: Task[];
  events: TaskEvent[];
}

export interface StartTaskInput {
  workflow: WorkflowInstance;
  task: Task;
  actorUserId: string;
  now: Date;
}

export interface StartTaskResult {
  workflow: WorkflowInstance;
  task: Task;
  events: TaskEvent[];
}

export interface CompleteTaskInput {
  workflow: WorkflowInstance;
  task: Task;
  template: WorkflowTemplate;
  actorUserId: string;
  now: Date;
}

export interface CompleteTaskResult {
  workflow: WorkflowInstance;
  completedTask: Task;
  nextTask: Task | null;
  events: TaskEvent[];
}

export interface BlockTaskInput {
  workflow: WorkflowInstance;
  task: Task;
  actorUserId: string;
  reason: string;
  now: Date;
}

export interface BlockTaskResult {
  workflow: WorkflowInstance;
  task: Task;
  events: TaskEvent[];
}

export interface InterruptTaskInput {
  workflow: WorkflowInstance;
  task: Task;
  actorUserId: string;
  reason: string;
  now: Date;
}

export interface InterruptTaskResult {
  workflow: WorkflowInstance;
  task: Task;
  events: TaskEvent[];
}

export interface FollowUpTaskInput {
  workflow: WorkflowInstance;
  task: Task;
  actorUserId: string;
  reason: string;
  now: Date;
}

export interface FollowUpTaskResult {
  workflow: WorkflowInstance;
  task: Task;
  events: TaskEvent[];
}

export interface TransferTaskInput {
  workflow: WorkflowInstance;
  task: Task;
  actorUserId: string;
  targetUserId: string;
  reason: string;
  now: Date;
}

export interface TransferTaskResult {
  workflow: WorkflowInstance;
  task: Task;
  events: TaskEvent[];
}

export function createWorkflowInstance(
  input: CreateWorkflowInstanceInput,
): CreateWorkflowInstanceResult {
  const firstStep = input.template.steps.find(
    (step) => step.key === input.template.firstStepKey,
  );

  if (!firstStep) {
    throw new Error(
      `Missing first workflow step: ${input.template.firstStepKey}`,
    );
  }

  const workflow: WorkflowInstance = {
    id: input.id,
    projectId: input.projectId,
    matterTypeId: input.matterTypeId,
    workflowTemplateId: input.template.id,
    title: input.title,
    description: input.description,
    status: "running",
    currentStepKey: firstStep.key,
    createdById: input.createdById,
    createdAt: input.now,
    updatedAt: input.now,
  };

  const firstTaskBase: Omit<Task, "assigneeUserId"> = {
    id: `${input.id}:${firstStep.key}`,
    workflowInstanceId: input.id,
    projectId: input.projectId,
    stepTemplateId: firstStep.id,
    title: firstStep.title,
    description: firstStep.description,
    status: "pending",
    executorType: firstStep.executorType,
    queuePosition: 0,
    createdAt: input.now,
    updatedAt: input.now,
  };

  const firstTask: Task = firstStep.assigneeUserId
    ? {
        ...firstTaskBase,
        assigneeUserId: firstStep.assigneeUserId,
      }
    : firstTaskBase;

  const events: TaskEvent[] = [
    {
      id: `${input.id}:workflow_created`,
      taskId: firstTask.id,
      workflowInstanceId: input.id,
      type: "workflow_created",
      actorType: "system",
      actorUserId: input.createdById,
      createdAt: input.now,
    },
    {
      id: `${firstTask.id}:task_created`,
      taskId: firstTask.id,
      workflowInstanceId: input.id,
      type: "task_created",
      actorType: "system",
      actorUserId: input.createdById,
      createdAt: input.now,
    },
  ];

  return {
    workflow,
    tasks: [firstTask],
    events,
  };
}

export function startTask(input: StartTaskInput): StartTaskResult {
  const startedTask: Task = {
    ...input.task,
    status: "active",
    startedAt: input.now,
    updatedAt: input.now,
  };

  const startedEvent: TaskEvent = {
    id: `${input.task.id}:task_started`,
    taskId: input.task.id,
    workflowInstanceId: input.workflow.id,
    type: "task_started",
    actorType: "human",
    actorUserId: input.actorUserId,
    createdAt: input.now,
  };

  return {
    workflow: {
      ...input.workflow,
      updatedAt: input.now,
    },
    task: startedTask,
    events: [startedEvent],
  };
}

export function blockTask(input: BlockTaskInput): BlockTaskResult {
  const blockedTask: Task = {
    ...input.task,
    status: "blocked",
    updatedAt: input.now,
  };

  const blockedEvent: TaskEvent = {
    id: `${input.task.id}:task_blocked`,
    taskId: input.task.id,
    workflowInstanceId: input.workflow.id,
    type: "task_blocked",
    actorType: "human",
    actorUserId: input.actorUserId,
    message: input.reason,
    createdAt: input.now,
  };

  return {
    workflow: {
      ...input.workflow,
      status: "blocked",
      updatedAt: input.now,
    },
    task: blockedTask,
    events: [blockedEvent],
  };
}

export function interruptTask(input: InterruptTaskInput): InterruptTaskResult {
  const interruptedTask: Task = {
    ...input.task,
    status: "interrupted",
    updatedAt: input.now,
  };

  const interruptedEvent: TaskEvent = {
    id: `${input.task.id}:task_interrupted`,
    taskId: input.task.id,
    workflowInstanceId: input.workflow.id,
    type: "task_interrupted",
    actorType: "human",
    actorUserId: input.actorUserId,
    message: input.reason,
    createdAt: input.now,
  };

  return {
    workflow: {
      ...input.workflow,
      updatedAt: input.now,
    },
    task: interruptedTask,
    events: [interruptedEvent],
  };
}

export function followUpTask(input: FollowUpTaskInput): FollowUpTaskResult {
  const followUpTask: Task = {
    ...input.task,
    status: "follow_up",
    updatedAt: input.now,
  };

  const followUpEvent: TaskEvent = {
    id: `${input.task.id}:task_follow_up_created`,
    taskId: input.task.id,
    workflowInstanceId: input.workflow.id,
    type: "task_follow_up_created",
    actorType: "human",
    actorUserId: input.actorUserId,
    message: input.reason,
    createdAt: input.now,
  };

  return {
    workflow: {
      ...input.workflow,
      updatedAt: input.now,
    },
    task: followUpTask,
    events: [followUpEvent],
  };
}

export function transferTask(input: TransferTaskInput): TransferTaskResult {
  const transferredTask: Task = {
    ...input.task,
    status: "transferred",
    assigneeUserId: input.targetUserId,
    updatedAt: input.now,
  };

  const transferredEvent: TaskEvent = {
    id: `${input.task.id}:task_transferred`,
    taskId: input.task.id,
    workflowInstanceId: input.workflow.id,
    type: "task_transferred",
    actorType: "human",
    actorUserId: input.actorUserId,
    message: input.reason,
    payload: {
      targetUserId: input.targetUserId,
    },
    createdAt: input.now,
  };

  return {
    workflow: {
      ...input.workflow,
      updatedAt: input.now,
    },
    task: transferredTask,
    events: [transferredEvent],
  };
}

export function completeTask(input: CompleteTaskInput): CompleteTaskResult {
  const currentStep = input.template.steps.find(
    (step) => step.id === input.task.stepTemplateId,
  );

  if (!currentStep) {
    throw new Error(`Missing current workflow step: ${input.task.stepTemplateId}`);
  }

  const completedTask: Task = {
    ...input.task,
    status: "completed",
    completedAt: input.now,
    updatedAt: input.now,
  };

  const completionEvent: TaskEvent = {
    id: `${input.task.id}:task_completed`,
    taskId: input.task.id,
    workflowInstanceId: input.workflow.id,
    type: "task_completed",
    actorType: "human",
    actorUserId: input.actorUserId,
    createdAt: input.now,
  };

  if (!currentStep.nextStepKey) {
    return {
      workflow: {
        ...input.workflow,
        status: "completed",
        updatedAt: input.now,
      },
      completedTask,
      nextTask: null,
      events: [completionEvent],
    };
  }

  const nextStep = input.template.steps.find(
    (step) => step.key === currentStep.nextStepKey,
  );

  if (!nextStep) {
    throw new Error(`Missing next workflow step: ${currentStep.nextStepKey}`);
  }

  const nextTaskBase: Omit<Task, "assigneeUserId"> = {
    id: `${input.workflow.id}:${nextStep.key}`,
    workflowInstanceId: input.workflow.id,
    projectId: input.workflow.projectId,
    stepTemplateId: nextStep.id,
    title: nextStep.title,
    description: nextStep.description,
    status: "pending",
    executorType: nextStep.executorType,
    queuePosition: 0,
    createdAt: input.now,
    updatedAt: input.now,
  };

  const nextTask: Task = nextStep.assigneeUserId
    ? {
        ...nextTaskBase,
        assigneeUserId: nextStep.assigneeUserId,
      }
    : nextTaskBase;

  const nextTaskCreatedEvent: TaskEvent = {
    id: `${nextTask.id}:task_created`,
    taskId: nextTask.id,
    workflowInstanceId: input.workflow.id,
    type: "task_created",
    actorType: "system",
    actorUserId: input.actorUserId,
    createdAt: input.now,
  };

  return {
    workflow: {
      ...input.workflow,
      currentStepKey: nextStep.key,
      status: "running",
      updatedAt: input.now,
    },
    completedTask,
    nextTask,
    events: [completionEvent, nextTaskCreatedEvent],
  };
}
