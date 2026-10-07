import { prisma } from "../../../../../packages/db/src/index";
import { requireUserTaskReads, requireUserTaskWrites } from "./task-rollout";

const CATEGORIES = new Set(["backlog", "todo", "in_progress", "in_review", "completed", "cancelled"]);

interface SettingsDb {
  space: { findUnique(args: unknown): Promise<{
    id: string; type: string; ownerUserId: string | null; status: string;
    company: { members: Array<{ role: string; status: string }> } | null;
  } | null> };
  project: { findUnique(args: unknown): Promise<{ id: string; spaceId: string | null } | null> };
  taskLabel: {
    findMany?(args: unknown): Promise<unknown[]>;
    create(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
    count(args: unknown): Promise<number>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  taskStatusDefinition: {
    findMany?(args: unknown): Promise<unknown[]>;
    create(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
    count(args: unknown): Promise<number>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
}

function error(code: "validation_failed" | "task_not_found" | "task_access_denied" | "version_conflict", message: string) {
  return Object.assign(new Error(message), { code });
}

async function loadSpaceAccess(input: { userId: string; spaceId: string; db: SettingsDb }) {
  const space = await input.db.space.findUnique({ where: { id: input.spaceId }, select: {
    id: true, type: true, ownerUserId: true, status: true,
    company: { select: { members: { where: { userId: input.userId, status: "active" }, select: { role: true, status: true } } } },
  } });
  if (!space || space.status !== "active") throw error("task_not_found", "Space not found");
  const membership = space.company?.members.find((member) => member.status === "active") ?? null;
  const canRead = space.type === "personal" ? space.ownerUserId === input.userId : Boolean(membership);
  if (!canRead) throw error("task_access_denied", "Task settings access denied");
  return { space, membership };
}

async function assertSpaceAdmin(input: { userId: string; spaceId: string; db: SettingsDb }) {
  const { space, membership } = await loadSpaceAccess(input);
  const allowed = space.type === "personal"
    ? space.ownerUserId === input.userId
    : Boolean(membership && ["owner", "admin"].includes(membership.role));
  if (!allowed) throw error("task_access_denied", "Task settings access denied");
}

function assertColor(color: string) {
  if (!/^#[0-9a-f]{6}$/iu.test(color)) throw error("validation_failed", "Task setting color must be a hex swatch");
}

export async function createTaskLabelDefinition(input: {
  userId: string; spaceId: string; id: string; name: string; color: string; db?: SettingsDb;
}) {
  if (!input.db) requireUserTaskWrites();
  const db = input.db ?? (prisma as unknown as SettingsDb);
  await assertSpaceAdmin({ userId: input.userId, spaceId: input.spaceId, db });
  assertColor(input.color);
  if (!input.name.trim()) throw error("validation_failed", "Task label name is required");
  return db.taskLabel.create({ data: {
    id: input.id, spaceId: input.spaceId, name: input.name.trim(), color: input.color, createdById: input.userId,
  } });
}

export async function listTaskLabelDefinitions(input: { userId: string; spaceId: string; db?: SettingsDb }) {
  if (!input.db) requireUserTaskReads();
  const db = input.db ?? (prisma as unknown as SettingsDb);
  await loadSpaceAccess({ userId: input.userId, spaceId: input.spaceId, db });
  if (!db.taskLabel.findMany) return [];
  return db.taskLabel.findMany({
    where: { spaceId: input.spaceId },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

export async function deleteTaskLabelDefinition(input: {
  userId: string; spaceId: string; labelId: string; db?: SettingsDb;
}) {
  if (!input.db) requireUserTaskWrites();
  const db = input.db ?? (prisma as unknown as SettingsDb);
  await assertSpaceAdmin({ userId: input.userId, spaceId: input.spaceId, db });
  if (await db.taskLabel.count({ where: { id: input.labelId, spaceId: input.spaceId, assignments: { some: {} } } }) > 0) {
    throw error("version_conflict", "Task label is in use");
  }
  const result = await db.taskLabel.deleteMany({ where: { id: input.labelId, spaceId: input.spaceId } });
  if (result.count !== 1) throw error("task_not_found", "Task label not found");
  return result;
}

export async function createTaskStatusDefinition(input: {
  userId: string; spaceId: string; projectId?: string; id: string; key: string; name: string;
  category: "backlog" | "todo" | "in_progress" | "in_review" | "completed" | "cancelled";
  color: string; sortOrder: number; db?: SettingsDb;
}) {
  if (!input.db) requireUserTaskWrites();
  const db = input.db ?? (prisma as unknown as SettingsDb);
  await assertSpaceAdmin({ userId: input.userId, spaceId: input.spaceId, db });
  if (!CATEGORIES.has(input.category)) throw error("validation_failed", "Task status category is invalid");
  assertColor(input.color);
  if (input.projectId) {
    const project = await db.project.findUnique({ where: { id: input.projectId }, select: { id: true, spaceId: true } });
    if (!project || project.spaceId !== input.spaceId) throw error("validation_failed", "Task status Project belongs to another Space");
  }
  const scopeKey = input.projectId ? `project:${input.projectId}` : `space:${input.spaceId}`;
  return db.taskStatusDefinition.create({ data: {
    id: input.id, spaceId: input.spaceId, projectId: input.projectId ?? null, scopeKey,
    key: input.key.trim(), name: input.name.trim(), category: input.category, color: input.color,
    sortOrder: input.sortOrder, isActive: true, createdById: input.userId,
  } });
}

export async function listTaskStatusDefinitions(input: {
  userId: string; spaceId: string; projectId?: string; db?: SettingsDb;
}) {
  if (!input.db) requireUserTaskReads();
  const db = input.db ?? (prisma as unknown as SettingsDb);
  await assertSpaceAdmin({ userId: input.userId, spaceId: input.spaceId, db });
  if (!db.taskStatusDefinition.findMany) return [];
  return db.taskStatusDefinition.findMany({
    where: {
      spaceId: input.spaceId,
      ...(input.projectId ? { projectId: input.projectId } : { projectId: null }),
      isActive: true,
    },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
}

export async function deleteTaskStatusDefinition(input: {
  userId: string; spaceId: string; definitionId: string; db?: SettingsDb;
}) {
  if (!input.db) requireUserTaskWrites();
  const db = input.db ?? (prisma as unknown as SettingsDb);
  await assertSpaceAdmin({ userId: input.userId, spaceId: input.spaceId, db });
  if (await db.taskStatusDefinition.count({ where: { id: input.definitionId, spaceId: input.spaceId, tasks: { some: {} } } }) > 0) {
    throw error("version_conflict", "Task status definition is in use");
  }
  const result = await db.taskStatusDefinition.deleteMany({ where: { id: input.definitionId, spaceId: input.spaceId } });
  if (result.count !== 1) throw error("task_not_found", "Task status definition not found");
  return result;
}
