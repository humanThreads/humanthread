import { revokeWorkerModelSite, updateWorkerModelSiteModels } from "@humanthread/db";
import { z } from "zod";

import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { resolveWorkerManagementScope } from "../../../../lib/orchestration/worker-resource-scope";

const siteIdSchema = z.string().regex(/^[a-f0-9]{32}$/u);
const companyIdSchema = z.string().trim().min(1).max(64);
const modelEntrySchema = z.object({
  name: z.string().trim().min(1).max(512),
  label: z.string().trim().min(1).max(256),
}).strict();
// Deliberately narrow: a catalogue edit must never be able to rotate the
// endpoint or the encrypted API key through this endpoint.
const updateModelsSchema = z.object({
  models: z.array(modelEntrySchema).max(256),
}).strict();

export async function PATCH(request: Request, context: { params: Promise<{ siteId: string }> }): Promise<Response> {
  try {
    const [{ siteId: rawSiteId }, actor, body] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
      request.json(),
    ]);
    const siteId = siteIdSchema.parse(rawSiteId);
    const input = updateModelsSchema.parse(body);
    const companyIdValue = new URL(request.url).searchParams.get("companyId")?.trim();
    const companyId = companyIdValue ? companyIdSchema.parse(companyIdValue) : undefined;
    const managed = await resolveWorkerManagementScope({ userId: actor.userId, ...(companyId === undefined ? {} : { companyId }) });
    const result = await updateWorkerModelSiteModels({
      siteId,
      actorUserId: actor.userId,
      scope: managed.scope,
      ...(managed.companyRole === undefined ? {} : { companyRole: managed.companyRole }),
      models: input.models,
      now: new Date(),
    });
    return Response.json({ ok: true, result });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ siteId: string }> }): Promise<Response> {
  try {
    const [{ siteId: rawSiteId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const siteId = siteIdSchema.parse(rawSiteId);
    const companyIdValue = new URL(request.url).searchParams.get("companyId")?.trim();
    const companyId = companyIdValue ? companyIdSchema.parse(companyIdValue) : undefined;
    const managed = await resolveWorkerManagementScope({ userId: actor.userId, ...(companyId === undefined ? {} : { companyId }) });
    await revokeWorkerModelSite({
      siteId,
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
  const status = error instanceof Error && /authentication|required/iu.test(error.message)
    ? 401
    : code === "authorization_denied" ? 403 : 400;
  return Response.json({ ok: false, errorCode: code, message: error instanceof Error ? error.message : "Worker model site request failed" }, { status });
}
