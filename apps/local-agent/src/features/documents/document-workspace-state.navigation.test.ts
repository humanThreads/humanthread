// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("desktop document workspace navigation policy", () => {
  beforeEach(() => {
    vi.resetModules();
    window.history.replaceState({}, "", "/documents/doc_1?space=one");
    vi.spyOn(window.performance, "getEntriesByType").mockReturnValue([
      { type: "reload" } as PerformanceNavigationTiming,
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stops restoring after an in-app route or project query change", async () => {
    const { shouldRestoreCurrentDocumentWorkspace } = await import("./document-workspace-state");

    expect(shouldRestoreCurrentDocumentWorkspace()).toBe(true);

    window.history.replaceState({}, "", "/documents/doc_2?space=two");

    expect(shouldRestoreCurrentDocumentWorkspace()).toBe(false);
  });

  it("requires the reload location to remain unchanged", async () => {
    const { shouldRestoreDocumentWorkspace } = await import("./document-workspace-state");

    expect(shouldRestoreDocumentWorkspace("reload", "/documents?space=one", "/documents?space=one")).toBe(true);
    expect(shouldRestoreDocumentWorkspace("reload", "/documents?space=one", "/documents?space=two")).toBe(false);
  });
});
