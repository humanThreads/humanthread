import { z } from "zod";
import { localAgentBuildVersionSchema } from "../../../../../../../packages/shared/src/index";
import { authenticateAgentRequest } from "../../../../lib/agent/agent-auth";
import {
  createAgentCorsPreflightResponse,
  createAgentJsonResponse,
} from "../../../../lib/agent/agent-cors";

export const loopAssignmentIdSchema = z.string().trim().min(1).max(128);
export const loopAssignmentLeaseSchema = z.number().int().positive();
export const loopAssignmentCommandSchema = z.string().trim().min(1).max(128);
export const loopAssignmentAgentVersionSchema = localAgentBuildVersionSchema.optional();
export const LOOP_ASSIGNMENT_LEASE_MS = 60_000;
export const LOOP_ASSIGNMENT_CORS_METHODS = ["OPTIONS", "POST"] as const;

export function loopAssignmentOptions(request: Request): Response {
  return createAgentCorsPreflightResponse(
    request,
    LOOP_ASSIGNMENT_CORS_METHODS,
  );
}

export async function parseLoopAssignmentBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  const body = await request.json();
  return schema.parse(body);
}

export async function authenticateLoopAssignmentRequest(
  request: Request,
  input: { userId: string; deviceId: string },
) {
  return authenticateAgentRequest({
    authorizationHeader: request.headers.get("authorization"),
    userId: input.userId,
    deviceId: input.deviceId,
    deviceTokenHeader: request.headers.get("x-agent-device-token"),
    requireAuthorizedDevice: true,
    allowDeviceTokenOnly: true,
  });
}

export function loopAssignmentSuccess(request: Request, result: unknown): Response {
  return createAgentJsonResponse(request, LOOP_ASSIGNMENT_CORS_METHODS, {
    ok: true,
    result,
  });
}

export function loopAssignmentFailure(request: Request, error: unknown): Response {
  const originalCode = errorCode(error);
  const code = originalCode === "not_found" ? "stale_lease" : originalCode;
  const status = code === "stale_lease" || code === "stale_effect" || code === "version_conflict"
    ? 409
    : code === "authorization_denied" || code === "policy_denied" || code === "grant_revoked"
        ? 403
      : isAuthenticationError(error)
        ? 401
        : 400;
  return createAgentJsonResponse(
    request,
    LOOP_ASSIGNMENT_CORS_METHODS,
    {
      ok: false,
      code: code || (status === 401 ? "authentication_required" : "validation_failed"),
      error: error instanceof Error ? error.message : "Loop assignment command failed",
    },
    { status },
  );
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
}

function isAuthenticationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /authorization|agent user|agent device|device token/iu.test(message);
}
