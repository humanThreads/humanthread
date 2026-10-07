import { NextResponse } from "next/server";

import { listEligibleWorkflowParticipants } from "@/lib/orchestration/workflow-interaction-participants";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import {
  apiValidationError,
  decodeWorkflowInteractionRouteId,
  workflowInteractionApiErrorResponse,
} from "../../../../../../lib/orchestration/workflow-interaction-http";

export async function GET(
  request: Request,
  context: { params: Promise<{ loopRunId: string }> },
) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const loopRunId = decodeWorkflowInteractionRouteId((await context.params).loopRunId, 96);
    const query = new URL(request.url).searchParams.get("query") ?? "";
    if (query.length > 191) throw apiValidationError("Participant query is too long");
    const participants = await listEligibleWorkflowParticipants({
      userId: actor.userId,
      loopRunId,
      query,
    });
    return NextResponse.json({ ok: true, participants });
  } catch (error) {
    const response = workflowInteractionApiErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
