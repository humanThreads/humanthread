import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { assertCanCommentOnTask, assertCanReadProject, prisma } from "@humanthread/db";

import {
  assertProtectedStorageKey,
  TASK_ATTACHMENT_ALLOWED_MIME_TYPES,
  TASK_ATTACHMENT_MAX_BYTES,
  validateProtectedAttachment,
} from "../tasks/task-attachments";

export type WorkflowAttachmentScanStatus = "pending_scan" | "safe" | "rejected";

interface InteractionAttachmentOwner {
  id: string;
  projectId: string;
  taskId: string | null;
  loopRunId: string;
  status: string;
}

interface AttachmentDependencies {
  loadInteraction(input: { interactionId: string }): Promise<InteractionAttachmentOwner | null>;
  assertCanReply(input: { userId: string; interaction: InteractionAttachmentOwner }): Promise<void>;
  assertCanReadProject: typeof assertCanReadProject;
}

interface AttachmentCreateDb {
  workflowInteractionAttachment: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  };
}

interface AttachmentReadDb {
  workflowInteractionAttachment: {
    findUnique(args: unknown): Promise<{
      id: string;
      interactionId: string;
      storageKey: string;
      originalName: string;
      mimeType: string;
      byteSize: number;
      scanStatus: string;
      interaction: { projectId: string };
    } | null>;
  };
}

interface AttachmentScanDb {
  workflowInteractionAttachment: {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

const DEFAULT_DEPENDENCIES: AttachmentDependencies = {
  loadInteraction: async ({ interactionId }) => prisma.workflowInteraction.findUnique({
    where: { id: interactionId },
    select: { id: true, projectId: true, taskId: true, loopRunId: true, status: true },
  }),
  assertCanReply: async ({ userId, interaction }) => {
    const access = await assertCanReadProject({ userId, projectId: interaction.projectId });
    if (access.role === "owner" || access.role === "maintainer") return;
    if (interaction.taskId) {
      await assertCanCommentOnTask({ userId, taskId: interaction.taskId });
      return;
    }
    throw attachmentError("authorization_denied", "Workflow interaction reply access denied");
  },
  assertCanReadProject,
};

export function resolveWorkflowInteractionAttachmentStorageRoot(cwd = process.cwd()) {
  const normalized = resolve(cwd);
  return basename(normalized) === "web" && basename(dirname(normalized)) === "apps"
    ? join(normalized, "storage", "workflow-interaction-attachments")
    : join(normalized, "apps", "web", "storage", "workflow-interaction-attachments");
}

export async function createWorkflowInteractionAttachment(input: {
  userId: string;
  loopRunId: string;
  interactionId: string;
  file: File;
  storageRoot?: string;
  createId?: () => string;
  dependencies?: Partial<AttachmentDependencies>;
  db?: AttachmentCreateDb;
}) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...input.dependencies };
  const interaction = await dependencies.loadInteraction({ interactionId: input.interactionId });
  if (!interaction || interaction.loopRunId !== input.loopRunId) {
    throw attachmentError("not_found", "Workflow interaction not found");
  }
  if (interaction.status !== "open") {
    throw attachmentError("version_conflict", "Workflow interaction is read-only");
  }
  await dependencies.assertCanReply({ userId: input.userId, interaction });
  const validated = validateProtectedAttachment({
    file: input.file,
    maxBytes: TASK_ATTACHMENT_MAX_BYTES,
    allowedMimeTypes: TASK_ATTACHMENT_ALLOWED_MIME_TYPES,
  });
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const attachmentId = input.createId?.() ?? `workflow_attachment_${randomUUID()}`;
  const storageKey = `${input.interactionId}/${attachmentId}`;
  assertProtectedStorageKey(storageKey);
  const storageRoot = input.storageRoot ?? resolveWorkflowInteractionAttachmentStorageRoot();
  const filePath = join(storageRoot, storageKey);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);

  try {
    await (input.db ?? prisma as unknown as AttachmentCreateDb).workflowInteractionAttachment.create({
      data: {
        id: attachmentId,
        interactionId: input.interactionId,
        messageId: null,
        storageKey,
        originalName: validated.fileName,
        mimeType: input.file.type,
        byteSize: input.file.size,
        scanStatus: "pending_scan",
        checksum: createHash("sha256").update(bytes).digest("hex"),
        uploadedByUserId: input.userId,
      },
    });
  } catch (error) {
    await rm(filePath, { force: true });
    throw error;
  }

  return {
    attachmentId,
    fileName: validated.fileName,
    mimeType: input.file.type,
    byteSize: input.file.size,
    scanStatus: "pending_scan" as const,
  };
}

export async function markWorkflowInteractionAttachmentScanned(input: {
  attachmentId: string;
  scanStatus: Exclude<WorkflowAttachmentScanStatus, "pending_scan">;
  scanner: string;
  scannedAt: Date;
}, dependencies: { db?: AttachmentScanDb } = {}) {
  if (!input.scanner.trim()) throw attachmentError("validation_failed", "Scanner identity is required");
  if (Number.isNaN(input.scannedAt.getTime())) throw attachmentError("validation_failed", "Scan time is invalid");
  const updated = await (dependencies.db ?? prisma as unknown as AttachmentScanDb)
    .workflowInteractionAttachment.updateMany({
      where: { id: input.attachmentId, scanStatus: "pending_scan" },
      data: { scanStatus: input.scanStatus, scanner: input.scanner, scannedAt: input.scannedAt },
    });
  if (updated.count !== 1) throw attachmentError("version_conflict", "Workflow attachment scan state changed");
}

export async function readWorkflowInteractionAttachment(input: {
  userId: string;
  attachmentId: string;
  storageRoot?: string;
  dependencies?: Partial<Pick<AttachmentDependencies, "assertCanReadProject">>;
  db?: AttachmentReadDb;
}) {
  const attachment = await (input.db ?? prisma as unknown as AttachmentReadDb)
    .workflowInteractionAttachment.findUnique({
      where: { id: input.attachmentId },
      select: {
        id: true,
        interactionId: true,
        storageKey: true,
        originalName: true,
        mimeType: true,
        byteSize: true,
        scanStatus: true,
        interaction: { select: { projectId: true } },
      },
    });
  if (!attachment) throw attachmentError("not_found", "Workflow attachment not found");
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...input.dependencies };
  try {
    await dependencies.assertCanReadProject({ userId: input.userId, projectId: attachment.interaction.projectId });
  } catch {
    throw attachmentError("not_found", "Workflow attachment not found");
  }
  if (attachment.scanStatus !== "safe") {
    throw attachmentError("attachment_quarantined", "Workflow attachment is not available");
  }
  assertProtectedStorageKey(attachment.storageKey);
  return {
    ...attachment,
    filePath: join(input.storageRoot ?? resolveWorkflowInteractionAttachmentStorageRoot(), attachment.storageKey),
  };
}

export function workflowInteractionAttachmentDisposition(fileName: string) {
  const fallback = basename(fileName).replace(/[^A-Za-z0-9._-]/gu, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function attachmentError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}
