import { NextResponse } from "next/server";
import {
  disableLoopBindingCommand,
  upsertLoopBindingCommand,
} from "@/lib/orchestration/loop-definition-commands";
import {
  disableLoopBindingRequestSchema,
  loopApiError,
  loopBindingRequestSchema,
} from "../../../../../lib/orchestration/loop-definition-contracts";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { readProjectLoopSettings } from "@/lib/orchestration/loop-product-read-model";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const [{ projectId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const settings = await readProjectLoopSettings({ userId: actor.userId, projectId });
    if (!settings) throw Object.assign(new Error("Project not found"), { code: "not_found" });
    return NextResponse.json({ ok: true, result: settings.bindings, settings });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const [{ projectId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const body = loopBindingRequestSchema.parse(await request.json());
    const result = await upsertLoopBindingCommand({
      actorUserId: actor.userId,
      projectId,
      commandId: body.commandId,
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: body.expectedVersion }),
      loopDefinitionId: body.loopDefinitionId,
      activeVersionId: body.activeVersionId,
      status: body.status,
      triggerPolicy: body.triggerPolicy,
      parameterOverrides: body.parameterOverrides,
      notificationPolicy: body.notificationPolicy,
      automationGrantIds: body.automationGrantIds,
      allowedAgentProfileIds: body.allowedAgentProfileIds,
      allowedProviders: body.allowedProviders,
      ...(body.bindingRole === undefined ? {} : { bindingRole: body.bindingRole }),
      ...(body.workerStageConfigurations === undefined ? {} : {
        workerStageConfigurations: body.workerStageConfigurations,
      }),
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const [{ projectId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const body = disableLoopBindingRequestSchema.parse(await request.json());
    const result = await disableLoopBindingCommand({
      actorUserId: actor.userId,
      projectId,
      commandId: body.commandId,
      bindingId: body.bindingId,
      expectedVersion: body.expectedVersion,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
