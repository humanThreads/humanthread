import { z } from "zod";

export const scheduledTaskStatusSchema = z.enum(["inactive", "enabled", "disabled"]);
export const scheduledTaskContentModeSchema = z.enum(["platform", "loop_managed"]);
export const scheduledTaskTriggerSourceSchema = z.enum(["scheduled", "catch_up", "manual"]);
export const scheduledTaskRunStatusSchema = z.enum([
  "preparing", "running", "waiting", "succeeded", "failed", "cancelled", "blocked",
]);

export const scheduledTaskExecutionTargetInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("local_agent"), agentProfileId: z.string().trim().min(1).max(96) }).strict(),
  z.object({ type: z.literal("linux_worker_pool"), workerPoolId: z.string().regex(/^[a-f0-9]{32}$/u) }).strict(),
]);

const contentFields = {
  contentMode: scheduledTaskContentModeSchema,
  contentMarkdown: z.string().max(100_000).optional(),
};

function validateContent(
  value: { contentMode: string; contentMarkdown?: string | undefined },
  context: z.RefinementCtx,
) {
  if (value.contentMode === "platform" && !value.contentMarkdown?.trim()) {
    context.addIssue({ code: "custom", path: ["contentMarkdown"], message: "平台维护模式需要任务正文" });
  }
  if (value.contentMode === "loop_managed" && value.contentMarkdown !== undefined) {
    context.addIssue({ code: "custom", path: ["contentMarkdown"], message: "项目自行管理模式不能提交 contentMarkdown" });
  }
}

export const createProjectScheduledTaskSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(191),
  description: z.string().max(10_000).default(""),
  loopBindingId: z.string().trim().min(1).max(96),
  cronExpression: z.string().trim().min(1).max(191),
  timezone: z.string().trim().min(1).max(64),
  executionTarget: scheduledTaskExecutionTargetInputSchema,
  ...contentFields,
}).strict().superRefine(validateContent);

export const updateProjectScheduledTaskSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
  expectedVersion: z.number().int().positive(),
  name: z.string().trim().min(1).max(191).optional(),
  description: z.string().max(10_000).optional(),
  loopBindingId: z.string().trim().min(1).max(96).optional(),
  cronExpression: z.string().trim().min(1).max(191).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  executionTarget: scheduledTaskExecutionTargetInputSchema.optional(),
  contentMode: scheduledTaskContentModeSchema.optional(),
  contentMarkdown: z.string().max(100_000).nullable().optional(),
}).strict();

export const changeProjectScheduledTaskStatusSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
  expectedVersion: z.number().int().positive(),
  command: z.enum(["enable", "deactivate", "disable", "restore"]),
}).strict();

export const manualRunProjectScheduledTaskSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
}).strict();

export type ScheduledTaskStatus = z.infer<typeof scheduledTaskStatusSchema>;
export type ScheduledTaskContentMode = z.infer<typeof scheduledTaskContentModeSchema>;
export type ScheduledTaskTriggerSource = z.infer<typeof scheduledTaskTriggerSourceSchema>;
export type ScheduledTaskRunStatus = z.infer<typeof scheduledTaskRunStatusSchema>;
export type ScheduledTaskExecutionTargetInput = z.infer<typeof scheduledTaskExecutionTargetInputSchema>;
