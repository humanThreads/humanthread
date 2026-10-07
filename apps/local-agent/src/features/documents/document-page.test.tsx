import type {
  DesktopDocumentDetail,
  DesktopDocumentRevision,
  DesktopDocumentTreeResponse,
} from "@humanthread/workbench-client";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentWorkspace } from "./document-page";
import {
  getDocumentWorkspaceStorageKey,
  writeDocumentWorkspaceNavigation,
} from "./document-workspace-state";

const treeMounts = vi.hoisted(() => ({ count: 0 }));

vi.mock("./document-tree", () => ({
  DocumentTree: () => {
    useState(() => {
      treeMounts.count += 1;
      return null;
    });
    return <nav aria-label="文档目录" role="tree">文档目录</nav>;
  },
}));

const detail: DesktopDocumentDetail = {
  id: "doc_1", projectId: "project_1", title: "架构说明", path: "architecture.md",
  contentMarkdown: "# Current", version: 8,
  createdAt: "2026-07-20T08:00:00.000Z", updatedAt: "2026-07-27T08:00:00.000Z",
  capabilities: { edit: true },
};

const groups: DesktopDocumentTreeResponse["data"]["groups"] = [{
  key: "project:project_1", label: "Atlas", projectId: "project_1", canWrite: true,
  directories: [],
  documents: [{
    id: "doc_1", directoryId: null, title: "架构说明",
    path: "architecture.md", sortOrder: 0, route: "/documents/doc_1",
  }],
}];

describe("DocumentWorkspace", () => {
  beforeEach(() => {
    treeMounts.count = 0;
    window.history.replaceState({}, "", "/documents");
    window.sessionStorage.clear();
  });

  afterEach(cleanup);

  it("discards reload snapshots after leaving the document workspace", () => {
    const { unmount } = render(<MemoryRouter><DocumentWorkspace
      detail={detail}
      draft={detail.contentMarkdown}
      groups={groups}
      revisions={[] as DesktopDocumentRevision[]}
      savePending={false}
      onDraftChange={vi.fn()}
      onSave={vi.fn()}
    /></MemoryRouter>);
    const treeKey = getDocumentWorkspaceStorageKey("project_1");
    const modeKey = getDocumentWorkspaceStorageKey("project_1/doc_1");
    window.sessionStorage.setItem(treeKey, "tree snapshot");
    window.sessionStorage.setItem(modeKey, "mode snapshot");

    unmount();

    expect(window.sessionStorage.getItem(treeKey)).toBeNull();
    expect(window.sessionStorage.getItem(modeKey)).toBeNull();
  });

  it("keeps the tree snapshot for a same-workspace document navigation", async () => {
    const scopeKey = "project_1";
    const treeKey = getDocumentWorkspaceStorageKey(scopeKey);
    window.history.replaceState({}, "", "/documents/doc_2");
    window.sessionStorage.setItem(treeKey, JSON.stringify({ expandedDirectoryIds: ["dir_1"], mode: "preview" }));
    writeDocumentWorkspaceNavigation(scopeKey, "/documents/doc_2");

    const workspace = <MemoryRouter><DocumentWorkspace
      detail={{ ...detail, id: "doc_2", title: "运行手册", path: "runbook.md" }}
      draft="# Runbook"
      groups={groups}
      revisions={[] as DesktopDocumentRevision[]}
      savePending={false}
      onDraftChange={vi.fn()}
      onSave={vi.fn()}
    /></MemoryRouter>;
    const { rerender, unmount } = render(workspace);

    expect(window.sessionStorage.getItem(treeKey)).not.toBeNull();
    rerender(<MemoryRouter><DocumentWorkspace
      detail={{ ...detail, id: "doc_2", title: "运行手册", path: "runbook.md" }}
      draft="# Runbook"
      groups={groups}
      revisions={[] as DesktopDocumentRevision[]}
      revisionsLoading
      savePending={false}
      onDraftChange={vi.fn()}
      onSave={vi.fn()}
    /></MemoryRouter>);
    expect(window.sessionStorage.getItem(treeKey)).not.toBeNull();
    unmount();

    await waitFor(() => expect(window.sessionStorage.getItem(treeKey)).toBeNull());
  });

  it("does not clear a restored tree during the StrictMode probe", () => {
    const scopeKey = "project_1";
    const treeKey = getDocumentWorkspaceStorageKey(scopeKey);
    window.history.replaceState({}, "", "/documents/doc_2");
    window.sessionStorage.setItem(treeKey, JSON.stringify({ expandedDirectoryIds: ["dir_1"], mode: "preview" }));
    writeDocumentWorkspaceNavigation(scopeKey, "/documents/doc_2");

    const { unmount } = render(<StrictMode><MemoryRouter><DocumentWorkspace
      detail={{ ...detail, id: "doc_2", title: "运行手册", path: "runbook.md" }}
      draft="# Runbook"
      groups={groups}
      revisions={[] as DesktopDocumentRevision[]}
      savePending={false}
      onDraftChange={vi.fn()}
      onSave={vi.fn()}
    /></MemoryRouter></StrictMode>);

    expect(window.sessionStorage.getItem(treeKey)).not.toBeNull();
    unmount();
  });

  it("discards the previous document mode when selecting another document", () => {
    const { rerender } = render(<MemoryRouter><DocumentWorkspace
      detail={detail}
      draft={detail.contentMarkdown}
      groups={groups}
      revisions={[] as DesktopDocumentRevision[]}
      savePending={false}
      onDraftChange={vi.fn()}
      onSave={vi.fn()}
    /></MemoryRouter>);
    const modeKey = getDocumentWorkspaceStorageKey("project_1/doc_1");
    window.sessionStorage.setItem(modeKey, "mode snapshot");

    rerender(<MemoryRouter><DocumentWorkspace
      detail={{ ...detail, id: "doc_2", title: "运行手册", path: "runbook.md" }}
      draft="# Runbook"
      groups={groups}
      revisions={[] as DesktopDocumentRevision[]}
      savePending={false}
      onDraftChange={vi.fn()}
      onSave={vi.fn()}
    /></MemoryRouter>);

    expect(window.sessionStorage.getItem(modeKey)).toBeNull();
  });

  it("keeps the tree instance when the document selection changes", () => {
    const { rerender } = render(<MemoryRouter><DocumentWorkspace
      detail={detail}
      draft={detail.contentMarkdown}
      groups={groups}
      revisions={[] as DesktopDocumentRevision[]}
      savePending={false}
      onDraftChange={vi.fn()}
      onSave={vi.fn()}
    /></MemoryRouter>);

    expect(treeMounts.count).toBe(1);

    rerender(<MemoryRouter><DocumentWorkspace
      detail={{ ...detail, id: "doc_2", title: "运行手册", path: "runbook.md" }}
      draft="# Runbook"
      groups={groups}
      revisions={[] as DesktopDocumentRevision[]}
      savePending={false}
      onDraftChange={vi.fn()}
      onSave={vi.fn()}
    /></MemoryRouter>);

    expect(treeMounts.count).toBe(1);
  });

  it("remounts the tree when the workspace changes", () => {
    const { rerender } = render(<MemoryRouter><DocumentWorkspace
      detail={{ ...detail, projectId: "project_1" }}
      draft={detail.contentMarkdown}
      groups={groups}
      revisions={[] as DesktopDocumentRevision[]}
      savePending={false}
      onDraftChange={vi.fn()}
      onSave={vi.fn()}
    /></MemoryRouter>);

    rerender(<MemoryRouter><DocumentWorkspace
      detail={{ ...detail, id: "doc_3", projectId: "project_2", title: "Other project", path: "other.md" }}
      draft="# Other"
      groups={groups}
      revisions={[] as DesktopDocumentRevision[]}
      savePending={false}
      onDraftChange={vi.fn()}
      onSave={vi.fn()}
    /></MemoryRouter>);

    expect(treeMounts.count).toBe(2);
  });

  it("keeps directory and revisions collapsed until requested", () => {
    render(<MemoryRouter><DocumentWorkspace
      detail={detail}
      draft={detail.contentMarkdown}
      groups={groups}
      revisions={[] as DesktopDocumentRevision[]}
      savePending={false}
      onDraftChange={vi.fn()}
      onSave={vi.fn()}
    /></MemoryRouter>);

    expect(screen.queryByRole("tree", { name: "文档目录" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "打开文档目录" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "架构说明" })).toBeVisible();
    expect(screen.getByTestId("document-workspace")).toHaveClass("document-workspace");
    expect(screen.getByRole("button", { name: "修订 8" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "修订记录" })).not.toBeInTheDocument();
  });
});
