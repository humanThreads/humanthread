import {
  desktopLoopInteractionMessageRequestSchema,
  desktopLoopInteractionMutationResponseSchema,
} from "@humanthread/workbench-client";

import { appendDesktopLoopInteractionMessage } from "@/lib/desktop/desktop-loop-interactions";
import {
  createDesktopLoopInteractionError,
  createDesktopLoopInteractionPreflight,
  DESKTOP_LOOP_INTERACTION_METHODS,
} from "../../../../../../../../../lib/desktop/desktop-loop-interaction-route";
import { createDesktopJsonResponse } from "../../../../../../../../../lib/desktop/desktop-cors";
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
    const input = desktopLoopInteractionMessageRequestSchema.parse(await request.json());
    const result = await appendDesktopLoopInteractionMessage(request, loopRunId, interactionId, input);
    return createDesktopJsonResponse(
      request,
      DESKTOP_LOOP_INTERACTION_METHODS,
      desktopLoopInteractionMutationResponseSchema.parse({ ok: true, result }),
    );
  } catch (error) {
    return createDesktopLoopInteractionError(request, error);
  }
}
