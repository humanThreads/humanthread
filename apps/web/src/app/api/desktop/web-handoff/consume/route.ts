import { NextResponse } from "next/server";

import { consumeDesktopWebHandoff } from "../../../../../lib/desktop/desktop-web-handoff";
import {
  LEGACY_WEB_AUTH_COOKIES,
  WEB_SESSION_COOKIE,
} from "../../../../../lib/workbench/web-session-cookie";
import { createWebSession } from "../../../../../lib/workbench/web-session-store";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const MAX_HANDOFF_CODE_LENGTH = 256;

function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

function errorResponse(status: number, code: string, error: string): NextResponse {
  return noStore(NextResponse.json({ ok: false, code, error }, { status }));
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code")?.trim();
  if (!code || code.length > MAX_HANDOFF_CODE_LENGTH) {
    return errorResponse(400, "validation_failed", "Desktop Web handoff code is required");
  }

  try {
    const handoff = await consumeDesktopWebHandoff(code);
    const session = await createWebSession({ userId: handoff.userId, request });
    const response = NextResponse.redirect(new URL(handoff.targetPath, requestUrl.origin), 303);
    const secure = requestUrl.protocol === "https:";
    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure,
      path: "/",
      maxAge: COOKIE_MAX_AGE_SECONDS,
    };
    response.cookies.set(WEB_SESSION_COOKIE, session.token, cookieOptions);
    for (const legacyName of LEGACY_WEB_AUTH_COOKIES) {
      response.cookies.set(legacyName, "", { ...cookieOptions, maxAge: 0 });
    }
    return noStore(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Desktop Web handoff failed";
    if (
      message === "Desktop Web handoff has already been consumed" ||
      message === "Desktop Web handoff has expired"
    ) {
      return errorResponse(410, "handoff_unavailable", message);
    }
    if (message === "Desktop Web handoff code is invalid") {
      return errorResponse(404, "handoff_not_found", message);
    }
    return errorResponse(500, "internal_error", "Desktop Web handoff failed");
  }
}
