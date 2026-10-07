import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("../../../lib/workbench/workbench-route-auth", () => ({
  requireWorkbenchSession: vi.fn().mockResolvedValue({
    session: { context: { userId: "user_1" }, loginEmail: "owner@example.com", account: { name: "Owner" } },
  }),
}));
vi.mock("../../../lib/workbench/workbench-companies", () => ({
  getWorkbenchCompanyFilters: vi.fn().mockResolvedValue([{ key: "personal", label: "个人空间", spaceId: "space_1" }]),
}));
vi.mock("../../../lib/workbench/workbench-avatar", () => ({ getWorkbenchShellLoginProps: vi.fn().mockReturnValue({}) }));
vi.mock("../../../lib/orchestration/loop-product-read-model", () => ({
  readLoopDefinitionEditor: vi.fn(),
}));
vi.mock("../../components/workbench-shell", () => ({
  WorkbenchShell: ({ children }: { children: ReactNode }) => createElement("main", null, children),
}));
vi.mock("../../components/loops/loop-editor", () => ({
  LoopEditor: () => createElement("div", { "data-loop-editor": "true" }),
}));
vi.mock("../../components/loops/loop-definition-lifecycle", () => ({
  LoopDefinitionLifecycle: () => createElement("div", { "data-loop-lifecycle": "true" }),
}));

import {
  dynamic,
  LOOP_EDITOR_CONTENT_MODE,
  LOOP_EDITOR_PAGE_TITLE,
  LOOP_EDITOR_SHOWS_LIFECYCLE,
  LOOP_EDITOR_WORKSPACE_CLASS,
  resolveLoopEditorGraph,
} from "./page";
import { readLoopDefinitionEditor } from "../../../lib/orchestration/loop-product-read-model";
import LoopEditorPage from "./page";

const validGraph = {
  schemaVersion: 1,
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  limits: { maxStages: 2, maxRepeatCount: 1 },
  nodes: [
    { key: "start", label: "Start", type: "start" },
    { key: "end", label: "End", type: "end" },
  ],
  edges: [
    { id: "start-end", source: "start", target: "end", kind: "normal", outcome: "success" },
  ],
};

describe("Loop editor page", () => {
  it("uses a dynamic full workspace", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(LOOP_EDITOR_CONTENT_MODE).toBe("workspace");
  });

  it("renders the editor in a full-height workspace root so the graph canvas can render", async () => {
    vi.mocked(readLoopDefinitionEditor).mockResolvedValue({
      definition: {
        id: "loop_1",
        spaceId: "space_1",
        name: "Delivery loop",
        description: null,
        scope: "project",
        origin: "space",
        readOnly: false,
        status: "draft",
        draftGraph: validGraph,
      },
      draftRevision: 1,
      versions: [],
      subloopOptions: [],
      platformCaps: { maxStages: 64, maxRepeatCount: 20, maxTransitions: 1024 },
      lifecycle: { canArchive: false, canDelete: false, referenceCount: 0, references: {} },
    } as never);

    const markup = renderToStaticMarkup(await LoopEditorPage({ params: Promise.resolve({ loopDefinitionId: "loop_1" }) }));

    expect(markup).toContain(`class="${LOOP_EDITOR_WORKSPACE_CLASS}"`);
    expect(markup).toMatch(/<div class="[^"]*h-full[^"]*min-h-0[^"]*">.*data-loop-editor.*data-loop-lifecycle/s);
  });

  it("keeps the editor title stable", () => {
    expect(LOOP_EDITOR_PAGE_TITLE).toBe("Loop 图编辑器");
  });

  it("keeps definition lifecycle controls outside the graph editor", () => {
    expect(LOOP_EDITOR_SHOWS_LIFECYCLE).toBe(true);
  });

  it("falls back to the active published graph when the draft graph is invalid", () => {
    const result = resolveLoopEditorGraph({
      draftGraph: {},
      latestPublishedVersion: { id: "version_1", graph: validGraph },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        schemaVersion: validGraph.schemaVersion,
        nodes: validGraph.nodes,
        edges: validGraph.edges,
      });
    }
  });

  it("keeps the draft graph as the source when it is valid", () => {
    const result = resolveLoopEditorGraph({
      draftGraph: validGraph,
      latestPublishedVersion: { id: "version_1", graph: { invalid: true } },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        schemaVersion: validGraph.schemaVersion,
        nodes: validGraph.nodes,
        edges: validGraph.edges,
      });
    }
  });

  it("returns the draft parse failure when no valid published fallback exists", () => {
    const result = resolveLoopEditorGraph({
      draftGraph: {},
      latestPublishedVersion: { id: "version_1", graph: { invalid: true } },
    });

    expect(result.success).toBe(false);
  });
});
