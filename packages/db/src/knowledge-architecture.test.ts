import { describe, expect, it, vi } from "vitest";

import {
  architectureNeighborhood,
  getKnowledgeArchitectureVersion,
  listKnowledgeArchitectureViews,
  publishKnowledgeArchitectureView,
} from "./knowledge-architecture";
import { knowledgeProjectDigest } from "./knowledge-reference";

const PROJECT_DIGEST = knowledgeProjectDigest("project_1");
const manifest = {
  manifestVersion: 1 as const,
  viewKey: "architecture.release",
  title: "发布架构",
  generatedAt: "2026-09-20T00:00:00.000Z",
  nodes: [
    { key: "web", title: "Web", kind: "service", layer: "app", summary: "入口", documentRefs: [{ kind: "knowledge" as const, ref: "interface.web" }] },
    { key: "worker", title: "Worker", kind: "service", layer: "app", summary: "执行", documentRefs: [] },
  ],
  edges: [{ key: "web-worker", from: "web", to: "worker", type: "calls" as const, origin: "inferred" as const, confidence: 0.8, summary: "", evidenceRefs: [] }],
  groups: [],
  entryNodeKeys: ["web"],
  relatedEntryKeys: [],
};

function fixture() {
  const views = new Map<string, Record<string, unknown>>();
  const versions = new Map<string, Record<string, unknown>>();
  const tx = {
    knowledgeArchitectureView: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => views.get(where.id) ?? null),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        for (const row of data) views.set(String(row.id), row);
        return { count: data.length };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = views.get(String(where.id));
        if (!row || row.latestVersion !== where.latestVersion) return { count: 0 };
        views.set(row.id, { ...row, ...data });
        return { count: 1 };
      }),
    },
    knowledgeArchitectureViewVersion: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.viewId) return [...versions.values()].filter((row) => row.viewId === where.viewId && (!where.status || row.status === where.status));
        return [...versions.values()].map((row) => ({ ...row, view: views.get(String(row.viewId)) }));
      }),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        for (const row of data) versions.set(String(row.id), row);
        return { count: data.length };
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $transaction: async <T>(callback: (tx: never) => Promise<T>) => callback(tx as never),
  };
  return { views, versions, db: tx };
}

describe("knowledge architecture persistence", () => {
  it("publishes an immutable manifest version and lists it", async () => {
    const dependencies = fixture();
    const result = await publishKnowledgeArchitectureView({
      projectDigest: PROJECT_DIGEST,
      stableKey: "architecture.release",
      title: "发布架构",
      manifest,
      bundleObjectKey: "architecture/release/index.htm",
    }, dependencies.db as never);
    expect(result).toMatchObject({ latestVersion: 1, status: "published" });
    await expect(listKnowledgeArchitectureViews(PROJECT_DIGEST, dependencies.db as never)).resolves.toHaveLength(1);
    expect((await getKnowledgeArchitectureVersion({ projectDigest: PROJECT_DIGEST, viewId: result.id }, dependencies.db as never))?.manifest.edges[0]?.confidence).toBe(0.8);
  });

  it("returns upstream, downstream, and related entry keys for a node", () => {
    expect(architectureNeighborhood(manifest, "web")).toMatchObject({
      downstream: [expect.objectContaining({ to: "worker" })],
      relatedEntryKeys: ["interface.web"],
    });
  });
});
