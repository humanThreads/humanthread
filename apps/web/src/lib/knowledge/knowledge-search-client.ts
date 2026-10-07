export interface KnowledgeSearchClientItem {
  score: number;
  entryId: string | null;
  version: number | null;
  stableKey: string | null;
  title: string | null;
  entryType: string | null;
  content: string | null;
  headingPath: string[];
  tags: string[];
  chunkIndex: number;
  contentDigest: string | null;
}

export interface KnowledgeSearchClientResult {
  items: KnowledgeSearchClientItem[];
}

export async function searchProjectKnowledge(input: {
  projectDigest: string;
  query: string;
  limit?: number;
  entryType?: string;
}): Promise<KnowledgeSearchClientResult> {
  const indexerUrl = process.env.HUMANTHREAD_KNOWLEDGE_INDEXER_URL?.trim();
  if (!indexerUrl) throw Object.assign(new Error("Knowledge indexer is not configured"), { code: "index_unavailable" });
  const token = process.env.HUMANTHREAD_KNOWLEDGE_INDEXER_TOKEN?.trim();
  const response = await fetch(new URL("/v1/search", indexerUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      projectDigest: input.projectDigest,
      query: input.query,
      limit: input.limit ?? 10,
      ...(input.entryType ? { entryType: input.entryType } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw Object.assign(new Error("Knowledge index is unavailable"), { code: "index_unavailable" });
  const body = await response.json() as { result?: KnowledgeSearchClientResult } | KnowledgeSearchClientResult;
  return "result" in body && body.result ? body.result : body as KnowledgeSearchClientResult;
}
