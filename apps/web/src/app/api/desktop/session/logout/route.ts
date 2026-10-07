import { z } from "zod";

import {
  createDesktopCorsPreflightResponse,
  createDesktopJsonResponse,
  createDesktopSessionErrorResponse,
} from "../../../../../lib/desktop/desktop-cors";
import { revokeDesktopSession } from "../../../../../lib/desktop/desktop-session-store";

const METHODS = ["OPTIONS", "POST"] as const;
const logoutRequestSchema = z.object({
  sessionId: z.string().trim().min(1).max(96),
  refreshToken: z.string().min(1),
});

export function OPTIONS(request: Request) {
  return createDesktopCorsPreflightResponse(request, METHODS);
}

export async function POST(request: Request) {
  try {
    const body = logoutRequestSchema.parse(await request.json());
    const session = await revokeDesktopSession(body);
    return createDesktopJsonResponse(request, METHODS, {
      ok: true,
      data: { sessionId: session.id },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createDesktopJsonResponse(
        request,
        METHODS,
        { ok: false, code: "validation_failed", error: "Invalid desktop logout request" },
        { status: 400 },
      );
    }
    return createDesktopSessionErrorResponse(request, METHODS, error);
  }
}
