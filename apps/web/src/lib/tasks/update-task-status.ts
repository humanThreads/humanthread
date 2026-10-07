import type { Task, WorkflowInstance, WorkflowTemplate } from "@humanthread/shared";
import type {
  BlockTaskResult,
  CompleteTaskResult,
  FollowUpTaskResult,
  InterruptTaskResult,
  TransferTaskResult,
  StartTaskResult,
} from "../../../../../packages/workflow-core/src/index";
import { recordLegacyTaskUsage } from "./task-rollout";
import {
  blockTask,
  completeTask,
  followUpTask,
  interruptTask,
  startTask,
  transferTask,
} from "../../../../../packages/workflow-core/src/index";

export interface StartTaskForUserInput {
  actorUserId: string;
  now: Date;
}

export interface CompleteTaskForUserInput {
  teamId: string;
  actorUserId: string;
  now: Date;
}

export interface BlockTaskForUserInput {
  actorUserId: string;
  reason: string;
  now: Date;
}

export interface InterruptTaskForUserInput {
  actorUserId: string;
  reason: string;
  now: Date;
}

export interface FollowUpTaskForUserInput {
  actorUserId: string;
  reason: string;
  now: Date;
}

export interface TransferTaskForUserInput {
  actorUserId: string;
  targetUserId: string;
  reason: string;
  now: Date;
}

export interface StartTaskContext {
  workflow: WorkflowInstance;
  task: Task;
}

export interface CompleteTaskContext extends StartTaskContext {
  template: WorkflowTemplate;
}

export async function startTaskForUser(
  input: StartTaskForUserInput,
  dependencies: {
    loadTaskContext: () => Promise<StartTaskContext>;
    persist: (input: { result: StartTaskResult }) => Promise<void>;
  },
): Promise<StartTaskResult> {
  recordLegacyTaskUsage({ kind: "write", surface: "legacy-start" });
  const context = await dependencies.loadTaskContext();
  const result = startTask({
    workflow: context.workflow,
    task: context.task,
    actorUserId: input.actorUserId,
    now: input.now,
  });

  await dependencies.persist({
    result,
  });

  return result;
}

export async function completeTaskForUser(
  input: CompleteTaskForUserInput,
  dependencies: {
    loadTaskContext: () => Promise<CompleteTaskContext>;
    persist: (input: {
      teamId: string;
      result: CompleteTaskResult;
    }) => Promise<void>;
  },
): Promise<CompleteTaskResult> {
  recordLegacyTaskUsage({ kind: "write", surface: "legacy-complete" });
  const context = await dependencies.loadTaskContext();
  const result = completeTask({
    workflow: context.workflow,
    task: context.task,
    template: context.template,
    actorUserId: input.actorUserId,
    now: input.now,
  });

  await dependencies.persist({
    teamId: input.teamId,
    result,
  });

  return result;
}

export async function blockTaskForUser(
  input: BlockTaskForUserInput,
  dependencies: {
    loadTaskContext: () => Promise<StartTaskContext>;
    persist: (input: { result: BlockTaskResult }) => Promise<void>;
  },
): Promise<BlockTaskResult> {
  recordLegacyTaskUsage({ kind: "write", surface: "legacy-block" });
  const context = await dependencies.loadTaskContext();
  const result = blockTask({
    workflow: context.workflow,
    task: context.task,
    actorUserId: input.actorUserId,
    reason: input.reason,
    now: input.now,
  });

  await dependencies.persist({
    result,
  });

  return result;
}

export async function interruptTaskForUser(
  input: InterruptTaskForUserInput,
  dependencies: {
    loadTaskContext: () => Promise<StartTaskContext>;
    persist: (input: { result: InterruptTaskResult }) => Promise<void>;
  },
): Promise<InterruptTaskResult> {
  recordLegacyTaskUsage({ kind: "write", surface: "legacy-interrupt" });
  const context = await dependencies.loadTaskContext();
  const result = interruptTask({
    workflow: context.workflow,
    task: context.task,
    actorUserId: input.actorUserId,
    reason: input.reason,
    now: input.now,
  });

  await dependencies.persist({
    result,
  });

  return result;
}

export async function followUpTaskForUser(
  input: FollowUpTaskForUserInput,
  dependencies: {
    loadTaskContext: () => Promise<StartTaskContext>;
    persist: (input: { result: FollowUpTaskResult }) => Promise<void>;
  },
): Promise<FollowUpTaskResult> {
  recordLegacyTaskUsage({ kind: "write", surface: "legacy-follow-up" });
  const context = await dependencies.loadTaskContext();
  const result = followUpTask({
    workflow: context.workflow,
    task: context.task,
    actorUserId: input.actorUserId,
    reason: input.reason,
    now: input.now,
  });

  await dependencies.persist({
    result,
  });

  return result;
}

export async function transferTaskForUser(
  input: TransferTaskForUserInput,
  dependencies: {
    loadTaskContext: () => Promise<StartTaskContext>;
    persist: (input: { result: TransferTaskResult }) => Promise<void>;
  },
): Promise<TransferTaskResult> {
  recordLegacyTaskUsage({ kind: "write", surface: "legacy-transfer" });
  const context = await dependencies.loadTaskContext();
  const result = transferTask({
    workflow: context.workflow,
    task: context.task,
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
    reason: input.reason,
    now: input.now,
  });

  await dependencies.persist({
    result,
  });

  return result;
}
