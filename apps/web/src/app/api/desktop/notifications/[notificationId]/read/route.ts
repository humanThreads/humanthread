import {
  desktopNotificationReadRequestSchema,
  desktopNotificationReadResponseSchema,
} from "@humanthread/workbench-client";
import { z } from "zod";

import { markDesktopNotificationRead } from "@/lib/desktop/desktop-notification-models";
import {
  createDesktopCorsPreflightResponse,
  createDesktopJsonResponse,
} from "../../../../../../lib/desktop/desktop-cors";

const METHODS = ["POST", "OPTIONS"] as const;

export function OPTIONS(request: Request) {
  return createDesktopCorsPreflightResponse(request, METHODS);
}

function errorResponse(request: Request, error: unknown): Response {
  const message = error instanceof Error
    ? error.message
    : "Desktop notification request failed";
  const status = message === "Workbench API authentication required"
    ? 401
    : message === "Space access denied"
      ? 403
      : message === "Notification not found"
        ? 404
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 500;
  const code = status === 401
    ? "authentication_required"
    : status === 403
      ? "authorization_denied"
      : status === 404
        ? "notification_not_found"
        : status === 400
          ? "validation_failed"
          : "internal_error";

  return createDesktopJsonResponse(request, METHODS, {
    ok: false,
    code,
    error: status === 500 ? "Desktop notification request failed" : message,
  }, { status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ notificationId: string }> },
) {
  try {
    const { notificationId } = await context.params;
    const input = desktopNotificationReadRequestSchema.parse(await request.json());
    const result = await markDesktopNotificationRead(request, notificationId, input);
    return createDesktopJsonResponse(
      request,
      METHODS,
      desktopNotificationReadResponseSchema.parse({ ok: true, result }),
    );
  } catch (error) {
    return errorResponse(request, error);
  }
}
