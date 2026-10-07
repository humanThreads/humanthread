import { NextResponse } from "next/server";
import { z } from "zod";

export function agentProfileApiError(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({
      ok: false,
      code: "validation_failed",
      error: "Invalid Agent Profile request",
      issues: error.issues,
    }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "Agent Profile request failed";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const status = message === "Workbench API authentication required"
    ? 401
    : code === "authorization_denied" || /access denied/iu.test(message)
      ? 403
      : code === "not_found"
        ? 404
        : code === "validation_failed"
          ? 400
          : 500;
  if (status === 500) {
    return NextResponse.json({ ok: false, code: "internal_error", error: "Agent Profile request failed" }, { status });
  }
  return NextResponse.json({ ok: false, code: code || "request_failed", error: message }, { status });
}
