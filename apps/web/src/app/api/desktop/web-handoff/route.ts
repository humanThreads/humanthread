import { z } from "zod";

import { createDesktopCorsPreflightResponse, createDesktopJsonResponse } from "../../../../lib/desktop/desktop-cors";
import { issueDesktopWebHandoff } from "../../../../lib/desktop/desktop-web-handoff";
import { resolveWorkbenchApiActor } from "../../../../lib/workbench/workbench-api-session";

const METHODS = ["POST", "OPTIONS"] as const;
const requestSchema = z.object({ targetPath: z.string().trim().min(1).max(512) }).strict();

export function OPTIONS(request: Request) {
  return createDesktopCorsPreflightResponse(request, METHODS);
}

function errorResponse(request: Request, status: number, code: string, error: string) {
  const response = createDesktopJsonResponse(
    request,
    METHODS,
    { ok: false, code, error },
    { status },
  );
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function POST(request: Request) {
  let parsed: z.infer<typeof requestSchema>;
  try {
    const result = requestSchema.safeParse(await request.json());
    if (!result.success) {
      return errorResponse(request, 400, "validation_failed", "Desktop Web handoff request is invalid");
    }
    parsed = result.data;
  } catch {
    return errorResponse(request, 400, "validation_failed", "Desktop Web handoff request is invalid");
  }

  try {
    const actor = await resolveWorkbenchApiActor(request);
    if (actor.authKind !== "desktop_token") {
      return errorResponse(request, 403, "authorization_denied", "Desktop session is required");
    }
    const handoff = await issueDesktopWebHandoff({
      userId: actor.userId,
      sessionId: actor.sessionId,
      targetPath: parsed.targetPath,
    });
    const consumeUrl = new URL("/api/desktop/web-handoff/consume", request.url);
    consumeUrl.searchParams.set("code", handoff.code);
    const response = createDesktopJsonResponse(request, METHODS, {
      ok: true,
      consumeUrl: consumeUrl.toString(),
      targetPath: handoff.targetPath,
      expiresAt: handoff.expiresAt.toISOString(),
    });
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Desktop Web handoff failed";
    if (message === "Workbench API authentication required") {
      return errorResponse(request, 401, "authentication_required", message);
    }
    if (message === "Desktop Web handoff target is not allowed") {
      return errorResponse(request, 400, "target_not_allowed", message);
    }
    if (message === "Desktop Web handoff target access denied") {
      return errorResponse(request, 403, "authorization_denied", message);
    }
    return errorResponse(request, 500, "internal_error", "Desktop Web handoff failed");
  }
}
