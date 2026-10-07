import { describe, expect, it } from "vitest";
import {
  DOCUMENT_WORKSPACE_MODE_VALUES,
  getDocumentWorkspaceStorageKey,
  getDocumentWorkspaceNavigationStorageKey,
  readDocumentWorkspaceSnapshot,
  shouldRestoreDocumentWorkspaceNavigation,
  writeDocumentWorkspaceNavigation,
} from "./document-workspace-state";

describe("desktop document workspace state", () => {
  it("uses a project-scoped reload snapshot and ignores malformed data", () => {
    const storage = new Map<string, string>([
      [
        getDocumentWorkspaceStorageKey("project_1"),
        JSON.stringify({ expandedDirectoryIds: ["dir_1"], mode: "edit" }),
      ],
    ]);
    expect(readDocumentWorkspaceSnapshot("project_1", storage, true)).toEqual({
      expandedDirectoryIds: ["dir_1"],
      mode: "edit",
    });
    expect(readDocumentWorkspaceSnapshot("project_1", storage, false)).toBeNull();
    expect(readDocumentWorkspaceSnapshot("project_2", storage, true)).toBeNull();
    expect(DOCUMENT_WORKSPACE_MODE_VALUES).toEqual(["source", "split", "preview", "edit"]);
  });

  it("restores an in-workspace navigation handoff only at its target", () => {
    const storage = new Map<string, string>();
    writeDocumentWorkspaceNavigation("project_1", "/documents/doc_2", storage);

    expect(storage.has(getDocumentWorkspaceNavigationStorageKey("project_1"))).toBe(true);
    expect(shouldRestoreDocumentWorkspaceNavigation("project_1", "/documents/doc_2", storage)).toBe(true);
    expect(shouldRestoreDocumentWorkspaceNavigation("project_1", "/documents/doc_3", storage)).toBe(false);
    expect(storage.has(getDocumentWorkspaceNavigationStorageKey("project_1"))).toBe(false);
  });
});
