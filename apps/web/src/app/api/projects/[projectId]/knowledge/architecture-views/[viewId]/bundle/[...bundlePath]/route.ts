import { NextResponse } from "next/server";

import {
  assertCanReadProject,
  getKnowledgeArchitectureVersion,
  knowledgeProjectDigest,
} from "@humanthread/db";
import { ARCHITECTURE_BUNDLE_ENTRY_FILE, validateArchitectureBundle } from "@humanthread/shared";

import { readArchitectureBundleObject } from "@/lib/knowledge/architecture-bundle-storage";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

export const ARCHITECTURE_BUNDLE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; viewId: string; bundlePath: string[] }> },
) {
  try {
    const [{ projectId, viewId, bundlePath }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    await assertCanReadProject({ userId: actor.userId, projectId });
    if (!Array.isArray(bundlePath) || bundlePath.length !== 1 || bundlePath[0] !== ARCHITECTURE_BUNDLE_ENTRY_FILE) {
      return NextResponse.json({ ok: false, code: "not_found", error: "Architecture bundle entry not found" }, { status: 404 });
    }
    const projectDigest = knowledgeProjectDigest(projectId);
    const version = await getKnowledgeArchitectureVersion({ projectDigest, viewId });
    if (!version) {
      return NextResponse.json({ ok: false, code: "not_found", error: "Architecture view not found" }, { status: 404 });
    }
    const content = await readArchitectureBundleObject(version.bundleObjectKey);
    const bundle = validateArchitectureBundle({ fileName: ARCHITECTURE_BUNDLE_ENTRY_FILE, content });
    return new Response(bundle.content, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(bundle.byteSize),
        "content-security-policy": ARCHITECTURE_BUNDLE_CSP,
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin",
        "cache-control": "private, max-age=60",
      },
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "validation_failed") {
      return NextResponse.json({ ok: false, code, error: "Architecture bundle failed validation" }, { status: 422 });
    }
    const status = code === "project_access_denied" || code === "authorization_denied"
      ? 403
      : code === "not_found"
        ? 404
        : code === "storage_backend_unavailable"
          ? 503
          : 500;
    return NextResponse.json({ ok: false, code: code || "internal_error", error: error instanceof Error ? error.message : "Architecture bundle unavailable" }, { status });
  }
}
