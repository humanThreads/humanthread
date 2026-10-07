import { z } from "zod";
import {
  createWorkerModelSite,
  listWorkerModelSites,
} from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { resolveWorkerManagementScope, resolveWorkerProjectScope } from "../../../lib/orchestration/worker-resource-scope";

const modelEntrySchema = z.object({
  name: z.string().trim().min(1).max(512),
  label: z.string().trim().min(1).max(256),
}).strict();

const createModelSiteSchema = z.object({
  companyId: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(191),
  endpoint: z.url().max(1024),
  apiKey: z.string().trim().min(1).max(4_096),
  models: z.array(modelEntrySchema).max(256).optional(),
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
    const result = await listWorkerModelSites({ actorUserId: actor.userId, scope });
    return Response.json({ ok: true, result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const [actor, body] = await Promise.all([
      resolveWorkbenchApiActor(request),
      request.json(),
    ]);
    const input = createModelSiteSchema.parse(body);
    const managed = await resolveWorkerManagementScope({
      userId: actor.userId,
      ...(input.companyId === undefined ? {} : { companyId: input.companyId }),
    });
    const result = await createWorkerModelSite({
      actorUserId: actor.userId,
      scope: managed.scope,
      ...(managed.companyRole === undefined ? {} : { companyRole: managed.companyRole }),
      ...input,
      now: new Date(),
    });
    return Response.json({ ok: true, result });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): Response {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : "validation_failed";
  const status = /authentication|required/iu.test(error instanceof Error ? error.message : "")
    ? 401
    : code === "authorization_denied" ? 403 : 400;
  const message = code === "configuration_required"
    && error instanceof Error
    && error.message.includes("HUMANTHREAD_WORKER_MODEL_SITE_ENCRYPTION_KEY")
    ? "Worker model-site encryption is not configured"
    : "Worker model site request failed";
  return Response.json({ ok: false, errorCode: code, message }, { status });
}
