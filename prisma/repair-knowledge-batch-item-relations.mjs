#!/usr/bin/env node
// Repairs KnowledgeBatchItem rows whose `relations` payload was persisted as an
// empty object instead of an empty array. Older platform versions validated the
// payload only at publication time, so such a batch could never be approved.
//
// Only provably equivalent data is rewritten: an empty JSON object becomes an
// empty array. Any non-empty or otherwise malformed value is reported and left
// untouched for manual review.
//
// Usage:
//   node prisma/repair-knowledge-batch-item-relations.mjs <batchId>
//   node prisma/repair-knowledge-batch-item-relations.mjs <batchId> --apply

import { writeSync } from "node:fs";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const batchId = process.argv.slice(2).find((value) => !value.startsWith("--"))?.trim();

async function main() {
  if (!batchId || !/^[a-f0-9]{32}$/u.test(batchId)) {
    writeSync(2, "A lowercase 32-character batchId is required.\n");
    return 1;
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

  try {
    const batch = await prisma.knowledgeBatch.findUnique({
      where: { id: batchId },
      select: { id: true, jobId: true, status: true, projectDigest: true },
    });
    if (!batch) {
      writeSync(2, `Knowledge batch ${batchId} was not found.\n`);
      return 1;
    }
    const items = await prisma.knowledgeBatchItem.findMany({
      where: { batchId },
      orderBy: { ordinal: "asc" },
      select: { id: true, ordinal: true, stableKey: true, relations: true, publishedVersion: true },
    });

    const repairable = [];
    const blocked = [];
    for (const item of items) {
      if (Array.isArray(item.relations)) continue;
      const isEmptyObject = item.relations
        && typeof item.relations === "object"
        && !Array.isArray(item.relations)
        && Object.keys(item.relations).length === 0;
      if (isEmptyObject && item.publishedVersion === null) {
        repairable.push(item);
      } else {
        blocked.push({
          ordinal: item.ordinal,
          stableKey: item.stableKey,
          publishedVersion: item.publishedVersion,
          reason: item.publishedVersion === null ? "relations payload is not an empty object" : "item is already published",
        });
      }
    }

    writeSync(1, `${JSON.stringify({
      mode: APPLY ? "apply" : "dry-run",
      batch,
      totalItems: items.length,
      alreadyArray: items.length - repairable.length - blocked.length,
      repairable: repairable.map((item) => ({ ordinal: item.ordinal, stableKey: item.stableKey })),
      blocked,
    }, null, 2)}\n`);

    if (!APPLY) {
      writeSync(1, "Dry run only. Re-run with --apply to rewrite empty-object relations as empty arrays.\n");
      return blocked.length === 0 ? 0 : 2;
    }
    if (repairable.length === 0) {
      writeSync(1, "No repairable rows.\n");
      return blocked.length === 0 ? 0 : 2;
    }

    const repaired = await prisma.$transaction(async (tx) => {
      let count = 0;
      for (const item of repairable) {
        const updated = await tx.knowledgeBatchItem.updateMany({
          where: { id: item.id, publishedVersion: null },
          data: { relations: [] },
        });
        count += updated.count;
      }
      return count;
    }, { maxWait: 5_000, timeout: 30_000 });
    writeSync(1, `Repaired ${repaired} of ${repairable.length} targeted rows.\n`);
    return blocked.length === 0 ? 0 : 2;
  } finally {
    await prisma.$disconnect();
  }
}

main().then((code) => process.exit(code ?? 0), (error) => {
  writeSync(2, error instanceof Error ? `${error.name}: ${error.message}\n` : `${String(error)}\n`);
  process.exit(1);
});
