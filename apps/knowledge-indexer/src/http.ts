import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { processKnowledgeIndexJob, type KnowledgeIndexJobProgressWriter, type KnowledgeIndexJobRunner } from "./service";
import type { KnowledgeSearchRequest, KnowledgeSearchResult } from "@humanthread/knowledge-indexer";

export interface KnowledgeIndexerHttpDependencies {
  writer: KnowledgeIndexJobProgressWriter;
  runner: KnowledgeIndexJobRunner;
  loadVersions(job: Awaited<ReturnType<KnowledgeIndexJobProgressWriter["claim"]>> extends infer T ? Exclude<T, null> : never): Promise<unknown[]>;
  health(): Promise<{ ok: boolean; qdrant: boolean }>;
  search: KnowledgeIndexerSearch;
}

interface KnowledgeIndexerSearch {
  search(input: KnowledgeSearchRequest): Promise<KnowledgeSearchResult>;
}

export function createKnowledgeIndexerServer(dependencies: KnowledgeIndexerHttpDependencies) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/health") {
        return json(response, 200, { ok: true, qdrant: (await dependencies.health()).qdrant });
      }
      if (request.method === "POST" && url.pathname === "/v1/index-jobs") {
        const body = await readJson(request) as { jobId?: unknown };
        if (typeof body.jobId !== "string" || !body.jobId.trim()) return json(response, 400, { ok: false, error: "jobId is required" });
        const job = await processKnowledgeIndexJob({
          jobId: body.jobId,
          writer: dependencies.writer,
          runner: dependencies.runner,
          loadVersions: dependencies.loadVersions as never,
        });
        return json(response, 200, { ok: true, job });
      }
      if (request.method === "POST" && url.pathname === "/v1/search") {
        const body = await readJson(request) as KnowledgeSearchRequest;
        const result = await dependencies.search.search(body);
        return json(response, 200, { ok: true, result });
      }
      return json(response, 404, { ok: false, error: "not_found" });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      return json(response, code === "not_found" ? 404 : code === "validation_failed" ? 400 : code === "conflict" ? 409 : 500, {
        ok: false,
        error: error instanceof Error ? error.message : "knowledge indexer failed",
      });
    }
  });
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
  response.end(payload);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
