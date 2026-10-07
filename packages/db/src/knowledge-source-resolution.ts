import { knowledgeProjectDigest } from "./knowledge-reference";
import { prisma } from "./prisma";

export interface ResolvableKnowledgeSourceReference {
  kind: string;
  ref: string;
  sourceType?: string;
}

export interface ResolvedKnowledgeSource {
  kind: string;
  ref: string;
  sourceType: string;
  active: boolean;
  missing: boolean;
  accessible: boolean;
}

interface SourceResolutionTx {
  task: {
    findUnique(args: unknown): Promise<{ id: string; projectId: string | null; archivedAt: Date | null } | null>;
  };
  document: {
    findUnique(args: unknown): Promise<{ id: string; projectId: string | null; deletedAt: Date | null } | null>;
  };
  loopRun: {
    findUnique(args: unknown): Promise<{ id: string; projectId: string; status: string } | null>;
  };
}

type SourceResolutionDb = SourceResolutionTx;

const DEFAULT_DB = prisma as unknown as SourceResolutionDb;

export async function resolveKnowledgeSources(input: {
  projectDigest: string;
  references: ResolvableKnowledgeSourceReference[];
}, db: SourceResolutionDb = DEFAULT_DB): Promise<ResolvedKnowledgeSource[]> {
  if (input.references.length === 0) throw validationError("Knowledge source references are required");
  return Promise.all(input.references.map((reference) => resolveOne(db, input.projectDigest, reference)));
}

async function resolveOne(tx: SourceResolutionTx, projectDigest: string, reference: ResolvableKnowledgeSourceReference): Promise<ResolvedKnowledgeSource> {
  const kind = requiredText(reference.kind, "source.kind");
  const rawRef = requiredText(reference.ref, "source.ref");
  if (kind === "task") {
    const id = stripPrefix(rawRef, "task:");
    const task = await tx.task.findUnique({ where: { id }, select: { id: true, projectId: true, archivedAt: true } });
    return result(reference, kind, id, Boolean(task && task.projectId && knowledgeProjectDigest(task.projectId) === projectDigest && !task.archivedAt), !task);
  }
  if (kind === "document") {
    const id = stripPrefix(rawRef, "doc:");
    const document = await tx.document.findUnique({ where: { id }, select: { id: true, projectId: true, deletedAt: true } });
    return result(reference, kind, id, Boolean(document && document.projectId && knowledgeProjectDigest(document.projectId) === projectDigest && !document.deletedAt), !document);
  }
  if (kind === "loop-run") {
    const id = stripPrefix(rawRef, "loop-run:");
    const run = await tx.loopRun.findUnique({ where: { id }, select: { id: true, projectId: true, status: true } });
    const active = Boolean(run && knowledgeProjectDigest(run.projectId) === projectDigest && run.status !== "failed" && run.status !== "cancelled");
    return result(reference, kind, id, active, !run);
  }
  throw validationError(`Unsupported knowledge source kind: ${kind}`);
}

function result(reference: ResolvableKnowledgeSourceReference, kind: string, ref: string, active: boolean, missing: boolean): ResolvedKnowledgeSource {
  return {
    kind,
    ref,
    sourceType: reference.sourceType ?? kind,
    active,
    missing,
    accessible: !missing,
  };
}

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw validationError(`${field} is required`);
  return value.trim();
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}
