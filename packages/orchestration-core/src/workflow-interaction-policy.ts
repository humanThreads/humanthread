export type WorkflowInteractionPermissionRole =
  | "viewer"
  | "task_collaborator"
  | "task_assignee"
  | "task_creator"
  | "project_admin"
  | "release_approver"
  | "agent";

export type WorkflowInteractionPermissionAction =
  | "view"
  | "open"
  | "reply"
  | "confirm"
  | "release_decide"
  | "runtime_decide";

export type WorkflowInteractionPermission =
  | { allowed: true }
  | { allowed: false; reason: "interaction_read_only" | "role_denied" };

const REPLY_ROLES = new Set<WorkflowInteractionPermissionRole>([
  "task_collaborator",
  "task_assignee",
  "task_creator",
  "project_admin",
  "agent",
]);
const CONFIRM_ROLES = new Set<WorkflowInteractionPermissionRole>([
  "task_assignee",
  "task_creator",
  "project_admin",
]);
const RELEASE_DECISION_ROLES = new Set<WorkflowInteractionPermissionRole>([
  "release_approver",
  "project_admin",
]);

export function evaluateWorkflowInteractionPermission(input: {
  role: WorkflowInteractionPermissionRole;
  action: WorkflowInteractionPermissionAction;
  terminal: boolean;
}): WorkflowInteractionPermission {
  if (input.action === "view") return { allowed: true };
  if (input.terminal) return { allowed: false, reason: "interaction_read_only" };

  const allowed = input.action === "open"
    ? input.role === "agent" || input.role === "project_admin"
    : input.action === "reply"
      ? REPLY_ROLES.has(input.role)
      : input.action === "confirm"
        ? CONFIRM_ROLES.has(input.role)
        : input.action === "release_decide"
          ? RELEASE_DECISION_ROLES.has(input.role)
          : input.role === "project_admin" || input.role === "task_assignee" || input.role === "task_creator";

  return allowed ? { allowed: true } : { allowed: false, reason: "role_denied" };
}
