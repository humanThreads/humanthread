import { createWorkerPool, listWorkerPools } from "@humanthread/db";
import { z } from "zod";

import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { resolveWorkerManagementScope, resolveWorkerProjectScope } from "../../../lib/orchestration/worker-resource-scope";

const createWorkerPoolSchema = z.object({
  companyId: z.string().trim().min(1).max(64).optional(),
  displayName: z.string().trim().min(1).max(191),
  maxConcurrentRuns: z.number().int().positive().max(128),
  configuration: z.record(z.string(), z.unknown()),
}).strict();

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId")?.trim();
    const companyId = url.searchParams.get("companyId")?.trim() || undefined;
    const scope = projectId
      ? await resolveWorkerProjectScope({ userId: actor.userId, projectId })
      : (await resolveWorkerManagementScope({ userId: actor.userId, ...(companyId === undefined ? {} : { companyId }) })).scope;
    const pools = await listWorkerPools({ actorUserId: actor.userId, scope });
    return Response.json({ pools });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const body = createWorkerPoolSchema.parse(await request.json());
    const managed = await resolveWorkerManagementScope({
      userId: actor.userId,
      ...(body.companyId === undefined ? {} : { companyId: body.companyId }),
    });
    const created = await createWorkerPool({
      actorUserId: actor.userId,
      scope: managed.scope,
      ...(managed.companyRole === undefined ? {} : { companyRole: managed.companyRole }),
      displayName: body.displayName,
      maxConcurrentRuns: body.maxConcurrentRuns,
      configuration: body.configuration,
      now: new Date(),
    });
    return Response.json(created, { status: 201 });
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
    : code === "authorization_denied" || code === "worker_pool_unauthorized" ? 403 : code === "worker_pool_conflict" ? 409 : 400;
  return Response.json({ errorCode: code, message: error instanceof Error ? error.message : "Worker pool request failed" }, { status });
}
