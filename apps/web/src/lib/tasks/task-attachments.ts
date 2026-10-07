import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { assertCanEditTask, assertCanReadTask, prisma } from "../../../../../packages/db/src/index";
import { requireUserTaskReads, requireUserTaskWrites } from "./task-rollout";
import { createStorageDriver, type StorageConfig } from "../storage/unified-storage";

export const TASK_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const TASK_ATTACHMENT_ALLOWED_MIME_TYPES = [
  "image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain",
  "text/csv", "text/markdown", "application/json", "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

interface AttachmentDependencies {
  assertCanReadTask: typeof assertCanReadTask;
  assertCanEditTask: typeof assertCanEditTask;
}

const DEFAULT_DEPENDENCIES: AttachmentDependencies = { assertCanReadTask, assertCanEditTask };

export function resolveTaskAttachmentStorageRoot(cwd = process.cwd()) {
  const normalized = resolve(cwd);
  return basename(normalized) === "web" && basename(dirname(normalized)) === "apps"
    ? join(normalized, "storage", "task-attachments")
    : join(normalized, "apps", "web", "storage", "task-attachments");
}

export function normalizeProtectedAttachmentName(name: string) {
  return basename(name.trim()).replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 191) || "attachment";
}

export function assertProtectedStorageKey(key: string) {
  if (!/^[A-Za-z0-9._:-]+\/[A-Za-z0-9._:-]+$/u.test(key)) {
    throw attachmentValidationError("invalid_storage_key", "Invalid protected attachment storage key");
  }
}

export function validateProtectedAttachment(input: {
  file: File;
  maxBytes?: number;
  allowedMimeTypes?: readonly string[];
}) {
  const maxBytes = input.maxBytes ?? TASK_ATTACHMENT_MAX_BYTES;
  const allowedMimeTypes = input.allowedMimeTypes ?? TASK_ATTACHMENT_ALLOWED_MIME_TYPES;
  if (!input.file || input.file.size === 0) {
    throw attachmentValidationError("attachment_required", "Attachment is required");
  }
  if (input.file.name !== basename(input.file.name) || /[\\/]/u.test(input.file.name)) {
    throw attachmentValidationError("invalid_name", "Attachment name is invalid");
  }
  if (input.file.size > maxBytes) {
    throw attachmentValidationError("too_large", "Attachment is too large");
  }
  if (!allowedMimeTypes.includes(input.file.type)) {
    throw attachmentValidationError("unsupported_mime", "Unsupported attachment type");
  }
  return { fileName: normalizeProtectedAttachmentName(input.file.name) };
}

export async function saveTaskAttachment(input: {
  userId: string; taskId: string; file: File; storageRoot?: string; createId?: () => string;
  dependencies?: Partial<AttachmentDependencies>;
  storageConfig?: StorageConfig;
  storageDriver?: { put(input: { key: string; contentType: string; body: Uint8Array }): Promise<{ key: string; scanStatus: string }> };
  db?: { taskAttachment: { create(args: unknown): Promise<{ id: string; originalName: string; mimeType: string; byteSize: bigint }> } };
}) {
  if (!input.db) requireUserTaskWrites();
  const validated = validateProtectedAttachment({ file: input.file });
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...input.dependencies };
  await dependencies.assertCanEditTask({ userId: input.userId, taskId: input.taskId });
  const id = input.createId?.() ?? `attachment_${randomUUID()}`;
  const storageKey = `${input.taskId}/${id}`;
  assertProtectedStorageKey(storageKey);
  const root = input.storageRoot ?? resolveTaskAttachmentStorageRoot();
  const filePath = join(root, storageKey);
  await mkdir(join(root, input.taskId), { recursive: true });
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  if (input.storageDriver || input.storageConfig) {
    const driver = input.storageDriver ?? createStorageDriver(input.storageConfig!);
    await driver.put({ key: storageKey, contentType: input.file.type, body: bytes });
  } else {
    await writeFile(filePath, Buffer.from(bytes));
  }
  try {
    const attachment = await (input.db ?? prisma).taskAttachment.create({ data: {
      id, taskId: input.taskId, storageKey, originalName: validated.fileName,
      mimeType: input.file.type, byteSize: BigInt(input.file.size), uploadedById: input.userId,
    }, select: { id: true, originalName: true, mimeType: true, byteSize: true } });
    return { ...attachment, byteSize: Number(attachment.byteSize), downloadUrl: `/api/task-attachments/${attachment.id}` };
  } catch (error) {
    await rm(filePath, { force: true });
    throw error;
  }
}

export async function readTaskAttachment(input: {
  userId: string; attachmentId: string; storageRoot?: string; dependencies?: Partial<AttachmentDependencies>;
  db?: { taskAttachment: { findUnique(args: unknown): Promise<{
    id: string; taskId: string; storageKey: string; originalName: string; mimeType: string; byteSize: bigint; deletedAt: Date | null;
  } | null> } };
}) {
  if (!input.db) requireUserTaskReads();
  const attachment = await (input.db ?? prisma).taskAttachment.findUnique({ where: { id: input.attachmentId }, select: {
    id: true, taskId: true, storageKey: true, originalName: true, mimeType: true, byteSize: true, deletedAt: true,
  } });
  if (!attachment || attachment.deletedAt) throw new Error("Task attachment not found");
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...input.dependencies };
  await dependencies.assertCanReadTask({ userId: input.userId, taskId: attachment.taskId });
  assertProtectedStorageKey(attachment.storageKey);
  return { ...attachment, byteSize: Number(attachment.byteSize), filePath: join(input.storageRoot ?? resolveTaskAttachmentStorageRoot(), attachment.storageKey) };
}

export async function removeTaskAttachment(input: {
  userId: string; attachmentId: string; storageRoot?: string; dependencies?: Partial<AttachmentDependencies>;
  db?: { taskAttachment: {
    findUnique(args: unknown): Promise<{ id: string; taskId: string; storageKey: string; deletedAt: Date | null } | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  } };
}) {
  if (!input.db) requireUserTaskWrites();
  const db = input.db ?? prisma;
  const attachment = await db.taskAttachment.findUnique({
    where: { id: input.attachmentId }, select: { id: true, taskId: true, storageKey: true, deletedAt: true },
  });
  if (!attachment || attachment.deletedAt) throw new Error("Task attachment not found");
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...input.dependencies };
  await dependencies.assertCanEditTask({ userId: input.userId, taskId: attachment.taskId });
  const updated = await db.taskAttachment.updateMany({
    where: { id: input.attachmentId, deletedAt: null }, data: { deletedAt: new Date() },
  });
  if (updated.count !== 1) throw Object.assign(new Error("Task attachment changed"), { code: "version_conflict" });
  assertProtectedStorageKey(attachment.storageKey);
  await rm(join(input.storageRoot ?? resolveTaskAttachmentStorageRoot(), attachment.storageKey), { force: true });
  return { id: attachment.id };
}

export function taskAttachmentDisposition(fileName: string) {
  const fallback = normalizeProtectedAttachmentName(fileName).replace(/[^A-Za-z0-9._-]/gu, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export const isInlineTaskAttachment = (mimeType: string) => ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mimeType);

function attachmentValidationError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}
