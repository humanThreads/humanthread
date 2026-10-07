import type { OrchestrationActor } from "@humanthread/shared";

export type TaskStatusCategory =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "completed"
  | "cancelled";

export type TaskVisibility = "private" | "project" | "company";
export type TaskAcceptanceMode = "none" | "human" | "automated" | "hybrid";
export type TaskRole = "creator" | "assignee" | "participant" | "follower";
export type TaskActorType = OrchestrationActor["type"];

export type TaskCommand =
  | "move_to_todo"
  | "start"
  | "complete"
  | "submit_for_review"
  | "accept"
  | "reject"
  | "cancel"
  | "reopen";

export type TaskErrorCode =
  | "task_invalid_transition"
  | "task_acceptance_required"
  | "task_acceptance_evidence_required"
  | "task_actor_cannot_complete";

export interface TaskSnapshot {
  id: string;
  status: TaskStatusCategory;
  version: number;
  acceptanceMode: TaskAcceptanceMode;
  isBlocked: boolean;
}

export interface TaskTransitionResult extends TaskSnapshot {
  eventType: string;
}

export class TaskDomainError extends Error {
  readonly code: TaskErrorCode;
  readonly currentStatus: TaskStatusCategory;
  readonly command: TaskCommand;

  constructor(
    message: string,
    code: TaskErrorCode,
    currentStatus: TaskStatusCategory,
    command: TaskCommand,
  ) {
    super(`${code}: ${message}`);
    this.name = "TaskDomainError";
    this.code = code;
    this.currentStatus = currentStatus;
    this.command = command;
  }
}
