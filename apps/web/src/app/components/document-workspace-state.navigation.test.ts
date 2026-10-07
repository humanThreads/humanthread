// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("web document workspace navigation policy", () => {
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
});
