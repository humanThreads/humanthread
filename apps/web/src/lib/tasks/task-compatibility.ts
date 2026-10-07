import { mapWorkflowTransitionToTaskCommand, type TaskAcceptanceMode, type TaskStatusCategory } from "@humanthread/orchestration-core";
import { addUserTaskBlocker, changeUserTaskStatus } from "./task-commands";
import { getUserTaskRollout, recordLegacyTaskUsage, type UserTaskRollout } from "./task-rollout";
import { prisma } from "../../../../../packages/db/src/index";

interface CompatibilityTask {
  statusCategory: TaskStatusCategory;
  acceptanceMode: TaskAcceptanceMode;
  version: number;
}

interface CompatibilityDependencies {
  rollout: UserTaskRollout;
  loadTask(input: { taskId: string }): Promise<CompatibilityTask | null>;
  changeStatus: typeof changeUserTaskStatus;
  addBlocker: typeof addUserTaskBlocker;
}

const defaultDependencies: CompatibilityDependencies = {
  rollout: getUserTaskRollout(),
  loadTask: async ({ taskId }) => {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { statusCategory: true, acceptanceMode: true, version: true } });
    return task?.statusCategory && task.acceptanceMode ? {
      statusCategory: task.statusCategory as TaskStatusCategory,
      acceptanceMode: task.acceptanceMode as TaskAcceptanceMode,
      version: task.version,
    } : null;
  },
  changeStatus: changeUserTaskStatus,
  addBlocker: addUserTaskBlocker,
};

export async function syncLegacyUserTaskProjection(input: {
  taskId: string;
  actorUserId: string;
  legacyStatus: string;
  reason?: string;
}, dependencies: CompatibilityDependencies = defaultDependencies) {
  recordLegacyTaskUsage({ kind: "write", surface: `legacy-sync:${input.legacyStatus}`, taskId: input.taskId });
  if (!dependencies.rollout.writes) return { synced: false as const, reason: "writes_disabled" as const };
  const task = await dependencies.loadTask({ taskId: input.taskId });
  if (!task) return { synced: false as const, reason: "not_migrated" as const };
  const mapped = mapWorkflowTransitionToTaskCommand({ currentCategory: task.statusCategory, legacyStatus: input.legacyStatus, acceptanceMode: task.acceptanceMode });
  const base = {
    actor: { type: "user" as const, id: input.actorUserId },
    commandId: `legacy-sync:${input.taskId}:${input.legacyStatus}:${task.version}`,
    correlationId: `legacy-task:${input.taskId}`,
    taskId: input.taskId,
    expectedVersion: task.version,
  };
  if (mapped.blockerRequired) {
    await dependencies.addBlocker({ ...base, reason: input.reason?.trim() || "Legacy task reported a blocker" });
    return { synced: true as const, action: "blocker" as const };
  }
  if (!mapped.command) return { synced: false as const, reason: "no_transition" as const };
  await dependencies.changeStatus({ ...base, command: mapped.command });
  return { synced: true as const, action: mapped.command };
}

export async function bestEffortLegacyUserTaskSync(input: Parameters<typeof syncLegacyUserTaskProjection>[0]) {
  try {
    return await syncLegacyUserTaskProjection(input);
  } catch (error) {
    console.error("user_task_legacy_sync_failed", {
      taskId: input.taskId,
      legacyStatus: input.legacyStatus,
      error: error instanceof Error ? error.message : "unknown",
    });
    return { synced: false as const, reason: "sync_failed" as const };
  }
}
