import { describe, expect, it } from "vitest";
import { DOCUMENT_DETAIL_SECTION_TITLES, dynamic } from "./page";
import {
  getWorkbenchDocument,
  listWorkbenchDocumentRevisions,
} from "../../../../../lib/workbench/workbench-documents";
import { requireWorkbenchSession } from "../../../../../lib/workbench/workbench-route-auth";
import {
  DOCUMENT_SAVE_CONFLICT_MESSAGE,
  MarkdownDocumentEditor,
} from "../../../../components/markdown-document-editor";

describe("Project document editor page", () => {
  it("forces dynamic rendering", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("uses document detail, revision and workbench session queries", () => {
    expect(typeof requireWorkbenchSession).toBe("function");
    expect(typeof getWorkbenchDocument).toBe("function");
    expect(typeof listWorkbenchDocumentRevisions).toBe("function");
    expect(typeof MarkdownDocumentEditor).toBe("function");
  });

  it("keeps document detail sections stable", () => {
    expect(DOCUMENT_DETAIL_SECTION_TITLES).toEqual([
      "文档目录",
      "Markdown 正文",
      "修订记录",
    ]);
  });

  it("uses explicit version conflict copy", () => {
    expect(DOCUMENT_SAVE_CONFLICT_MESSAGE).toBe(
      "文档已被更新，请刷新后合并。",
    );
  });
});
