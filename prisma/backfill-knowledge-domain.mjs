import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";

import {
  planKnowledgeDomainBackfill,
  summarizeKnowledgeDomainBackfill,
} from "./knowledge-domain-backfill-plan.mjs";
import { writeKnowledgeDomainBackfillPlan } from "./knowledge-domain-backfill-write.mjs";

const args = process.argv.slice(2);

if (args.includes("--help")) {
  console.log("Usage: node prisma/backfill-knowledge-domain.mjs [--apply]");
  console.log("Defaults to dry-run. Use --apply to write the planned rows.");
  process.exit(0);
}

const unknownArgs = args.filter((arg) => arg !== "--apply");
if (unknownArgs.length > 0) {
  console.error(`Unknown argument(s): ${unknownArgs.join(", ")}`);
  console.error("Run with --help for usage.");
  process.exit(1);
}

const apply = args.includes("--apply");
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error("DATABASE_URL is required to backfill the knowledge domain.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

function errorCodeSummary(errors) {
  return errors.reduce((summary, error) => {
    summary[error.code] = (summary[error.code] ?? 0) + 1;
    return summary;
  }, {});
}

function ids(rows) {
  return rows.map((row) => row.id);
}

async function countPending(plan) {
  const idsByTable = {
    policies: ids(plan.policies),
    jobs: ids(plan.jobs),
    batches: ids(plan.batches),
    items: ids(plan.items),
    entries: ids(plan.entries),
    versions: ids(plan.versions),
    relations: ids(plan.relations),
  };
  const [policies, jobs, batches, items, entries, versions, relations] = await Promise.all([
    countMissing(prisma.knowledgePolicy, idsByTable.policies),
    countMissing(prisma.knowledgeJob, idsByTable.jobs),
    countMissing(prisma.knowledgeBatch, idsByTable.batches),
    countMissing(prisma.knowledgeBatchItem, idsByTable.items),
    countMissing(prisma.knowledgeEntry, idsByTable.entries),
    countMissing(prisma.knowledgeEntryVersion, idsByTable.versions),
    countMissing(prisma.knowledgeRelation, idsByTable.relations),
  ]);
  return { policies, jobs, batches, items, entries, versions, relations };
}

async function countMissing(delegate, rowIds) {
  if (rowIds.length === 0) return 0;
  const existing = await delegate.count({ where: { id: { in: rowIds } } });
  return rowIds.length - existing;
}

async function main() {
  const [projects, candidates] = await Promise.all([
    prisma.project.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
    }),
    prisma.knowledgeCandidate.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        projectId: true,
        loopRunId: true,
        loopNodeRunId: true,
        sourceEventId: true,
        sourceArtifactId: true,
        sourceReferences: true,
        contentSummary: true,
        confidence: true,
        extractorVersion: true,
        status: true,
        reviewedByUserId: true,
        reviewReason: true,
        publishedDocumentId: true,
        publishedDocumentVersion: true,
        reviewedAt: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);
  const documentIds = [...new Set(
    candidates.flatMap((candidate) => candidate.publishedDocumentId ? [candidate.publishedDocumentId] : []),
  )];
  const [documents, documentRevisions] = documentIds.length === 0
    ? [[], []]
    : await Promise.all([
        prisma.document.findMany({
          where: { id: { in: documentIds } },
          select: {
            id: true,
            projectId: true,
            path: true,
            contentMarkdown: true,
            version: true,
          },
        }),
        prisma.documentRevision.findMany({
          where: { documentId: { in: documentIds } },
          select: {
            id: true,
            documentId: true,
            version: true,
            contentMarkdown: true,
          },
        }),
      ]);

  const plan = planKnowledgeDomainBackfill({
    projects,
    candidates,
    documents,
    documentRevisions,
  });
  const summary = summarizeKnowledgeDomainBackfill(plan);

  if (plan.errors.length > 0) {
    console.error(JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      summary,
      errorCodes: errorCodeSummary(plan.errors),
    }));
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    const pending = await countPending(plan);
    console.log(JSON.stringify({ mode: "dry-run", summary, pending }));
    return;
  }

  const created = await writeKnowledgeDomainBackfillPlan(prisma, plan);
  console.log(JSON.stringify({ mode: "apply", summary, created }));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      error: "knowledge_domain_backfill_failed",
      code: error && typeof error === "object" && "code" in error ? error.code : undefined,
    }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
