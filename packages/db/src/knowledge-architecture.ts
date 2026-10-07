import {
  parseArchitectureManifest,
  type ArchitectureManifest,
} from "@humanthread/shared";

import { knowledgeDigest, knowledgeId } from "./knowledge-reference";
import { KNOWLEDGE_TRANSACTION_OPTIONS } from "./knowledge-jobs";
import { prisma } from "./prisma";

export interface ArchitectureViewProjection {
  id: string;
  projectDigest: string;
  stableKey: string;
  title: string;
  status: string;
  latestVersion: number;
  updatedAt: Date;
}

export interface ArchitectureViewVersionProjection {
  id: string;
  viewId: string;
  version: number;
  manifest: ArchitectureManifest;
  contentDigest: string;
  bundleObjectKey: string;
  status: string;
  publishedAt: Date;
}

interface ArchitectureDb {
  knowledgeArchitectureView: {
    findUnique(args: unknown): Promise<Record<string, unknown> | null>;
    createMany(args: unknown): Promise<{ count: number }>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  knowledgeArchitectureViewVersion: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
    createMany(args: unknown): Promise<{ count: number }>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  $transaction<T>(callback: (tx: ArchitectureDb) => Promise<T>, options?: { maxWait?: number; timeout?: number }): Promise<T>;
}

export async function publishKnowledgeArchitectureView(
  input: {
    projectDigest: string;
    stableKey: string;
    title: string;
    manifest: unknown;
    bundleObjectKey: string;
  },
  db: ArchitectureDb = prisma as unknown as ArchitectureDb,
): Promise<ArchitectureViewProjection> {
  const manifest = parseArchitectureManifest(input.manifest);
  const projectDigest = requiredDigest(input.projectDigest, "projectDigest");
  const stableKey = requiredText(input.stableKey, "stableKey");
  const title = requiredText(input.title, "title");
  if (!/^[A-Za-z0-9._:/-]+$/u.test(input.bundleObjectKey) || input.bundleObjectKey.startsWith("/")) {
    throw validationError("Architecture bundle object key is invalid");
  }
  const viewId = knowledgeId("knowledge-architecture-view", projectDigest, stableKey);
  const contentDigest = knowledgeDigest("knowledge-architecture-manifest", JSON.stringify(manifest));
  const now = new Date();
  return db.$transaction(async (tx) => {
    const current = await tx.knowledgeArchitectureView.findUnique({ where: { id: viewId } });
    const latestVersion = Number(current?.latestVersion ?? 0);
    const version = latestVersion + 1;
    const versionId = knowledgeId("knowledge-architecture-view-version", viewId, String(version));
    if (!current) {
      await tx.knowledgeArchitectureView.createMany({
        data: [{ id: viewId, projectDigest, stableKey, title, status: "published", latestVersion: 0, createdAt: now, updatedAt: now }],
        skipDuplicates: true,
      });
    }
    await tx.knowledgeArchitectureViewVersion.updateMany({
      where: { viewId, status: "published" },
      data: { status: "superseded" },
    });
    await tx.knowledgeArchitectureViewVersion.createMany({
      data: [{
        id: versionId,
        viewId,
        version,
        manifest,
        contentDigest,
        bundleObjectKey: input.bundleObjectKey,
        status: "published",
        publishedAt: now,
        createdAt: now,
      }],
      skipDuplicates: false,
    });
    const updated = await tx.knowledgeArchitectureView.updateMany({
      where: { id: viewId, latestVersion },
      data: { title, status: "published", latestVersion: version, updatedAt: now },
    });
    if (updated.count !== 1) throw versionConflict("Architecture view changed while publishing");
    return { id: viewId, projectDigest, stableKey, title, status: "published", latestVersion: version, updatedAt: now };
  }, KNOWLEDGE_TRANSACTION_OPTIONS);
}

export async function listKnowledgeArchitectureViews(
  projectDigest: string,
  db: ArchitectureDb = prisma as unknown as ArchitectureDb,
): Promise<ArchitectureViewProjection[]> {
  const rows = await db.$transaction(async (tx) => tx.knowledgeArchitectureViewVersion.findMany({
    where: { view: { projectDigest } },
    include: { view: true },
  }) as never);
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const version = row as Record<string, unknown>;
    const view = version.view as Record<string, unknown> | undefined;
    if (!view || version.status !== "published") continue;
    latest.set(String(view.id), view);
  }
  return [...latest.values()].map((view) => ({
    id: String(view.id),
    projectDigest: String(view.projectDigest),
    stableKey: String(view.stableKey),
    title: String(view.title),
    status: String(view.status),
    latestVersion: Number(view.latestVersion),
    updatedAt: new Date(String(view.updatedAt)),
  }));
}

export async function getKnowledgeArchitectureVersion(
  input: { projectDigest: string; viewId: string; version?: number },
  db: ArchitectureDb = prisma as unknown as ArchitectureDb,
): Promise<ArchitectureViewVersionProjection | null> {
  const rows = await db.$transaction(async (tx) => tx.knowledgeArchitectureViewVersion.findMany({
    where: {
      viewId: input.viewId,
      ...(input.version === undefined ? { status: "published" } : { version: input.version }),
      view: { projectDigest: input.projectDigest },
    },
  }) as never);
  const row = (Array.isArray(rows) ? rows : [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    viewId: String(row.viewId),
    version: Number(row.version),
    manifest: parseArchitectureManifest(row.manifest),
    contentDigest: String(row.contentDigest),
    bundleObjectKey: String(row.bundleObjectKey),
    status: String(row.status),
    publishedAt: new Date(String(row.publishedAt)),
  };
}

export function architectureNeighborhood(manifest: ArchitectureManifest, nodeKey: string) {
  const node = manifest.nodes.find((candidate) => candidate.key === nodeKey);
  if (!node) throw notFound("Architecture node not found");
  const upstream = manifest.edges.filter((edge) => edge.to === nodeKey);
  const downstream = manifest.edges.filter((edge) => edge.from === nodeKey);
  const relatedKeys = new Set([...upstream.map((edge) => edge.from), ...downstream.map((edge) => edge.to)]);
  return {
    node,
    upstream,
    downstream,
    relatedNodes: manifest.nodes.filter((candidate) => relatedKeys.has(candidate.key)),
    relatedEntryKeys: node.documentRefs.filter((reference) => reference.kind === "knowledge").map((reference) => reference.ref),
  };
}

function requiredDigest(value: string, field: string): string {
  const normalized = requiredText(value, field);
  if (!/^[a-f0-9]{32}$/u.test(normalized)) throw validationError(`${field} must be a lowercase MD5 digest`);
  return normalized;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw validationError(`${field} is required`);
  return normalized;
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}

function versionConflict(message: string): Error {
  return Object.assign(new Error(message), { code: "version_conflict" });
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: "not_found" });
}
