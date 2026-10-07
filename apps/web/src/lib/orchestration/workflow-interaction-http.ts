import { z } from "zod";
import {
  interventionResolutionActionSchema,
  workflowInteractionMessageInputSchema,
  type WorkflowInteractionMessageInput,
} from "@humanthread/shared";

const boundedId = z.string().trim().min(1).max(128);

const httpMessageSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return {
    ...record,
    answers: record.answers ?? {},
    attachmentIds: record.attachmentIds ?? [],
    mentionedUserIds: record.mentionedUserIds ?? [],
  };
}, workflowInteractionMessageInputSchema);

export const openWorkflowInteractionBodySchema = z.object({
  commandId: boundedId,
  loopNodeRunId: z.string().trim().min(1).max(96),
  message: httpMessageSchema,
}).strict();

export const requestWorkflowInterventionBodySchema = z.object({
  commandId: boundedId,
  reason: z.string().trim().min(1).max(20_000),
  evidence: z.unknown().optional(),
  // Accepted for forward compatibility, but route handlers must resolve the
  // active Attempt from the authenticated LoopRun and never trust this value.
  loopNodeAttemptId: z.string().trim().min(1).max(128).optional(),
}).strict();

export const appendWorkflowInteractionMessageBodySchema = z.object({
  commandId: boundedId,
  message: httpMessageSchema,
}).strict();

export const confirmLatestWorkflowPositionBodySchema = z.object({
  commandId: boundedId,
}).strict();

export const delegateWorkflowConflictSpeakerBodySchema = z.object({
  commandId: boundedId,
  expectedVersion: z.number().int().nonnegative(),
  speakerUserId: boundedId,
}).strict();

export const submitWorkflowInterventionBodySchema = z.object({
  commandId: boundedId,
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().max(4_000).optional().default(""),
  action: interventionResolutionActionSchema,
  manualConflict: z.boolean().optional().default(false),
}).strict();

export const confirmWorkflowInteractionBodySchema = z.object({
  commandId: boundedId,
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().max(4_000).optional().default(""),
}).strict();

export const decideWorkflowInteractionBodySchema = z.object({
  commandId: boundedId,
  expectedVersion: z.number().int().nonnegative(),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().max(4_000).optional().default(""),
  selectedEdgeId: z.string().trim().min(1).max(96),
}).strict().superRefine((value, context) => {
  if (value.decision === "rejected" && value.reason.trim().length === 0) {
    context.addIssue({ code: "custom", message: "Rejection reason is required", path: ["reason"] });
  }
});

export function parseWorkflowInteractionMessage(value: unknown): WorkflowInteractionMessageInput {
  return httpMessageSchema.parse(value) as WorkflowInteractionMessageInput;
}

export function decodeWorkflowInteractionRouteId(value: string, maxLength = 128): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw apiValidationError("Route identifier is invalid");
  }
  if (!decoded.trim() || decoded.length > maxLength) throw apiValidationError("Route identifier is invalid");
  return decoded;
}

export function workflowInteractionApiErrorResponse(error: unknown): {
  status: number;
  body: { ok: false; code: string; error: string };
} {
  const message = error instanceof Error ? error.message : "Workflow interaction failed";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (message === "Workbench API authentication required") {
    return { status: 401, body: { ok: false, code: "authentication_required", error: message } };
  }
  if (code === "authorization_denied" || /access denied|role denied|administrator access required/iu.test(message)) {
    return { status: 403, body: { ok: false, code: "authorization_denied", error: "Workflow interaction access denied" } };
  }
  if (code === "not_found" || /not found/iu.test(message)) {
    return { status: 404, body: { ok: false, code: "not_found", error: "Workflow interaction not found" } };
  }
  if (code === "version_conflict") {
    return { status: 409, body: { ok: false, code, error: "Workflow interaction changed" } };
  }
  if (code === "validation_failed" || error instanceof z.ZodError) {
    return { status: 400, body: { ok: false, code: "validation_failed", error: "Workflow interaction request is invalid" } };
  }
  return { status: 500, body: { ok: false, code: "internal_error", error: "Workflow interaction is temporarily unavailable" } };
}

export function apiValidationError(message: string): Error & { code: "validation_failed" } {
  return Object.assign(new Error(message), { code: "validation_failed" as const });
}
