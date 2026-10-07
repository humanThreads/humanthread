import { describe, expect, it } from "vitest";
import type { WorkbenchDocumentTreeGroup } from "../../lib/workbench/workbench-documents";
import {
  buildDocumentPath,
  buildDocumentTreeRequest,
  documentTitleToFilename,
  listLegalDirectoryTargets,
  mapDocumentTreeError,
  normalizeMarkdownFilename,
  validateDirectoryName,
  validateDocumentDraft,
} from "./document-tree-interactions";

const group: WorkbenchDocumentTreeGroup = {
  key: "project:project_1",
  label: "Alpha",
  spaceId: "space_1",
  projectId: "project_1",
  canWrite: true,
  directories: [
    { id: "dir_parent", parentId: null, name: "产品", path: "产品", sortOrder: 0 },
    { id: "dir_child", parentId: "dir_parent", name: "需求", path: "产品/需求", sortOrder: 0 },
    { id: "dir_sibling", parentId: null, name: "发布", path: "发布", sortOrder: 1000 },
  ],
  documents: [
    { id: "doc_1", groupKey: "project:project_1", directoryId: "dir_parent", title: "说明", path: "产品/readme.md", sortOrder: 0, deletedAt: null },
  ],
};

const tree = { spaceId: "space_1", groups: [group], trash: [] };

describe("document tree interaction model", () => {
  it("builds normalized markdown filenames without duplicate suffixes", () => {
    expect(documentTitleToFilename("需求 评审记录")).toBe("需求-评审记录.md");
    expect(normalizeMarkdownFilename("review.MD.md")).toBe("review.md");
  });

  it("validates directory and document fields", () => {
    expect(validateDirectoryName("docs/api")).toBe("文件夹名称不能包含路径分隔符");
    expect(validateDirectoryName("  ")).toBe("请输入文件夹名称");
    expect(validateDocumentDraft({ title: "", filename: "readme.txt" })).toEqual({
      title: "请输入文档标题",
      filename: "文件名必须以 .md 结尾",
    });
  });

  it("builds the final path from directory and filename", () => {
    expect(buildDocumentPath({ directoryPath: "产品设计", filename: "review.md" }))
      .toBe("产品设计/review.md");
    expect(buildDocumentPath({ directoryPath: null, filename: "review.md" }))
      .toBe("review.md");
  });

  it("excludes a directory and descendants from move targets", () => {
    expect(
      listLegalDirectoryTargets({ group, sourceDirectoryId: "dir_parent" })
        .map((target) => target.id),
    ).toEqual([null, "dir_sibling"]);
  });

  it("builds the same document move request used by menu and drag actions", () => {
    const request = buildDocumentTreeRequest({
      command: { type: "move-document", groupKey: group.key, documentId: "doc_1" },
      values: { directoryId: "dir_sibling" },
      tree,
    });

    expect(request.path).toBe("/api/documents/doc_1");
    expect(request.init.method).toBe("PATCH");
    expect(JSON.parse(String(request.init.body))).toEqual({
      operation: "move",
      directoryId: "dir_sibling",
      sortOrder: 0,
    });
  });

  it("builds create and conflict-resolving restore requests", () => {
    const create = buildDocumentTreeRequest({
      command: { type: "create-document", groupKey: group.key, directoryId: "dir_parent" },
      values: { title: "评审", filename: "review.md" },
      tree,
    });
    expect(create.path).toBe("/api/projects/project_1/documents");
    expect(JSON.parse(String(create.init.body))).toMatchObject({
      title: "评审",
      path: "review.md",
      directoryId: "dir_parent",
      contentMarkdown: "# 评审\n",
    });

    const restore = buildDocumentTreeRequest({
      command: { type: "restore-document", groupKey: group.key, documentId: "doc_1" },
      values: { directoryId: "dir_sibling", filename: "restored.md" },
      tree,
    });
    expect(JSON.parse(String(restore.init.body))).toEqual({
      operation: "restore",
      directoryId: "dir_sibling",
      path: "发布/restored.md",
    });
  });

  it("maps backend conflicts to stable product feedback", () => {
    expect(mapDocumentTreeError("Document directory is not empty")).toEqual({
      message: "该文件夹仍包含内容，请先移动或删除其中的项目。",
    });
    expect(mapDocumentTreeError("Document restore path conflict")).toEqual({
      message: "原位置已有同名文档，请选择新位置或修改文件名。",
      field: "filename",
      restoreConflict: true,
    });
  });
});
