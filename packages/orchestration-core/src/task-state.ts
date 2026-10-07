import {
  TaskDomainError,
  type TaskActorType,
  type TaskCommand,
  type TaskSnapshot,
  type TaskStatusCategory,
  type TaskTransitionResult,
} from "./task-contracts";

const TRANSITIONS: Record<
  TaskStatusCategory,
  Partial<Record<TaskCommand, TaskStatusCategory>>
> = {
  backlog: { move_to_todo: "todo", cancel: "cancelled" },
  todo: { start: "in_progress", cancel: "cancelled" },
  in_progress: {
    complete: "completed",
    submit_for_review: "in_review",
    cancel: "cancelled",
  },
  in_review: { accept: "completed", reject: "in_progress", cancel: "cancelled" },
  completed: { reopen: "todo" },
  cancelled: { reopen: "todo" },
};

function fail(
  task: TaskSnapshot,
  command: TaskCommand,
  code: ConstructorParameters<typeof TaskDomainError>[1],
  message: string,
): never {
  throw new TaskDomainError(message, code, task.status, command);
}

function assertAcceptanceRules(input: {
  task: TaskSnapshot;
  command: TaskCommand;
  actorType: TaskActorType;
  acceptancePassed?: boolean;
}) {
  if (input.command === "complete") {
    if (input.actorType !== "user") {
      fail(input.task, input.command, "task_actor_cannot_complete", "only a human can directly complete a task");
    }
    if (input.task.acceptanceMode !== "none") {
      fail(input.task, input.command, "task_acceptance_required", "task must be submitted for review");
    }
  }

  if (input.command !== "accept") return;
  if (input.actorType === "agent" || input.actorType === "worker") {
    fail(input.task, input.command, "task_actor_cannot_complete", "execution actors cannot accept a task");
  }
  if (input.task.acceptanceMode === "automated") {
    if (!input.acceptancePassed) {
      fail(input.task, input.command, "task_acceptance_evidence_required", "automated acceptance evidence is required");
    }
  }
  if (input.task.acceptanceMode === "human" && input.actorType !== "user") {
    fail(input.task, input.command, "task_actor_cannot_complete", "human acceptance is required");
  }
  if (
    input.task.acceptanceMode === "hybrid" &&
    (input.actorType !== "user" || !input.acceptancePassed)
  ) {
    fail(input.task, input.command, "task_acceptance_evidence_required", "human acceptance and automated evidence are required");
  }
}

export function transitionTask(input: {
  task: TaskSnapshot;
  command: TaskCommand;
  actorType: TaskActorType;
  acceptancePassed?: boolean;
}): TaskTransitionResult {
  assertAcceptanceRules(input);
  const status = TRANSITIONS[input.task.status][input.command];
  if (!status) {
    fail(input.task, input.command, "task_invalid_transition", "invalid user task transition");
  }

  return {
    ...input.task,
    status,
    version: input.task.version + 1,
    eventType: `task.${input.command}`,
  };
}

export function deriveTaskProgress(
  children: Array<{ status: TaskStatusCategory }>,
): { completed: number; total: number; percent: number; allCompleted: boolean } {
  const total = children.length;
  const completed = children.filter((child) => child.status === "completed").length;
  return {
    completed,
    total,
    percent: total === 0 ? 0 : Math.floor((completed / total) * 100),
    allCompleted: total > 0 && completed === total,
  };
}
