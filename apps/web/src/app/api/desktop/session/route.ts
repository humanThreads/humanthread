import { z } from "zod";

import {
  createDesktopCorsPreflightResponse,
  createDesktopJsonResponse,
  createDesktopSessionErrorResponse,
} from "../../../../lib/desktop/desktop-cors";
import { loginDesktopSession } from "../../../../lib/desktop/desktop-login";

const METHODS = ["OPTIONS", "POST"] as const;
const desktopLoginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
  installationId: z.string().trim().min(1).max(96),
  deviceId: z.string().trim().min(1).max(64),
  deviceName: z.string().trim().min(1).max(191),
  platform: z.enum(["macos", "windows", "linux"]),
});

export function OPTIONS(request: Request) {
  return createDesktopCorsPreflightResponse(request, METHODS);
}

export async function POST(request: Request) {
  try {
    const body = desktopLoginRequestSchema.parse(await request.json());
    const currentDeviceToken = request.headers.get("x-agent-device-token")?.trim();
    const result = await loginDesktopSession({
      ...body,
      ...(currentDeviceToken ? { currentDeviceToken } : {}),
    });
    return createDesktopJsonResponse(request, METHODS, { ok: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createDesktopJsonResponse(
        request,
        METHODS,
        {
          ok: false,
          code: "validation_failed",
          error: "Invalid desktop login request",
          issues: error.issues,
        },
        { status: 400 },
      );
    }
    return createDesktopSessionErrorResponse(request, METHODS, error);
  }
}
