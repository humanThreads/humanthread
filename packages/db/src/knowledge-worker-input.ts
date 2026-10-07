import { prisma } from "./prisma";

export interface KnowledgeWorkerInput {
  jobId: string;
  taskId: string;
  projectDigest: string;
  mode: string;
  templateVersionId: string;
  templateContent: string;
  sourceSnapshot: unknown;
  sourceSnapshotDigest: string;
  allowedEntryTypes: string[];
  allowedRelationTypes: string[];
  maxItems: number;
  previousStableKeys: string[];
}

export async function loadKnowledgeWorkerInput(input: {
  jobId: string;
}, db: {
  knowledgeJob: { findUnique(args: unknown): Promise<{
    id: string; taskId: string; projectDigest: string; mode: string; templateVersionId: string;
    sourceSnapshot: unknown; sourceSnapshotDigest: string;
  } | null> };
  knowledgeTemplateVersion: { findUnique(args: unknown): Promise<{ content: string } | null> };
  knowledgePolicy: { findUnique(args: unknown): Promise<{ allowedEntryTypes: unknown } | null> };
  knowledgeEntry: { findMany(args: unknown): Promise<Array<{ stableKey: string }>> };
} = prisma as never): Promise<KnowledgeWorkerInput> {
  const job = await db.knowledgeJob.findUnique({ where: { id: input.jobId } });
  if (!job) throw notFound("Knowledge job not found");
  const [template, policy, entries] = await Promise.all([
    db.knowledgeTemplateVersion.findUnique({ where: { id: job.templateVersionId } }),
    db.knowledgePolicy.findUnique({ where: { projectDigest: job.projectDigest } }),
    db.knowledgeEntry.findMany({ where: { projectDigest: job.projectDigest, status: "published" }, select: { stableKey: true } }),
  ]);
  if (!template) throw notFound("Knowledge template version not found");
  return {
    jobId: job.id,
    taskId: job.taskId,
    projectDigest: job.projectDigest,
    mode: job.mode,
    templateVersionId: job.templateVersionId,
    templateContent: template.content,
    sourceSnapshot: job.sourceSnapshot,
    sourceSnapshotDigest: job.sourceSnapshotDigest,
    allowedEntryTypes: Array.isArray(policy?.allowedEntryTypes)
      ? policy.allowedEntryTypes.filter((value): value is string => typeof value === "string")
      : [],
    allowedRelationTypes: ["depends_on", "contains", "calls", "publishes", "consumes", "evolves_to", "supersedes", "constrains", "related_to"],
    maxItems: 500,
    previousStableKeys: entries.map((entry) => entry.stableKey),
  };
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: "not_found" });
}
