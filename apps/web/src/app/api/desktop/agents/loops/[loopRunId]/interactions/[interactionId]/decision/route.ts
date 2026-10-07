import {
  desktopLoopInteractionDecisionRequestSchema,
  desktopLoopInteractionMutationResponseSchema,
} from "@humanthread/workbench-client";

import { createDesktopJsonResponse } from "../../../../../../../../../lib/desktop/desktop-cors";
import {
  createDesktopLoopInteractionError,
  createDesktopLoopInteractionPreflight,
  DESKTOP_LOOP_INTERACTION_METHODS,
} from "../../../../../../../../../lib/desktop/desktop-loop-interaction-route";
import { decideDesktopLoopInteraction } from "@/lib/desktop/desktop-loop-interactions";
import { decodeWorkflowInteractionRouteId } from "../../../../../../../../../lib/orchestration/workflow-interaction-http";

export const OPTIONS = createDesktopLoopInteractionPreflight;

export async function POST(
  request: Request,
  context: { params: Promise<{ loopRunId: string; interactionId: string }> },
) {
  try {
    const params = await context.params;
    const loopRunId = decodeWorkflowInteractionRouteId(params.loopRunId, 96);
    const interactionId = decodeWorkflowInteractionRouteId(params.interactionId, 96);
    const input = desktopLoopInteractionDecisionRequestSchema.parse(await request.json());
    const result = await decideDesktopLoopInteraction(request, loopRunId, interactionId, input);
    return createDesktopJsonResponse(
      request,
      DESKTOP_LOOP_INTERACTION_METHODS,
      desktopLoopInteractionMutationResponseSchema.parse({ ok: true, result }),
    );
  } catch (error) {
    return createDesktopLoopInteractionError(request, error);
  }
}
