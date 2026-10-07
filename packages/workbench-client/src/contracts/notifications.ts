import { z } from "zod";

export const loopNotificationIntentSchema = z.object({
  id: z.string().min(1).max(128),
  projectId: z.string().min(1).max(96),
  loopRunId: z.string().min(1).max(96),
  loopNodeRunId: z.string().min(1).max(96).nullable(),
  level: z.enum(["action_required", "critical", "important", "activity"]),
  title: z.string().min(1).max(160),
  description: z.string().max(240),
  eventFamily: z.string().min(1).max(96),
  channels: z.array(z.enum(["in_app", "desktop", "email", "enterprise_im"])),
  approvalId: z.string().min(1).max(128).nullable(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
}).strict();

export const desktopNotificationReadRequestSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
}).strict();

export const desktopNotificationReadResponseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    notificationId: z.string().min(1),
    isUnread: z.literal(false),
  }).strict(),
}).strict();

export type DesktopNotificationReadRequest = z.infer<
  typeof desktopNotificationReadRequestSchema
>;
export type DesktopNotificationReadResponse = z.infer<
  typeof desktopNotificationReadResponseSchema
>;
export type LoopNotificationIntent = z.infer<typeof loopNotificationIntentSchema>;
