import { prisma } from "../prisma";
import {
  buildAccessibleTaskWhere,
  type TaskRelationFilter,
} from "./access";

interface TaskReadDb {
  task: {
    findMany(args: unknown): Promise<unknown[]>;
    findFirst(args: unknown): Promise<unknown | null>;
  };
}

const SUMMARY_SELECT = {
  id: true,
  title: true,
  statusCategory: true,
  visibility: true,
  priority: true,
  startAt: true,
  dueAt: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  assignee: { select: { id: true, name: true, avatarUrl: true } },
  project: { select: { id: true, name: true } },
  statusDefinition: { select: { id: true, name: true, category: true, color: true } },
  blockers: {
    where: { status: "active" },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, reason: true, ownerUserId: true, createdAt: true },
  },
  labelAssignments: {
    select: { label: { select: { id: true, name: true, color: true } } },
  },
  _count: { select: { childTasks: true } },
  agentRuns: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true,
      status: true,
      createdAt: true,
      agentProfile: { select: { id: true, name: true, provider: true } },
    },
  },
} as const;

export async function listTasks(input: {
  userId: string;
  spaceId?: string;
  projectId?: string;
  relation?: TaskRelationFilter;
  statusCategory?: string;
  take?: number;
  db?: Pick<TaskReadDb, "task">;
}) {
  const db = input.db ?? (prisma as unknown as TaskReadDb);
  return db.task.findMany({
    where: {
      AND: [
        buildAccessibleTaskWhere(input),
        ...(input.statusCategory ? [{ statusCategory: input.statusCategory }] : []),
      ],
    },
    select: SUMMARY_SELECT,
    orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }],
    take: input.take ?? 200,
  });
}

export async function getTaskDetail(input: {
  userId: string;
  taskId: string;
  db?: Pick<TaskReadDb, "task">;
}) {
  const db = input.db ?? (prisma as unknown as TaskReadDb);
  return db.task.findFirst({
    where: {
      AND: [{ id: input.taskId }, buildAccessibleTaskWhere({ userId: input.userId })],
    },
    select: {
      ...SUMMARY_SELECT,
      contentMarkdown: true,
      acceptanceMode: true,
      acceptanceReviewer: { select: { id: true, name: true, avatarUrl: true } },
      createdBy: { select: { id: true, name: true, avatarUrl: true } },
      members: {
        select: { role: true, user: { select: { id: true, name: true, avatarUrl: true } } },
      },
      childTasks: { select: SUMMARY_SELECT, orderBy: { createdAt: "asc" } },
      predecessorDependencies: {
        select: { id: true, type: true, successorTask: { select: { id: true, title: true, statusCategory: true } } },
      },
      successorDependencies: {
        select: { id: true, type: true, predecessorTask: { select: { id: true, title: true, statusCategory: true } } },
      },
      documentLinks: {
        select: { document: { select: { id: true, title: true, path: true, version: true } } },
      },
      attachments: {
        where: { deletedAt: null },
        select: { id: true, originalName: true, mimeType: true, byteSize: true, createdAt: true },
      },
      comments: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          contentMarkdown: true,
          createdAt: true,
          updatedAt: true,
          author: { select: { id: true, name: true, avatarUrl: true } },
        },
      },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, type: true, actorType: true, message: true, payload: true, createdAt: true },
      },
      reminders: {
        where: { status: { in: ["pending", "failed"] } },
        orderBy: { remindAt: "asc" },
        select: { id: true, remindAt: true, channel: true, status: true },
      },
      loopRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, currentIteration: true, stopReason: true, version: true },
      },
    },
  });
}
