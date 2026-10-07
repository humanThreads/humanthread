import { createHash } from "node:crypto";

import { boundedPersistenceId } from "./bounded-id";
import { createProjectDocument } from "./documents";
import { prisma } from "./prisma";

export type KnowledgeCandidateStatus =
  | "candidate"
  | "review_required"
  | "published"
  | "rejected"
  | "superseded";

export interface KnowledgeSourceReference {
  loopRunId: string;
  nodeRunId?: string;
  eventId?: string;
  artifactId?: string;
}

export interface KnowledgeCandidateProjection {
  id: string;
  projectId: string;
  title: string;
  contentSummary: string;
  contentFingerprint: string;
  sourceRefs: KnowledgeSourceReference[];
  confidence: number;
  redactionResult: Record<string, unknown>;
  conflictResult: Record<string, unknown>;
  extractorVersion: string;
  status: KnowledgeCandidateStatus;
  reviewedByUserId: string | null;
  reviewReason: string | null;
  publishedDocumentId: string | null;
  publishedDocumentVersion: number | null;
  reviewedAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface PersistKnowledgeCandidateInput {
  projectId: string;
  title: string;
  safeContent: string;
  sourceRefs: KnowledgeSourceReference[];
  confidence: number;
  redactionResult: Record<string, unknown>;
  conflictResult: Record<string, unknown>;
  extractorVersion: string;
  status: "candidate" | "review_required";
}

interface KnowledgeCandidateRow {
  id: string;
  projectId: string;
  loopRunId: string;
  loopNodeRunId: string | null;
  sourceEventId: string | null;
  sourceArtifactId: string | null;
  dedupeKey: string | null;
  contentSummary: string;
  sourceReferences: unknown;
  confidence: number;
  redactionResult: unknown;
  conflictResult: unknown;
  extractorVersion: string;
  status: string;
  reviewedByUserId: string | null;
  reviewReason: string | null;
  publishedDocumentId: string | null;
  publishedDocumentVersion: number | null;
  reviewedAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
}

interface KnowledgeCandidateStore {
  knowledgeCandidate: {
    findUnique(args: unknown): Promise<KnowledgeCandidateRow | null>;
    findMany(args: unknown): Promise<KnowledgeCandidateRow[]>;
    createMany(args: { data: Array<Record<string, unknown>>; skipDuplicates: boolean }): Promise<{ count: number }>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

interface KnowledgeCandidateDb extends KnowledgeCandidateStore {
  $transaction<T>(callback: (tx: KnowledgeCandidateStore) => Promise<T>): Promise<T>;
}

interface DocumentVersionInput {
  candidateId: string;
  projectId: string;
  title: string;
  path: string;
  contentMarkdown: string;
  actorUserId: string;
}

interface KnowledgeCandidateDependencies {
  db: KnowledgeCandidateDb;
  now?: () => Date;
  createDocumentVersion(input: DocumentVersionInput): Promise<{ id: string; version: number }>;
}

interface KnowledgeConflictDependencies {
  db: {
    document: {
      findMany(args: unknown): Promise<Array<{
        id: string;
        title: string;
        contentMarkdown: string;
      }>>;
    };
  };
}

const DEFAULT_DEPENDENCIES: KnowledgeCandidateDependencies = {
  db: prisma as unknown as KnowledgeCandidateDb,
  createDocumentVersion: createKnowledgeDocumentVersion,
};

const DEFAULT_CONFLICT_DEPENDENCIES: KnowledgeConflictDependencies = {
  db: prisma,
};

export async function findKnowledgeCandidateConflicts(
  input: { projectId: string; title: string; safeContent: string },
  dependencies: KnowledgeConflictDependencies = DEFAULT_CONFLICT_DEPENDENCIES,
): Promise<Array<{ documentId: string; reason: string }>> {
  const projectId = requiredId(input.projectId, "projectId");
  const title = requiredText(input.title, "title");
  const content = normalizeKnowledgeContent(input.safeContent);
  const documents = await dependencies.db.document.findMany({
    where: { projectId, deletedAt: null },
    select: { id: true, title: true, contentMarkdown: true },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 500,
  });
  return documents.flatMap((document) => {
    if (normalizeKnowledgeContent(document.contentMarkdown) === content) {
      return [{ documentId: document.id, reason: "项目中已存在相同内容" }];
    }
    if (document.title.trim() === title) {
      return [{ documentId: document.id, reason: "同名项目文档包含不同内容" }];
    }
    return [];
  });
}

export async function persistKnowledgeCandidate(
  input: PersistKnowledgeCandidateInput,
  dependencies: KnowledgeCandidateDependencies = DEFAULT_DEPENDENCIES,
): Promise<KnowledgeCandidateProjection> {
  const projectId = requiredId(input.projectId, "projectId");
  const title = requiredText(input.title, "title");
  const safeContent = requiredText(input.safeContent, "safeContent");
  const extractorVersion = requiredId(input.extractorVersion, "extractorVersion");
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new Error("Knowledge confidence must be between 0 and 1");
  }
  const sourceRefs = normalizeSourceRefs(input.sourceRefs);
  const contentFingerprint = fingerprint(safeContent.replace(/\r\n?/gu, "\n").trim());
  const sourceFingerprint = fingerprint(canonicalJson(sourceRefs));
  const digest = createHash("sha256")
    .update([projectId, contentFingerprint, sourceFingerprint].join("\0"))
    .digest("hex");
  const dedupeKey = `knowledge:${digest}`;
  const id = boundedPersistenceId("knowledge-candidate", [digest]);
  const now = dependencies.now?.() ?? new Date();
  const firstSource = sourceRefs[0]!;

  return dependencies.db.$transaction(async (tx) => {
    const existing = await tx.knowledgeCandidate.findUnique({ where: { dedupeKey } });
    if (existing) return projectRow(existing);
    const data = {
      id,
      projectId,
      loopRunId: firstSource.loopRunId,
      loopNodeRunId: firstSource.nodeRunId ?? null,
      sourceEventId: firstSource.eventId ?? null,
      sourceArtifactId: firstSource.artifactId ?? null,
      dedupeKey,
      contentSummary: safeContent,
      sourceReferences: { title, contentFingerprint, references: sourceRefs },
      confidence: input.confidence,
      redactionResult: input.redactionResult,
      conflictResult: input.conflictResult,
      extractorVersion,
      status: input.status,
      reviewedByUserId: null,
      reviewReason: null,
      publishedDocumentId: null,
      publishedDocumentVersion: null,
      reviewedAt: null,
      publishedAt: null,
      createdAt: now,
    };
    const inserted = await tx.knowledgeCandidate.createMany({ data: [data], skipDuplicates: true });
    if (inserted.count === 1) return projectRow(data as KnowledgeCandidateRow);
    const raced = await tx.knowledgeCandidate.findUnique({ where: { dedupeKey } });
    if (!raced) throw new Error("Knowledge candidate dedupe conflict");
    return projectRow(raced);
  });
}

export async function readKnowledgeCandidateAccess(
  input: { candidateId: string },
  dependencies: Pick<KnowledgeCandidateDependencies, "db"> = DEFAULT_DEPENDENCIES,
): Promise<{ id: string; projectId: string } | null> {
  const row = await dependencies.db.knowledgeCandidate.findUnique({
    where: { id: requiredId(input.candidateId, "candidateId") },
    select: { id: true, projectId: true },
  });
  return row ? { id: row.id, projectId: row.projectId } : null;
}

export async function listKnowledgeCandidates(
  input: { projectId: string; statuses?: KnowledgeCandidateStatus[]; limit?: number },
  dependencies: Pick<KnowledgeCandidateDependencies, "db"> = DEFAULT_DEPENDENCIES,
): Promise<KnowledgeCandidateProjection[]> {
  const statuses = input.statuses?.length ? Array.from(new Set(input.statuses)) : undefined;
  const rows = await dependencies.db.knowledgeCandidate.findMany({
    where: {
      projectId: requiredId(input.projectId, "projectId"),
      ...(statuses ? { status: { in: statuses } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(input.limit ?? 100, 1), 200),
  });
  return rows.map(projectRow);
}

export async function publishKnowledgeCandidate(
  input: { candidateId: string; actorUserId: string },
  dependencies: KnowledgeCandidateDependencies = DEFAULT_DEPENDENCIES,
): Promise<KnowledgeCandidateProjection> {
  const candidateId = requiredId(input.candidateId, "candidateId");
  const actorUserId = requiredId(input.actorUserId, "actorUserId");
  const current = await dependencies.db.knowledgeCandidate.findUnique({ where: { id: candidateId } });
  if (!current) throw notFound("Knowledge candidate not found");
  if (current.status === "published") {
    if (!current.publishedDocumentId || current.publishedDocumentVersion === null) {
      throw new Error("Published knowledge candidate is incomplete");
    }
    return projectRow(current);
  }
  if (current.status !== "candidate" && current.status !== "review_required") {
    throw versionConflict("Knowledge candidate is no longer publishable");
  }

  const now = dependencies.now?.() ?? new Date();
  if (current.reviewedByUserId && current.reviewedByUserId !== actorUserId) {
    throw versionConflict("Knowledge candidate publication is already claimed");
  }
  if (!current.reviewedByUserId) {
    const claimed = await dependencies.db.knowledgeCandidate.updateMany({
      where: {
        id: candidateId,
        status: { in: ["candidate", "review_required"] },
        reviewedByUserId: null,
        publishedDocumentId: null,
      },
      data: {
        reviewedByUserId: actorUserId,
        reviewedAt: now,
      },
    });
    if (claimed.count !== 1) {
      const raced = await dependencies.db.knowledgeCandidate.findUnique({ where: { id: candidateId } });
      if (!raced) throw notFound("Knowledge candidate not found");
      if (raced.status === "published") return projectRow(raced);
      if (raced.reviewedByUserId !== actorUserId) {
        throw versionConflict("Knowledge candidate publication is already claimed");
      }
    }
  }

  const projected = projectRow(current);
  const documentId = boundedPersistenceId("knowledge-doc", [candidateId]);
  const document = await dependencies.createDocumentVersion({
    candidateId,
    projectId: current.projectId,
    title: projected.title,
    path: `知识库/Loop/${documentId.replaceAll(":", "-")}.md`,
    contentMarkdown: buildKnowledgeDocument(projected),
    actorUserId,
  });
  const updated = await dependencies.db.knowledgeCandidate.updateMany({
    where: {
      id: candidateId,
      status: { in: ["candidate", "review_required"] },
      reviewedByUserId: actorUserId,
      publishedDocumentId: null,
    },
    data: {
      status: "published",
      publishedDocumentId: document.id,
      publishedDocumentVersion: document.version,
      publishedAt: now,
    },
  });
  const result = await dependencies.db.knowledgeCandidate.findUnique({ where: { id: candidateId } });
  if (!result) throw notFound("Knowledge candidate not found");
  if (updated.count !== 1 && result.status !== "published") {
    throw versionConflict("Knowledge candidate changed during publication");
  }
  return projectRow(result);
}

export async function decideKnowledgeCandidate(
  input: {
    candidateId: string;
    actorUserId: string;
    decision: "publish" | "reject" | "supersede";
    reason?: string;
    commandId?: string;
  },
  dependencies: KnowledgeCandidateDependencies = DEFAULT_DEPENDENCIES,
): Promise<KnowledgeCandidateProjection> {
  if (input.decision === "publish") {
    return publishKnowledgeCandidate(input, dependencies);
  }
  const reason = input.reason?.trim() ?? "";
  if (!reason) throw new Error("Knowledge review reason is required");
  const candidateId = requiredId(input.candidateId, "candidateId");
  const actorUserId = requiredId(input.actorUserId, "actorUserId");
  const nextStatus = input.decision === "reject" ? "rejected" : "superseded";
  const now = dependencies.now?.() ?? new Date();
  const updated = await dependencies.db.knowledgeCandidate.updateMany({
    where: {
      id: candidateId,
      status: { in: ["candidate", "review_required"] },
      reviewedByUserId: null,
      publishedDocumentId: null,
    },
    data: {
      status: nextStatus,
      reviewedByUserId: actorUserId,
      reviewReason: reason,
      reviewedAt: now,
    },
  });
  const result = await dependencies.db.knowledgeCandidate.findUnique({ where: { id: candidateId } });
  if (!result) throw notFound("Knowledge candidate not found");
  if (updated.count !== 1 && result.status !== nextStatus) {
    throw versionConflict("Knowledge candidate is no longer reviewable");
  }
  return projectRow(result);
}

async function createKnowledgeDocumentVersion(input: DocumentVersionInput) {
  const documentId = boundedPersistenceId("knowledge-doc", [input.candidateId]);
  try {
    return await createProjectDocument({
      projectId: input.projectId,
      title: input.title,
      path: input.path,
      contentMarkdown: input.contentMarkdown,
      actorUserId: input.actorUserId,
      source: "system",
      createId: () => documentId,
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "Document path conflict") throw error;
    const existing = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, projectId: true, version: true },
    });
    if (!existing || existing.projectId !== input.projectId) throw error;
    return { id: existing.id, version: existing.version };
  }
}

function projectRow(row: KnowledgeCandidateRow): KnowledgeCandidateProjection {
  const source = asRecord(row.sourceReferences);
  const refsValue = Array.isArray(row.sourceReferences)
    ? row.sourceReferences
    : source.references;
  const sourceRefs = normalizeSourceRefs(Array.isArray(refsValue) ? refsValue : []);
  const contentFingerprint = typeof source.contentFingerprint === "string"
    ? source.contentFingerprint
    : fingerprint(row.contentSummary.replace(/\r\n?/gu, "\n").trim());
  return {
    id: row.id,
    projectId: row.projectId,
    title: typeof source.title === "string" && source.title.trim() ? source.title : "Loop 知识候选",
    contentSummary: row.contentSummary,
    contentFingerprint,
    sourceRefs,
    confidence: row.confidence,
    redactionResult: asRecord(row.redactionResult),
    conflictResult: asRecord(row.conflictResult),
    extractorVersion: row.extractorVersion,
    status: asStatus(row.status),
    reviewedByUserId: row.reviewedByUserId,
    reviewReason: row.reviewReason,
    publishedDocumentId: row.publishedDocumentId,
    publishedDocumentVersion: row.publishedDocumentVersion,
    reviewedAt: row.reviewedAt,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
  };
}

function buildKnowledgeDocument(candidate: KnowledgeCandidateProjection): string {
  const provenance = candidate.sourceRefs.map((source) => {
    const details = [
      `Loop Run \`${source.loopRunId}\``,
      source.nodeRunId ? `Node \`${source.nodeRunId}\`` : null,
      source.eventId ? `Event \`${source.eventId}\`` : null,
      source.artifactId ? `Artifact \`${source.artifactId}\`` : null,
    ].filter(Boolean).join(" · ");
    return `- ${details}`;
  }).join("\n");
  return `# ${candidate.title}\n\n${candidate.contentSummary}\n\n## 来源\n\n${provenance}\n\n- 内容指纹：\`${candidate.contentFingerprint}\`\n- 提取器：\`${candidate.extractorVersion}\``;
}

function normalizeSourceRefs(value: unknown[]): KnowledgeSourceReference[] {
  if (value.length === 0) throw new Error("Knowledge candidate provenance is required");
  const normalized = value.map((item) => {
    const record = asRecord(item);
    return {
      loopRunId: requiredId(String(record.loopRunId ?? ""), "source.loopRunId"),
      ...(typeof record.nodeRunId === "string" && record.nodeRunId ? { nodeRunId: record.nodeRunId } : {}),
      ...(typeof record.eventId === "string" && record.eventId ? { eventId: record.eventId } : {}),
      ...(typeof record.artifactId === "string" && record.artifactId ? { artifactId: record.artifactId } : {}),
    };
  });
  return normalized.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asStatus(value: string): KnowledgeCandidateStatus {
  if (value === "candidate" || value === "review_required" || value === "published" || value === "rejected" || value === "superseded") return value;
  throw new Error("Knowledge candidate status is invalid");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function fingerprint(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalizeKnowledgeContent(value: string): string {
  return value.replace(/\r\n?/gu, "\n").trim();
}

function requiredId(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: "not_found" });
}

function versionConflict(message: string): Error {
  return Object.assign(new Error(message), { code: "version_conflict" });
}
