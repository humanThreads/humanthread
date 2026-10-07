import { NextResponse } from "next/server";

import { openRequirementConversation } from "@/lib/orchestration/workflow-interaction-commands";
import { readAuthorizedLoopRunInteractions } from "../../../../../lib/orchestration/workflow-interaction-query";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import {
  decodeWorkflowInteractionRouteId,
  openWorkflowInteractionBodySchema,
  workflowInteractionApiErrorResponse,
} from "../../../../../lib/orchestration/workflow-interaction-http";

export async function POST(
  request: Request,
  context: { params: Promise<{ loopRunId: string }> },
) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { loopRunId } = await context.params;
    const decodedLoopRunId = decodeWorkflowInteractionRouteId(loopRunId, 96);
    const body = openWorkflowInteractionBodySchema.parse(await request.json());
    const interaction = await openRequirementConversation({
      actor: { type: "user", id: actor.userId },
      actorUserId: actor.userId,
      commandId: body.commandId,
      expectedLoopRunId: decodedLoopRunId,
      loopNodeRunId: body.loopNodeRunId,
      message: body.message,
      occurredAt: new Date(),
    });
    return NextResponse.json({ ok: true, interaction });
  } catch (error) {
    const mapped = workflowInteractionApiErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ loopRunId: string }> },
) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { loopRunId } = await context.params;
    const decodedLoopRunId = decodeWorkflowInteractionRouteId(loopRunId, 96);
    const result = await readAuthorizedLoopRunInteractions({ userId: actor.userId, loopRunId: decodedLoopRunId });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = workflowInteractionApiErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
