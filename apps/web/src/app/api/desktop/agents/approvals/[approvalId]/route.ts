import {
  desktopAgentMutationResponseSchema,
  desktopApprovalDecisionRequestSchema,
} from "@humanthread/workbench-client";
import { z } from "zod";

import { decideDesktopApproval } from "@/lib/desktop/desktop-agent-commands";
import {
  createDesktopCorsPreflightResponse,
  createDesktopJsonResponse,
} from "../../../../../../lib/desktop/desktop-cors";

const METHODS = ["POST", "OPTIONS"] as const;

export function OPTIONS(request: Request) {
  return createDesktopCorsPreflightResponse(request, METHODS);
}

function errorResponse(request: Request, error: unknown) {
  const message = error instanceof Error ? error.message : "Desktop approval request failed";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const status = message === "Workbench API authentication required"
    ? 401
    : message === "Space access denied" || /access denied/iu.test(message)
      ? 403
      : message === "Approval not found" || code === "not_found"
        ? 404
        : code === "version_conflict"
          ? 409
          : error instanceof z.ZodError || error instanceof SyntaxError || code === "validation_failed"
            ? 400
            : 500;
  return createDesktopJsonResponse(request, METHODS, {
    ok: false,
    code: status === 401 ? "authentication_required"
      : status === 403 ? "authorization_denied"
        : status === 404 ? "approval_not_found"
          : status === 409 ? "version_conflict"
            : status === 400 ? "validation_failed" : "internal_error",
    error: status === 500 ? "Desktop approval request failed" : message,
  }, { status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ approvalId: string }> },
) {
  try {
    const { approvalId } = await context.params;
    const input = desktopApprovalDecisionRequestSchema.parse(await request.json());
    const result = await decideDesktopApproval(request, approvalId, input);
    return createDesktopJsonResponse(
      request,
      METHODS,
      desktopAgentMutationResponseSchema.parse({ ok: true, result }),
    );
  } catch (error) {
    return errorResponse(request, error);
  }
}
