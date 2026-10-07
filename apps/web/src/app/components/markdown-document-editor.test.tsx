import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_EDITOR_MODES,
  MarkdownDocumentEditor,
  buildAttachmentMarkdown,
  getInitialDocumentEditorMode,
  getRestoredDocumentEditorMode,
  shouldAttachDiagramPreview,
} from "./markdown-document-editor";
import { getDocumentWorkspaceStorageKey } from "./document-workspace-state";

describe("MarkdownDocumentEditor", () => {
  const document = {
    id: "doc_1",
    title: "Guide",
    path: "guides/guide.md",
    contentMarkdown: "# Guide",
    version: 1,
  };

  it("exposes source split and preview modes", () => {
    expect(DOCUMENT_EDITOR_MODES).toEqual(["edit", "view"]);
    const markup = renderToStaticMarkup(
      <MarkdownDocumentEditor document={document} />,
    );
    expect(markup).toContain("查看");
    expect(markup).toContain("编辑");
    expect(markup).not.toContain("源码");
    expect(markup).not.toContain("分栏");
    expect(markup).not.toContain("预览");
    expect(markup).toContain("上传图片或附件");
    expect(markup).toContain("flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden");
    expect(markup).toContain("grid min-h-0 flex-1 overflow-hidden");
    expect(markup).toContain("h-full min-h-0 min-w-0 overflow-y-auto overscroll-contain");
    expect(markup).not.toContain("min-h-[560px]");
  });

  it("defaults every newly opened document to view", () => {
    expect(getInitialDocumentEditorMode()).toBe("view");
  });

  it("restores edit mode only for an in-place reload", () => {
    const storage = new Map<string, string>();
    const scopeKey = "project:project_1/doc_1";

    storage.set(getDocumentWorkspaceStorageKey(scopeKey), JSON.stringify({
      expandedDirectoryIds: [],
      mode: "edit",
    }));
    expect(getRestoredDocumentEditorMode(scopeKey, storage, true)).toBe("edit");
    expect(getRestoredDocumentEditorMode(scopeKey, storage, false)).toBe("view");
  });

  it("builds image and file markdown for protected attachments", () => {
    expect(
      buildAttachmentMarkdown({
        originalName: "diagram.png",
        mimeType: "image/png",
        markdownUrl: "/api/document-attachments/attachment_1",
      }),
    ).toBe("![diagram.png](/api/document-attachments/attachment_1)");
    expect(
      buildAttachmentMarkdown({
        originalName: "design.pdf",
        mimeType: "application/pdf",
        markdownUrl: "/api/document-attachments/attachment_2",
      }),
    ).toBe("[design.pdf](/api/document-attachments/attachment_2)");
  });

  it("marks XMind and Visio uploads for diagram preview", () => {
    expect(shouldAttachDiagramPreview({ originalName: "roadmap.xmind", mimeType: "application/vnd.xmind.workbook" })).toBe(true);
    expect(shouldAttachDiagramPreview({ originalName: "flow.vsdx", mimeType: "application/vnd.ms-visio.drawing" })).toBe(true);
    expect(shouldAttachDiagramPreview({ originalName: "guide.md", mimeType: "text/markdown" })).toBe(false);
  });
});
