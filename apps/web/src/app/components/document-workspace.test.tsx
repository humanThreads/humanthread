import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DocumentWorkspace } from "./document-workspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("DocumentWorkspace", () => {
  it("composes tree editor and revision metadata", () => {
    const markup = renderToStaticMarkup(
      <DocumentWorkspace
        tree={{ spaceId: "space_1", groups: [], trash: [] }}
        document={{
          id: "doc_1",
          title: "Guide",
          path: "guide.md",
          contentMarkdown: "# Guide",
          version: 2,
        }}
        canWrite
        revisions={[{
          id: "revision_2",
          documentId: "doc_1",
          version: 2,
          contentMarkdown: "# Historical Guide",
          source: "web",
          createdAt: new Date("2026-07-19T00:00:00Z"),
          createdById: "user_1",
        }]}
      />,
    );
    expect(markup).toContain("文档目录");
    expect(markup).toContain("修订记录展开栏");
    expect(markup).toContain("打开修订记录");
    expect(markup).toContain("上传图片或附件");
    expect(markup).toContain("relative grid h-full min-h-0 items-stretch overflow-hidden bg-white");
    expect(markup).toContain("grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)]");
    expect(markup).toContain("lg:grid-cols-[280px_minmax(0,1fr)]");
    expect(markup).toContain("xl:grid-cols-[280px_minmax(0,1fr)_44px]");
    expect(markup).toContain("h-full min-h-full self-stretch flex-col overflow-hidden border-r border-[#d0d7de] bg-[#f6f8fa] lg:flex");
    expect(markup).toContain("flex h-full min-h-0 min-w-0 overflow-hidden");
    expect(markup).toContain("收起文档目录");
    expect(markup).not.toContain("收起修订记录");
    expect(markup).not.toContain("查看版本 v2");
    expect(markup).not.toContain("min-h-[680px]");
    expect(markup).not.toContain("overflow-hidden border-y border-[#d0d7de] bg-white");
  });

  it("tracks server tree changes instead of freezing the initial tree", () => {
    const source = readFileSync(new URL("./document-workspace.tsx", import.meta.url), "utf8");

    expect(source).toContain("tree: serverTree");
    expect(source).toContain("function useServerTree(serverTree");
    expect(source).toContain("trackedTree !== serverTree");
  });
});
