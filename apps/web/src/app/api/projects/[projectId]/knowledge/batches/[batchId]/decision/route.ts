import { NextResponse } from "next/server";
import { z } from "zod";

import {
  assertCanWriteKnowledgeBatch,
  decideKnowledgeBatchForIngestion,
} from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

const decisionSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
  decision: z.enum(["approve", "reject"]),
  itemIds: z.array(z.string().trim().min(1).max(128)).optional(),
  reason: z.string().trim().max(4_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.decision === "reject" && !value.reason) {
    context.addIssue({
      code: "custom",
      path: ["reason"],
      message: "Knowledge rejection reason is required",
    });
  }
});

function errorResponse(error: unknown): NextResponse {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return NextResponse.json(
      { ok: false, code: "validation_failed", error: "Invalid knowledge batch decision request" },
      { status: 400 },
    );
  }

  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "Knowledge batch decision failed";
  const normalized = message.toLowerCase();
  const status = message === "Workbench API authentication required"
    ? 401
    : code === "not_found" || normalized.includes("not found")
      ? 404
      : code === "validation_failed"
        ? 400
        : code === "version_conflict" || code === "conflict" || code === "command_in_progress"
          ? 409
          : code === "authorization_denied" || normalized.includes("access denied")
            ? 403
            : 500;

  return NextResponse.json(
    status === 500
      ? { ok: false, code: "internal_error", error: "Knowledge batch decision failed" }
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
    const body = decisionSchema.parse(await request.json());
    await assertCanWriteKnowledgeBatch({ userId: actor.userId, projectId, batchId });
    const result = await decideKnowledgeBatchForIngestion({
      batchId,
      actorDigest: actor.userId,
      commandId: body.commandId,
      decision: body.decision,
      ...(body.itemIds === undefined ? {} : { itemIds: body.itemIds }),
      ...(body.reason === undefined ? {} : { reason: body.reason }),
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return errorResponse(error);
  }
}
