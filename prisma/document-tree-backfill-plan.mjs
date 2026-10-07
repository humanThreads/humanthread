import { createHash } from "node:crypto";

export function buildDocumentDirectoryId(containerKey, path) {
  const digest = createHash("sha256")
    .update(`${containerKey}:${path}`)
    .digest("hex")
    .slice(0, 48);
  return `dir_${digest}`;
}

function normalizePath(path) {
  return path.trim().replace(/^\/+|\/+$/gu, "");
}

export function planDocumentTreeBackfill(input) {
  const directoriesByKey = new Map();
  const existingDirectoriesByKey = new Map(
    (input.directories ?? []).map((directory) => [
      `${directory.containerKey}:${normalizePath(directory.path)}`,
      directory,
    ]),
  );
  const assignments = [];
  const skippedDocumentIds = [];
  const errors = [];
  const documentsByContainer = new Map();

  for (const document of input.documents) {
    if (!document.spaceId || !document.containerKey) {
      errors.push({
        documentId: document.id,
        message: "Document ownership is incomplete",
      });
      continue;
    }

    const path = normalizePath(document.path);
    const segments = path.split("/");
    const directorySegments = segments.slice(0, -1);
    let parentId = null;
    let directoryPath = "";

    for (const segment of directorySegments) {
      directoryPath = directoryPath ? `${directoryPath}/${segment}` : segment;
      const key = `${document.containerKey}:${directoryPath}`;
      const existingDirectory = existingDirectoriesByKey.get(key);
      const id = existingDirectory?.id ?? buildDocumentDirectoryId(document.containerKey, directoryPath);
      if (!existingDirectory && !directoriesByKey.has(key)) {
        directoriesByKey.set(key, {
          id,
          spaceId: document.spaceId,
          projectId: document.projectId,
          containerKey: document.containerKey,
          parentId,
          name: segment,
          path: directoryPath,
          sortOrder: 0,
          createdById: document.createdById,
          updatedById: document.updatedById,
        });
      }
      parentId = id;
    }

    if (document.directoryId) {
      if (document.directoryId === parentId) {
        skippedDocumentIds.push(document.id);
      } else {
        errors.push({
          documentId: document.id,
          message: "Document directory conflicts with path",
        });
      }
      continue;
    }

    if (!parentId) {
      skippedDocumentIds.push(document.id);
      continue;
    }

    const containerDocuments = documentsByContainer.get(document.containerKey) ?? [];
    containerDocuments.push({ documentId: document.id, directoryId: parentId, path });
    documentsByContainer.set(document.containerKey, containerDocuments);
  }

  for (const containerDocuments of documentsByContainer.values()) {
    containerDocuments.sort((left, right) => left.path.localeCompare(right.path));
    containerDocuments.forEach((document, sortOrder) => {
      assignments.push({
        documentId: document.documentId,
        directoryId: document.directoryId,
        sortOrder,
      });
    });
  }

  const directories = [...directoriesByKey.values()].sort((left, right) => {
    const depthDifference = left.path.split("/").length - right.path.split("/").length;
    return depthDifference || left.path.localeCompare(right.path);
  });

  return { directories, assignments, skippedDocumentIds, errors };
}

export function summarizeDocumentTreeBackfill(plan) {
  return {
    directories: plan.directories.length,
    assignments: plan.assignments.length,
    skippedDocuments: plan.skippedDocumentIds.length,
    errors: plan.errors.length,
  };
}
