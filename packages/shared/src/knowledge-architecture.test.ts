import { describe, expect, it } from "vitest";

import { parseArchitectureManifest } from "./knowledge-architecture";

const manifest = {
  manifestVersion: 1 as const,
  viewKey: "architecture.release-flow",
  title: "发布流程",
  generatedAt: "2026-09-20T00:00:00.000Z",
  nodes: [
    { key: "service.web", title: "Web", kind: "service", layer: "application", summary: "平台", documentRefs: [] },
    { key: "service.worker", title: "Worker", kind: "service", layer: "application", summary: "执行", documentRefs: [] },
  ],
  edges: [
    { key: "edge.web-worker", from: "service.web", to: "service.worker", type: "calls" as const, origin: "inferred" as const, confidence: 0.9, summary: "调度", evidenceRefs: ["file:a.ts"] },
  ],
  groups: [],
  entryNodeKeys: ["service.web"],
  relatedEntryKeys: [],
};

describe("architecture manifest", () => {
  it("accepts a valid graph and preserves inferred confidence", () => {
    expect(parseArchitectureManifest(manifest).edges[0]).toMatchObject({ origin: "inferred", confidence: 0.9 });
  });

  it("rejects missing nodes and duplicate keys", () => {
    expect(() => parseArchitectureManifest({ ...manifest, entryNodeKeys: ["missing"] })).toThrow();
    expect(() => parseArchitectureManifest({ ...manifest, nodes: [manifest.nodes[0], manifest.nodes[0]] })).toThrow();
  });
});
