import { NextResponse } from "next/server";
import { z } from "zod";

import { assertCanWriteProject, enqueueProjectRepositoryVerification } from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

const verificationSchema = z.object({
  expectedDefaultBranch: z.string().trim().min(1).max(191).optional(),
}).strict();

function failure(error: unknown): Response {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, code: "validation_failed", error: "项目仓库校验请求无效", issues: error.issues }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "项目仓库校验失败";
  const code = error && typeof error === "object" && typeof Reflect.get(error, "code") === "string"
    ? String(Reflect.get(error, "code"))
    : "request_failed";
  const status = message === "Workbench API authentication required"
    ? 401
    : code === "not_found"
      ? 404
      : code === "authorization_denied"
        ? 403
        : code === "validation_failed" || code === "configuration_required"
          ? 400
          : 500;
  return NextResponse.json(
    status === 500
      ? { ok: false, code: "internal_error", error: "项目仓库校验失败" }
      : { ok: false, code, error: message },
    { status },
  );
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const [{ projectId }, actor, rawBody] = await Promise.all([context.params, resolveWorkbenchApiActor(request), request.json()]);
    await assertCanWriteProject({ userId: actor.userId, projectId });
    const body = verificationSchema.parse(rawBody ?? {});
    const queued = await enqueueProjectRepositoryVerification({
      actorUserId: actor.userId,
      projectId,
      ...(body.expectedDefaultBranch ? { expectedDefaultBranch: body.expectedDefaultBranch } : {}),
    });
    return NextResponse.json({ ok: true, accepted: true, result: queued }, { status: 202 });
  } catch (error) {
    return failure(error);
  }
}
