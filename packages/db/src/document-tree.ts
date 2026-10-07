import { randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { isPrismaUniqueConstraintError } from "./prisma-errors";

export interface DocumentTreeDirectoryRow {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  sortOrder: number;
}

export interface DocumentTreeDocumentRow {
  id: string;
  directoryId: string | null;
  title: string;
  path: string;
  sortOrder: number;
}

export type DocumentTreeNode =
  | (DocumentTreeDirectoryRow & { type: "directory"; children: DocumentTreeNode[] })
  | (DocumentTreeDocumentRow & { type: "document" });

type DocumentTreeTransactionClient = {
  documentDirectory: {
    findUnique(input: unknown): Promise<any>;
    findMany?(input: unknown): Promise<any[]>;
    count(input: unknown): Promise<number>;
    create?(input: unknown): Promise<any>;
    upsert?(input: unknown): Promise<any>;
    update(input: unknown): Promise<any>;
    updateMany(input: unknown): Promise<any>;
    delete(input: unknown): Promise<any>;
  };
  document: {
    findUnique(input: unknown): Promise<any>;
    findMany?(input: unknown): Promise<any[]>;
    count(input: unknown): Promise<number>;
    update(input: unknown): Promise<any>;
    updateMany(input: unknown): Promise<any>;
  };
};

type DocumentDirectoryResolverTransaction = {
  documentDirectory: {
    findUnique(input: unknown): Promise<{ id: string; path: string } | null>;
    upsert(input: unknown): Promise<{ id: string; path: string }>;
  };
};

type DocumentTreeDb = DocumentTreeTransactionClient & {
  $transaction<T>(callback: (tx: DocumentTreeTransactionClient) => Promise<T>): Promise<T>;
};

function compareTreeItems(left: { sortOrder: number; path: string }, right: { sortOrder: number; path: string }) {
  return left.sortOrder - right.sortOrder || left.path.localeCompare(right.path);
}

export function buildDocumentTree(input: {
  directories: DocumentTreeDirectoryRow[];
  documents: DocumentTreeDocumentRow[];
}): DocumentTreeNode[] {
  const directoryNodes = new Map<string, Extract<DocumentTreeNode, { type: "directory" }>>();
  const roots: DocumentTreeNode[] = [];

  for (const directory of [...input.directories].sort(compareTreeItems)) {
    directoryNodes.set(directory.id, { ...directory, type: "directory", children: [] });
  }

  for (const directory of [...input.directories].sort(compareTreeItems)) {
    const node = directoryNodes.get(directory.id)!;
    const parent = directory.parentId ? directoryNodes.get(directory.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  for (const document of [...input.documents].sort(compareTreeItems)) {
    const node: DocumentTreeNode = { ...document, type: "document" };
    const parent = document.directoryId ? directoryNodes.get(document.directoryId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortChildren = (nodes: DocumentTreeNode[]) => {
    nodes.sort(compareTreeItems);
    for (const node of nodes) if (node.type === "directory") sortChildren(node.children);
  };
  sortChildren(roots);
  return roots;
}

export function normalizeDocumentDirectoryName(name: string): string {
  const normalized = name.trim().replace(/\s+/gu, " ");
  if (!normalized || normalized === "." || normalized === ".." || /[\\/]/u.test(normalized)) {
    throw new Error("Invalid document directory name");
  }
  return normalized;
}

export interface ParsedDocumentPath {
  path: string;
  fileName: string;
  directorySegments: string[];
}

export function parseDocumentPath(path: string): ParsedDocumentPath {
  const normalized = path.trim();
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.endsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.includes("\\")
  ) {
    throw new Error("Invalid document path");
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Invalid document path");
  }

  const fileName = segments.at(-1)!;
  if (!fileName.endsWith(".md")) {
    throw new Error("Document path must end with .md");
  }

  const directorySegments = segments
    .slice(0, -1)
    .map(normalizeDocumentDirectoryName);

  return {
    path: [...directorySegments, fileName].join("/"),
    fileName,
    directorySegments,
  };
}

export async function resolveDocumentDirectoryPath(input: {
  tx: DocumentDirectoryResolverTransaction;
  spaceId: string;
  projectId?: string | null;
  containerKey: string;
  directorySegments: string[];
  actorUserId: string;
  createId?: () => string;
}): Promise<string | null> {
  let parentId: string | null = null;
  let path = "";

  for (const rawSegment of input.directorySegments) {
    const name = normalizeDocumentDirectoryName(rawSegment);
    path = path ? `${path}/${name}` : name;
    const uniqueWhere = {
      containerKey_path: {
        containerKey: input.containerKey,
        path,
      },
    };
    let directory: { id: string; path: string } | null;
    try {
      directory = await input.tx.documentDirectory.upsert({
        where: uniqueWhere,
        create: {
          id: input.createId?.() ?? `dir_${randomUUID()}`,
          spaceId: input.spaceId,
          projectId: input.projectId ?? null,
          containerKey: input.containerKey,
          parentId,
          name,
          path,
          sortOrder: 0,
          createdById: input.actorUserId,
          updatedById: input.actorUserId,
        },
        update: {},
        select: { id: true, path: true },
      });
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) {
        throw error;
      }
      directory = await input.tx.documentDirectory.findUnique({
        where: uniqueWhere,
        select: { id: true, path: true },
      });
      if (!directory) {
        throw error;
      }
    }
    parentId = directory.id;
  }

  return parentId;
}

function joinDirectoryPath(parentPath: string | null, name: string) {
  return parentPath ? `${parentPath}/${name}` : name;
}

export async function createDocumentDirectory(input: {
  db?: DocumentTreeDb;
  spaceId: string;
  projectId?: string;
  containerKey: string;
  parentId?: string;
  name: string;
  sortOrder?: number;
  actorUserId: string;
  createId?: () => string;
}) {
  const db = input.db ?? (prisma as unknown as DocumentTreeDb);
  const name = normalizeDocumentDirectoryName(input.name);
  return db.$transaction(async (tx) => {
    const parent = input.parentId
      ? await tx.documentDirectory.findUnique({ where: { id: input.parentId } })
      : null;
    if (parent && parent.containerKey !== input.containerKey) {
      throw new Error("Document tree move crosses containers");
    }
    return tx.documentDirectory.create!({
      data: {
        id: input.createId?.() ?? `dir_${randomUUID()}`,
        spaceId: input.spaceId,
        projectId: input.projectId ?? null,
        containerKey: input.containerKey,
        parentId: parent?.id ?? null,
        name,
        path: joinDirectoryPath(parent?.path ?? null, name),
        sortOrder: input.sortOrder ?? 0,
        createdById: input.actorUserId,
        updatedById: input.actorUserId,
      },
    });
  });
}

async function relocateDirectory(input: {
  tx: DocumentTreeTransactionClient;
  directory: any;
  parent: any | null;
  name: string;
  sortOrder: number;
  actorUserId: string;
}) {
  const oldPath = input.directory.path;
  const newPath = joinDirectoryPath(input.parent?.path ?? null, input.name);
  const descendants = await input.tx.documentDirectory.findMany?.({
    where: { containerKey: input.directory.containerKey, path: { startsWith: `${oldPath}/` } },
    orderBy: { path: "asc" },
  }) ?? [];
  const documents = await input.tx.document.findMany?.({
    where: {
      containerKey: input.directory.containerKey,
      deletedAt: null,
      OR: [{ directoryId: input.directory.id }, { path: { startsWith: `${oldPath}/` } }],
    },
  }) ?? [];

  await input.tx.documentDirectory.update({
    where: { id: input.directory.id },
    data: {
      parentId: input.parent?.id ?? null,
      name: input.name,
      path: newPath,
      sortOrder: input.sortOrder,
      updatedById: input.actorUserId,
    },
  });
  for (const descendant of descendants) {
    await input.tx.documentDirectory.update({
      where: { id: descendant.id },
      data: { path: `${newPath}${descendant.path.slice(oldPath.length)}`, updatedById: input.actorUserId },
    });
  }
  for (const document of documents) {
    await input.tx.document.update({
      where: { id: document.id },
      data: { path: `${newPath}${document.path.slice(oldPath.length)}`, updatedById: input.actorUserId },
    });
  }
  return { id: input.directory.id, path: newPath };
}

export async function renameDocumentDirectory(input: {
  db?: DocumentTreeDb;
  directoryId: string;
  name: string;
  actorUserId: string;
}) {
  const db = input.db ?? (prisma as unknown as DocumentTreeDb);
  const name = normalizeDocumentDirectoryName(input.name);
  return db.$transaction(async (tx) => {
    const directory = await tx.documentDirectory.findUnique({ where: { id: input.directoryId } });
    if (!directory) throw new Error("Document directory not found");
    const parent = directory.parentId
      ? await tx.documentDirectory.findUnique({ where: { id: directory.parentId } })
      : null;
    return relocateDirectory({ tx, directory, parent, name, sortOrder: directory.sortOrder, actorUserId: input.actorUserId });
  });
}

export async function moveDocumentDirectory(input: {
  db?: DocumentTreeDb;
  directoryId: string;
  parentId?: string | null;
  sortOrder: number;
  actorUserId: string;
}) {
  const db = input.db ?? (prisma as unknown as DocumentTreeDb);
  return db.$transaction(async (tx) => {
    const directory = await tx.documentDirectory.findUnique({ where: { id: input.directoryId } });
    if (!directory) throw new Error("Document directory not found");
    const parent = input.parentId
      ? await tx.documentDirectory.findUnique({ where: { id: input.parentId } })
      : null;
    if (input.parentId && !parent) throw new Error("Document directory parent not found");
    if (parent && parent.containerKey !== directory.containerKey) {
      throw new Error("Document tree move crosses containers");
    }
    if (parent && (parent.id === directory.id || parent.path.startsWith(`${directory.path}/`))) {
      throw new Error("Document directory cycle");
    }
    return relocateDirectory({
      tx,
      directory,
      parent,
      name: directory.name,
      sortOrder: input.sortOrder,
      actorUserId: input.actorUserId,
    });
  });
}

export async function deleteDocumentDirectory(input: {
  db?: DocumentTreeDb;
  directoryId: string;
  actorUserId: string;
}) {
  const db = input.db ?? (prisma as unknown as DocumentTreeDb);
  return db.$transaction(async (tx) => {
    const directory = await tx.documentDirectory.findUnique({ where: { id: input.directoryId } });
    if (!directory) throw new Error("Document directory not found");
    const [childDirectories, childDocuments] = await Promise.all([
      tx.documentDirectory.count({ where: { parentId: input.directoryId } }),
      tx.document.count({ where: { directoryId: input.directoryId } }),
    ]);
    if (childDirectories || childDocuments) throw new Error("Document directory is not empty");
    await tx.documentDirectory.delete({ where: { id: input.directoryId } });
    return { id: input.directoryId };
  });
}

export async function moveDocument(input: {
  db?: DocumentTreeDb;
  documentId: string;
  directoryId?: string | null;
  targetPath?: string;
  sortOrder: number;
  actorUserId: string;
}) {
  const db = input.db ?? (prisma as unknown as DocumentTreeDb);
  const target = input.targetPath ? parseDocumentPath(input.targetPath) : null;
  try {
    return await db.$transaction(async (tx) => {
      const document = await tx.document.findUnique({ where: { id: input.documentId } });
      if (!document) throw new Error("Document not found");
      let directoryId: string | null;
      let path: string;

      if (target) {
        if (!document.spaceId || !document.containerKey) {
          throw new Error("Document has no space");
        }
        directoryId = await resolveDocumentDirectoryPath({
          tx: tx as DocumentDirectoryResolverTransaction,
          spaceId: document.spaceId,
          projectId: document.projectId,
          containerKey: document.containerKey,
          directorySegments: target.directorySegments,
          actorUserId: input.actorUserId,
        });
        path = target.path;
      } else {
        const directory = input.directoryId
          ? await tx.documentDirectory.findUnique({ where: { id: input.directoryId } })
          : null;
        if (directory && directory.containerKey !== document.containerKey) {
          throw new Error("Document tree move crosses containers");
        }
        const fileName = document.path.split("/").at(-1)!;
        directoryId = directory?.id ?? null;
        path = directory ? `${directory.path}/${fileName}` : fileName;
      }

      return tx.document.update({
        where: { id: document.id },
        data: {
          directoryId,
          path,
          sortOrder: input.sortOrder,
          updatedById: input.actorUserId,
        },
      });
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      throw new Error("Document path conflict");
    }
    throw error;
  }
}

export async function softDeleteDocument(input: {
  db?: DocumentTreeDb;
  documentId: string;
  actorUserId: string;
  now?: Date;
}) {
  const db = input.db ?? (prisma as unknown as DocumentTreeDb);
  return db.$transaction(async (tx) => {
    const document = await tx.document.findUnique({ where: { id: input.documentId } });
    if (!document) throw new Error("Document not found");
    if (document.deletedAt) return { id: document.id };
    return tx.document.update({
      where: { id: document.id },
      data: {
        path: `.trash/${document.id}.md`,
        directoryId: null,
        deletedAt: input.now ?? new Date(),
        deletedById: input.actorUserId,
        deletedFromPath: document.path,
        deletedFromDirectoryId: document.directoryId,
        updatedById: input.actorUserId,
      },
    });
  });
}

export async function restoreDocument(input: {
  db?: DocumentTreeDb;
  documentId: string;
  directoryId?: string | null;
  path?: string;
  actorUserId: string;
}) {
  const db = input.db ?? (prisma as unknown as DocumentTreeDb);
  return db.$transaction(async (tx) => {
    const document = await tx.document.findUnique({ where: { id: input.documentId } });
    if (!document) throw new Error("Document not found");
    if (!document.deletedAt) return { id: document.id };
    const path = input.path ?? document.deletedFromPath;
    const directoryId = input.directoryId === undefined
      ? document.deletedFromDirectoryId
      : input.directoryId;
    if (!path) throw new Error("Document restore path is required");
    const conflictCount = await tx.document.count({
      where: { containerKey: document.containerKey, path, id: { not: document.id } },
    });
    if (conflictCount) throw new Error("Document restore path conflict");
    return tx.document.update({
      where: { id: document.id },
      data: {
        path,
        directoryId: directoryId ?? null,
        deletedAt: null,
        deletedById: null,
        deletedFromPath: null,
        deletedFromDirectoryId: null,
        updatedById: input.actorUserId,
      },
    });
  });
}
