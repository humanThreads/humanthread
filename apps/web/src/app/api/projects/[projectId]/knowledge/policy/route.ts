import { NextResponse } from "next/server";
import { z } from "zod";

import {
  readKnowledgePolicySettings,
  updateKnowledgePolicySettings,
} from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

const updateSchema = z.object({
  expectedVersion: z.number().int().min(1),
  autoPublishEnabled: z.boolean(),
  minimumConfidence: z.number().min(0).max(1),
  allowedSourceTypes: z.array(z.string().trim().min(1).max(64)).max(32),
  allowedEntryTypes: z.array(z.string().trim().min(1).max(32)).max(16),
  allowAutomaticDelete: z.boolean().optional(),
  allowAutomaticExpire: z.boolean().optional(),
  allowAutomaticSupersede: z.boolean().optional(),
  subscribeSpaceKnowledge: z.boolean().optional(),
}).strict();

function errorResponse(error: unknown): NextResponse {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return NextResponse.json(
      { ok: false, code: "validation_failed", error: "Invalid knowledge policy request" },
      { status: 400 },
    );
  }

  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "Knowledge policy request failed";
  const normalized = message.toLowerCase();
  const status = message === "Workbench API authentication required"
    ? 401
    : code === "not_found" || normalized.includes("not found")
      ? 404
      : code === "validation_failed"
        ? 400
        : code === "version_conflict" || code === "conflict"
          ? 409
          : code === "authorization_denied" || normalized.includes("access denied")
            ? 403
            : 500;

  return NextResponse.json(
    status === 500
      ? { ok: false, code: "internal_error", error: "Knowledge policy request failed" }
      : { ok: false, code: code || "request_failed", error: message },
    { status },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { projectId } = await context.params;
    const policy = await readKnowledgePolicySettings({ userId: actor.userId, projectId });
    if (!policy) {
      throw Object.assign(new Error("Knowledge policy not found"), { code: "not_found" });
    }
    return NextResponse.json({ ok: true, policy });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { projectId } = await context.params;
    const body = updateSchema.parse(await request.json());
    const policy = await updateKnowledgePolicySettings({
      userId: actor.userId,
      projectId,
      expectedVersion: body.expectedVersion,
      autoPublishEnabled: body.autoPublishEnabled,
      minimumConfidence: body.minimumConfidence,
      allowedSourceTypes: body.allowedSourceTypes,
      allowedEntryTypes: body.allowedEntryTypes,
      ...(body.allowAutomaticDelete === undefined ? {} : { allowAutomaticDelete: body.allowAutomaticDelete }),
      ...(body.allowAutomaticExpire === undefined ? {} : { allowAutomaticExpire: body.allowAutomaticExpire }),
      ...(body.allowAutomaticSupersede === undefined ? {} : { allowAutomaticSupersede: body.allowAutomaticSupersede }),
      ...(body.subscribeSpaceKnowledge === undefined ? {} : { subscribeSpaceKnowledge: body.subscribeSpaceKnowledge }),
    });
    return NextResponse.json({ ok: true, policy });
  } catch (error) {
    return errorResponse(error);
  }
}
