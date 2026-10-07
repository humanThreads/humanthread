import { z } from "zod";

const interactionIdSchema = z.string().trim().min(1).max(128);
const messageBodySchema = z.string().max(20_000);
const answerValueSchema = z.string().trim().min(1).max(4_000);

export const workflowInteractionKindSchema = z.enum([
  "requirement_conversation",
  "business_approval",
  "runtime_permission",
  "runtime_intervention",
]);

export const workflowInteractionStatusSchema = z.enum([
  "open",
  "confirmed",
  "approved",
  "rejected",
  "cancelled",
  "expired",
]);

export const workflowInteractionRoleSchema = z.enum([
  "task_collaborator",
  "task_assignee",
  "task_creator",
  "project_admin",
  "release_approver",
]);

const workflowInteractionFieldOptionSchema = z.object({
  value: z.string().trim().min(1).max(96),
  label: z.string().trim().min(1).max(191),
}).strict();

export const workflowInteractionFieldSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9_-]+$/u).max(64),
  label: z.string().trim().min(1).max(191),
  control: z.enum(["single_select", "multi_select", "text"]),
  options: z.array(workflowInteractionFieldOptionSchema).max(32),
  required: z.boolean(),
}).strict().superRefine((field, context) => {
  if (field.control !== "text" && field.options.length === 0) {
    context.addIssue({ code: "custom", message: "Select fields require options", path: ["options"] });
  }
  if (field.control === "text" && field.options.length > 0) {
    context.addIssue({ code: "custom", message: "Text fields cannot declare options", path: ["options"] });
  }
});

export const workflowInteractionPolicySchema = z.object({
  kind: workflowInteractionKindSchema,
  replyRoles: z.array(workflowInteractionRoleSchema).max(5),
  confirmRoles: z.array(workflowInteractionRoleSchema).min(1).max(5),
  structuredFields: z.array(workflowInteractionFieldSchema).max(32),
}).strict();

export const workflowInteractionSpeakerKeySchema = z.string().regex(/^[0-9a-f]{32}$/u);
const positionDigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const workflowInteractionConclusionSchema = z.object({
  topicKey: z.string().regex(/^[A-Za-z0-9_-]+$/u).max(64),
  optionKey: z.string().regex(/^[A-Za-z0-9_-]+$/u).max(96),
  exclusive: z.boolean(),
}).strict();

export const workflowInteractionSpeakerDelegationSchema = z.object({
  event: z.literal("speaker_delegation"),
  speakerKey: workflowInteractionSpeakerKeySchema,
}).strict();

export const workflowInteractionDiscussionMessageSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("position"),
    conclusion: workflowInteractionConclusionSchema.optional(),
  }).strict(),
  z.object({
    event: z.literal("speaker_confirmation"),
    positionSequence: z.number().int().positive(),
    positionDigest: positionDigestSchema,
  }).strict(),
  workflowInteractionSpeakerDelegationSchema,
]);

export const interventionResolutionActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("route_upstream"), targetNodeKey: z.string().min(1).max(96) }).strict(),
  z.object({ type: z.literal("resume_checkpoint") }).strict(),
  z.object({ type: z.literal("terminate") }).strict(),
]);

const workflowInteractionDiscussionStateShape = {
  speakers: z.array(z.object({
    speakerKey: workflowInteractionSpeakerKeySchema,
    latestSequence: z.number().int().positive(),
    confirmed: z.boolean(),
  }).passthrough()).max(128),
  conflicts: z.array(z.object({
    topicKey: z.string().regex(/^[A-Za-z0-9_-]+$/u).max(64),
    optionKeys: z.array(z.string().regex(/^[A-Za-z0-9_-]+$/u).max(96)).min(2).max(32),
  }).passthrough()).max(32),
};

export const workflowInteractionDiscussionStateSchema = z.discriminatedUnion("phase", [
  z.object({
    phase: z.literal("ordinary"),
    activeSpeakerKey: z.null(),
    ...workflowInteractionDiscussionStateShape,
  }).passthrough(),
  z.object({
    phase: z.literal("conflict_resolution"),
    activeSpeakerKey: workflowInteractionSpeakerKeySchema,
    ...workflowInteractionDiscussionStateShape,
  }).passthrough(),
]);

export const workflowInteractionCapabilitiesSchema = z.object({
  canReply: z.boolean(),
  canConfirmOwnPosition: z.boolean(),
  canSubmit: z.boolean(),
  canDelegateConflictSpeaker: z.boolean(),
  canResolveConflict: z.boolean(),
}).passthrough();

export const workflowInteractionMessageInputSchema = z.object({
  body: messageBodySchema,
  answers: z.record(z.string().regex(/^[A-Za-z0-9_-]+$/u).max(64), z.array(answerValueSchema).max(32)),
  attachmentIds: z.array(interactionIdSchema).max(20),
  mentionedUserIds: z.array(interactionIdSchema).max(50),
  discussion: workflowInteractionDiscussionMessageSchema.optional(),
}).strict().superRefine((message, context) => {
  if (
    message.body.trim().length === 0
    && Object.keys(message.answers).length === 0
    && message.attachmentIds.length === 0
    && message.discussion === undefined
  ) {
    context.addIssue({ code: "custom", message: "Workflow interaction message is empty", path: ["body"] });
  }
});

export const workflowInteractionCommandSchema = z.object({
  commandId: interactionIdSchema,
  expectedVersion: z.number().int().nonnegative(),
}).strict();

export const workflowInteractionMessageViewSchema = z.object({
  id: interactionIdSchema,
  sequence: z.number().int().positive(),
  actorType: z.enum(["user", "agent", "system"]),
  actorId: interactionIdSchema,
  actorUserId: interactionIdSchema.nullable().optional(),
  actorDisplayName: z.string().max(191).nullable().optional(),
  actorAvatarUrl: z.string().max(512).nullable().optional(),
  commandId: interactionIdSchema,
  body: messageBodySchema,
  answers: z.record(z.string(), z.array(z.string())),
  createdAt: z.iso.datetime({ offset: true }),
  attachmentIds: z.array(interactionIdSchema).optional(),
  mentionedUserIds: z.array(interactionIdSchema).optional(),
  discussion: workflowInteractionDiscussionMessageSchema.optional(),
}).passthrough();

export const workflowInteractionDecisionViewSchema = z.object({
  id: interactionIdSchema,
  decision: z.enum(["confirmed", "approved", "rejected", "cancelled", "expired"]),
  actorType: z.enum(["user", "agent", "system"]),
  actorId: interactionIdSchema,
  reason: z.string().max(4_000).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
}).passthrough();

export const workflowInteractionViewSchema = z.object({
  id: interactionIdSchema,
  projectId: interactionIdSchema,
  taskId: interactionIdSchema.nullable(),
  loopRunId: interactionIdSchema,
  loopNodeRunId: interactionIdSchema,
  activationNo: z.number().int().positive(),
  kind: workflowInteractionKindSchema,
  status: workflowInteractionStatusSchema,
  version: z.number().int().positive(),
  createdAt: z.iso.datetime({ offset: true }),
  closedAt: z.iso.datetime({ offset: true }).nullable(),
  messages: z.array(workflowInteractionMessageViewSchema),
  decision: workflowInteractionDecisionViewSchema.nullable(),
  discussionState: workflowInteractionDiscussionStateSchema.optional(),
  capabilities: workflowInteractionCapabilitiesSchema.optional(),
}).passthrough();

export type WorkflowInteractionKind = z.infer<typeof workflowInteractionKindSchema>;
export type WorkflowInteractionStatus = z.infer<typeof workflowInteractionStatusSchema>;
export type WorkflowInteractionRole = z.infer<typeof workflowInteractionRoleSchema>;
export type WorkflowInteractionPolicy = z.infer<typeof workflowInteractionPolicySchema>;
export type WorkflowInteractionField = z.infer<typeof workflowInteractionFieldSchema>;
export type WorkflowInteractionMessageInput = z.infer<typeof workflowInteractionMessageInputSchema>;
export type WorkflowInteractionView = z.infer<typeof workflowInteractionViewSchema>;
export type WorkflowInteractionConclusion = z.infer<typeof workflowInteractionConclusionSchema>;
export type WorkflowInteractionDiscussionMessage = z.infer<typeof workflowInteractionDiscussionMessageSchema>;
export type WorkflowInteractionSpeakerDelegation = z.infer<typeof workflowInteractionSpeakerDelegationSchema>;
export type InterventionResolutionAction = z.infer<typeof interventionResolutionActionSchema>;
export type WorkflowInteractionDiscussionState = z.infer<typeof workflowInteractionDiscussionStateSchema>;
export type WorkflowInteractionCapabilities = z.infer<typeof workflowInteractionCapabilitiesSchema>;
