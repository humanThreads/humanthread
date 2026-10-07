import { prisma } from "@humanthread/db";

interface QueuedKnowledgeIndexJob {
  id: string;
  status: string;
  version: number;
}

export interface KnowledgeIndexDispatcherDependencies {
  listQueued(limit: number): Promise<QueuedKnowledgeIndexJob[]>;
  markDispatched(job: QueuedKnowledgeIndexJob): Promise<void>;
  dispatch(input: { jobId: string; indexerUrl: string; token?: string }): Promise<unknown>;
}

const DEFAULT_DEPENDENCIES: KnowledgeIndexDispatcherDependencies = {
  listQueued: (limit) => prisma.knowledgeIndexJob.findMany({
    where: { status: "queued" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, status: true, version: true },
  }),
  markDispatched: async (job) => {
    await prisma.knowledgeIndexJob.updateMany({
      where: { id: job.id, status: { in: ["running", "active"] } },
      data: { heartbeatAt: new Date() },
    });
  },
  dispatch: async ({ jobId, indexerUrl, token }) => {
    const response = await fetch(new URL("/v1/index-jobs", indexerUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jobId }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Knowledge indexer dispatch failed: ${response.status} ${body.slice(0, 200)}`.trim());
    }
    return response.json().catch(() => ({}));
  },
};

/**
 * Claims queued KnowledgeIndexJob rows and hands each one to the index service.
 * The service performs the atomic claim, so a failed dispatch leaves the row
 * queued and it is retried on the next worker iteration.
 */
export async function dispatchQueuedKnowledgeIndexJobs(input: {
  limit?: number;
  indexerUrl?: string;
  token?: string;
  dependencies?: Partial<KnowledgeIndexDispatcherDependencies>;
} = {}): Promise<{ dispatched: number; skipped: number; failed: number }> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...input.dependencies };
  const indexerUrl = (input.indexerUrl ?? process.env.HUMANTHREAD_KNOWLEDGE_INDEXER_URL ?? "").trim();
  if (!indexerUrl) return { dispatched: 0, skipped: 0, failed: 0 };
  const token = input.token ?? process.env.HUMANTHREAD_KNOWLEDGE_INDEXER_TOKEN?.trim();
  const limit = input.limit ?? 20;
  const jobs = await dependencies.listQueued(limit);
  let dispatched = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await dependencies.dispatch({ jobId: job.id, indexerUrl, ...(token ? { token } : {}) });
      await dependencies.markDispatched(job);
      dispatched += 1;
    } catch {
      failed += 1;
    }
  }
  return { dispatched, skipped: 0, failed };
}
