import type {
  WorkbenchDocumentDirectoryItem,
  WorkbenchDocumentTreeGroup,
  WorkbenchDocumentTreeItem,
} from "../../lib/workbench/workbench-documents";

export type DocumentTreeCommand =
  | { type: "create-directory"; groupKey: string; parentId: string | null }
  | { type: "create-document"; groupKey: string; directoryId: string | null }
  | { type: "rename-directory"; groupKey: string; directoryId: string }
  | { type: "move-directory"; groupKey: string; directoryId: string }
  | { type: "delete-directory"; groupKey: string; directoryId: string }
  | { type: "move-document"; groupKey: string; documentId: string }
  | { type: "trash-document"; groupKey: string; documentId: string }
  | { type: "restore-document"; groupKey: string; documentId: string }
  | { type: "reorder-directory"; groupKey: string; directoryId: string; direction: "up" | "down" }
  | { type: "reorder-document"; groupKey: string; documentId: string; direction: "up" | "down" }
  | { type: "manage-permission"; groupKey: string; targetId: string; targetType: "document" | "directory" };
  
  

export interface DocumentTreeCommandValues {
  name?: string;
  title?: string;
  filename?: string;
  directoryId?: string | null;
}

export interface DocumentTreeInteractionError {
  message: string;
  field?: "name" | "title" | "filename" | "directoryId";
  restoreConflict?: boolean;
}

export interface DocumentTreeData {
  spaceId: string;
  groups: WorkbenchDocumentTreeGroup[];
  trash: WorkbenchDocumentTreeItem[];
}

export interface DocumentDirectoryTarget {
  id: string | null;
  label: string;
  path: string | null;
}

export function normalizeMarkdownFilename(value: string) {
  const stem = value.trim().replace(/(?:\.md)+$/giu, "");
  return `${stem || "untitled"}.md`;
}

export function documentTitleToFilename(title: string) {
  const stem = title
    .trim()
    .replace(/\s+/gu, "-")
    .replace(/[\\/:*?"<>|]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
  return normalizeMarkdownFilename(stem || "untitled");
}

export function validateDirectoryName(value: string) {
  const name = value.trim();
  if (!name) return "请输入文件夹名称";
  if (/[\\/]/u.test(name)) return "文件夹名称不能包含路径分隔符";
  if (name === "." || name === "..") return "请输入有效的文件夹名称";
  return null;
}

export function validateDocumentDraft(input: { title: string; filename: string }) {
  const errors: { title?: string; filename?: string } = {};
  if (!input.title.trim()) errors.title = "请输入文档标题";
  const filename = input.filename.trim();
  if (!filename.toLowerCase().endsWith(".md")) {
    errors.filename = "文件名必须以 .md 结尾";
  } else if (/[\\/]/u.test(filename) || filename === ".md") {
    errors.filename = "请输入有效的 Markdown 文件名";
  }
  return errors;
}

export function buildDocumentPath(input: {
  directoryPath: string | null;
  filename: string;
}) {
  return input.directoryPath
    ? `${input.directoryPath}/${input.filename}`
    : input.filename;
}

function collectDescendantIds(
  directories: WorkbenchDocumentDirectoryItem[],
  sourceDirectoryId: string,
) {
  const excluded = new Set([sourceDirectoryId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const directory of directories) {
      if (directory.parentId && excluded.has(directory.parentId) && !excluded.has(directory.id)) {
        excluded.add(directory.id);
        changed = true;
      }
    }
  }
  return excluded;
}

export function listLegalDirectoryTargets(input: {
  group: WorkbenchDocumentTreeGroup;
  sourceDirectoryId?: string;
}) {
  const excluded = input.sourceDirectoryId
    ? collectDescendantIds(input.group.directories, input.sourceDirectoryId)
    : new Set<string>();
  return [
    { id: null, label: `${input.group.label} 根目录`, path: null },
    ...input.group.directories
      .filter((directory) => !excluded.has(directory.id))
      .map((directory) => ({
        id: directory.id,
        label: directory.path,
        path: directory.path,
      })),
  ] satisfies DocumentDirectoryTarget[];
}

function jsonRequest(method: string, body?: object): RequestInit {
  return {
    method,
    ...(body
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  };
}

function requireGroup(tree: DocumentTreeData, groupKey: string) {
  const group = tree.groups.find((item) => item.key === groupKey);
  if (!group) throw new Error("Document tree group not found");
  return group;
}

function findDirectory(group: WorkbenchDocumentTreeGroup, directoryId: string | null | undefined) {
  if (!directoryId) return null;
  const directory = group.directories.find((item) => item.id === directoryId);
  if (!directory) throw new Error("Document directory not found");
  return directory;
}

function requireDirectory(group: WorkbenchDocumentTreeGroup, directoryId: string) {
  return findDirectory(group, directoryId) ?? (() => {
    throw new Error("Document directory not found");
  })();
}

function requireDocument(group: WorkbenchDocumentTreeGroup, documentId: string) {
  const document = group.documents.find((item) => item.id === documentId);
  if (!document) throw new Error("Document not found");
  return document;
}

export function buildDocumentTreeRequest(input: {
  command: DocumentTreeCommand;
  values: DocumentTreeCommandValues;
  tree: DocumentTreeData;
}) {
  const { command, values, tree } = input;
  const group = requireGroup(tree, command.groupKey);
  switch (command.type) {
    case "create-directory":
      return {
        path: `/api/spaces/${encodeURIComponent(tree.spaceId)}/document-tree`,
        init: jsonRequest("POST", {
          name: values.name?.trim() ?? "",
          projectId: group.projectId,
          parentId: command.parentId,
        }),
      };
    case "manage-permission":
      return { path: "/api/documents/permissions", init: jsonRequest("GET") };
    case "create-document": {
      const endpoint = group.projectId
        ? `/api/projects/${encodeURIComponent(group.projectId)}/documents`
        : `/api/spaces/${encodeURIComponent(tree.spaceId)}/documents`;
      const title = values.title?.trim() ?? "";
      return {
        path: endpoint,
        init: jsonRequest("POST", {
          title,
          path: values.filename?.trim() ?? "",
          contentMarkdown: `# ${title}\n`,
          directoryId: command.directoryId,
        }),
      };
    }
    case "rename-directory":
      return {
        path: `/api/document-directories/${encodeURIComponent(command.directoryId)}`,
        init: jsonRequest("PATCH", { name: values.name?.trim() ?? "" }),
      };
    case "move-directory":
      return {
        path: `/api/document-directories/${encodeURIComponent(command.directoryId)}`,
        init: jsonRequest("PATCH", {
          parentId: values.directoryId ?? null,
          sortOrder: 0,
        }),
      };
    case "delete-directory":
      return {
        path: `/api/document-directories/${encodeURIComponent(command.directoryId)}`,
        init: jsonRequest("DELETE"),
      };
    case "move-document":
      return {
        path: `/api/documents/${encodeURIComponent(command.documentId)}`,
        init: jsonRequest("PATCH", {
          operation: "move",
          directoryId: values.directoryId ?? null,
          sortOrder: 0,
        }),
      };
    case "trash-document":
      return {
        path: `/api/documents/${encodeURIComponent(command.documentId)}`,
        init: jsonRequest("PATCH", { operation: "trash" }),
      };
    case "restore-document": {
      const hasOverride = values.filename !== undefined || values.directoryId !== undefined;
      const directory = hasOverride ? findDirectory(group, values.directoryId) : null;
      return {
        path: `/api/documents/${encodeURIComponent(command.documentId)}`,
        init: jsonRequest("PATCH", {
          operation: "restore",
          ...(hasOverride
            ? {
                directoryId: values.directoryId ?? null,
                path: buildDocumentPath({
                  directoryPath: directory?.path ?? null,
                  filename: values.filename?.trim() ?? "",
                }),
              }
            : {}),
        }),
      };
    }
    case "reorder-directory": {
      const directory = requireDirectory(group, command.directoryId);
      return {
        path: `/api/document-directories/${encodeURIComponent(command.directoryId)}`,
        init: jsonRequest("PATCH", {
          parentId: directory.parentId,
          sortOrder: directory.sortOrder + (command.direction === "up" ? -1000 : 1000),
        }),
      };
    }
    case "reorder-document": {
      const document = requireDocument(group, command.documentId);
      return {
        path: `/api/documents/${encodeURIComponent(command.documentId)}`,
        init: jsonRequest("PATCH", {
          operation: "move",
          directoryId: document.directoryId,
          sortOrder: document.sortOrder + (command.direction === "up" ? -1000 : 1000),
        }),
      };
    }
  }
}

export function mapDocumentTreeError(message: string): DocumentTreeInteractionError {
  if (/not empty/iu.test(message)) {
    return { message: "该文件夹仍包含内容，请先移动或删除其中的项目。" };
  }
  if (/restore path conflict/iu.test(message)) {
    return {
      message: "原位置已有同名文档，请选择新位置或修改文件名。",
      field: "filename",
      restoreConflict: true,
    };
  }
  if (/cycle/iu.test(message)) {
    return { message: "文件夹不能移动到自身或其子文件夹中。", field: "directoryId" };
  }
  if (/crosses containers|same container/iu.test(message)) {
    return { message: "目录和文档只能在同一空间或项目内移动。", field: "directoryId" };
  }
  if (/conflict|unique|already exists/iu.test(message)) {
    return { message: "当前位置已存在同名项目，请修改名称后重试。", field: "name" };
  }
  if (/access denied|write access|permission/iu.test(message)) {
    return { message: "你没有执行此操作的权限。" };
  }
  if (/authentication|required|session/iu.test(message)) {
    return { message: "登录状态已失效，请重新登录后重试。" };
  }
  if (/invalid response|network|fetch/iu.test(message)) {
    return { message: "网络请求失败，请检查连接后重试。" };
  }
  return { message: "文档目录操作失败，请稍后重试。" };
}
