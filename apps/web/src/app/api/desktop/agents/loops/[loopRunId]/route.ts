import {
  desktopAgentMutationResponseSchema,
  desktopLoopDetailResponseSchema,
  desktopLoopCommandRequestSchema,
} from "@humanthread/workbench-client";
import { z } from "zod";

import { commandDesktopLoop } from "@/lib/desktop/desktop-agent-commands";
import { readDesktopLoopDetail } from "@/lib/desktop/desktop-loop-detail";
import {
  createDesktopCorsPreflightResponse,
  createDesktopJsonResponse,
} from "../../../../../../lib/desktop/desktop-cors";
import { createDesktopReadResponse } from "../../../../../../lib/desktop/desktop-read-route";

const METHODS = ["GET", "POST", "OPTIONS"] as const;

export function OPTIONS(request: Request) {
  return createDesktopCorsPreflightResponse(request, METHODS);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ loopRunId: string }> },
) {
  const { loopRunId } = await context.params;
  return createDesktopReadResponse(
    request,
    (currentRequest) => readDesktopLoopDetail(currentRequest, loopRunId),
    desktopLoopDetailResponseSchema,
  );
}

function errorResponse(request: Request, error: unknown) {
  const message = error instanceof Error ? error.message : "Desktop Loop request failed";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const status = message === "Workbench API authentication required"
    ? 401
    : message === "Space access denied" || /access denied/iu.test(message)
      ? 403
      : message === "Loop not found" || code === "not_found"
        ? 404
        : ["version_conflict", "budget_exhausted", "policy_denied"].includes(code)
          ? 409
          : error instanceof z.ZodError || error instanceof SyntaxError || code === "validation_failed"
            ? 400
            : 500;
  return createDesktopJsonResponse(request, METHODS, {
    ok: false,
    code: status === 401 ? "authentication_required"
      : status === 403 ? "authorization_denied"
        : status === 404 ? "loop_not_found"
          : status === 409 ? code || "version_conflict"
            : status === 400 ? "validation_failed" : "internal_error",
    error: status === 500 ? "Desktop Loop request failed" : message,
  }, { status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ loopRunId: string }> },
) {
  try {
    const { loopRunId } = await context.params;
    const input = desktopLoopCommandRequestSchema.parse(await request.json());
    const result = await commandDesktopLoop(request, loopRunId, input);
    return createDesktopJsonResponse(
      request,
      METHODS,
      desktopAgentMutationResponseSchema.parse({ ok: true, result }),
    );
  } catch (error) {
    return errorResponse(request, error);
  }
}
