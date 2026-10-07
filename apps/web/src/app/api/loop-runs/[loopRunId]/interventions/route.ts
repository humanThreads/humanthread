import { NextResponse } from "next/server";

import { requestRuntimeIntervention } from "@/lib/orchestration/workflow-interaction-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import {
  decodeWorkflowInteractionRouteId,
  requestWorkflowInterventionBodySchema,
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
    const body = requestWorkflowInterventionBodySchema.parse(await request.json());
    const intervention = await requestRuntimeIntervention({
      actor: { type: "user", id: actor.userId },
      actorUserId: actor.userId,
      commandId: body.commandId,
      loopRunId: decodedLoopRunId,
      reason: body.reason,
      ...(body.evidence === undefined ? {} : { evidence: body.evidence }),
      occurredAt: new Date(),
    });
    return NextResponse.json({ ok: true, intervention });
  } catch (error) {
    const mapped = workflowInteractionApiErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
