import { derivedPersistenceId } from "./bounded-id";

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

export function scheduledTaskProjectDigest(projectId: string): string {
  return derivedPersistenceId(["project", required(projectId, "projectId")]);
}

export function projectScheduledTaskId(projectId: string, commandId: string): string {
  return derivedPersistenceId(["project-scheduled-task", required(projectId, "projectId"), required(commandId, "commandId")]);
}

/**
 * `loopRunReference` is JSON and may contain the real LoopRun opaque ID.
 * `LoopRun.scheduledTaskRunId` is the only CHAR(32) association and must use this function's output.
 */
export function projectScheduledTaskRunId(scheduledTaskId: string, triggerKey: string): string {
  return derivedPersistenceId(["project-scheduled-task-run", required(scheduledTaskId, "scheduledTaskId"), required(triggerKey, "triggerKey")]);
}

export function projectScheduledTaskEventId(scheduledTaskId: string, commandId: string): string {
  return derivedPersistenceId(["project-scheduled-task-event", required(scheduledTaskId, "scheduledTaskId"), required(commandId, "commandId")]);
}

export function scheduledTaskLoopBindingDigest(bindingId: string): string {
  return derivedPersistenceId([
    "project-scheduled-task-loop-binding",
    required(bindingId, "bindingId"),
  ]);
}

export function scheduledTaskExecutionTargetDigest(
  target:
    | { type: "local_agent"; agentProfileId: string }
    | { type: "linux_worker_pool"; workerPoolId: string },
): string {
  if (target.type === "local_agent") {
    return derivedPersistenceId([
      "project-scheduled-task-execution-target",
      target.type,
      required(target.agentProfileId, "agentProfileId"),
    ]);
  }

  return derivedPersistenceId([
    "project-scheduled-task-execution-target",
    target.type,
    required(target.workerPoolId, "workerPoolId"),
  ]);
}

export function scheduledTaskActorDigest(userId: string): string {
  return derivedPersistenceId([
    "project-scheduled-task-actor",
    required(userId, "userId"),
  ]);
}
