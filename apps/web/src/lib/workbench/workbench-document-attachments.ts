import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  assertCanReadDocument,
  assertCanWriteDocument,
  prisma,
} from "../../../../../packages/db/src/index";

export const WORKBENCH_DOCUMENT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const WORKBENCH_DOCUMENT_ATTACHMENT_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/html",
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "application/zip",
  "application/vnd.xmind.workbook",
  "application/vnd.ms-visio.drawing",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

interface AttachmentDependencies {
  assertCanReadDocument: typeof assertCanReadDocument;
  assertCanWriteDocument: typeof assertCanWriteDocument;
}

const DEFAULT_DEPENDENCIES: AttachmentDependencies = {
  assertCanReadDocument,
  assertCanWriteDocument,
};

export function resolveWorkbenchDocumentAttachmentStorageRoot(
  cwd = process.cwd(),
): string {
  const normalized = resolve(cwd);
  if (basename(normalized) === "web" && basename(dirname(normalized)) === "apps") {
    return join(normalized, "storage", "document-attachments");
  }
  return join(normalized, "apps", "web", "storage", "document-attachments");
}

function normalizeAttachmentName(name: string): string {
  const normalized = basename(name.trim()).replace(/[\u0000-\u001f\u007f]/gu, "");
  return normalized.slice(0, 255) || "attachment";
}

export function resolveWorkbenchDocumentAttachmentMimeType(file: Pick<File, "name" | "type">) {
  const declared = file.type.trim().toLowerCase();
  const extension = normalizeAttachmentName(file.name).toLowerCase().split(".").at(-1);
  if (extension === "xmind" && (!declared || declared === "application/octet-stream" || declared === "application/zip")) {
    return "application/vnd.xmind.workbook";
  }
  if ((extension === "vsdx" || extension === "vsd") && (!declared || declared === "application/octet-stream" || declared === "application/zip")) {
    return "application/vnd.ms-visio.drawing";
  }
  if (declared) return declared;
  return declared;
}

function assertStorageKey(storageKey: string) {
  if (!/^[A-Za-z0-9._:-]+\/[A-Za-z0-9._:-]+$/u.test(storageKey)) {
    throw new Error("Invalid document attachment storage key");
  }
}

export async function saveWorkbenchDocumentAttachment(input: {
  userId: string;
  documentId: string;
  file: File;
  storageRoot?: string;
  createId?: () => string;
  dependencies?: Partial<AttachmentDependencies>;
  db?: {
    documentAttachment: {
      create(args: unknown): Promise<{
        id: string;
        originalName: string;
        mimeType: string;
        byteSize: bigint;
      }>;
    };
  };
}) {
  if (!input.file || input.file.size === 0) {
    throw new Error("Document attachment is required");
  }
  if (input.file.size > WORKBENCH_DOCUMENT_ATTACHMENT_MAX_BYTES) {
    throw new Error("Document attachment is too large");
  }
  const mimeType = resolveWorkbenchDocumentAttachmentMimeType(input.file);
  if (!WORKBENCH_DOCUMENT_ATTACHMENT_ALLOWED_MIME_TYPES.includes(
    mimeType as (typeof WORKBENCH_DOCUMENT_ATTACHMENT_ALLOWED_MIME_TYPES)[number],
  )) {
    throw new Error("Unsupported document attachment type");
  }

  const dependencies = { ...DEFAULT_DEPENDENCIES, ...input.dependencies };
  await dependencies.assertCanWriteDocument({
    userId: input.userId,
    documentId: input.documentId,
  });

  const attachmentId = input.createId?.() ?? `attachment_${randomUUID()}`;
  const storageKey = `${input.documentId}/${attachmentId}`;
  assertStorageKey(storageKey);
  const storageRoot = input.storageRoot ?? resolveWorkbenchDocumentAttachmentStorageRoot();
  const directory = join(storageRoot, input.documentId);
  const filePath = join(storageRoot, storageKey);
  const originalName = normalizeAttachmentName(input.file.name);
  const db = input.db ?? prisma;

  await mkdir(directory, { recursive: true });
  await writeFile(filePath, Buffer.from(await input.file.arrayBuffer()));
  try {
    const attachment = await db.documentAttachment.create({
      data: {
        id: attachmentId,
        documentId: input.documentId,
        storageKey,
        originalName,
        mimeType,
        byteSize: BigInt(input.file.size),
        uploadedById: input.userId,
      },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        byteSize: true,
      },
    });
    return {
      ...attachment,
      byteSize: Number(attachment.byteSize),
      markdownUrl: `/api/document-attachments/${attachment.id}`,
    };
  } catch (error) {
    await rm(filePath, { force: true });
    throw error;
  }
}

export async function readWorkbenchDocumentAttachment(input: {
  userId: string;
  attachmentId: string;
  storageRoot?: string;
  dependencies?: Partial<AttachmentDependencies>;
  db?: {
    documentAttachment: {
      findUnique(args: unknown): Promise<{
        id: string;
        documentId: string;
        storageKey: string;
        originalName: string;
        mimeType: string;
        byteSize: bigint;
        deletedAt: Date | null;
      } | null>;
    };
  };
}) {
  const db = input.db ?? prisma;
  const attachment = await db.documentAttachment.findUnique({
    where: { id: input.attachmentId },
    select: {
      id: true,
      documentId: true,
      storageKey: true,
      originalName: true,
      mimeType: true,
      byteSize: true,
      deletedAt: true,
    },
  });
  if (!attachment || attachment.deletedAt) {
    throw new Error("Document attachment not found");
  }
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...input.dependencies };
  await dependencies.assertCanReadDocument({
    userId: input.userId,
    documentId: attachment.documentId,
  });
  assertStorageKey(attachment.storageKey);
  const storageRoot = input.storageRoot ?? resolveWorkbenchDocumentAttachmentStorageRoot();
  return {
    ...attachment,
    byteSize: Number(attachment.byteSize),
    filePath: join(storageRoot, attachment.storageKey),
  };
}

export function buildDocumentAttachmentContentDisposition(fileName: string) {
  const fallback = normalizeAttachmentName(fileName).replace(/[^A-Za-z0-9._-]/gu, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function isInlineDocumentAttachmentMimeType(mimeType: string) {
  return ["image/png", "image/jpeg", "image/webp", "image/gif", "text/html"].includes(mimeType);
}
