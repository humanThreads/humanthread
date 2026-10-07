import { createHash } from "node:crypto";
import { assertCanReadProject, assertCanWriteProject, prisma } from "@humanthread/db";
import { Prisma } from "@prisma/client";
import {
  normalizeTaskFieldOptions,
  validateTaskFieldKey,
  validateTaskFieldType,
  type TaskFieldDefinitionRecord,
} from "../tasks/task-business-fields";

const FIELD_SELECT = {
  id: true,
  projectId: true,
  key: true,
  name: true,
  type: true,
  required: true,
  options: true,
  sortOrder: true,
  isActive: true,
} as const;

export function projectTaskFieldId(projectId: string, key: string) {
  const readable = `project-field:${projectId}:${key}`;
  if (readable.length <= 96) return readable;
  return `project-field:${createHash("sha256").update(readable).digest("hex")}`;
}

function normalizeInput(input: {
  key: string;
  name: string;
  type: string;
  required?: boolean;
  options?: unknown;
  sortOrder?: number;
  isActive?: boolean;
}) {
  const key = validateTaskFieldKey(input.key);
  const name = input.name.trim();
  if (!name) throw Object.assign(new Error("Task field name is required"), { code: "validation_failed" });
  const type = validateTaskFieldType(input.type);
  const options = normalizeTaskFieldOptions(input.options, type);
  const normalized = {
    key,
    name,
    type,
    required: Boolean(input.required),
    sortOrder: Number.isInteger(input.sortOrder) ? input.sortOrder! : 0,
    isActive: input.isActive !== false,
  };
  return { ...normalized, options };
}

export async function listProjectTaskFields(input: { userId: string; projectId: string }) {
  await assertCanReadProject({ userId: input.userId, projectId: input.projectId });
  return prisma.projectTaskFieldDefinition.findMany({
    where: { projectId: input.projectId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
    select: FIELD_SELECT,
  }) as Promise<TaskFieldDefinitionRecord[]>;
}

export async function upsertProjectTaskField(input: {
  userId: string;
  projectId: string;
  field: { key: string; name: string; type: string; required?: boolean; options?: unknown; sortOrder?: number; isActive?: boolean };
}) {
  await assertCanWriteProject({ userId: input.userId, projectId: input.projectId });
  const field = normalizeInput(input.field);
  return prisma.projectTaskFieldDefinition.upsert({
    where: { projectId_key: { projectId: input.projectId, key: field.key } },
    create: {
      id: projectTaskFieldId(input.projectId, field.key),
      projectId: input.projectId,
      createdById: input.userId,
      ...field,
      options: field.options ?? Prisma.DbNull,
    },
    update: { ...field, options: field.options ?? Prisma.DbNull },
    select: FIELD_SELECT,
  }) as Promise<TaskFieldDefinitionRecord>;
}

export async function deleteProjectTaskField(input: { userId: string; projectId: string; fieldId: string }) {
  await assertCanWriteProject({ userId: input.userId, projectId: input.projectId });
  const deleted = await prisma.projectTaskFieldDefinition.updateMany({
    where: { id: input.fieldId, projectId: input.projectId },
    data: { isActive: false },
  });
  if (deleted.count === 0) throw Object.assign(new Error("Task field not found"), { code: "not_found" });
  return { fieldId: input.fieldId, isActive: false };
}
