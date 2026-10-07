import { z } from "zod";

const commandIdSchema = z.string().trim().min(1).max(128);

/**
 * Reported strings reach the platform model picker and logs, so control
 * characters are refused at this boundary rather than sanitised later.
 */
const reportedModelTextSchema = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001F\u007F]/u.test(value), "Control characters are not allowed");

export const desktopAgentRuntimeProfileSchema = z.object({
  id: z.string().trim().min(1).max(96),
  userId: z.string().trim().min(1).max(96),
  localDeviceId: z.string().trim().min(1).max(64),
  provider: z.enum(["codex", "claude"]),
  label: z.string().trim().min(1).max(191),
  status: z.enum(["ready", "missing", "unauthenticated", "disabled"]),
  version: z.number().int().positive(),
  capabilities: z.array(z.string().trim().min(1).max(64)).max(64),
  modelSites: z.array(z.object({
    siteId: z.string().regex(/^[a-f0-9]{32}$/u),
    name: reportedModelTextSchema(191),
    adapter: z.enum(["codex_environment", "openai_compatible", "ollama", "lmstudio"]),
    models: z.array(z.object({
      name: reportedModelTextSchema(512),
      label: reportedModelTextSchema(256),
    }).strict()).max(512),
  }).strict()).max(32).default([]),
  lastValidatedAt: z.iso.datetime().nullable(),
}).strict();

export const deviceRuntimeProfileUpsertRequestSchema = z.object({
  commandId: commandIdSchema,
  expectedVersion: z.number().int().positive().optional(),
  provider: z.enum(["codex", "claude"]),
  label: z.string().trim().min(1).max(191),
  status: z.enum(["ready", "missing", "unauthenticated", "disabled"]),
  capabilities: z.array(z.string().trim().min(1).max(64)).max(64),
  modelSites: z.array(z.object({
    siteId: z.string().regex(/^[a-f0-9]{32}$/u),
    name: reportedModelTextSchema(191),
    adapter: z.enum(["codex_environment", "openai_compatible", "ollama", "lmstudio"]),
    models: z.array(z.object({
      name: reportedModelTextSchema(512),
      label: reportedModelTextSchema(256),
    }).strict()).max(512),
  }).strict()).max(32).optional(),
  validatedAt: z.iso.datetime(),
}).strict();

export const desktopAgentRuntimeCollectionResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    runtimeProfiles: z.array(desktopAgentRuntimeProfileSchema),
  }).strict(),
}).strict();

export const desktopAgentRuntimeMutationResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    runtimeProfile: desktopAgentRuntimeProfileSchema,
  }).strict(),
}).strict();

export const desktopApprovalDecisionRequestSchema = z.object({
  commandId: commandIdSchema,
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().max(2_000),
}).strict();

export const desktopLoopCommandRequestSchema = z.object({
  commandId: commandIdSchema,
  command: z.enum(["start", "pause", "resume", "cancel"]),
  expectedVersion: z.number().int().positive(),
}).strict();

const desktopLoopInteractionMessageInputSchema = z.object({
  body: z.string().max(20_000),
  answers: z.record(
    z.string().regex(/^[A-Za-z0-9_-]+$/u).max(64),
    z.array(z.string().trim().min(1).max(4_000)).max(32),
  ),
  attachmentIds: z.array(z.string().trim().min(1).max(128)).max(20),
  mentionedUserIds: z.array(z.string().trim().min(1).max(128)).max(50),
}).strict().superRefine((message, context) => {
  if (
    message.body.trim().length === 0
    && Object.keys(message.answers).length === 0
    && message.attachmentIds.length === 0
  ) {
    context.addIssue({ code: "custom", message: "Loop interaction message is empty", path: ["body"] });
  }
});

export const desktopLoopInteractionMessageRequestSchema = z.object({
  commandId: commandIdSchema,
  message: desktopLoopInteractionMessageInputSchema,
}).strict();

export const desktopLoopInteractionConfirmRequestSchema = z.object({
  commandId: commandIdSchema,
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().max(4_000),
}).strict();

export const desktopLoopInteractionDecisionRequestSchema = z.object({
  commandId: commandIdSchema,
  expectedVersion: z.number().int().nonnegative(),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().max(4_000),
  selectedEdgeId: z.string().trim().min(1).max(96),
}).strict().superRefine((value, context) => {
  if (value.decision === "rejected" && value.reason.trim().length === 0) {
    context.addIssue({ code: "custom", message: "Rejection reason is required", path: ["reason"] });
  }
});

export const desktopLoopInteractionMutationResponseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    id: z.string().trim().min(1).max(128),
    status: z.string().trim().min(1).max(64),
    version: z.number().int().positive(),
  }).strict(),
}).strict();

export const desktopAgentMutationResponseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    resourceType: z.enum(["approval", "loop"]),
    id: z.string().min(1),
    status: z.string().min(1),
    version: z.number().int().positive().optional(),
  }).strict(),
}).strict();

export type DesktopApprovalDecisionRequest = z.infer<typeof desktopApprovalDecisionRequestSchema>;
export type DesktopLoopCommandRequest = z.infer<typeof desktopLoopCommandRequestSchema>;
export type DesktopAgentMutationResponse = z.infer<typeof desktopAgentMutationResponseSchema>;
export type DesktopLoopInteractionMessageRequest = z.infer<typeof desktopLoopInteractionMessageRequestSchema>;
export type DesktopLoopInteractionConfirmRequest = z.infer<typeof desktopLoopInteractionConfirmRequestSchema>;
export type DesktopLoopInteractionDecisionRequest = z.infer<typeof desktopLoopInteractionDecisionRequestSchema>;
export type DesktopLoopInteractionMutationResponse = z.infer<typeof desktopLoopInteractionMutationResponseSchema>;
export type DeviceRuntimeProfileUpsertRequest = z.infer<
  typeof deviceRuntimeProfileUpsertRequestSchema
>;
