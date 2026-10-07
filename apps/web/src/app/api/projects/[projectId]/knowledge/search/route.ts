import { NextResponse } from "next/server";
import { z } from "zod";

import { assertCanReadProject, knowledgeProjectDigest } from "@humanthread/db";

import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

const querySchema = z.object({
  q: z.string().trim().min(1).max(2_000),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  entryType: z.string().trim().max(32).optional(),
}).strict();

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const [{ projectId }, actor] = await Promise.all([context.params, resolveWorkbenchApiActor(request)]);
    await assertCanReadProject({ userId: actor.userId, projectId });
    const url = new URL(request.url);
    const query = querySchema.parse({
      q: url.searchParams.get("q") ?? "",
      limit: url.searchParams.get("limit") ?? "10",
      ...(url.searchParams.get("entryType") ? { entryType: url.searchParams.get("entryType")! } : {}),
    });
    const indexerUrl = process.env.HUMANTHREAD_KNOWLEDGE_INDEXER_URL?.trim();
    if (!indexerUrl) throw Object.assign(new Error("Knowledge indexer is not configured"), { code: "index_unavailable" });
    const response = await fetch(new URL("/v1/search", indexerUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.HUMANTHREAD_KNOWLEDGE_INDEXER_TOKEN
          ? { authorization: `Bearer ${process.env.HUMANTHREAD_KNOWLEDGE_INDEXER_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        projectDigest: knowledgeProjectDigest(projectId),
        query: query.q,
        limit: query.limit,
        ...(query.entryType ? { entryType: query.entryType } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json() as unknown;
    if (!response.ok) {
      return NextResponse.json({ ok: false, code: "index_unavailable", error: "Knowledge index is unavailable" }, { status: 503 });
    }
    const envelope = body as { ok?: boolean; result?: unknown };
    return NextResponse.json({ ok: true, result: envelope?.result ?? body });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, code: "validation_failed", issues: error.issues }, { status: 400 });
    }
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const message = error instanceof Error ? error.message : "";
    const status = message === "Workbench API authentication required"
      ? 401
      : code === "project_access_denied" || code === "authorization_denied"
        ? 403
        : code === "not_found"
          ? 404
          : code === "index_unavailable"
            ? 503
            : 500;
    return NextResponse.json({ ok: false, code: code || "internal_error", error: error instanceof Error ? error.message : "Knowledge search failed" }, { status });
  }
}
