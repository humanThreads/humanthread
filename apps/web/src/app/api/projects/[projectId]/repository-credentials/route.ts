import { NextResponse } from "next/server";
import { z } from "zod";

import { saveProjectRepositoryCredentials } from "@humanthread/db";
import { projectRepositoryCredentialInputSchema } from "@humanthread/shared";

import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

function failure(error: unknown): Response {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, code: "validation_failed", error: "项目仓库凭证无效", issues: error.issues }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "项目仓库凭证保存失败";
  const code = error && typeof error === "object" && typeof Reflect.get(error, "code") === "string"
    ? String(Reflect.get(error, "code"))
    : "request_failed";
  const status = message === "Workbench API authentication required"
    ? 401
    : code === "not_found"
      ? 404
      : code === "authorization_denied"
        ? 403
        : code === "validation_failed" || code === "provider_unsupported" || code === "configuration_required"
          ? 400
          : 500;
  return NextResponse.json(
    status === 500
      ? { ok: false, code: "internal_error", error: "项目仓库凭证保存失败" }
      : { ok: false, code, error: message },
    { status },
  );
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const [{ projectId }, actor, rawBody] = await Promise.all([context.params, resolveWorkbenchApiActor(request), request.json()]);
    const body = projectRepositoryCredentialInputSchema.parse(rawBody);
    return NextResponse.json({
      ok: true,
      result: await saveProjectRepositoryCredentials({
        actorUserId: actor.userId,
        projectId,
        authMode: body.authMode,
        username: body.username,
        secret: body.secret,
      }),
    }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
