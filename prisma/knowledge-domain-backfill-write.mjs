const TRANSACTION_OPTIONS = Object.freeze({
  maxWait: 5_000,
  timeout: 30_000,
});

export async function writeKnowledgeDomainBackfillPlan(prisma, plan) {
  return prisma.$transaction(async (tx) => {
    const counts = {};
    counts.policies = await createMany(tx.knowledgePolicy, plan.policies);
    counts.jobs = await createMany(tx.knowledgeJob, plan.jobs);
    counts.batches = await createMany(tx.knowledgeBatch, plan.batches);
    counts.items = await createMany(tx.knowledgeBatchItem, plan.items);
    counts.entries = await createMany(tx.knowledgeEntry, plan.entries);
    counts.versions = await createMany(tx.knowledgeEntryVersion, plan.versions);
    counts.relations = await createMany(tx.knowledgeRelation, plan.relations);
    return counts;
  }, TRANSACTION_OPTIONS);
}

async function createMany(delegate, rows) {
  if (rows.length === 0) return 0;
  const result = await delegate.createMany({ data: rows, skipDuplicates: true });
  return result.count;
}
