import { describe, expect, it } from "vitest";
import {
  DOCUMENT_WORKSPACE_MODE_VALUES,
  getDocumentWorkspaceStorageKey,
  getDocumentWorkspaceNavigationStorageKey,
  readDocumentWorkspaceSnapshot,
  shouldRestoreDocumentWorkspaceNavigation,
  shouldRestoreDocumentWorkspace,
  handoffDocumentWorkspaceNavigation,
  writeDocumentWorkspaceNavigation,
} from "./document-workspace-state";

describe("document workspace state", () => {
  it("restores only a valid snapshot for a reload", () => {
    const storage = new Map<string, string>([
      [
        getDocumentWorkspaceStorageKey("space_1"),
        JSON.stringify({ expandedDirectoryIds: ["dir_1", "dir_2"], mode: "view" }),
      ],
    ]);

    expect(readDocumentWorkspaceSnapshot("space_1", storage, true)).toEqual({
      expandedDirectoryIds: ["dir_1", "dir_2"],
      mode: "view",
    });
    expect(readDocumentWorkspaceSnapshot("space_1", storage, false)).toBeNull();
  });

  it("rejects malformed or unsupported snapshots", () => {
    const storage = new Map<string, string>([
      [getDocumentWorkspaceStorageKey("space_1"), JSON.stringify({ expandedDirectoryIds: [1], mode: "source" })],
    ]);
    expect(readDocumentWorkspaceSnapshot("space_1", storage, true)).toBeNull();
    expect(DOCUMENT_WORKSPACE_MODE_VALUES).toEqual(["edit", "view"]);
  });

  it("restores only on an explicit reload navigation", () => {
    expect(shouldRestoreDocumentWorkspace("reload", "/documents/doc_1", "/documents/doc_1")).toBe(true);
    expect(shouldRestoreDocumentWorkspace("navigate", "/documents/doc_1", "/documents/doc_1")).toBe(false);
    expect(shouldRestoreDocumentWorkspace("reload", "/documents/doc_1", "/documents/doc_2")).toBe(false);
  });

  it("restores an in-workspace navigation handoff only at its target", () => {
    const storage = new Map<string, string>();
    writeDocumentWorkspaceNavigation("project:project_1", "/documents/doc_2", storage);

    expect(storage.has(getDocumentWorkspaceNavigationStorageKey("project:project_1"))).toBe(true);
    expect(shouldRestoreDocumentWorkspaceNavigation("project:project_1", "/documents/doc_2", storage)).toBe(true);
    expect(shouldRestoreDocumentWorkspaceNavigation("project:project_1", "/documents/doc_3", storage)).toBe(false);
    expect(storage.has(getDocumentWorkspaceNavigationStorageKey("project:project_1"))).toBe(false);
  });

  it("copies the current tree snapshot when the document scope changes within a space", () => {
    const storage = new Map<string, string>([
      [getDocumentWorkspaceStorageKey("space:space_1"), JSON.stringify({ expandedDirectoryIds: ["dir_1"], mode: "view" })],
    ]);

    handoffDocumentWorkspaceNavigation("space:space_1", "project:project_1", "/documents/doc_1", storage);

    expect(readDocumentWorkspaceSnapshot("project:project_1", storage, true)).toEqual({
      expandedDirectoryIds: ["dir_1"],
      mode: "view",
    });
    expect(shouldRestoreDocumentWorkspaceNavigation("project:project_1", "/documents/doc_1", storage)).toBe(true);
  });
});
