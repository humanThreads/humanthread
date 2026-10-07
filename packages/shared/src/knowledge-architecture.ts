import { z } from "zod";

const architectureNodeSchema = z.object({
  key: z.string().trim().min(1).max(191),
  title: z.string().trim().min(1).max(191),
  kind: z.string().trim().min(1).max(32),
  layer: z.string().trim().min(1).max(64),
  summary: z.string().trim().max(4_000),
  documentRefs: z.array(z.object({
    kind: z.enum(["knowledge", "document", "file", "task", "url"]),
    ref: z.string().trim().min(1).max(2_000),
    title: z.string().trim().max(191).optional(),
  }).strict()).max(100).default([]),
}).strict();

const architectureEdgeSchema = z.object({
  key: z.string().trim().min(1).max(191),
  from: z.string().trim().min(1).max(191),
  to: z.string().trim().min(1).max(191),
  type: z.enum([
    "depends_on", "contains", "calls", "publishes", "consumes",
    "evolves_to", "supersedes", "constrains", "related_to",
  ]),
  origin: z.enum(["explicit", "inferred"]),
  confidence: z.number().min(0).max(1),
  summary: z.string().trim().max(2_000).default(""),
  evidenceRefs: z.array(z.string().trim().min(1).max(2_000)).max(100).default([]),
}).strict();

export const architectureManifestSchema = z.object({
  manifestVersion: z.literal(1),
  viewKey: z.string().trim().min(1).max(191),
  title: z.string().trim().min(1).max(191),
  generatedAt: z.string().datetime(),
  nodes: z.array(architectureNodeSchema).min(1).max(5_000),
  edges: z.array(architectureEdgeSchema).max(20_000),
  groups: z.array(z.object({
    key: z.string().trim().min(1).max(191),
    title: z.string().trim().min(1).max(191),
    nodeKeys: z.array(z.string().trim().min(1).max(191)).min(1).max(5_000),
  }).strict()).max(500).default([]),
  entryNodeKeys: z.array(z.string().trim().min(1).max(191)).min(1).max(100),
  relatedEntryKeys: z.array(z.string().trim().min(1).max(191)).max(1_000).default([]),
}).strict().superRefine((manifest, context) => {
  const nodeKeys = new Set<string>();
  for (const node of manifest.nodes) {
    if (nodeKeys.has(node.key)) {
      context.addIssue({ code: "custom", path: ["nodes"], message: `Duplicate architecture node key: ${node.key}` });
    }
    nodeKeys.add(node.key);
    if (node.documentRefs.some((reference) => reference.kind === "url" && !/^https?:\/\//u.test(reference.ref))) {
      context.addIssue({ code: "custom", path: ["nodes"], message: "Architecture URL reference is invalid" });
    }
  }
  for (const key of manifest.entryNodeKeys) {
    if (!nodeKeys.has(key)) context.addIssue({ code: "custom", path: ["entryNodeKeys"], message: `Entry node does not exist: ${key}` });
  }
  for (const edge of manifest.edges) {
    if (!nodeKeys.has(edge.from) || !nodeKeys.has(edge.to)) {
      context.addIssue({ code: "custom", path: ["edges"], message: `Architecture edge references a missing node: ${edge.key}` });
    }
  }
});

export type ArchitectureManifest = z.infer<typeof architectureManifestSchema>;

export function parseArchitectureManifest(value: unknown): ArchitectureManifest {
  return architectureManifestSchema.parse(value);
}
