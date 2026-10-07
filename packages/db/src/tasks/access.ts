import type { Prisma } from "@prisma/client";
import {
  authorizeTaskAction,
  type TaskAction,
} from "@humanthread/orchestration-core";
import { prisma } from "../prisma";

export type TaskRelationFilter =
  | "assigned"
  | "created"
  | "participating"
  | "following"
  | "overdue";

export function buildAccessibleTaskWhere(input: {
  userId: string;
  spaceId?: string;
  projectId?: string;
  relation?: TaskRelationFilter;
  includeArchived?: boolean;
  now?: Date;
}): Prisma.TaskWhereInput {
  const directRelation: Prisma.TaskWhereInput = {
    OR: [
      { createdById: input.userId },
      { assigneeUserId: input.userId },
      { members: { some: { userId: input.userId } } },
    ],
  };
  const access: Prisma.TaskWhereInput = {
    OR: [
      {
        AND: [
          directRelation,
          {
            OR: [
              { space: { type: "personal", status: "active" } },
              {
                space: {
                  type: "company",
                  status: "active",
                  company: { members: { some: { userId: input.userId, status: "active" } } },
                },
              },
            ],
          },
        ],
      },
      {
        space: {
          type: "personal",
          status: "active",
          ownerUserId: input.userId,
        },
      },
      {
        visibility: "project",
        project: {
          members: { some: { userId: input.userId, status: "active" } },
        },
      },
      {
        visibility: "company",
        space: {
          type: "company",
          status: "active",
          company: { members: { some: { userId: input.userId, status: "active" } } },
        },
      },
    ],
  };
  const filters: Prisma.TaskWhereInput[] = [];
  if (!input.includeArchived) filters.push({ archivedAt: null });
  filters.push(access);
  if (input.spaceId) filters.push({ spaceId: input.spaceId });
  if (input.projectId) filters.push({ projectId: input.projectId });

  if (input.relation === "assigned") filters.push({ assigneeUserId: input.userId });
  if (input.relation === "created") filters.push({ createdById: input.userId });
  if (input.relation === "participating") {
    filters.push({ members: { some: { userId: input.userId, role: "participant" } } });
  }
  if (input.relation === "following") {
    filters.push({ members: { some: { userId: input.userId, role: "follower" } } });
  }
  if (input.relation === "overdue") {
    filters.push({
      dueAt: { lt: input.now ?? new Date() },
      statusCategory: { notIn: ["completed", "cancelled"] },
    });
  }

  return { AND: filters };
}

interface TaskPolicyRow {
  id: string;
  visibility: string | null;
  createdById: string | null;
  assigneeUserId: string | null;
  space: {
    id: string;
    type: string;
    ownerUserId: string | null;
    status: string;
    company: { members: Array<{ role: string; status: string }> } | null;
  } | null;
  project: { members: Array<{ role: string; status: string }> } | null;
  members: Array<{ userId: string; role: string }>;
}

interface TaskAccessDb {
  task: {
    findUnique(args: unknown): Promise<TaskPolicyRow | null>;
  };
}

export class TaskAccessError extends Error {
  readonly code: "task_not_found" | "task_access_denied";

  constructor(code: "task_not_found" | "task_access_denied") {
    super(code === "task_not_found" ? "Task not found" : "Task access denied");
    this.name = "TaskAccessError";
    this.code = code;
  }
}

async function assertTaskAction(input: {
  userId: string;
  taskId: string;
  action: TaskAction;
  hideDenied?: boolean;
  db?: TaskAccessDb;
}) {
  const db = input.db ?? (prisma as unknown as TaskAccessDb);
  const task = await db.task.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      visibility: true,
      createdById: true,
      assigneeUserId: true,
      space: {
        select: {
          id: true,
          type: true,
          ownerUserId: true,
          status: true,
          company: {
            select: {
              members: {
                where: { userId: input.userId },
                select: { role: true, status: true },
              },
            },
          },
        },
      },
      project: {
        select: {
          members: {
            where: { userId: input.userId },
            select: { role: true, status: true },
          },
        },
      },
      members: {
        where: { userId: input.userId },
        select: { userId: true, role: true },
      },
    },
  });
  if (!task?.space || !task.createdById) throw new TaskAccessError("task_not_found");

  const companyMembership = task.space.company?.members.find((member) => member.status === "active") ?? null;
  const projectMembership = task.project?.members.find((member) => member.status === "active") ?? null;
  const result = authorizeTaskAction({
    actor: { type: "user", id: input.userId },
    action: input.action,
    task: {
      spaceType: task.space.type as "personal" | "company",
      visibility: (task.visibility ?? "private") as "private" | "project" | "company",
      spaceOwnerUserId: task.space.ownerUserId,
      creatorUserId: task.createdById,
      assigneeUserId: task.assigneeUserId,
      members: task.members as Array<{ userId: string; role: "participant" | "follower" }>,
    },
    memberships: {
      spaceActive: task.space.status === "active" && (
        task.space.type === "personal" || Boolean(companyMembership)
      ),
      companyRole: companyMembership?.role ?? null,
      projectRole: projectMembership?.role ?? null,
      projectActive: Boolean(projectMembership),
    },
  });
  if (!result.allowed) {
    throw new TaskAccessError(input.hideDenied ? "task_not_found" : "task_access_denied");
  }
  return { taskId: task.id, role: result.role };
}

export const assertCanReadTask = (input: Omit<Parameters<typeof assertTaskAction>[0], "action" | "hideDenied">) =>
  assertTaskAction({ ...input, action: "read", hideDenied: true });

export const assertCanCommentOnTask = (input: Omit<Parameters<typeof assertTaskAction>[0], "action" | "hideDenied">) =>
  assertTaskAction({ ...input, action: "comment" });

export const assertCanEditTask = (input: Omit<Parameters<typeof assertTaskAction>[0], "action" | "hideDenied">) =>
  assertTaskAction({ ...input, action: "edit_content" });

export const assertCanChangeTaskStatus = (input: Omit<Parameters<typeof assertTaskAction>[0], "action" | "hideDenied">) =>
  assertTaskAction({ ...input, action: "change_status" });

export const assertCanDispatchTaskAgent = (input: Omit<Parameters<typeof assertTaskAction>[0], "action" | "hideDenied">) =>
  assertTaskAction({ ...input, action: "dispatch_agent" });

export const assertCanManageTaskMembers = (input: Omit<Parameters<typeof assertTaskAction>[0], "action" | "hideDenied">) =>
  assertTaskAction({ ...input, action: "manage_members" });

export const assertCanGovernTask = (input: Omit<Parameters<typeof assertTaskAction>[0], "action">) =>
  assertTaskAction({ ...input, action: "govern" });
