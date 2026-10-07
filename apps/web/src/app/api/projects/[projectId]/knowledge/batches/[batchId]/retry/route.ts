import { NextResponse } from "next/server";
import { z } from "zod";

import {
  assertCanWriteKnowledgeBatch,
  retryKnowledgeBatch,
} from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

const retrySchema = z.object({
  commandId: z.string().trim().min(1).max(128),
}).strict();

function errorResponse(error: unknown): NextResponse {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return NextResponse.json(
      { ok: false, code: "validation_failed", error: "Invalid knowledge batch retry request" },
      { status: 400 },
    );
  }

  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "Knowledge batch retry failed";
  const normalized = message.toLowerCase();
  const status = message === "Workbench API authentication required"
    ? 401
    : code === "not_found" || normalized.includes("not found")
      ? 404
      : code === "validation_failed"
        ? 400
        : code === "version_conflict" || code === "conflict" || code === "not_retryable"
          || code === "permanent_failure" || code === "failed_stage_missing" || code === "command_in_progress"
          ? 409
          : code === "authorization_denied" || normalized.includes("access denied")
            ? 403
            : 500;

  return NextResponse.json(
    status === 500
      ? { ok: false, code: "internal_error", error: "Knowledge batch retry failed" }
      : { ok: false, code: code || "request_failed", error: message },
    { status },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; batchId: string }> },
) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { projectId, batchId } = await context.params;
    const body = retrySchema.parse(await request.json());
    await assertCanWriteKnowledgeBatch({ userId: actor.userId, projectId, batchId });
    const batch = await retryKnowledgeBatch({ batchId, commandId: body.commandId });
    return NextResponse.json({ ok: true, batch });
  } catch (error) {
    return errorResponse(error);
  }
}
