import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DocumentRevisionPanel } from "./document-revision-panel";

const revisions = [{
  id: "revision_2",
  documentId: "doc_1",
  version: 2,
  contentMarkdown: "# Historical Guide",
  source: "web",
  createdAt: new Date("2026-07-21T00:00:00.000Z"),
  createdById: "user_1",
}];

describe("DocumentRevisionPanel", () => {
  it("renders revision list controls", () => {
    const markup = renderToStaticMarkup(
      <DocumentRevisionPanel
        revisions={revisions}
        open
        mobileOpen={false}
        selectedRevisionId={null}
        onOpenChange={vi.fn()}
        onMobileOpenChange={vi.fn()}
        onSelectRevision={vi.fn()}
      />,
    );

    expect(markup).toContain("修订记录");
    expect(markup).toContain("收起修订记录");
    expect(markup).toContain("查看版本 v2");
  });

  it("renders selected historical markdown as read-only", () => {
    const markup = renderToStaticMarkup(
      <DocumentRevisionPanel
        revisions={revisions}
        open
        mobileOpen={false}
        selectedRevisionId="revision_2"
        onOpenChange={vi.fn()}
        onMobileOpenChange={vi.fn()}
        onSelectRevision={vi.fn()}
      />,
    );

    expect(markup).toContain("只读历史版本");
    expect(markup).toContain("返回修订列表");
    expect(markup).toContain("Historical Guide");
  });
});
