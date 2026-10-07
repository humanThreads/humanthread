import {
  assertCanReadDocument,
  assertCanReadProject,
  assertCanReadSpace,
  assertCanWriteDocument,
  assertCanWriteProject,
  assertCanWriteSpace,
  appendDocument,
  buildAccessibleProjectWhere,
  createDocument,
  createDocumentDirectory,
  createProjectDocument,
  deleteDocumentDirectory,
  listAccessibleSpaces,
  moveDocument,
  moveDocumentDirectory,
  prisma,
  renameDocumentDirectory,
  restoreDocument,
  softDeleteDocument,
  updateDocument,
  updateDocumentIdempotently,
  type DocumentRevisionSource,
} from "../../../../../packages/db/src/index";

interface DocumentSummaryRow {
  id: string;
  spaceId: string | null;
  projectId: string | null;
  title: string;
  path: string;
  version: number;
  updatedAt: Date;
}

interface AccessibleProjectDocumentRow extends DocumentSummaryRow {
  project: { id: string; name: string } | null;
}

interface DocumentDetailRow extends DocumentSummaryRow {
  contentMarkdown: string;
  format: "markdown" | "htm";
  createdAt: Date;
}

interface DocumentRevisionRow {
  id: string;
  documentId: string;
  version: number;
  contentMarkdown: string;
  source: string;
  createdAt: Date;
  createdById: string;
}

interface DocumentTreeDirectoryDbRow extends WorkbenchDocumentDirectoryItem {
  projectId: string | null;
  containerKey: string;
}

type DocumentTreeDocumentDbRow = Omit<WorkbenchDocumentTreeItem, "groupKey"> & {
  projectId: string | null;
  containerKey: string | null;
};

interface WorkbenchDocumentTreeDb {
  project: { findMany(args: unknown): Promise<Array<{ id: string; name: string }>> };
  documentDirectory: { findMany(args: unknown): Promise<DocumentTreeDirectoryDbRow[]> };
  document: { findMany(args: unknown): Promise<DocumentTreeDocumentDbRow[]> };
}

interface WorkbenchDocumentDependencies {
  assertCanReadProject: typeof assertCanReadProject;
  assertCanWriteProject: typeof assertCanWriteProject;
  assertCanReadSpace: typeof assertCanReadSpace;
  assertCanWriteSpace: typeof assertCanWriteSpace;
  assertCanReadDocument: typeof assertCanReadDocument;
  assertCanWriteDocument: typeof assertCanWriteDocument;
  appendDocument: typeof appendDocument;
  createDocument: typeof createDocument;
  createProjectDocument: typeof createProjectDocument;
  updateDocument: typeof updateDocument;
  updateDocumentIdempotently: typeof updateDocumentIdempotently;
  updateProjectDocument: typeof updateDocument;
  listAccessibleSpaces: typeof listAccessibleSpaces;
  createDocumentDirectory: typeof createDocumentDirectory;
  renameDocumentDirectory: typeof renameDocumentDirectory;
  moveDocumentDirectory: typeof moveDocumentDirectory;
  deleteDocumentDirectory: typeof deleteDocumentDirectory;
  moveDocument: typeof moveDocument;
  softDeleteDocument: typeof softDeleteDocument;
  restoreDocument: typeof restoreDocument;
}

const DEFAULT_DOCUMENT_DEPENDENCIES: WorkbenchDocumentDependencies = {
  assertCanReadProject,
  assertCanWriteProject,
  assertCanReadSpace,
  assertCanWriteSpace,
  assertCanReadDocument,
  assertCanWriteDocument,
  appendDocument,
  createDocument,
  createProjectDocument,
  updateDocument,
  updateDocumentIdempotently,
  updateProjectDocument: updateDocument,
  listAccessibleSpaces,
  createDocumentDirectory,
  renameDocumentDirectory,
  moveDocumentDirectory,
  deleteDocumentDirectory,
  moveDocument,
  softDeleteDocument,
  restoreDocument,
};

export interface WorkbenchDocumentTreeItem {
  id: string;
  groupKey: string;
  directoryId: string | null;
  title: string;
  path: string;
  sortOrder: number;
  deletedAt: Date | null;
}

export interface WorkbenchDocumentDirectoryItem {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  sortOrder: number;
}

export interface WorkbenchDocumentTreeGroup {
  key: string;
  label: string;
  spaceId: string;
  projectId: string | null;
  canWrite: boolean;
  canManage?: boolean;
  directories: WorkbenchDocumentDirectoryItem[];
  documents: WorkbenchDocumentTreeItem[];
}

export interface WorkbenchProjectDocumentSummary {
  id: string;
  projectId: string;
  directoryId?: string;
  title: string;
  path: string;
  version: number;
  updatedAt: Date;
}

export interface WorkbenchSpaceDocumentSummary {
  id: string;
  spaceId: string;
  projectId: null;
  title: string;
  path: string;
  version: number;
  updatedAt: Date;
}

export interface WorkbenchAccessibleSpaceDocumentSummary
  extends WorkbenchSpaceDocumentSummary {
  spaceName: string;
  spaceRole: "owner" | "admin" | "member" | "viewer";
}

export interface WorkbenchAccessibleProjectDocumentSummary
  extends WorkbenchProjectDocumentSummary {
  projectName: string;
}

export interface WorkbenchDocumentSearchResult extends DocumentSummaryRow {
  spaceId: string;
  projectName: string | null;
}

export interface WorkbenchDocumentDetail {
  id: string;
  spaceId: string;
  projectId: string | null;
  title: string;
  path: string;
  contentMarkdown: string;
  format: "markdown" | "htm";
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type WorkbenchProjectDocumentDetail = WorkbenchDocumentDetail;

export interface WorkbenchDocumentRevision {
  id: string;
  documentId: string;
  version: number;
  contentMarkdown: string;
  source: string;
  createdAt: Date;
  createdById: string;
}

export async function listProjectDocuments(input: {
  projectId: string;
  userId: string;
  dependencies?: Partial<WorkbenchDocumentDependencies>;
  db?: { document: { findMany: typeof prisma.document.findMany } };
}): Promise<WorkbenchProjectDocumentSummary[]> {
  const dependencies = { ...DEFAULT_DOCUMENT_DEPENDENCIES, ...input.dependencies };
  const db = input.db ?? prisma;

  await dependencies.assertCanReadProject({
    userId: input.userId,
    projectId: input.projectId,
  });
  const documents = (await db.document.findMany({
    where: { projectId: input.projectId, deletedAt: null },
    orderBy: [{ updatedAt: "desc" }, { path: "asc" }],
    select: {
      id: true,
      spaceId: true,
      projectId: true,
      title: true,
      path: true,
      version: true,
      updatedAt: true,
    },
  })) as DocumentSummaryRow[];

  return documents.map((document) => {
    if (!document.projectId) {
      throw new Error("Project document has no project");
    }

    return {
      id: document.id,
      projectId: document.projectId,
      title: document.title,
      path: document.path,
      version: document.version,
      updatedAt: document.updatedAt,
    };
  });
}

export async function listSpaceDocuments(input: {
  spaceId: string;
  userId: string;
  dependencies?: Partial<WorkbenchDocumentDependencies>;
  db?: { document: { findMany: typeof prisma.document.findMany } };
}): Promise<WorkbenchSpaceDocumentSummary[]> {
  const dependencies = { ...DEFAULT_DOCUMENT_DEPENDENCIES, ...input.dependencies };
  const db = input.db ?? prisma;

  await dependencies.assertCanReadSpace({ userId: input.userId, spaceId: input.spaceId });
  const documents = (await db.document.findMany({
    where: { spaceId: input.spaceId, projectId: null, deletedAt: null },
    orderBy: [{ updatedAt: "desc" }, { path: "asc" }],
    select: {
      id: true,
      spaceId: true,
      projectId: true,
      title: true,
      path: true,
      version: true,
      updatedAt: true,
    },
  })) as DocumentSummaryRow[];

  return documents.map((document) => {
    if (!document.spaceId || document.projectId) {
      throw new Error("Invalid root document target");
    }

    return {
      id: document.id,
      spaceId: document.spaceId,
      projectId: null,
      deletedAt: null,
      title: document.title,
      path: document.path,
      version: document.version,
      updatedAt: document.updatedAt,
    };
  });
}

export async function listAccessibleSpaceDocuments(input: {
  userId: string;
  spaceId?: string;
  dependencies?: Partial<WorkbenchDocumentDependencies>;
  db?: { document: { findMany: typeof prisma.document.findMany } };
}): Promise<WorkbenchAccessibleSpaceDocumentSummary[]> {
  const dependencies = { ...DEFAULT_DOCUMENT_DEPENDENCIES, ...input.dependencies };
  const db = input.db ?? prisma;
  const spaces = await dependencies.listAccessibleSpaces({ userId: input.userId });
  const selectedSpaces = input.spaceId
    ? spaces.filter((space) => space.id === input.spaceId)
    : spaces;

  if (input.spaceId && selectedSpaces.length === 0) {
    throw new Error("Space access denied");
  }

  if (selectedSpaces.length === 0) {
    return [];
  }

  const spaceById = new Map(selectedSpaces.map((space) => [space.id, space]));
  const documents = (await db.document.findMany({
    where: {
      projectId: null,
      spaceId: { in: selectedSpaces.map((space) => space.id) },
    },
    orderBy: [{ updatedAt: "desc" }, { path: "asc" }],
    select: {
      id: true,
      spaceId: true,
      projectId: true,
      title: true,
      path: true,
      version: true,
      updatedAt: true,
    },
  })) as DocumentSummaryRow[];

  return documents.map((document) => {
    const space = document.spaceId ? spaceById.get(document.spaceId) : undefined;

    if (!space || document.projectId) {
      throw new Error("Invalid root document target");
    }

    return {
      id: document.id,
      spaceId: space.id,
      projectId: null,
      spaceName: space.name,
      spaceRole: space.role,
      title: document.title,
      path: document.path,
      version: document.version,
      updatedAt: document.updatedAt,
    };
  });
}

export async function listAccessibleProjectDocuments(input: {
  userId: string;
  companyId?: string;
  ownerType?: "company" | "personal";
  db?: { document: { findMany: typeof prisma.document.findMany } };
}): Promise<WorkbenchAccessibleProjectDocumentSummary[]> {
  const db = input.db ?? prisma;
  const documents = (await db.document.findMany({
    where: {
      projectId: { not: null },
      deletedAt: null,
      project: buildAccessibleProjectWhere({
        userId: input.userId,
        ...(input.companyId ? { companyId: input.companyId } : {}),
        ...(input.ownerType ? { ownerType: input.ownerType } : {}),
      }),
    },
    orderBy: [{ updatedAt: "desc" }, { path: "asc" }],
    select: {
      id: true,
      spaceId: true,
      projectId: true,
      title: true,
      path: true,
      version: true,
      updatedAt: true,
      project: { select: { id: true, name: true } },
    },
  })) as unknown as AccessibleProjectDocumentRow[];

  return documents.map((document) => {
    if (!document.projectId || !document.project) {
      throw new Error("Project document has no project");
    }

    return {
      id: document.id,
      projectId: document.projectId,
      projectName: document.project.name,
      title: document.title,
      path: document.path,
      version: document.version,
      updatedAt: document.updatedAt,
    };
  });
}

export async function searchWorkbenchDocuments(input: {
  userId: string;
  spaceId: string;
  projectId?: string;
  query: string;
  dependencies?: Partial<WorkbenchDocumentDependencies>;
  db?: { document: { findMany: typeof prisma.document.findMany } };
}): Promise<WorkbenchDocumentSearchResult[]> {
  const dependencies = { ...DEFAULT_DOCUMENT_DEPENDENCIES, ...input.dependencies };
  const db = input.db ?? prisma;
  const query = input.query.trim();

  if (!query) {
    return [];
  }

  if (input.projectId) {
    await dependencies.assertCanReadProject({
      userId: input.userId,
      projectId: input.projectId,
    });
  } else {
    await dependencies.assertCanReadSpace({
      userId: input.userId,
      spaceId: input.spaceId,
    });
  }

  const documents = (await db.document.findMany({
    where: {
      spaceId: input.spaceId,
      projectId: input.projectId ?? null,
      deletedAt: null,
      OR: [
        { title: { contains: query } },
        { path: { contains: query } },
        { contentMarkdown: { contains: query } },
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { path: "asc" }],
    select: {
      id: true,
      spaceId: true,
      projectId: true,
      title: true,
      path: true,
      version: true,
      updatedAt: true,
      project: { select: { id: true, name: true } },
    },
  })) as unknown as AccessibleProjectDocumentRow[];

  return documents.map((document) => {
    if (!document.spaceId) {
      throw new Error("Document has no space");
    }

    return {
      id: document.id,
      spaceId: document.spaceId,
      projectId: document.projectId,
      projectName: document.project?.name ?? null,
      title: document.title,
      path: document.path,
      version: document.version,
      updatedAt: document.updatedAt,
    };
  });
}

export async function getWorkbenchDocument(input: {
  documentId: string;
  userId: string;
  dependencies?: Partial<WorkbenchDocumentDependencies>;
  db?: { document: { findUnique: typeof prisma.document.findUnique } };
}): Promise<WorkbenchDocumentDetail> {
  const dependencies = { ...DEFAULT_DOCUMENT_DEPENDENCIES, ...input.dependencies };
  const db = input.db ?? prisma;
  const document = (await db.document.findUnique({
    where: { id: input.documentId, deletedAt: null },
    select: {
      id: true,
      spaceId: true,
      projectId: true,
      title: true,
      path: true,
      contentMarkdown: true,
      format: true,
      version: true,
      createdAt: true,
      updatedAt: true,
    },
  })) as DocumentDetailRow | null;

  if (!document) {
    throw new Error("Document not found");
  }

  await dependencies.assertCanReadDocument({
    userId: input.userId,
    documentId: document.id,
  });

  if (!document.spaceId) {
    throw new Error("Document has no space");
  }

  return { ...document, spaceId: document.spaceId };
}

export async function listWorkbenchDocumentTree(input: {
  userId: string;
  spaceId: string;
  projectId?: string;
  dependencies?: Partial<WorkbenchDocumentDependencies>;
  db?: WorkbenchDocumentTreeDb;
}) {
  const dependencies = { ...DEFAULT_DOCUMENT_DEPENDENCIES, ...input.dependencies };
  const db = input.db ?? prisma;
  const spaceAccess = await dependencies.assertCanReadSpace({
    userId: input.userId,
    spaceId: input.spaceId,
  });
  if (input.projectId) {
    await dependencies.assertCanReadProject({ userId: input.userId, projectId: input.projectId });
  }
  const projects = await db.project.findMany({
    where: {
      spaceId: input.spaceId,
      ...(input.projectId ? { id: input.projectId } : {}),
      ...buildAccessibleProjectWhere({ userId: input.userId }),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const projectIds = projects.map((project) => project.id);
  const [directories, documents] = await Promise.all([
    db.documentDirectory.findMany({
      where: {
        spaceId: input.spaceId,
        OR: [{ projectId: null }, { projectId: { in: projectIds } }],
      },
      orderBy: [{ sortOrder: "asc" }, { path: "asc" }],
      select: {
        id: true,
        parentId: true,
        projectId: true,
        containerKey: true,
        name: true,
        path: true,
        sortOrder: true,
      },
    }),
    db.document.findMany({
      where: {
        spaceId: input.spaceId,
        OR: [{ projectId: null }, { projectId: { in: projectIds } }],
      },
      orderBy: [{ sortOrder: "asc" }, { path: "asc" }],
      select: {
        id: true,
        directoryId: true,
        projectId: true,
        containerKey: true,
        title: true,
        path: true,
        sortOrder: true,
        deletedAt: true,
      },
    }),
  ]);

  const readableDocuments = (await Promise.all(documents.map(async (document) => {
    try {
      await dependencies.assertCanReadDocument({ userId: input.userId, documentId: document.id });
      return document;
    } catch {
      return null;
    }
  }))).filter((document): document is DocumentTreeDocumentDbRow => Boolean(document));

  const groups: WorkbenchDocumentTreeGroup[] = [];
  const buildGroup = async (project: { id: string; name: string } | null) => {
    const key = project ? `project:${project.id}` : `space:${input.spaceId}`;
    let canWrite = spaceAccess.role !== "viewer";
    let canManage = spaceAccess.role === "owner" || spaceAccess.role === "admin";
    if (project) {
      try {
        const projectAccess = await dependencies.assertCanWriteProject({ userId: input.userId, projectId: project.id });
        canWrite = true;
        canManage = canManage || projectAccess.role === "owner";
      } catch {
        canWrite = false;
      }
    }
    groups.push({
      key,
      label: project?.name ?? "空间文档",
      spaceId: input.spaceId,
      projectId: project?.id ?? null,
      canWrite,
      canManage,
      directories: directories
        .filter((directory) => directory.projectId === (project?.id ?? null))
        .map((directory) => ({
          id: directory.id,
          parentId: directory.parentId,
          name: directory.name,
          path: directory.path,
          sortOrder: directory.sortOrder,
        })),
      documents: readableDocuments
        .filter((document) => !document.deletedAt && document.projectId === (project?.id ?? null))
        .map((document) => ({
          id: document.id,
          groupKey: document.containerKey ?? key,
          directoryId: document.directoryId,
          title: document.title,
          path: document.path,
          sortOrder: document.sortOrder,
          deletedAt: document.deletedAt,
        })),
    });
  };
  if (!input.projectId) await buildGroup(null);
  for (const project of projects) await buildGroup(project);

  return {
    spaceId: input.spaceId,
    groups,
    trash: readableDocuments
      .filter((document) => Boolean(document.deletedAt))
      .map((document) => ({
        id: document.id,
        groupKey: document.containerKey
          ?? (document.projectId ? `project:${document.projectId}` : `space:${input.spaceId}`),
        directoryId: document.directoryId,
        title: document.title,
        path: document.path,
        sortOrder: document.sortOrder,
        deletedAt: document.deletedAt,
      })),
  };
}

export async function listWorkbenchDocumentTargetTree(input: {
  userId: string;
  spaceId: string;
  projectId?: string;
  dependencies?: Partial<WorkbenchDocumentDependencies>;
  db?: WorkbenchDocumentTreeDb;
}) {
  const dependencies = { ...DEFAULT_DOCUMENT_DEPENDENCIES, ...input.dependencies };
  if (input.projectId) {
    await dependencies.assertCanReadProject({
      userId: input.userId,
      projectId: input.projectId,
    });
  }

  const tree = await listWorkbenchDocumentTree({
    userId: input.userId,
    spaceId: input.spaceId,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.dependencies ? { dependencies: input.dependencies } : {}),
    ...(input.db ? { db: input.db } : {}),
  });
  const groupKey = input.projectId
    ? `project:${input.projectId}`
    : `space:${input.spaceId}`;
  const group = tree.groups.find((candidate) => candidate.key === groupKey);
  if (!group) {
    throw new Error(input.projectId ? "Invalid project space" : "Document tree not found");
  }

  return {
    spaceId: tree.spaceId,
    groups: [group],
    trash: tree.trash.filter((document) => document.groupKey === groupKey),
  };
}

export async function createWorkbenchDocumentDirectory(input: {
  userId: string;
  spaceId: string;
  projectId?: string;
  parentId?: string;
  name: string;
  dependencies?: Partial<WorkbenchDocumentDependencies>;
  db?: { project: { findUnique(args: unknown): Promise<{ id: string; spaceId: string | null } | null> } };
}) {
  const dependencies = { ...DEFAULT_DOCUMENT_DEPENDENCIES, ...input.dependencies };
  if (input.projectId) {
    await dependencies.assertCanWriteProject({ userId: input.userId, projectId: input.projectId });
    const db = input.db ?? prisma;
    const project = await db.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, spaceId: true },
    });
    if (!project || project.spaceId !== input.spaceId) {
      throw new Error("Invalid project space");
    }
  } else {
    await dependencies.assertCanWriteSpace({ userId: input.userId, spaceId: input.spaceId });
  }
  return dependencies.createDocumentDirectory({
    spaceId: input.spaceId,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    containerKey: input.projectId ? `project:${input.projectId}` : `space:${input.spaceId}`,
    ...(input.parentId ? { parentId: input.parentId } : {}),
    name: input.name,
    actorUserId: input.userId,
  });
}

export async function updateWorkbenchDocumentDirectory(input: {
  userId: string;
  directoryId: string;
  name?: string;
  parentId?: string | null;
  sortOrder?: number;
  dependencies?: Partial<WorkbenchDocumentDependencies>;
  db?: { documentDirectory: { findUnique(args: unknown): Promise<{ id: string; spaceId: string; projectId: string | null } | null> } };
}) {
  const dependencies = { ...DEFAULT_DOCUMENT_DEPENDENCIES, ...input.dependencies };
  const db = input.db ?? prisma;
  const directory = await db.documentDirectory.findUnique({
    where: { id: input.directoryId },
    select: { id: true, spaceId: true, projectId: true },
  });
  if (!directory) throw new Error("Document directory not found");
  if (directory.projectId) {
    await dependencies.assertCanWriteProject({ userId: input.userId, projectId: directory.projectId });
  } else {
    await dependencies.assertCanWriteSpace({ userId: input.userId, spaceId: directory.spaceId });
  }
  if (input.name !== undefined) {
    return dependencies.renameDocumentDirectory({
      directoryId: input.directoryId,
      name: input.name,
      actorUserId: input.userId,
    });
  }
  return dependencies.moveDocumentDirectory({
    directoryId: input.directoryId,
    parentId: input.parentId ?? null,
    sortOrder: input.sortOrder ?? 0,
    actorUserId: input.userId,
  });
}

export async function deleteWorkbenchDocumentDirectory(input: {
  userId: string;
  directoryId: string;
  dependencies?: Partial<WorkbenchDocumentDependencies>;
  db?: { documentDirectory: { findUnique(args: unknown): Promise<{ id: string; spaceId: string; projectId: string | null } | null> } };
}) {
  const dependencies = { ...DEFAULT_DOCUMENT_DEPENDENCIES, ...input.dependencies };
  const db = input.db ?? prisma;
  const directory = await db.documentDirectory.findUnique({
    where: { id: input.directoryId },
    select: { id: true, spaceId: true, projectId: true },
  });
  if (!directory) throw new Error("Document directory not found");
  if (directory.projectId) {
    await dependencies.assertCanWriteProject({ userId: input.userId, projectId: directory.projectId });
  } else {
    await dependencies.assertCanWriteSpace({ userId: input.userId, spaceId: directory.spaceId });
  }
  return dependencies.deleteDocumentDirectory({
    directoryId: input.directoryId,
    actorUserId: input.userId,
  });
}

export async function trashWorkbenchDocument(input: {
  userId: string;
  documentId: string;
  dependencies?: Partial<WorkbenchDocumentDependencies>;
}) {
  const dependencies = { ...DEFAULT_DOCUMENT_DEPENDENCIES, ...input.dependencies };
  await dependencies.assertCanWriteDocument({ userId: input.userId, documentId: input.documentId });
  return dependencies.softDeleteDocument({ documentId: input.documentId, actorUserId: input.userId });
}

export async function restoreWorkbenchDocument(input: {
  userId: string;
  documentId: string;
  directoryId?: string | null;
  path?: string;
  dependencies?: Partial<WorkbenchDocumentDependencies>;
}) {
  const dependencies = { ...DEFAULT_DOCUMENT_DEPENDENCIES, ...input.dependencies };
  await dependencies.assertCanWriteDocument({ userId: input.userId, documentId: input.documentId });
  return dependencies.restoreDocument({
    documentId: input.documentId,
    ...(input.directoryId !== undefined ? { directoryId: input.directoryId } : {}),
    ...(input.path ? { path: input.path } : {}),
    actorUserId: input.userId,
  });
}

export async function moveWorkbenchDocument(input: {
  userId: string;
  documentId: string;
  directoryId?: string | null;
  targetPath?: string;
  sortOrder?: number;
  dependencies?: Partial<WorkbenchDocumentDependencies>;
}) {
  const dependencies = { ...DEFAULT_DOCUMENT_DEPENDENCIES, ...input.dependencies };
  await dependencies.assertCanWriteDocument({ userId: input.userId, documentId: input.documentId });
  return dependencies.moveDocument({
    documentId: input.documentId,
    ...(input.targetPath
      ? { targetPath: input.targetPath }
      : { directoryId: input.directoryId ?? null }),
    sortOrder: input.sortOrder ?? 0,
    actorUserId: input.userId,
  });
}

export async function listWorkbenchDocumentRevisions(input: {
  documentId: string;
  userId: string;
  dependencies?: Partial<WorkbenchDocumentDependencies>;
  db?: {
    documentRevision: { findMany: typeof prisma.documentRevision.findMany };
  };
}): Promise<WorkbenchDocumentRevision[]> {
  const dependencies = { ...DEFAULT_DOCUMENT_DEPENDENCIES, ...input.dependencies };
  const db = input.db ?? prisma;

  await dependencies.assertCanReadDocument({
    userId: input.userId,
    documentId: input.documentId,
  });
  const revisions = (await db.documentRevision.findMany({
    where: { documentId: input.documentId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      documentId: true,
      version: true,
      contentMarkdown: true,
      source: true,
      createdAt: true,
      createdById: true,
    },
  })) as DocumentRevisionRow[];

  return revisions;
}

export async function createWorkbenchDocument(input: {
  spaceId?: string;
  projectId: string;
  userId: string;
  title: string;
  directoryId?: string;
  path: string;
  contentMarkdown: string;
  source: DocumentRevisionSource;
  dependencies?: Partial<WorkbenchDocumentDependencies>;
}) {
  const dependencies = { ...DEFAULT_DOCUMENT_DEPENDENCIES, ...input.dependencies };

  await dependencies.assertCanWriteProject({
    userId: input.userId,
    projectId: input.projectId,
    ...(input.directoryId ? { directoryId: input.directoryId } : {}),
  });

  return dependencies.createProjectDocument({
    ...(input.spaceId ? { spaceId: input.spaceId } : {}),
    projectId: input.projectId,
    ...(input.directoryId ? { directoryId: input.directoryId } : {}),
    title: input.title,
    path: input.path,
    contentMarkdown: input.contentMarkdown,
    actorUserId: input.userId,
    source: input.source,
  });
}

export async function createWorkbenchSpaceDocument(input: {
  spaceId: string;
  userId: string;
  title: string;
  directoryId?: string;
  path: string;
  contentMarkdown: string;
  source: DocumentRevisionSource;
  dependencies?: Partial<WorkbenchDocumentDependencies>;
}) {
  const dependencies = { ...DEFAULT_DOCUMENT_DEPENDENCIES, ...input.dependencies };

  await dependencies.assertCanWriteSpace({ userId: input.userId, spaceId: input.spaceId });

  return dependencies.createDocument({
    spaceId: input.spaceId,
    ...(input.directoryId ? { directoryId: input.directoryId } : {}),
    title: input.title,
    path: input.path,
    contentMarkdown: input.contentMarkdown,
    actorUserId: input.userId,
    source: input.source,
  });
}

export async function updateWorkbenchDocument(input: {
  documentId: string;
  userId: string;
  expectedVersion: number;
  title: string;
  contentMarkdown: string;
  source: DocumentRevisionSource;
  dependencies?: Partial<WorkbenchDocumentDependencies>;
}) {
  const dependencies = { ...DEFAULT_DOCUMENT_DEPENDENCIES, ...input.dependencies };

  await dependencies.assertCanWriteDocument({
    userId: input.userId,
    documentId: input.documentId,
  });

  return dependencies.updateDocument({
    documentId: input.documentId,
    expectedVersion: input.expectedVersion,
    title: input.title,
    contentMarkdown: input.contentMarkdown,
    actorUserId: input.userId,
    source: input.source,
  });
}

export async function updateWorkbenchDocumentIdempotently(input: {
  commandId: string;
  documentId: string;
  userId: string;
  expectedVersion: number;
  title: string;
  contentMarkdown: string;
  source: DocumentRevisionSource;
  dependencies?: Partial<WorkbenchDocumentDependencies>;
}) {
  const dependencies = { ...DEFAULT_DOCUMENT_DEPENDENCIES, ...input.dependencies };

  await dependencies.assertCanWriteDocument({
    userId: input.userId,
    documentId: input.documentId,
  });

  return dependencies.updateDocumentIdempotently({
    commandId: input.commandId,
    documentId: input.documentId,
    expectedVersion: input.expectedVersion,
    title: input.title,
    contentMarkdown: input.contentMarkdown,
    actorUserId: input.userId,
    source: input.source,
  });
}

export async function appendWorkbenchDocument(input: {
  documentId: string;
  userId: string;
  expectedVersion: number;
  title: string;
  contentMarkdown: string;
  source: DocumentRevisionSource;
  dependencies?: Partial<WorkbenchDocumentDependencies>;
}) {
  const dependencies = { ...DEFAULT_DOCUMENT_DEPENDENCIES, ...input.dependencies };

  await dependencies.assertCanWriteDocument({
    userId: input.userId,
    documentId: input.documentId,
  });

  return dependencies.appendDocument({
    documentId: input.documentId,
    expectedVersion: input.expectedVersion,
    title: input.title,
    contentMarkdown: input.contentMarkdown,
    actorUserId: input.userId,
    source: input.source,
  });
}
