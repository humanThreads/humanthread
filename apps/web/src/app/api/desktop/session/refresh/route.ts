import { z } from "zod";

import {
  createDesktopCorsPreflightResponse,
  createDesktopJsonResponse,
  createDesktopSessionErrorResponse,
} from "../../../../../lib/desktop/desktop-cors";
import { refreshDesktopSession } from "../../../../../lib/desktop/desktop-login";

const METHODS = ["OPTIONS", "POST"] as const;
const refreshRequestSchema = z.object({
  sessionId: z.string().trim().min(1).max(96),
  refreshToken: z.string().min(1),
});

export function OPTIONS(request: Request) {
  return createDesktopCorsPreflightResponse(request, METHODS);
}

export async function POST(request: Request) {
  try {
    const body = refreshRequestSchema.parse(await request.json());
    const result = await refreshDesktopSession(body);
    return createDesktopJsonResponse(request, METHODS, { ok: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createDesktopJsonResponse(
        request,
        METHODS,
        { ok: false, code: "validation_failed", error: "Invalid desktop refresh request" },
        { status: 400 },
      );
    }
    return createDesktopSessionErrorResponse(request, METHODS, error);
  }
}
