import type { DesktopDocumentTreeResponse } from "@humanthread/workbench-client";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentTree } from "./document-tree";
import {
  getDocumentWorkspaceStorageKey,
  shouldRestoreDocumentWorkspaceNavigation,
  writeDocumentWorkspaceNavigation,
} from "./document-workspace-state";

const groups: DesktopDocumentTreeResponse["data"]["groups"] = [{
  key: "project:project_1",
  label: "Atlas",
  projectId: "project_1",
  canWrite: true,
  directories: [{ id: "directory_1", parentId: null, name: "设计", path: "设计", sortOrder: 0 }],
  documents: [{
    id: "doc_1", directoryId: "directory_1", title: "架构说明",
    path: "设计/architecture.md", sortOrder: 0, route: "/documents/doc_1",
  }],
}];

beforeEach(() => {
  window.history.replaceState({}, "", "/documents");
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DocumentTree", () => {
  it("restores only directories that remain visible after reload", async () => {
    vi.spyOn(window.performance, "getEntriesByType").mockReturnValue([
      { type: "reload" } as PerformanceNavigationTiming,
    ]);
    const storageKey = getDocumentWorkspaceStorageKey("project_1");
    window.sessionStorage.setItem(storageKey, JSON.stringify({
      expandedDirectoryIds: ["directory_1", "directory_revoked"],
      mode: "preview",
    }));
    const refreshedGroups: DesktopDocumentTreeResponse["data"]["groups"] = [{
      ...groups[0]!,
      directories: [
        ...groups[0]!.directories,
        { id: "directory_new", parentId: null, name: "新增", path: "新增", sortOrder: 1 },
      ],
    }];

    render(<MemoryRouter><DocumentTree
      groups={refreshedGroups}
      selectedDocumentId="doc_1"
      workspaceScopeKey="project_1"
    /></MemoryRouter>);

    expect(screen.getByRole("treeitem", { name: /设计/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("treeitem", { name: "新增" })).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null")).toEqual({
      expandedDirectoryIds: ["directory_1"],
      mode: "preview",
    }));
  });

  it("renders project containers, folders and document navigation", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><DocumentTree groups={groups} selectedDocumentId="doc_1" /></MemoryRouter>);

    expect(screen.getByRole("tree", { name: "文档目录" })).toBeVisible();
    expect(screen.getByText("Atlas")).toBeVisible();
    expect(screen.getByText("设计")).toBeVisible();
    expect(screen.queryByRole("link", { name: "架构说明" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "设计" }));
    expect(screen.getByRole("link", { name: "架构说明" })).toHaveAttribute(
      "href",
      "/documents/doc_1",
    );
  });

  it("records and restores a same-workspace document navigation handoff", async () => {
    const user = userEvent.setup();
    const scopeKey = "project_1";
    render(<MemoryRouter><DocumentTree groups={groups} workspaceScopeKey={scopeKey} /></MemoryRouter>);

    await user.click(screen.getByRole("button", { name: "设计" }));
    await user.click(screen.getByRole("link", { name: "架构说明" }));

    expect(shouldRestoreDocumentWorkspaceNavigation(scopeKey, "/documents/doc_1", window.sessionStorage)).toBe(true);

    cleanup();
    window.history.replaceState({}, "", "/documents/doc_1");
    writeDocumentWorkspaceNavigation(scopeKey, "/documents/doc_1", window.sessionStorage);
    const { unmount } = render(<MemoryRouter><DocumentTree groups={groups} workspaceScopeKey={scopeKey} /></MemoryRouter>);

    expect(screen.getByRole("treeitem", { name: /设计/ })).toHaveAttribute("aria-expanded", "true");
    unmount();
  });
});
