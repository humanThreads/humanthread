import { NextResponse } from "next/server";
import { z } from "zod";

import {
  assertCanWriteProject,
  readKnowledgeJobAccess,
  submitKnowledgeBatchForIngestion,
} from "@humanthread/db";
import { KNOWLEDGE_BATCH_ITEM_LIMIT, KNOWLEDGE_ENTRY_TYPES } from "@humanthread/shared";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

const digestSchema = z.string().regex(/^[a-f0-9]{32}$/u);
const knowledgeItemSchema = z.object({
  stableKey: z.string().trim().min(1).max(191),
  changeType: z.enum(["create", "update", "supersede", "expire", "delete"]),
  sourceType: z.string().trim().min(1).max(32),
  entryType: z.enum(KNOWLEDGE_ENTRY_TYPES),
  scope: z.enum(["project", "space"]),
  title: z.string().trim().min(1).max(191),
  summary: z.string().max(20_000),
  bodyMarkdown: z.string().max(2_000_000),
  confidence: z.number().min(0).max(1),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
  changeSummary: z.string().trim().max(20_000).optional(),
  baseVersion: z.number().int().positive().nullable().default(null),
  validFrom: z.iso.datetime({ offset: true }).nullable().default(null),
  validUntil: z.iso.datetime({ offset: true }).nullable().default(null),
  evidence: z.unknown(),
  relations: z.array(z.record(z.string(), z.unknown())).max(200),
}).strict();

const submissionSchema = z.object({
  commandId: z.string().trim().min(1).max(128).optional(),
  submissionId: z.string().trim().min(1).max(191),
  templateDigest: digestSchema,
  sourceSnapshot: z.record(z.string(), z.unknown()),
  items: z.array(knowledgeItemSchema).max(KNOWLEDGE_BATCH_ITEM_LIMIT),
}).strict();

function errorResponse(error: unknown): NextResponse {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return NextResponse.json(
      { ok: false, code: "validation_failed", error: "Invalid knowledge batch submission" },
      { status: 400 },
    );
  }

  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "Knowledge batch submission failed";
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
      ? { ok: false, code: "internal_error", error: "Knowledge batch submission failed" }
      : { ok: false, code: code || "request_failed", error: message },
    { status },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; jobId: string }> },
) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { projectId, jobId } = await context.params;
    const body = submissionSchema.parse(await request.json());

    await assertCanWriteProject({ userId: actor.userId, projectId });
    const job = await readKnowledgeJobAccess({ userId: actor.userId, projectId, jobId });
    if (!job) {
      throw Object.assign(new Error("Knowledge job not found"), { code: "not_found" });
    }

    const batch = await submitKnowledgeBatchForIngestion({
      commandId: body.commandId ?? body.submissionId,
      jobId,
      actorDigest: actor.userId,
      submissionId: body.submissionId,
      templateDigest: body.templateDigest,
      sourceSnapshot: body.sourceSnapshot,
      items: body.items,
    });

    return NextResponse.json({
      ok: true,
      batchId: batch.id,
      receivedAt: batch.receivedAt,
      status: batch.status,
      progress: batch.progress,
      batch,
    }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
