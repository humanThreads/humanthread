// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentWorkspace } from "./document-workspace";
import {
  getDocumentWorkspaceStorageKey,
  writeDocumentWorkspaceNavigation,
} from "./document-workspace-state";

const treeMounts = vi.hoisted(() => ({ count: 0, onDocumentSelect: null as ((id: string) => void) | null, onCollapse: null as (() => void) | null }));

vi.mock("./document-tree", () => ({
  DocumentTree: ({ activeDocumentId, onDocumentSelect, onCollapse }: { activeDocumentId?: string; onDocumentSelect?: (id: string) => void; onCollapse?: () => void }) => {
    useState(() => {
      treeMounts.count += 1;
      return null;
    });
    treeMounts.onDocumentSelect = onDocumentSelect ?? null;
    treeMounts.onCollapse = onCollapse ?? null;
    return <nav aria-label="文档目录"><span data-testid="active-document">{activeDocumentId ?? "none"}</span><button type="button" onClick={() => onDocumentSelect?.("doc_2")}>打开第二篇</button>{onCollapse ? <button type="button" onClick={onCollapse}>收起目录</button> : null}</nav>;
  },
}));

vi.mock("./markdown-document-editor", () => ({
  MarkdownDocumentEditor: ({ workspaceActions }: { workspaceActions?: ReactNode }) => (
    <section><div>{workspaceActions}</div><div>当前正文</div></section>
  ),
}));

beforeEach(() => {
  treeMounts.count = 0;
  treeMounts.onDocumentSelect = null;
  treeMounts.onCollapse = null;
  window.history.replaceState({}, "", "/documents");
  window.sessionStorage.clear();
});

afterEach(cleanup);

describe("DocumentWorkspace interactions", () => {
  it("keeps the newly selected document highlighted after loading its detail", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/revisions")) {
        return new Response(JSON.stringify({ ok: true, revisions: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        ok: true,
        document: { id: "doc_2", projectId: "project_1", title: "Runbook", path: "runbook.md", contentMarkdown: "# Runbook", version: 1 },
      }), { status: 200 });
    }));
    render(<DocumentWorkspace
      tree={{ spaceId: "space_1", groups: [], trash: [] }}
      document={{ id: "doc_1", projectId: "project_1", title: "Guide", path: "guide.md", contentMarkdown: "# Current", version: 3 }}
    />);

    await user.click(screen.getByRole("button", { name: "打开第二篇" }));
    await waitFor(() => expect(screen.getByTestId("active-document").textContent).toBe("doc_2"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId("active-document").textContent).toBe("doc_2");
  });

  it("keeps the directory tree mounted while selecting another document", async () => {
    const tree = { spaceId: "space_1", groups: [], trash: [] };
    const { rerender } = render(<DocumentWorkspace tree={tree} document={{ id: "doc_1", projectId: "project_1", title: "Guide", path: "guide.md", contentMarkdown: "# Current", version: 3 }} />);
    rerender(<DocumentWorkspace tree={tree} document={{ id: "doc_2", projectId: "project_1", title: "Runbook", path: "runbook.md", contentMarkdown: "# Runbook", version: 1 }} />);
    expect(treeMounts.count).toBe(1);
  });
  it("discards reload snapshots after leaving the document workspace", () => {
    const { unmount } = render(<DocumentWorkspace
      tree={{ spaceId: "space_1", groups: [], trash: [] }}
      document={{
        id: "doc_1",
        projectId: "project_1",
        title: "Guide",
        path: "guide.md",
        contentMarkdown: "# Current",
        version: 3,
      }}
    />);
    const treeKey = getDocumentWorkspaceStorageKey("project:project_1");
    const modeKey = getDocumentWorkspaceStorageKey("project:project_1/doc_1");
    window.sessionStorage.setItem(treeKey, "tree snapshot");
    window.sessionStorage.setItem(modeKey, "mode snapshot");

    unmount();

    expect(window.sessionStorage.getItem(treeKey)).toBeNull();
    expect(window.sessionStorage.getItem(modeKey)).toBeNull();
  });

  it("keeps the tree snapshot for a same-workspace document navigation", async () => {
    const scopeKey = "project:project_1";
    const treeKey = getDocumentWorkspaceStorageKey(scopeKey);
    window.history.replaceState({}, "", "/documents/doc_2");
    window.sessionStorage.setItem(treeKey, JSON.stringify({ expandedDirectoryIds: ["dir_1"], mode: "view" }));
    writeDocumentWorkspaceNavigation(scopeKey, "/documents/doc_2");

    const workspace = <DocumentWorkspace
      tree={{ spaceId: "space_1", groups: [], trash: [] }}
      document={{
        id: "doc_2",
        projectId: "project_1",
        title: "Runbook",
        path: "runbook.md",
        contentMarkdown: "# Runbook",
        version: 1,
      }}
    />;
    const { rerender, unmount } = render(workspace);

    expect(window.sessionStorage.getItem(treeKey)).not.toBeNull();
    rerender(<DocumentWorkspace
      tree={{ spaceId: "space_1", groups: [], trash: [] }}
      document={{
        id: "doc_2",
        projectId: "project_1",
        title: "Runbook",
        path: "runbook.md",
        contentMarkdown: "# Runbook",
        version: 1,
      }}
      canWrite
    />);
    expect(window.sessionStorage.getItem(treeKey)).not.toBeNull();
    unmount();

    await waitFor(() => expect(window.sessionStorage.getItem(treeKey)).toBeNull());
  });

  it("keeps the previous document mode storage isolated when selecting another document", async () => {
    const tree = { spaceId: "space_1", groups: [], trash: [] };
    const { rerender } = render(<DocumentWorkspace
      tree={tree}
      document={{
        id: "doc_1",
        projectId: "project_1",
        title: "Guide",
        path: "guide.md",
        contentMarkdown: "# Current",
        version: 3,
      }}
    />);
    const modeKey = getDocumentWorkspaceStorageKey("project:project_1/doc_1");
    window.sessionStorage.setItem(modeKey, "mode snapshot");

    rerender(<DocumentWorkspace
      tree={tree}
      document={{
        id: "doc_2",
        projectId: "project_1",
        title: "Runbook",
        path: "runbook.md",
        contentMarkdown: "# Runbook",
        version: 1,
      }}
    />);

    expect(window.sessionStorage.getItem(modeKey)).toBe("mode snapshot");
  });

  it("keeps the tree instance when the document selection changes", () => {
    const tree = { spaceId: "space_1", groups: [], trash: [] };
    const { rerender } = render(<DocumentWorkspace
      tree={tree}
      document={{
        id: "doc_1",
        projectId: "project_1",
        title: "Guide",
        path: "guide.md",
        contentMarkdown: "# Current",
        version: 3,
      }}
    />);

    expect(treeMounts.count).toBe(1);

    rerender(<DocumentWorkspace
      tree={tree}
      document={{
        id: "doc_2",
        projectId: "project_1",
        title: "Runbook",
        path: "runbook.md",
        contentMarkdown: "# Runbook",
        version: 1,
      }}
    />);

    expect(treeMounts.count).toBe(1);
  });

  it("remounts the tree when the workspace changes", async () => {
    const tree = { spaceId: "space_1", groups: [], trash: [] };
    const { rerender } = render(<DocumentWorkspace
      tree={tree}
      document={{
        id: "doc_1",
        projectId: "project_1",
        title: "Guide",
        path: "guide.md",
        contentMarkdown: "# Current",
        version: 3,
      }}
    />);

    rerender(<DocumentWorkspace
      tree={tree}
      document={{
        id: "doc_3",
        projectId: "project_2",
        title: "Other project",
        path: "other.md",
        contentMarkdown: "# Other",
        version: 1,
      }}
    />);

    expect(treeMounts.count).toBe(1);
  });

  it("opens a historical revision and restores the panel after collapse", async () => {
    const user = userEvent.setup();
    render(<DocumentWorkspace
      tree={{ spaceId: "space_1", groups: [], trash: [] }}
      document={{ id: "doc_1", title: "Guide", path: "guide.md", contentMarkdown: "# Current", version: 3 }}
      revisions={[{
        id: "revision_2",
        documentId: "doc_1",
        version: 2,
        contentMarkdown: "# Historical Guide",
        source: "web",
        createdAt: new Date("2026-07-21T00:00:00.000Z"),
        createdById: "user_1",
      }]}
    />);

    await user.click(screen.getAllByRole("button", { name: "打开修订记录" }).at(-1)!);
    await user.click(screen.getByRole("button", { name: "查看版本 v2" }));
    expect(screen.getByText("Historical Guide")).toBeTruthy();
    expect(screen.getByText("当前正文")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "收起修订记录" }));
    expect(screen.queryByLabelText("修订记录侧栏")).toBeNull();
    expect(screen.getAllByRole("button", { name: "打开修订记录" }).length).toBeGreaterThan(0);
  });

  it("collapses and expands the desktop directory without losing the tree state", async () => {
    const user = userEvent.setup();
    render(<DocumentWorkspace
      tree={{ spaceId: "space_1", groups: [], trash: [] }}
      document={{ id: "doc_1", title: "Guide", path: "guide.md", contentMarkdown: "# Current", version: 3 }}
    />);

    await user.click(screen.getByRole("button", { name: "收起目录" }));
    expect(screen.getByLabelText("文档目录").closest("aside")?.className).toContain("lg:hidden");
    await user.click(screen.getByRole("button", { name: "展开文档目录" }));
    expect(screen.getByLabelText("文档目录")).toBeTruthy();
    expect(screen.getByLabelText("文档目录").closest("aside")?.className).toContain("lg:flex");
    expect(treeMounts.count).toBe(1);
  });
});
