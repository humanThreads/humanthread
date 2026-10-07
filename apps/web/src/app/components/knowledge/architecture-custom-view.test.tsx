import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ArchitectureCustomView, ARCHITECTURE_BUNDLE_IFRAME_SANDBOX } from "./architecture-custom-view";

const manifest = {
  manifestVersion: 1,
  viewKey: "architecture.release",
  title: "发布架构",
  generatedAt: "2026-09-20T00:00:00.000Z",
  nodes: [{ key: "web", title: "Web", kind: "service", layer: "app", summary: "入口", documentRefs: [] }],
  edges: [],
  groups: [],
  entryNodeKeys: ["web"],
  relatedEntryKeys: [],
};

describe("ArchitectureCustomView", () => {
  it("renders an opaque-origin sandboxed iframe without allow-same-origin", () => {
    const markup = renderToStaticMarkup(
      <ArchitectureCustomView projectId="project_1" viewId="view_1" bundleUrl="/api/projects/project_1/knowledge/architecture-views/view_1/bundle/index.htm" selectedKey="web" manifest={manifest as never} fallback={<div id="standard">标准视图</div>} initialStatus="loading" />,
    );
    expect(markup).toContain("<iframe");
    expect(markup).toContain('sandbox="allow-scripts"');
    expect(markup).not.toContain("allow-same-origin");
    expect(ARCHITECTURE_BUNDLE_IFRAME_SANDBOX).toBe("allow-scripts");
  });

  it("falls back to the standard view when the bundle fails to load", async () => {
    const onFallback = vi.fn();
    const { getArchitectureBundleStatus } = await import("./architecture-custom-view");
    expect(getArchitectureBundleStatus({ loaded: false, timedOut: true })).toBe("fallback");
    expect(getArchitectureBundleStatus({ loaded: true, timedOut: false })).toBe("ready");
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("renders the standard view during server rendering so custom HTML is never the only path", () => {
    const markup = renderToStaticMarkup(
      <ArchitectureCustomView projectId="project_1" viewId="view_1" bundleUrl="/bundle/index.htm" selectedKey="web" manifest={manifest as never} fallback={<div id="standard">标准视图</div>} />,
    );
    expect(markup).toContain('id="standard"');
    expect(markup).not.toContain("<iframe");
  });
});
