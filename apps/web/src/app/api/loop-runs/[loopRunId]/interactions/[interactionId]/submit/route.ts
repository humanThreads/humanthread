import { NextResponse } from "next/server";

import { submitWorkflowIntervention } from "@/lib/orchestration/workflow-interaction-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import {
  decodeWorkflowInteractionRouteId,
  submitWorkflowInterventionBodySchema,
  workflowInteractionApiErrorResponse,
} from "../../../../../../../lib/orchestration/workflow-interaction-http";

export async function POST(
  request: Request,
  context: { params: Promise<{ loopRunId: string; interactionId: string }> },
) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const params = await context.params;
    const loopRunId = decodeWorkflowInteractionRouteId(params.loopRunId, 96);
    const interactionId = decodeWorkflowInteractionRouteId(params.interactionId, 96);
    const body = submitWorkflowInterventionBodySchema.parse(await request.json());
    const interaction = await submitWorkflowIntervention({
      interactionId,
      expectedLoopRunId: loopRunId,
      actorUserId: actor.userId,
      commandId: body.commandId,
      expectedVersion: body.expectedVersion,
      reason: body.reason,
      action: body.action,
      manualConflict: body.manualConflict,
      occurredAt: new Date(),
    });
    return NextResponse.json({ ok: true, interaction });
  } catch (error) {
    const mapped = workflowInteractionApiErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
