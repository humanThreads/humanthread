import {
  desktopDocumentDetailResponseSchema,
  desktopDocumentRevisionsResponseSchema,
  desktopDocumentTreeResponseSchema,
  desktopDocumentUpdateResponseSchema,
  type DesktopDocumentDetailResponse,
  type DesktopDocumentRevisionsResponse,
  type DesktopDocumentTreeResponse,
  type DesktopDocumentUpdateRequest,
  type DesktopDocumentUpdateResponse,
} from "@humanthread/workbench-client";
import { assertCanWriteDocument } from "../../../../../packages/db/src/index";

import {
  getWorkbenchDocument,
  listWorkbenchDocumentRevisions,
  listWorkbenchDocumentTree,
  updateWorkbenchDocumentIdempotently,
} from "../workbench/workbench-documents";
import { resolveDesktopReadContext } from "./desktop-read-models";

type DesktopDocumentTreeData = DesktopDocumentTreeResponse["data"];
type DesktopDocumentDetailData = DesktopDocumentDetailResponse["data"];
type DesktopDocumentRevisionsData = DesktopDocumentRevisionsResponse["data"];
type DesktopDocumentUpdateData = DesktopDocumentUpdateResponse["data"];

interface DesktopDocumentDependencies {
  resolveDesktopReadContext: typeof resolveDesktopReadContext;
  getWorkbenchDocument: typeof getWorkbenchDocument;
  listWorkbenchDocumentTree: typeof listWorkbenchDocumentTree;
  listWorkbenchDocumentRevisions: typeof listWorkbenchDocumentRevisions;
  updateWorkbenchDocumentIdempotently: typeof updateWorkbenchDocumentIdempotently;
  assertCanWriteDocument: typeof assertCanWriteDocument;
}

const DEFAULT_DEPENDENCIES: DesktopDocumentDependencies = {
  resolveDesktopReadContext,
  getWorkbenchDocument,
  listWorkbenchDocumentTree,
  listWorkbenchDocumentRevisions,
  updateWorkbenchDocumentIdempotently,
  assertCanWriteDocument,
};

function dependenciesWith(
  overrides: Partial<DesktopDocumentDependencies>,
): DesktopDocumentDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

function publicGroupKey(projectId: string | null): string {
  return projectId ? `project:${projectId}` : "space";
}

async function resolveSelectedDocument(
  request: Request,
  documentId: string,
  dependencies: DesktopDocumentDependencies,
) {
  const context = await dependencies.resolveDesktopReadContext(request);
  const document = await dependencies.getWorkbenchDocument({
    documentId,
    userId: context.actor.userId,
  });
  if (document.spaceId !== context.space.id) throw new Error("Document not found");
  return { context, document };
}

export class DesktopDocumentVersionConflictError extends Error {
  readonly currentVersion: number;

  constructor(currentVersion: number) {
    super("Document version conflict");
    this.name = "DesktopDocumentVersionConflictError";
    this.currentVersion = currentVersion;
  }
}

export async function readDesktopDocumentTree(
  request: Request,
  dependencyOverrides: Partial<DesktopDocumentDependencies> = {},
): Promise<DesktopDocumentTreeData> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const context = await dependencies.resolveDesktopReadContext(request);
  const tree = await dependencies.listWorkbenchDocumentTree({
    userId: context.actor.userId,
    spaceId: context.space.id,
  });
  const result = {
    groups: tree.groups.map((group) => ({
      key: publicGroupKey(group.projectId),
      label: group.label,
      projectId: group.projectId,
      canWrite: group.canWrite,
      directories: group.directories,
      documents: group.documents.map((document) => ({
        id: document.id,
        directoryId: document.directoryId,
        title: document.title,
        path: document.path,
        sortOrder: document.sortOrder,
        route: `/documents/${encodeURIComponent(document.id)}`,
      })),
    })),
    trash: tree.trash.flatMap((document) => document.deletedAt ? [{
      id: document.id,
      groupKey: publicGroupKey(document.groupKey.startsWith("project:")
        ? document.groupKey.slice("project:".length)
        : null),
      directoryId: document.directoryId,
      title: document.title,
      path: document.path,
      sortOrder: document.sortOrder,
      deletedAt: document.deletedAt.toISOString(),
    }] : []),
  };

  return desktopDocumentTreeResponseSchema.parse({ ok: true, data: result }).data;
}

export async function readDesktopDocumentDetail(
  request: Request,
  documentId: string,
  dependencyOverrides: Partial<DesktopDocumentDependencies> = {},
): Promise<DesktopDocumentDetailData> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const { context, document } = await resolveSelectedDocument(request, documentId, dependencies);
  let edit = false;
  try {
    await dependencies.assertCanWriteDocument({ userId: context.actor.userId, documentId });
    edit = true;
  } catch {
    edit = false;
  }
  const result = {
    detail: {
      id: document.id,
      projectId: document.projectId,
      title: document.title,
      path: document.path,
      contentMarkdown: document.contentMarkdown,
      version: document.version,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      capabilities: { edit },
    },
  };

  return desktopDocumentDetailResponseSchema.parse({ ok: true, data: result }).data;
}

export async function readDesktopDocumentRevisions(
  request: Request,
  documentId: string,
  dependencyOverrides: Partial<DesktopDocumentDependencies> = {},
): Promise<DesktopDocumentRevisionsData> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const { context } = await resolveSelectedDocument(request, documentId, dependencies);
  const revisions = await dependencies.listWorkbenchDocumentRevisions({
    documentId,
    userId: context.actor.userId,
  });
  const result = {
    revisions: revisions.map((revision) => ({
      ...revision,
      source: revision.source,
      createdAt: revision.createdAt.toISOString(),
    })),
  };

  return desktopDocumentRevisionsResponseSchema.parse({ ok: true, data: result }).data;
}

export async function updateDesktopDocument(
  request: Request,
  documentId: string,
  input: DesktopDocumentUpdateRequest,
  dependencyOverrides: Partial<DesktopDocumentDependencies> = {},
): Promise<DesktopDocumentUpdateData> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const { context } = await resolveSelectedDocument(request, documentId, dependencies);
  try {
    const document = await dependencies.updateWorkbenchDocumentIdempotently({
      ...input,
      documentId,
      userId: context.actor.userId,
      source: "desktop",
    });
    return desktopDocumentUpdateResponseSchema.parse({
      ok: true,
      data: { document },
    }).data;
  } catch (error) {
    if (error instanceof Error && error.message === "Document version conflict") {
      const current = await dependencies.getWorkbenchDocument({
        documentId,
        userId: context.actor.userId,
      });
      if (current.spaceId !== context.space.id) throw new Error("Document not found");
      throw new DesktopDocumentVersionConflictError(current.version);
    }
    throw error;
  }
}
