import { NextResponse } from "next/server";

import {
  assertCanReadKnowledgeBatch,
  getKnowledgeBatchProjection,
} from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

function errorResponse(error: unknown): NextResponse {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "Knowledge batch read failed";
  const normalized = message.toLowerCase();
  const status = message === "Workbench API authentication required"
    ? 401
    : code === "not_found" || normalized.includes("not found")
      ? 404
      : code === "validation_failed"
        ? 400
        : code === "authorization_denied" || normalized.includes("access denied")
          ? 403
          : 500;

  return NextResponse.json(
    status === 500
      ? { ok: false, code: "internal_error", error: "Knowledge batch read failed" }
      : { ok: false, code: code || "request_failed", error: message },
    { status },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; batchId: string }> },
) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { projectId, batchId } = await context.params;
    await assertCanReadKnowledgeBatch({ userId: actor.userId, projectId, batchId });
    const batch = await getKnowledgeBatchProjection(batchId);
    if (!batch) {
      throw Object.assign(new Error("Knowledge batch not found"), { code: "not_found" });
    }
    return NextResponse.json({ ok: true, batch });
  } catch (error) {
    return errorResponse(error);
  }
}
