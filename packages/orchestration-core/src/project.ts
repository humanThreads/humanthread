export type ProjectStatus = "draft" | "planned" | "active" | "paused" | "completed" | "cancelled" | "archived";
export type ProjectCommand = "submit_plan" | "activate" | "pause" | "resume" | "complete" | "cancel" | "archive";
export type OrchestrationTaskStatus = "draft" | "ready" | "in_progress" | "verifying" | "waiting_approval" | "blocked" | "completed" | "failed" | "cancelled";
export type TaskCommand = "mark_ready" | "start" | "verify" | "wait_approval" | "block" | "complete" | "fail" | "cancel" | "reopen";

export class OrchestrationValidationError extends Error {
  readonly code = "validation_failed";
  readonly currentStatus: string;
  readonly command: string;

  constructor(message: string, currentStatus: string, command: string) {
    super(`validation_failed: ${message}`);
    this.name = "OrchestrationValidationError";
    this.currentStatus = currentStatus;
    this.command = command;
  }
}

const PROJECT_TRANSITIONS: Record<ProjectStatus, Partial<Record<ProjectCommand, ProjectStatus>>> = {
  // `draft` and `planned` may complete directly: real projects often accrue
  // milestones and Loop runs before anyone submits a formal plan, and closing
  // them must not depend on a ceremonial plan submission that never happened.
  draft: { submit_plan: "planned", complete: "completed", cancel: "cancelled" },
  planned: { activate: "active", complete: "completed", cancel: "cancelled" },
  active: { pause: "paused", complete: "completed", cancel: "cancelled" },
  paused: { resume: "active", complete: "completed", cancel: "cancelled" },
  completed: { archive: "archived" },
  cancelled: { archive: "archived" },
  archived: {},
};

const TASK_TRANSITIONS: Record<OrchestrationTaskStatus, Partial<Record<TaskCommand, OrchestrationTaskStatus>>> = {
  draft: { mark_ready: "ready", cancel: "cancelled" },
  ready: { start: "in_progress", block: "blocked", cancel: "cancelled" },
  in_progress: { verify: "verifying", wait_approval: "waiting_approval", block: "blocked", fail: "failed", cancel: "cancelled" },
  verifying: { complete: "completed", reopen: "ready", block: "blocked", fail: "failed", cancel: "cancelled" },
  waiting_approval: { reopen: "ready", block: "blocked", cancel: "cancelled" },
  blocked: { reopen: "ready", cancel: "cancelled" },
  completed: {},
  failed: { reopen: "ready", cancel: "cancelled" },
  cancelled: {},
};

export function transitionProject(input: {
  project: { id: string; status: ProjectStatus; version: number };
  command: ProjectCommand;
  context?: { objective?: string; stageCount?: number; milestoneCount?: number; planApproved?: boolean; repositoryPolicyValid?: boolean; requiredMilestonesComplete?: boolean };
}) {
  if (input.command === "submit_plan") {
    const context = input.context;
    if (!context?.objective?.trim() || !context.stageCount || !context.milestoneCount || !context.planApproved) {
      throw new OrchestrationValidationError("project plan is incomplete", input.project.status, input.command);
    }
  }
  if (input.command === "activate" && !input.context?.repositoryPolicyValid) {
    throw new OrchestrationValidationError("repository policy is invalid", input.project.status, input.command);
  }
  if (input.command === "complete" && !input.context?.requiredMilestonesComplete) {
    throw new OrchestrationValidationError("required milestones are incomplete", input.project.status, input.command);
  }
  const status = PROJECT_TRANSITIONS[input.project.status][input.command];
  if (!status) throw new OrchestrationValidationError("invalid project transition", input.project.status, input.command);
  return { ...input.project, status, version: input.project.version + 1 };
}

export function transitionTask(input: { task: { id: string; status: OrchestrationTaskStatus; version: number }; command: TaskCommand }) {
  const status = TASK_TRANSITIONS[input.task.status][input.command];
  if (!status) throw new OrchestrationValidationError("invalid task transition", input.task.status, input.command);
  return { ...input.task, status, version: input.task.version + 1 };
}

export function transitionStage(input: { stage: { id: string; status: string; version: number }; status: string }) {
  return { ...input.stage, status: input.status, version: input.stage.version + 1 };
}

export function transitionMilestone(input: { milestone: { id: string; status: string; version: number }; status: string }) {
  return { ...input.milestone, status: input.status, version: input.milestone.version + 1 };
}

export function computeReadyTaskIds(input: {
  project: { id: string; status: string };
  stages: Array<{ id: string; status: string }>;
  milestones: Array<{ id: string; stageId: string; status: string }>;
  tasks: Array<{ id: string; milestoneId?: string; status: string; priority?: number }>;
  dependencies: Array<{ predecessorTaskId: string; successorTaskId: string; type: string }>;
  locks: Array<{ taskId?: string; resourceKey?: string }>;
  approvals: Array<{ taskId?: string; status?: string }>;
}): string[] {
  if (input.project.status !== "active") return [];
  const activeStageIds = new Set(input.stages.filter((stage) => stage.status === "active").map((stage) => stage.id));
  const activeMilestoneIds = new Set(input.milestones.filter((milestone) => activeStageIds.has(milestone.stageId) && ["active", "at_risk"].includes(milestone.status)).map((milestone) => milestone.id));
  const completed = new Set(input.tasks.filter((task) => task.status === "completed").map((task) => task.id));
  const locked = new Set(input.locks.map((lock) => lock.taskId).filter((id): id is string => Boolean(id)));
  const pendingApproval = new Set(input.approvals.filter((approval) => approval.status === undefined || approval.status === "pending").map((approval) => approval.taskId).filter((id): id is string => Boolean(id)));

  return input.tasks
    .filter((task) => task.status === "ready")
    .filter((task) => task.milestoneId === undefined || activeMilestoneIds.has(task.milestoneId))
    .filter((task) => !locked.has(task.id) && !pendingApproval.has(task.id))
    .filter((task) => input.dependencies
      .filter((dependency) => dependency.type === "blocks" && dependency.successorTaskId === task.id)
      .every((dependency) => completed.has(dependency.predecessorTaskId)))
    .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0) || left.id.localeCompare(right.id))
    .map((task) => task.id);
}

export function validateTaskDependency(input: {
  predecessorTaskId: string;
  successorTaskId: string;
  existingDependencies: Array<{ predecessorTaskId: string; successorTaskId: string; type: string }>;
}) {
  const edges = [...input.existingDependencies, { ...input, type: "blocks" }];
  const adjacency = new Map<string, string[]>();
  for (const edge of edges.filter((edge) => edge.type === "blocks")) {
    adjacency.set(edge.predecessorTaskId, [...(adjacency.get(edge.predecessorTaskId) ?? []), edge.successorTaskId]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycle = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of adjacency.get(node) ?? []) if (hasCycle(next)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  for (const node of adjacency.keys()) {
    if (hasCycle(node)) return { ok: false as const, code: "validation_failed" as const, reason: "dependency_cycle" as const };
  }
  return { ok: true as const };
}

function pathIsSubset(child: string, parent: string): boolean {
  const invalid = (value: string) => value.startsWith("/") || value.split("/").includes("..");
  if (invalid(child) || invalid(parent) || !child || !parent) return false;
  const parentPrefix = parent.endsWith("/**") ? parent.slice(0, -3) : parent;
  return child === parent || child.startsWith(`${parentPrefix}/`);
}

export function validateTaskBreakdownProposal(input: {
  parent: { allowedPaths: string[]; allowedTools: string[]; maxAttempts: number; remainingBudget: number };
  children: Array<{ allowedPaths: string[]; allowedTools: string[]; maxAttempts: number; budget: number }>;
}) {
  const budget = input.children.reduce((total, child) => total + child.budget, 0);
  const valid = budget <= input.parent.remainingBudget && input.children.every((child) =>
    child.maxAttempts <= input.parent.maxAttempts &&
    child.allowedTools.every((tool) => input.parent.allowedTools.includes(tool)) &&
    child.allowedPaths.length > 0 &&
    child.allowedPaths.every((path) => input.parent.allowedPaths.some((parent) => pathIsSubset(path, parent))),
  );
  return valid ? { ok: true as const } : { ok: false as const, approvalType: "scope_change" as const };
}
