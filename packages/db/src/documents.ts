import { createHash, randomUUID } from "node:crypto";
import type { OrchestrationCommand } from "@humanthread/shared";
import {
  executeIdempotentCommand,
  OrchestrationPersistenceError,
  type OrchestrationEventsTx,
} from "./orchestration-events";
import {
  parseDocumentPath,
  resolveDocumentDirectoryPath,
} from "./document-tree";
import { prisma } from "./prisma";
import { isPrismaUniqueConstraintError } from "./prisma-errors";
import { derivedPersistenceId } from "./bounded-id";

export { parseDocumentPath } from "./document-tree";

export type DocumentRevisionSource = "web" | "desktop" | "agent" | "mcp" | "system";
export type DocumentFormat = "markdown" | "htm";

type DocumentTransactionClient = {
  documentDirectory: {
    findUnique(input: unknown): Promise<{
      id: string;
      containerKey: string;
      path: string;
    } | null>;
    upsert(input: unknown): Promise<{ id: string; path: string }>;
  };
  document: {
    create(input: unknown): Promise<{ id: string; version: number }>;
    findUnique(input: unknown): Promise<{
      id: string;
      version: number;
      contentMarkdown: string;
    } | null>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  documentRevision: {
    create(input: unknown): Promise<unknown>;
  };
};

export type DocumentDb = {
  project: {
    findUnique(input: unknown): Promise<{ id: string; spaceId: string | null } | null>;
  };
  $transaction<T>(callback: (tx: DocumentTransactionClient) => Promise<T>): Promise<T>;
};

type IdempotentDocumentTransactionClient = DocumentTransactionClient & OrchestrationEventsTx;

export type IdempotentDocumentDb = {
  $transaction<T>(callback: (tx: IdempotentDocumentTransactionClient) => Promise<T>): Promise<T>;
};

function defaultCreateId(): string {
  return `doc_${randomUUID()}`;
}

function documentRevisionId(documentId: string, version: number): string {
  return derivedPersistenceId(["document-revision", documentId, String(version)]);
}

export function normalizeDocumentPath(path: string): string {
  return parseDocumentPath(path).path;
}

export function buildDocumentContainerKey(input: {
  spaceId: string;
  projectId?: string;
}): string {
  return input.projectId ? `project:${input.projectId}` : `space:${input.spaceId}`;
}

export async function createDocument(input: {
  db?: DocumentDb;
  spaceId: string;
  projectId?: string;
  directoryId?: string;
  title: string;
  path: string;
  contentMarkdown: string;
  format?: DocumentFormat;
  actorUserId: string;
  source: DocumentRevisionSource;
  createId?: () => string;
}): Promise<{ id: string; version: number }> {
  const db = input.db ?? (prisma as unknown as DocumentDb);
  const parsedPath = parseDocumentPath(input.path);
  const title = input.title.trim();

  if (!title) {
    throw new Error("Document title is required");
  }

  if (input.projectId) {
    const project = await db.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, spaceId: true },
    });

    if (!project) {
      throw new Error("Document project not found");
    }

    if (project.spaceId !== input.spaceId) {
      throw new Error("Document project belongs to another space");
    }
  }

  const documentId = input.createId?.() ?? defaultCreateId();
  const containerKey = buildDocumentContainerKey(input);

  try {
    return await db.$transaction(async (tx) => {
      const explicitDirectory = input.directoryId
        ? await tx.documentDirectory.findUnique({
            where: { id: input.directoryId },
            select: { id: true, containerKey: true, path: true },
          })
        : null;
      if (input.directoryId && !explicitDirectory) {
        throw new Error("Document directory not found");
      }
      if (explicitDirectory && explicitDirectory.containerKey !== containerKey) {
        throw new Error("Document tree move crosses containers");
      }
      const resolvedDirectoryId = explicitDirectory
        ? explicitDirectory.id
        : await resolveDocumentDirectoryPath({
            tx,
            spaceId: input.spaceId,
            ...(input.projectId ? { projectId: input.projectId } : {}),
            containerKey,
            directorySegments: parsedPath.directorySegments,
            actorUserId: input.actorUserId,
          });
      const documentPath = explicitDirectory
        ? `${explicitDirectory.path}/${parsedPath.fileName}`
        : parsedPath.path;
      return tx.document.create({
        data: {
          id: documentId,
          spaceId: input.spaceId,
          projectId: input.projectId ?? null,
          containerKey,
          directoryId: resolvedDirectoryId,
          title,
          path: documentPath,
          contentMarkdown: input.contentMarkdown,
          format: input.format ?? (parsedPath.fileName.toLowerCase().endsWith(".htm") ? "htm" : "markdown"),
          version: 1,
          sortOrder: 0,
          createdById: input.actorUserId,
          updatedById: input.actorUserId,
          revisions: {
            create: {
              id: documentRevisionId(documentId, 1),
              version: 1,
              contentMarkdown: input.contentMarkdown,
              createdById: input.actorUserId,
              source: input.source,
            },
          },
        },
        select: { id: true, version: true },
      });
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      throw new Error("Document path conflict");
    }
    throw error;
  }
}

async function writeDocument(input: {
  db?: DocumentDb;
  documentId: string;
  expectedVersion: number;
  title: string;
  actorUserId: string;
  source: DocumentRevisionSource;
  resolveContent(currentContent: string): string;
}): Promise<{ id: string; version: number }> {
  const db = input.db ?? (prisma as unknown as DocumentDb);
  const title = input.title.trim();

  if (!title) {
    throw new Error("Document title is required");
  }

  return db.$transaction(async (tx) => {
    const current = await tx.document.findUnique({
      where: { id: input.documentId },
      select: { id: true, version: true, contentMarkdown: true },
    });

    if (!current) {
      throw new Error("Document not found");
    }

    if (current.version !== input.expectedVersion) {
      throw new Error("Document version conflict");
    }

    const nextVersion = current.version + 1;
    const contentMarkdown = input.resolveContent(current.contentMarkdown);
    const updated = await tx.document.updateMany({
      where: { id: input.documentId, version: input.expectedVersion },
      data: {
        title,
        contentMarkdown,
        version: nextVersion,
        updatedById: input.actorUserId,
      },
    });

    if (updated.count !== 1) {
      throw new Error("Document version conflict");
    }

    await tx.documentRevision.create({
      data: {
        id: documentRevisionId(input.documentId, nextVersion),
        documentId: input.documentId,
        version: nextVersion,
        contentMarkdown,
        createdById: input.actorUserId,
        source: input.source,
      },
    });

    return { id: input.documentId, version: nextVersion };
  });
}

export function updateDocument(input: {
  db?: DocumentDb;
  documentId: string;
  expectedVersion: number;
  title: string;
  contentMarkdown: string;
  actorUserId: string;
  source: DocumentRevisionSource;
}) {
  return writeDocument({ ...input, resolveContent: () => input.contentMarkdown });
}

function documentCommandReceiptId(documentId: string, commandId: string): string {
  const digest = createHash("sha256").update(`${documentId}\0${commandId}`).digest("hex");
  return `document:${digest}`;
}

export async function updateDocumentIdempotently(input: {
  db?: IdempotentDocumentDb;
  commandId: string;
  documentId: string;
  expectedVersion: number;
  title: string;
  contentMarkdown: string;
  actorUserId: string;
  source: DocumentRevisionSource;
}): Promise<{ id: string; version: number }> {
  const db = input.db ?? (prisma as unknown as IdempotentDocumentDb);
  const title = input.title.trim();
  if (!title) throw new Error("Document title is required");

  const issuedAt = new Date();
  const command: OrchestrationCommand<unknown> = {
    commandId: documentCommandReceiptId(input.documentId, input.commandId),
    correlationId: `document:${input.documentId}`,
    actor: { type: "user", id: input.actorUserId },
    payload: { documentId: input.documentId },
    issuedAt,
  };

  try {
    return await executeIdempotentCommand({
      command,
      aggregate: { type: "document", id: input.documentId },
      db,
      apply: async (tx) => {
        const current = await tx.document.findUnique({
          where: { id: input.documentId },
          select: { id: true, version: true, contentMarkdown: true },
        });
        if (!current) throw new Error("Document not found");
        if (current.version !== input.expectedVersion) {
          throw new Error("Document version conflict");
        }

        const result = { id: input.documentId, version: current.version + 1 };
        return {
          result,
          events: [],
          persist: async (currentTx) => {
            const updated = await currentTx.document.updateMany({
              where: { id: input.documentId, version: input.expectedVersion },
              data: {
                title,
                contentMarkdown: input.contentMarkdown,
                version: result.version,
                updatedById: input.actorUserId,
              },
            });
            if (updated.count !== 1) return 0;
            await currentTx.documentRevision.create({
              data: {
                id: documentRevisionId(input.documentId, result.version),
                documentId: input.documentId,
                version: result.version,
                contentMarkdown: input.contentMarkdown,
                createdById: input.actorUserId,
                source: input.source,
              },
            });
            return updated.count;
          },
        };
      },
    });
  } catch (error) {
    if (error instanceof OrchestrationPersistenceError && error.code === "version_conflict") {
      throw new Error("Document version conflict");
    }
    throw error;
  }
}

export function appendDocument(input: {
  db?: DocumentDb;
  documentId: string;
  expectedVersion: number;
  title: string;
  contentMarkdown: string;
  actorUserId: string;
  source: DocumentRevisionSource;
}) {
  return writeDocument({
    ...input,
    resolveContent: (currentContent) => {
      const suffix = input.contentMarkdown.trim();
      return suffix ? (currentContent ? `${currentContent}\n\n${suffix}` : suffix) : currentContent;
    },
  });
}

export const normalizeProjectDocumentPath = normalizeDocumentPath;
export const updateProjectDocument = updateDocument;

export function createProjectDocument(input: {
  db?: DocumentDb;
  projectId: string;
  spaceId?: string;
  directoryId?: string;
  title: string;
  path: string;
  contentMarkdown: string;
  format?: DocumentFormat;
  actorUserId: string;
  source: DocumentRevisionSource;
  createId?: () => string;
}) {
  const db = input.db ?? (prisma as unknown as DocumentDb);

  if (input.spaceId) {
    return createDocument({ ...input, db, spaceId: input.spaceId });
  }

  return db.project
    .findUnique({
      where: { id: input.projectId },
      select: { id: true, spaceId: true },
    })
    .then((project) => {
      if (!project?.spaceId) {
        throw new Error("Document project has no space");
      }

      return createDocument({ ...input, db, spaceId: project.spaceId });
    });
}
