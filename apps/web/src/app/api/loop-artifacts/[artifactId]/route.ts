import { NextResponse } from "next/server";
import { readLoopReviewArtifact } from "@/lib/orchestration/loop-review-artifacts";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ artifactId: string }> },
) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { artifactId } = await context.params;
    const artifact = await readLoopReviewArtifact({ userId: actor.userId, artifactId });
    return new Response(artifact.bytes, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(artifact.byteSize),
        "content-disposition": "inline",
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
      },
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const message = error instanceof Error ? error.message : "Review Artifact not found";
    const status = message === "Workbench API authentication required"
      ? 401
      : code === "not_found" ? 404
        : /access denied/iu.test(message) ? 403 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
