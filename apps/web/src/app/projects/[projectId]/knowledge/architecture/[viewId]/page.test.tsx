import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { getKnowledgeArchitectureVersion, prisma } from "@humanthread/db";

import KnowledgeArchitecturePage from "./page";

vi.mock("@humanthread/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@humanthread/db")>()),
  assertCanReadProject: vi.fn(),
  knowledgeProjectDigest: vi.fn(() => "a".repeat(32)),
  getKnowledgeArchitectureVersion: vi.fn(),
  prisma: { project: { findUnique: vi.fn() } },
}));
vi.mock("../../../../../../lib/workbench/workbench-route-auth", () => ({
  requireWorkbenchSession: vi.fn(async () => ({ session: { context: { userId: "user_1" }, loginEmail: "user@example.com" } })),
}));
vi.mock("../../../../../../lib/workbench/workbench-companies", () => ({ getWorkbenchCompanyFilters: vi.fn(async () => []) }));
vi.mock("../../../../../../lib/workbench/workbench-avatar", () => ({ getWorkbenchShellLoginProps: vi.fn(() => ({})) }));
vi.mock("../../../../../components/workbench-shell", () => ({ WorkbenchShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));

const manifest = {
  manifestVersion: 1 as const,
  viewKey: "architecture.release",
  title: "发布架构",
  generatedAt: "2026-09-20T00:00:00.000Z",
  nodes: [
    { key: "web", title: "Web", kind: "service", layer: "app", summary: "入口", documentRefs: [{ kind: "knowledge" as const, ref: "interface.web" }] },
    { key: "worker", title: "Worker", kind: "service", layer: "app", summary: "执行", documentRefs: [{ kind: "document" as const, ref: "doc:1", title: "Worker 文档" }] },
  ],
  edges: [{ key: "web-worker", from: "web", to: "worker", type: "calls" as const, origin: "inferred" as const, confidence: 0.8, summary: "", evidenceRefs: [] }],
  groups: [],
  entryNodeKeys: ["web"],
  relatedEntryKeys: [],
};

describe("knowledge architecture page", () => {
  it("centers the requested node and renders relationships and linked documents", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ id: "project_1", name: "Atlas", spaceId: "space_1" } as never);
    vi.mocked(getKnowledgeArchitectureVersion).mockResolvedValue({
      id: "v".repeat(32), viewId: "view_1", version: 1, manifest, contentDigest: "d".repeat(32),
      bundleObjectKey: "architecture/release/index.htm", status: "published", publishedAt: new Date("2026-09-20T00:00:00.000Z"),
    });
    const markup = renderToStaticMarkup(await KnowledgeArchitecturePage({
      params: Promise.resolve({ projectId: "project_1", viewId: "view_1" }),
      searchParams: Promise.resolve({ node: "web" }),
    }));
    expect(markup).toContain("Web");
    expect(markup).toContain("上游来源与依赖");
    expect(markup).toContain("关联知识");
    expect(markup).toContain("关联文档");
    expect(markup).toContain("interface.web");
    expect(markup).toContain("Worker");
  });
});
