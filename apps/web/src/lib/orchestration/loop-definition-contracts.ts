import { z } from "zod";
import { loopDefinitionScopeSchema, workerBranchPatternSchema } from "@humanthread/shared";

const boundedId = z.string().trim().min(1).max(96);
const commandId = z.string().trim().min(1).max(128);
const description = z.string().max(10_000).nullable().optional();
const workerPoolId = z.string().regex(/^[a-f0-9]{32}$/u);
const workerStageConfigurationSchema = z.object({
  siteId: z.string().regex(/^[a-f0-9]{32}$/u),
  model: z.string().trim().min(1).max(191),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh", "max", "ultra"]),
  requireGitDelivery: z.boolean().optional(),
}).strict();

export const createLoopDraftRequestSchema = z.object({
  commandId,
  spaceId: boundedId,
  scope: loopDefinitionScopeSchema.optional().default("task"),
  name: z.string().trim().min(1).max(191),
  description,
  graph: z.unknown(),
}).strict();

export const loopDefinitionListQuerySchema = z.object({
  spaceId: boundedId,
}).strict();

export const updateLoopDraftRequestSchema = z.object({
  commandId,
  expectedRevision: z.number().int().positive(),
  name: z.string().trim().min(1).max(191),
  description,
  graph: z.unknown(),
}).strict();

export const publishLoopDefinitionRequestSchema = z.object({
  commandId,
  expectedRevision: z.number().int().positive(),
}).strict();

export const activateLoopVersionRequestSchema = z.object({
  commandId,
  expectedRevision: z.number().int().positive(),
  activeVersionId: boundedId,
}).strict();

export const loopDefinitionLifecycleRequestSchema = z.object({
  commandId,
  expectedRevision: z.number().int().positive(),
  mode: z.enum(["archive", "delete"]),
}).strict();

export const loopBindingRequestSchema = z.object({
  commandId,
  expectedVersion: z.number().int().positive().optional(),
  loopDefinitionId: boundedId,
  activeVersionId: boundedId,
  bindingRole: z.enum(["task_development", "milestone_release"]).optional(),
  status: z.enum(["enabled", "disabled"]),
  triggerPolicy: z.object({
    manual: z.boolean(),
    taskEvents: z.array(z.string().trim().min(1).max(96)).max(32),
  }).strict(),
  parameterOverrides: z.record(z.string(), z.unknown()),
  notificationPolicy: z.record(z.string(), z.unknown()),
  automationGrantIds: z.array(boundedId).max(32),
  allowedAgentProfileIds: z.array(boundedId).max(32),
  allowedProviders: z.array(z.enum(["codex", "claude"])).max(2),
  workerStageConfigurations: z.record(z.string().trim().min(1).max(96), workerStageConfigurationSchema).optional(),
}).strict();

export const projectWorkerResourceRequestSchema = z.object({
  commandId,
  expectedVersion: z.number().int().positive(),
  workerPoolId,
  workerRepositoryUrl: z.url().max(1024),
  workerBranchPolicy: z.object({
    allowedBranches: z.array(workerBranchPatternSchema).min(1).max(64),
  }).strict(),
  workerImageRepository: z.string().trim().min(1).max(1024).optional(),
  workerImageTag: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/u).optional(),
  workerImageDigest: z.string().trim().regex(/^sha256:[a-f0-9]{64}$/u).optional(),
}).strict();

export const disableLoopBindingRequestSchema = z.object({
  commandId,
  bindingId: boundedId,
  expectedVersion: z.number().int().positive(),
}).strict();

export const loopTriggerRequestSchema = z.object({
  commandId,
  bindingId: boundedId,
  payload: z.record(z.string(), z.unknown()),
}).strict();

export function loopApiError(error: unknown): {
  status: number;
  body: { ok: false; code: string; error: string; issues?: z.core.$ZodIssue[]; currentRevision?: number };
} {
  if (error instanceof z.ZodError) {
    return {
      status: 400,
      body: { ok: false, code: "validation_failed", error: "Invalid Loop request", issues: error.issues },
    };
  }
  const message = error instanceof Error ? error.message : "";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const status = message === "Workbench API authentication required"
    ? 401
    : message.toLowerCase().includes("access denied")
      || code === "authorization_denied"
      || code === "policy_denied"
      ? 403
      : code === "not_found"
        ? 404
        : code === "version_conflict" || code === "budget_exhausted"
          ? 409
          : code === "validation_failed" || error instanceof SyntaxError
            ? 400
            : 500;
  if (status === 500) {
    return { status, body: { ok: false, code: "internal_error", error: "Loop request failed" } };
  }
  const revisionCandidate = error && typeof error === "object" && "currentRevision" in error
    ? Reflect.get(error, "currentRevision")
    : undefined;
  const currentRevision = typeof revisionCandidate === "number" && Number.isInteger(revisionCandidate)
    ? revisionCandidate
    : undefined;
  return {
    status,
    body: {
      ok: false,
      code: code || (status === 401 ? "authentication_required" : status === 403 ? "authorization_denied" : "validation_failed"),
      error: message || "Loop request failed",
      ...(currentRevision === undefined ? {} : { currentRevision }),
    },
  };
}
