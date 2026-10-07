import { NextResponse } from "next/server";
import { z } from "zod";

const DESKTOP_ALLOWED_HEADER_NAMES = [
  "content-type",
  "authorization",
  "x-agent-device-token",
] as const;

const DESKTOP_RUNTIME_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "http://localhost:1420",
  "http://127.0.0.1:1420",
]);

function configuredDesktopOrigins(): Set<string> {
  return new Set(
    (process.env.HUMANTHREAD_DESKTOP_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function resolveDesktopCorsOrigin(request: Request): string | null {
  const origin = request.headers.get("origin")?.trim();
  if (!origin) return null;

  const requestOrigin = new URL(request.url).origin;
  return DESKTOP_RUNTIME_ORIGINS.has(origin) ||
    configuredDesktopOrigins().has(origin) ||
    origin === requestOrigin
    ? origin
    : null;
}

function appendVaryOrigin(response: Response) {
  const values = (response.headers.get("vary") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.includes("Origin")) values.push("Origin");
  response.headers.set("vary", values.join(", "));
}

export function logDesktopRequestFailure(
  event: "desktop_session_request_failed" | "desktop_read_request_failed",
  request: Request,
  error: unknown,
): void {
  const requestUrl = new URL(request.url);
  console.error(event, {
    method: request.method,
    path: requestUrl.pathname,
    errorName: error instanceof Error ? error.name : "UnknownError",
    error: error instanceof Error ? error.message : "unknown",
  });
}

export function applyDesktopCors(
  response: Response,
  request: Request,
  methods: readonly string[],
): Response {
  const origin = resolveDesktopCorsOrigin(request);
  if (!origin) return response;

  response.headers.set("access-control-allow-origin", origin);
  response.headers.set("access-control-allow-methods", methods.join(", "));
  response.headers.set(
    "access-control-allow-headers",
    DESKTOP_ALLOWED_HEADER_NAMES.join(", "),
  );
  response.headers.set("access-control-max-age", "86400");
  appendVaryOrigin(response);
  return response;
}

export function createDesktopCorsPreflightResponse(
  request: Request,
  methods: readonly string[],
): Response {
  return applyDesktopCors(new NextResponse(null, { status: 204 }), request, methods);
}

export function createDesktopJsonResponse(
  request: Request,
  methods: readonly string[],
  body: unknown,
  init?: ResponseInit,
): Response {
  return applyDesktopCors(NextResponse.json(body, init), request, methods);
}

export function createDesktopConfigurationErrorResponse(
  request: Request,
  methods: readonly string[],
  error: unknown,
  fallbackMessage: string,
): Response {
  const message = error instanceof Error ? error.message : fallbackMessage;
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
  const status = message === "Workbench API authentication required"
    ? 401
    : code === "authorization_denied" || /access denied/iu.test(message)
      ? 403
      : code === "not_found"
        ? 404
        : code === "version_conflict"
          ? 409
          : error instanceof z.ZodError || error instanceof SyntaxError || code === "validation_failed"
            ? 422
            : 500;
  if (status === 500) {
    logDesktopRequestFailure("desktop_read_request_failed", request, error);
  }
  return createDesktopJsonResponse(request, methods, {
    ok: false,
    code: status === 401
      ? "authentication_required"
      : status === 403
        ? "authorization_denied"
        : status === 404
          ? "not_found"
          : status === 409
            ? "version_conflict"
            : status === 422
              ? "validation_failed"
              : "internal_error",
    error: status === 500 ? fallbackMessage : message,
  }, { status });
}

export function createDesktopSessionErrorResponse(
  request: Request,
  methods: readonly string[],
  error: unknown,
): Response {
  const message = error instanceof Error ? error.message : "Desktop session request failed";
  const authenticationError =
    message === "Workbench login credentials are invalid" ||
    message === "Desktop login user is unavailable" ||
    message.startsWith("Desktop refresh credential") ||
    message === "Desktop session has expired" ||
    message === "Desktop session is unavailable";
  const deviceConflict =
    message === "Local device belongs to a different user" ||
    message === "Current device token is required for authorized device binding";

  if (authenticationError) {
    return createDesktopJsonResponse(
      request,
      methods,
      { ok: false, code: "authentication_required", error: message },
      { status: 401 },
    );
  }
  if (deviceConflict) {
    return createDesktopJsonResponse(
      request,
      methods,
      { ok: false, code: "device_conflict", error: message },
      { status: 409 },
    );
  }
  logDesktopRequestFailure("desktop_session_request_failed", request, error);
  return createDesktopJsonResponse(
    request,
    methods,
    { ok: false, code: "internal_error", error: "Desktop session request failed" },
    { status: 500 },
  );
}
