import { NextResponse } from "next/server";

const AGENT_ALLOWED_HEADER_NAMES = [
  "content-type",
  "authorization",
  "x-agent-device-token",
] as const;

const AGENT_ALLOWED_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
]);

function isAllowedAgentOrigin(origin: string): boolean {
  if (AGENT_ALLOWED_ORIGINS.has(origin)) {
    return true;
  }

  try {
    const parsed = new URL(origin);

    return (
      (parsed.protocol === "tauri:" && parsed.hostname === "localhost") ||
      parsed.hostname === "tauri.localhost"
    );
  } catch {
    return false;
  }
}

function resolveAgentCorsOrigin(request: Request): string | null {
  const origin = request.headers.get("origin")?.trim();

  if (!origin || !isAllowedAgentOrigin(origin)) {
    return null;
  }

  return origin;
}

function appendVaryHeader(response: Response, value: string) {
  const currentValue = response.headers.get("vary")?.trim();

  if (!currentValue) {
    response.headers.set("vary", value);
    return;
  }

  const values = currentValue
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (!values.includes(value)) {
    values.push(value);
  }

  response.headers.set("vary", values.join(", "));
}

function applyAgentCorsHeaders(
  response: Response,
  request: Request,
  methods: readonly string[],
): Response {
  const origin = resolveAgentCorsOrigin(request);

  if (!origin) {
    return response;
  }

  response.headers.set("access-control-allow-origin", origin);
  response.headers.set("access-control-allow-methods", methods.join(", "));
  response.headers.set(
    "access-control-allow-headers",
    AGENT_ALLOWED_HEADER_NAMES.join(", "),
  );
  response.headers.set("access-control-max-age", "86400");
  appendVaryHeader(response, "Origin");

  return response;
}

export function createAgentCorsPreflightResponse(
  request: Request,
  methods: readonly string[],
): Response {
  return applyAgentCorsHeaders(
    new NextResponse(null, {
      status: 204,
    }),
    request,
    methods,
  );
}

export function createAgentJsonResponse(
  request: Request,
  methods: readonly string[],
  body: unknown,
  init?: ResponseInit,
): Response {
  return applyAgentCorsHeaders(NextResponse.json(body, init), request, methods);
}
