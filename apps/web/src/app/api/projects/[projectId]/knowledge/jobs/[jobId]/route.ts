import { NextResponse } from "next/server";

import { readKnowledgeJobAccess } from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

function errorResponse(error: unknown): NextResponse {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "Knowledge job read failed";
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
      ? { ok: false, code: "internal_error", error: "Knowledge job read failed" }
      : { ok: false, code: code || "request_failed", error: message },
    { status },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; jobId: string }> },
) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { projectId, jobId } = await context.params;
    const job = await readKnowledgeJobAccess({ userId: actor.userId, projectId, jobId });
    if (!job) {
      throw Object.assign(new Error("Knowledge job not found"), { code: "not_found" });
    }
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return errorResponse(error);
  }
}
