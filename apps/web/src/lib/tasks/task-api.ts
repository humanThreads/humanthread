import { NextResponse } from "next/server";
import { z } from "zod";

export const taskCommandMetadataSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
  expectedVersion: z.number().int().min(1),
});

const ALLOWED_COMMANDS: Record<string, string[]> = {
  backlog: ["move_to_todo", "cancel"],
  todo: ["start", "cancel"],
  in_progress: ["complete", "submit_for_review", "cancel"],
  in_review: ["accept", "reject", "cancel"],
  completed: ["reopen"],
  cancelled: ["reopen"],
};

export function taskApiErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({
      ok: false,
      code: "validation_failed",
      error: "Invalid Task request",
      issues: error.issues,
    }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "Task operation failed";
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof record.code === "string" ? record.code : "";
  if (message === "Workbench API authentication required") {
    return NextResponse.json({ ok: false, code: "authentication_required", error: message }, { status: 401 });
  }
  if (code === "task_not_found" || code === "not_found") {
    return NextResponse.json({ ok: false, code, error: "Task not found" }, { status: 404 });
  }
  if (code === "task_access_denied" || code === "authorization_denied") {
    return NextResponse.json({ ok: false, code, error: message }, { status: 403 });
  }
  if (code === "version_conflict") {
    return NextResponse.json({ ok: false, code, error: message }, { status: 409 });
  }
  if (code.startsWith("task_")) {
    const currentStatus = typeof record.currentStatus === "string" ? record.currentStatus : undefined;
    const missingChecks = Array.isArray(record.missingChecks)
      ? record.missingChecks.filter((value): value is string => typeof value === "string")
      : undefined;
    const blockingChecks = Array.isArray(record.blockingChecks)
      ? record.blockingChecks.filter((value): value is string => typeof value === "string")
      : undefined;
    return NextResponse.json({
      ok: false,
      code,
      error: message,
      ...(missingChecks ? { missingChecks } : {}),
      ...(blockingChecks ? { blockingChecks } : {}),
      ...(currentStatus ? {
        currentStatus,
        allowedCommands: ALLOWED_COMMANDS[currentStatus] ?? [],
      } : {}),
    }, { status: 422 });
  }
  return NextResponse.json({
    ok: false,
    code: code || "validation_failed",
    error: message,
  }, { status: 400 });
}
