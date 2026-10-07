import type { TaskRole, TaskVisibility } from "./task-contracts";

export type TaskAction =
  | "read"
  | "comment"
  | "edit_content"
  | "change_status"
  | "manage_members"
  | "manage_visibility"
  | "dispatch_agent"
  | "govern";

export interface TaskPolicyActor {
  type: "user" | "agent" | "worker" | "system";
  id: string;
  delegatedUserId?: string;
  allowedActions?: readonly TaskAction[];
}

export interface TaskPolicyInput {
  actor: TaskPolicyActor;
  action: TaskAction;
  task: {
    spaceType: "personal" | "company";
    visibility: TaskVisibility;
    spaceOwnerUserId: string | null;
    creatorUserId: string;
    assigneeUserId: string | null;
    members: Array<{ userId: string; role: Extract<TaskRole, "participant" | "follower"> }>;
  };
  memberships: {
    spaceActive: boolean;
    companyRole: string | null;
    projectRole: string | null;
    projectActive: boolean;
  };
}

export type TaskPolicyResult =
  | { allowed: true; role: TaskRole | "space_owner" | "project_member" | "company_member" | "project_admin" | "company_admin" | "service" }
  | { allowed: false; reason: "space_access_denied" | "task_not_visible" | "task_role_denied" | "delegated_action_denied" };

const PROJECT_ADMIN_ROLES = new Set(["owner", "maintainer"]);
const COMPANY_ADMIN_ROLES = new Set(["owner", "admin"]);

function effectiveUserId(actor: TaskPolicyActor, action: TaskAction): string | null {
  if (actor.type === "user") return actor.id;
  if (!actor.allowedActions?.includes(action)) return null;
  return actor.delegatedUserId ?? null;
}

function explicitRole(input: TaskPolicyInput, userId: string) {
  if (input.task.creatorUserId === userId) return "creator" as const;
  if (input.task.assigneeUserId === userId) return "assignee" as const;
  return input.task.members.find((member) => member.userId === userId)?.role ?? null;
}

function visibleRole(input: TaskPolicyInput, userId: string) {
  const directRole = explicitRole(input, userId);
  if (directRole) return directRole;
  if (
    input.task.spaceType === "personal" &&
    input.task.spaceOwnerUserId === userId
  ) {
    return "space_owner" as const;
  }
  if (input.task.visibility === "project" && input.memberships.projectActive) {
    return "project_member" as const;
  }
  if (input.task.visibility === "company" && input.memberships.companyRole) {
    return "company_member" as const;
  }
  return null;
}

function governanceRole(input: TaskPolicyInput) {
  if (
    input.memberships.projectActive &&
    input.memberships.projectRole &&
    PROJECT_ADMIN_ROLES.has(input.memberships.projectRole)
  ) {
    return "project_admin" as const;
  }
  if (
    input.memberships.companyRole &&
    COMPANY_ADMIN_ROLES.has(input.memberships.companyRole)
  ) {
    return "company_admin" as const;
  }
  return null;
}

export function authorizeTaskAction(input: TaskPolicyInput): TaskPolicyResult {
  if (!input.memberships.spaceActive) {
    return { allowed: false, reason: "space_access_denied" };
  }

  if (input.actor.type !== "user" && !input.actor.allowedActions?.includes(input.action)) {
    return { allowed: false, reason: "delegated_action_denied" };
  }
  const userId = effectiveUserId(input.actor, input.action);
  if (!userId) {
    if (input.actor.type === "system" && input.actor.allowedActions?.includes(input.action)) {
      return { allowed: true, role: "service" };
    }
    return { allowed: false, reason: "delegated_action_denied" };
  }

  const role = visibleRole(input, userId);
  const adminRole = governanceRole(input);
  if (input.action === "govern" && (adminRole || role === "creator" || role === "space_owner")) {
    return { allowed: true, role: adminRole ?? role as "creator" | "space_owner" };
  }
  if (!role) return { allowed: false, reason: "task_not_visible" };

  if (input.action === "read") return { allowed: true, role };
  if (
    input.action === "comment" &&
    ["creator", "assignee", "participant", "follower", "space_owner"].includes(role)
  ) {
    return { allowed: true, role };
  }
  if (
    input.action === "edit_content" &&
    ["creator", "assignee", "participant", "space_owner"].includes(role)
  ) {
    return { allowed: true, role };
  }
  if (
    input.action === "change_status" &&
    (input.task.assigneeUserId === userId ||
      role === "space_owner" ||
      (role === "creator" && !input.task.assigneeUserId))
  ) {
    return { allowed: true, role };
  }
  if (
    ["manage_members", "manage_visibility"].includes(input.action) &&
    ["creator", "space_owner"].includes(role)
  ) {
    return { allowed: true, role };
  }
  if (
    input.action === "dispatch_agent" &&
    ["creator", "assignee", "participant", "space_owner"].includes(role)
  ) {
    return { allowed: true, role };
  }

  return { allowed: false, reason: "task_role_denied" };
}
