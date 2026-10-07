import { workflowInteractionApiErrorResponse } from "../orchestration/workflow-interaction-http";
import {
  createDesktopCorsPreflightResponse,
  createDesktopJsonResponse,
} from "./desktop-cors";

export const DESKTOP_LOOP_INTERACTION_METHODS = ["POST", "OPTIONS"] as const;

export function createDesktopLoopInteractionPreflight(request: Request) {
  return createDesktopCorsPreflightResponse(request, DESKTOP_LOOP_INTERACTION_METHODS);
}

export function createDesktopLoopInteractionError(request: Request, error: unknown) {
  const mapped = workflowInteractionApiErrorResponse(error);
  return createDesktopJsonResponse(
    request,
    DESKTOP_LOOP_INTERACTION_METHODS,
    mapped.body,
    { status: mapped.status },
  );
}
