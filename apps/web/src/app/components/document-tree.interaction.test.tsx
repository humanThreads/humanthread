// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentTree } from "./document-tree";
import {
  getDocumentWorkspaceStorageKey,
  shouldRestoreDocumentWorkspaceNavigation,
  writeDocumentWorkspaceNavigation,
} from "./document-workspace-state";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const dnd = vi.hoisted((): { onDragEnd(event: unknown): void } => ({
  onDragEnd: () => undefined,
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd(event: unknown): void }) => {
    dnd.onDragEnd = onDragEnd;
    return children;
  },
  PointerSensor: class PointerSensor {},
  useSensor: () => ({}),
  useSensors: () => [],
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => undefined, transform: null, isDragging: false }),
  useDroppable: () => ({ setNodeRef: () => undefined, isOver: false }),
}));

const group = {
  key: "project:project_1",
  label: "Alpha",
  spaceId: "space_1",
  projectId: "project_1",
  canWrite: true,
  directories: [{ id: "dir_1", parentId: null, name: "产品设计", path: "产品设计", sortOrder: 0 }],
  documents: [],
};

const navigationGroup = {
  ...group,
  documents: [{
    id: "doc_1",
    groupKey: group.key,
    directoryId: "dir_1",
    title: "架构说明",
    path: "产品设计/architecture.md",
    sortOrder: 0,
    deletedAt: null,
  }],
};

beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
  window.history.replaceState({}, "", "/documents");
  window.sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DocumentTree interactions", () => {
  it("restores only directory ids that remain visible after reload", async () => {
    vi.spyOn(window.performance, "getEntriesByType").mockReturnValue([
      { type: "reload" } as PerformanceNavigationTiming,
    ]);
    const scopeKey = "project:project_1";
    const storageKey = getDocumentWorkspaceStorageKey(scopeKey);
    window.sessionStorage.setItem(storageKey, JSON.stringify({
      expandedDirectoryIds: ["dir_1", "dir_revoked"],
      mode: "view",
    }));

    render(<DocumentTree
      spaceId="space_1"
      workspaceScopeKey={scopeKey}
      groups={[group]}
      trash={[]}
    />);

    expect(screen.getByRole("treeitem", { name: /产品设计/ }).getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null")).toEqual({
      expandedDirectoryIds: ["dir_1"],
      mode: "view",
    }));
  });

  it("records a same-workspace document navigation handoff", async () => {
    const user = userEvent.setup();
    render(<DocumentTree
      spaceId="space_1"
      workspaceScopeKey={group.key}
      groups={[navigationGroup]}
      trash={[]}
    />);

    await user.click(screen.getByRole("button", { name: "展开目录" }));
    await user.click(screen.getByRole("link", { name: "架构说明" }));

    expect(shouldRestoreDocumentWorkspaceNavigation(group.key, "/documents/doc_1", window.sessionStorage)).toBe(true);
  });

  it("restores a scoped handoff when the target document route mounts", () => {
    const scopeKey = group.key;
    const storageKey = getDocumentWorkspaceStorageKey(scopeKey);
    window.history.replaceState({}, "", "/documents/doc_1");
    window.sessionStorage.setItem(storageKey, JSON.stringify({
      expandedDirectoryIds: ["dir_1"],
      mode: "view",
    }));
    writeDocumentWorkspaceNavigation(scopeKey, "/documents/doc_1", window.sessionStorage);

    render(<DocumentTree
      spaceId="space_1"
      workspaceScopeKey={scopeKey}
      groups={[navigationGroup]}
      trash={[]}
    />);

    expect(screen.getByRole("treeitem", { name: /产品设计/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("creates a document in the selected directory and opens it", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      document: { id: "doc_new" },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    render(<DocumentTree spaceId="space_1" groups={[group]} trash={[]} />);

    await user.click(screen.getByRole("button", { name: "产品设计的更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "在此新建文档" }));
    await user.type(screen.getByLabelText("文档标题"), "需求评审");
    await user.click(screen.getByRole("button", { name: "创建并打开" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [path, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(path).toBe("/api/projects/project_1/documents");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      title: "需求评审",
      path: "需求评审.md",
      directoryId: "dir_1",
    });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/documents/doc_new"));
  });

  it("keeps the dialog input when the server rejects a command", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: "Document directory is not empty",
    }), { status: 409, headers: { "content-type": "application/json" } }));
    render(<DocumentTree spaceId="space_1" groups={[group]} trash={[]} />);

    await user.click(screen.getByRole("button", { name: "产品设计的更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "删除空文件夹" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    expect((await screen.findByRole("alert")).textContent).toContain("该文件夹仍包含内容");
    expect(screen.getByRole("dialog", { name: "删除空文件夹" })).toBeTruthy();
  });

  it("shows drag failures near the tree without opening a move dialog", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: "Document directory cycle",
    }), { status: 409, headers: { "content-type": "application/json" } }));
    render(<DocumentTree spaceId="space_1" groups={[group]} trash={[]} />);

    await act(async () => {
      await dnd.onDragEnd({
        active: { data: { current: { id: "dir_1", groupKey: group.key, type: "directory" } } },
        over: { data: { current: { directoryId: "dir_1", groupKey: group.key } } },
      });
    });

    expect(screen.getByRole("alert").textContent).toContain("文件夹不能移动到自身");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the trash as a collapsed folder until the user expands it", async () => {
    const user = userEvent.setup();
    render(<DocumentTree
      spaceId="space_1"
      groups={[group]}
      trash={[{
        id: "doc_trash",
        groupKey: group.key,
        directoryId: null,
        title: "已删除文档",
        path: "trash.md",
        sortOrder: 0,
        deletedAt: new Date("2026-09-18T00:00:00.000Z"),
      }]}
    />);

    expect(screen.getByRole("button", { name: "展开回收站" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("已删除文档")).toBeNull();

    await user.click(screen.getByRole("button", { name: "展开回收站" }));

    expect(screen.getByRole("button", { name: "收起回收站" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("已删除文档")).toBeTruthy();
  });
});
