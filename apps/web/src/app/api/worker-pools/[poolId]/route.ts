import { revokeWorkerPool } from "@humanthread/db";
import { z } from "zod";

import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { resolveWorkerManagementScope } from "../../../../lib/orchestration/worker-resource-scope";

const poolIdSchema = z.string().regex(/^[a-f0-9]{32}$/u);
const companyIdSchema = z.string().trim().min(1).max(64);

export async function DELETE(request: Request, context: { params: Promise<{ poolId: string }> }): Promise<Response> {
  try {
    const [{ poolId: rawPoolId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const poolId = poolIdSchema.parse(rawPoolId);
    const companyIdValue = new URL(request.url).searchParams.get("companyId")?.trim();
    const companyId = companyIdValue ? companyIdSchema.parse(companyIdValue) : undefined;
    const managed = await resolveWorkerManagementScope({ userId: actor.userId, ...(companyId === undefined ? {} : { companyId }) });
    await revokeWorkerPool({
      poolId,
      actorUserId: actor.userId,
      scope: managed.scope,
      ...(managed.companyRole === undefined ? {} : { companyRole: managed.companyRole }),
      now: new Date(),
    });
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown): Response {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : "validation_failed";
  const status = error instanceof Error && error.message === "Workbench API authentication required"
    ? 401
    : code === "authorization_denied" || code === "worker_pool_unauthorized" ? 403
      : code === "worker_pool_conflict" ? 409 : 400;
  return Response.json({ errorCode: code, message: error instanceof Error ? error.message : "Worker pool request failed" }, { status });
}
