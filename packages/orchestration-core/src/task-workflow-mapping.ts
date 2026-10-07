import type {
  TaskAcceptanceMode,
  TaskCommand,
  TaskStatusCategory,
} from "./task-contracts";

export interface LegacyTaskStatusProjection {
  category: TaskStatusCategory;
  blockerRequired?: boolean;
  executionStatus?: "verifying" | "interrupted";
  approvalStatus?: "pending";
}

const LEGACY_STATUS: Record<string, LegacyTaskStatusProjection> = {
  pending: { category: "todo" },
  ready: { category: "todo" },
  follow_up: { category: "todo" },
  active: { category: "in_progress" },
  running: { category: "in_progress" },
  interrupted: { category: "in_progress" },
  blocked: { category: "in_progress", blockerRequired: true },
  verifying: { category: "in_review", executionStatus: "verifying" },
  waiting_approval: { category: "in_review", approvalStatus: "pending" },
  completed: { category: "completed" },
  cancelled: { category: "cancelled" },
};

export function mapLegacyTaskStatus(status: string): LegacyTaskStatusProjection {
  const projection = LEGACY_STATUS[status];
  if (!projection) throw new Error(`unsupported_legacy_task_status: ${status}`);
  return { ...projection };
}

export function mapWorkflowTransitionToTaskCommand(input: {
  currentCategory: TaskStatusCategory;
  legacyStatus: string;
  acceptanceMode: TaskAcceptanceMode;
}): { command: TaskCommand | null; blockerRequired: boolean } {
  const projection = mapLegacyTaskStatus(input.legacyStatus);
  if (projection.blockerRequired) return { command: null, blockerRequired: true };
  if (projection.category === input.currentCategory) {
    return { command: null, blockerRequired: false };
  }
  if (input.currentCategory === "backlog" && projection.category === "todo") {
    return { command: "move_to_todo", blockerRequired: false };
  }
  if (input.currentCategory === "todo" && projection.category === "in_progress") {
    return { command: "start", blockerRequired: false };
  }
  if (input.currentCategory === "in_progress" && projection.category === "in_review") {
    return { command: "submit_for_review", blockerRequired: false };
  }
  if (input.currentCategory === "in_progress" && projection.category === "completed") {
    return {
      command: input.acceptanceMode === "none" ? "complete" : "submit_for_review",
      blockerRequired: false,
    };
  }
  if (projection.category === "cancelled" && !["completed", "cancelled"].includes(input.currentCategory)) {
    return { command: "cancel", blockerRequired: false };
  }
  return { command: null, blockerRequired: false };
}
