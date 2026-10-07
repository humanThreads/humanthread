import { z } from "zod";
import { reasoningEffortSchema } from "./loop-engine";

const idSchema = z.string().trim().min(1).max(191);
const md5IdSchema = z.string().regex(/^[a-f0-9]{32}$/u);

export const LIVE_SESSION_TICKET_KINDS = ["control", "execution", "viewer"] as const;
export const liveSessionTicketKindSchema = z.enum(LIVE_SESSION_TICKET_KINDS);

export const liveSessionViewerTicketSchema = z.object({
  kind: z.literal("viewer"),
  token: z.string().trim().min(1).max(4_096),
  expiresAt: z.iso.datetime(),
}).strict();

export const liveSessionKindSchema = z.enum(["agent", "worker"]);
export const liveSessionSurfaceSchema = z.enum(["web", "android", "desktop"]);
export const liveSessionExecutionPolicySchema = z.enum(["direct", "loop"]);
export const liveSessionTargetSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("agent_device"),
    deviceId: idSchema,
  }).strict(),
  z.object({
    type: z.literal("worker_pool"),
  }).strict(),
]);

const modelNameSchema = z.string().trim().min(1).max(512).refine(
  (value) => !/[\u0000-\u001F\u007F]/u.test(value),
  "Model name must not contain control characters",
);

export const liveSessionModelSelectionSchema = z.object({
  siteId: md5IdSchema,
  model: modelNameSchema,
  reasoningEffort: reasoningEffortSchema,
}).strict();

export const liveSessionErrorCodeSchema = z.enum([
  "agent_device_required",
  "agent_device_offline",
  "agent_runtime_unavailable",
  "workspace_unavailable",
  "worker_project_required",
  "worker_task_required",
  "task_not_open",
  "worker_pool_missing",
  "worker_pool_unavailable",
  "loop_binding_missing",
  "live_session_not_found",
  "live_session_ended",
  "live_session_control_conflict",
  "live_session_backpressure",
  "live_session_gateway_unavailable",
  "internal_connector_offline",
  "live_session_direct_execution_pending",
  "model_selection_invalid",
  "model_site_unavailable",
  "agent_model_profile_unavailable",
]);

export const createLiveSessionInputSchema = z.object({
  commandId: md5IdSchema,
  kind: liveSessionKindSchema,
  surface: liveSessionSurfaceSchema,
  spaceId: idSchema,
  projectId: idSchema.nullable().default(null),
  taskId: idSchema.nullable().default(null),
  executionPolicy: liveSessionExecutionPolicySchema,
  target: liveSessionTargetSchema,
  businessRunId: idSchema.nullable().default(null),
  // Optional rather than defaulted: `CreateLiveSessionInput` is the inferred
  // output type, so a default here would force every existing caller to pass
  // the field explicitly. Absence and null both mean "use the resolved default".
  modelSelection: liveSessionModelSelectionSchema.nullable().optional(),
  initialCols: z.number().int().min(1).max(1_000).default(120),
  initialRows: z.number().int().min(1).max(500).default(36),
}).strict().superRefine((value, context) => {
  if (value.kind === "worker") {
    if (!value.projectId) {
      context.addIssue({ code: "custom", path: ["projectId"], message: "Worker sessions require a project" });
    }
    if (value.target.type !== "worker_pool") {
      context.addIssue({ code: "custom", path: ["target"], message: "Worker sessions require project-resolved Worker Pool execution" });
    }
  }
  if (value.kind === "agent" && value.target.type !== "agent_device") {
    context.addIssue({ code: "custom", path: ["target"], message: "Agent sessions require an Agent device" });
  }
  if (value.executionPolicy === "loop") {
    if (!value.projectId) {
      context.addIssue({ code: "custom", path: ["projectId"], message: "Loop sessions require a project" });
    }
    if (!value.taskId) {
      context.addIssue({ code: "custom", path: ["taskId"], message: "Loop sessions require a task" });
    }
  }
  if (value.executionPolicy === "direct" && value.businessRunId !== null) {
    context.addIssue({ code: "custom", path: ["businessRunId"], message: "Direct sessions cannot pre-bind a Loop run" });
  }
});

const liveSessionTargetViewSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("agent_device"),
    deviceId: idSchema,
    displayName: z.string().trim().min(1).max(191),
  }).strict(),
  z.object({
    type: z.literal("worker_pool"),
    workerPoolId: md5IdSchema,
    displayName: z.string().trim().min(1).max(191),
  }).strict(),
]);

export const liveSessionViewSchema = z.object({
  id: md5IdSchema,
  kind: liveSessionKindSchema,
  surface: liveSessionSurfaceSchema,
  spaceId: idSchema,
  projectId: idSchema.nullable(),
  taskId: idSchema.nullable(),
  executionPolicy: liveSessionExecutionPolicySchema,
  target: liveSessionTargetViewSchema,
  targetDisplayName: z.string().trim().min(1).max(191),
  businessRun: z.object({
    type: z.enum(["agent_run", "loop_run"]),
    id: idSchema,
  }).strict().nullable(),
  loopAttempt: z.object({
    loopRunId: idSchema,
    loopNodeRunId: idSchema,
    loopNodeAttemptId: idSchema,
    attemptNo: z.number().int().positive(),
    leaseGeneration: z.number().int().positive(),
  }).strict().nullable().optional(),
  status: z.enum(["starting", "running", "detached", "interrupted"]),
  controlState: z.enum(["viewer", "controller", "detached"]),
  journal: z.object({
    status: z.enum(["ready", "degraded", "replay_unavailable"]),
    retentionDays: z.number().int().min(1).max(3_650),
    firstSequence: z.number().int().nonnegative(),
    lastSequence: z.number().int().nonnegative(),
  }).strict(),
  // Optional for the same reason as `modelSelection`: a default would force every
  // existing `LiveSessionView` fixture to add the field.
  model: z.object({
    siteId: md5IdSchema,
    siteName: z.string().trim().min(1).max(191),
    model: modelNameSchema,
    label: z.string().trim().min(1).max(256),
    reasoningEffort: reasoningEffortSchema,
  }).strict().nullable().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  // A session whose execution already finished. It keeps its place in the list
  // so the terminal log stays reachable, but it must never be presented as a
  // live target still waiting for an executor. Optional so existing fixtures do
  // not all need the field.
  history: z.boolean().optional(),
}).strict();

export const liveSessionDispatchSchema = z.object({
  sessionId: md5IdSchema,
  kind: liveSessionKindSchema,
  target: liveSessionTargetViewSchema,
  projectId: idSchema.nullable(),
  taskId: idSchema.nullable(),
  executionPolicy: liveSessionExecutionPolicySchema,
  relayUrl: z.string().url(),
  authorization: z.string().trim().min(1).max(4_096),
  modelSelection: liveSessionModelSelectionSchema.nullable().optional(),
  initialCols: z.number().int().min(1).max(1_000),
  initialRows: z.number().int().min(1).max(500),
  runtime: z.object({
    endpoint: z.string().url(),
    apiKey: z.string().trim().min(1).max(4_096),
    model: z.string().trim().min(1).max(512),
    reasoningEffort: reasoningEffortSchema,
  }).strict().optional(),
}).strict();

export type LiveSessionKind = z.infer<typeof liveSessionKindSchema>;
export type LiveSessionSurface = z.infer<typeof liveSessionSurfaceSchema>;
export type LiveSessionExecutionPolicy = z.infer<typeof liveSessionExecutionPolicySchema>;
export type LiveSessionTarget = z.infer<typeof liveSessionTargetSchema>;
export type LiveSessionErrorCode = z.infer<typeof liveSessionErrorCodeSchema>;
export type LiveSessionTicketKind = z.infer<typeof liveSessionTicketKindSchema>;
export type LiveSessionViewerTicket = z.infer<typeof liveSessionViewerTicketSchema>;
export type CreateLiveSessionInput = z.infer<typeof createLiveSessionInputSchema>;
export type LiveSessionView = z.infer<typeof liveSessionViewSchema>;
export type LiveSessionDispatch = z.infer<typeof liveSessionDispatchSchema>;
