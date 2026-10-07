import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DocumentTree, DOCUMENT_TREE_GROUP_LABELS } from "./document-tree";
import { DocumentProjectSwitcher } from "./document-project-switcher";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("DocumentTree", () => {
  it("renders space, project and trash groups", () => {
    const markup = renderToStaticMarkup(
      <DocumentTree
        spaceId="space_1"
        activeDocumentId="doc_1"
        groups={[
          {
            key: "space:space_1",
            label: "空间文档",
            spaceId: "space_1",
            projectId: null,
            canWrite: true,
            directories: [],
            documents: [{ id: "doc_1", groupKey: "space:space_1", directoryId: null, title: "Home", path: "home.md", sortOrder: 0, deletedAt: null }],
          },
          {
            key: "project:project_1",
            label: "Platform",
            spaceId: "space_1",
            projectId: "project_1",
            canWrite: false,
            directories: [],
            documents: [],
          },
        ]}
        trash={[]}
      />,
    );
    expect(DOCUMENT_TREE_GROUP_LABELS).toEqual(["空间文档", "项目文档", "回收站"]);
    expect(markup).toContain("空间文档");
    expect(markup).toContain("Platform");
    expect(markup).toContain("回收站");
    expect(markup).toContain("Home");
    expect(markup).toContain("Home的更多操作");
    expect(markup).toContain("overflow-y-auto overscroll-contain");
    expect(markup).toContain("relative flex h-full min-h-0 w-full flex-1 flex-col");
    expect(markup).toContain("展开回收站");
    expect(markup).not.toContain("window.prompt");
  });

  it("renders the project switcher in the directory header", () => {
    const markup = renderToStaticMarkup(
      <DocumentTree
        spaceId="space_1"
        groups={[]}
        trash={[]}
        projectSwitcher={<DocumentProjectSwitcher projects={[{ id: "project_1", name: "项目一" }]} selectedProjectId="project_1" companyDocumentsHref="/documents" />}
      />,
    );
    expect(markup.indexOf("文档目录")).toBeLessThan(markup.indexOf("当前项目"));
    expect(markup).toContain('id="document-project-select"');
  });

  it("hides mutation controls for read-only groups", () => {
    const markup = renderToStaticMarkup(
      <DocumentTree
        spaceId="space_1"
        groups={[{
          key: "project:project_1",
          label: "Read only",
          spaceId: "space_1",
          projectId: "project_1",
          canWrite: false,
          directories: [],
          documents: [],
        }]}
        trash={[]}
      />,
    );
    expect(markup).not.toContain("新建目录");
    expect(markup).not.toContain("新建文档");
    expect(markup).not.toContain("更多操作");
  });

  it("starts every directory collapsed", () => {
    const markup = renderToStaticMarkup(
      <DocumentTree
        spaceId="space_1"
        groups={[{
          key: "space:space_1",
          label: "空间文档",
          spaceId: "space_1",
          projectId: null,
          canWrite: false,
          directories: [{ id: "directory_1", parentId: null, name: "设计", path: "设计", sortOrder: 0 }],
          documents: [],
        }]}
        trash={[]}
      />,
    );
    expect(markup).toContain('role="treeitem" aria-expanded="false"');
  });

  it("does not use browser-native prompt or confirm interactions", () => {
    const source = readFileSync(new URL("./document-tree.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("window.prompt");
    expect(source).not.toContain("window.confirm");
  });
});
