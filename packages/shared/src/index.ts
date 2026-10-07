import { z } from "zod";

export type Id = string;

export * from "./development-mode";
export * from "./loop-group-presets";
export * from "./build-version";
export * from "./loop-engine";
export * from "./runtime-checklist";
export * from "./orchestration";
export * from "./release-artifacts";
export * from "./workflow-interactions";
export * from "./worker-pools";
export * from "./worker-execution-snapshot";
export * from "./worker-branch-policy";
export * from "./project-repository";
export * from "./live-session";
export * from "./knowledge";
export * from "./knowledge-safety";
export * from "./knowledge-index";
export * from "./knowledge-architecture";
export * from "./knowledge-bundle";
export * from "./scheduled-task";

export type ExecutorType = "human" | "ai";

export type TaskStatus =
  | "pending"
  | "active"
  | "completed"
  | "blocked"
  | "interrupted"
  | "follow_up"
  | "transferred"
  | "cancelled";

export type WorkflowStatus = "running" | "completed" | "blocked" | "cancelled";

export type TaskEventType =
  | "workflow_created"
  | "task_created"
  | "task_started"
  | "task_completed"
  | "task_blocked"
  | "task_interrupted"
  | "task_follow_up_created"
  | "task_transferred"
  | "local_opened"
  | "command_started"
  | "command_exited"
  | "cli_reported"
  | "ai_step_completed";

export type LocalAgentPlatform =
  | "macos"
  | "windows"
  | "linux"
  | "web"
  | "unknown";

const localAgentPlatformSchema = z.enum([
  "macos",
  "windows",
  "linux",
  "web",
  "unknown",
]);

export const localAgentBuildVersionSchema = z.string().trim().min(1).max(64);

const agentWorkerCapabilityCategorySchema = z.enum([
  "workspace",
  "files",
  "commands",
  "browser",
  "desktop_apps",
]);

const agentWorkerLoginStateCategorySchema = z.enum([
  "provider_account",
  "browser_profile",
  "desktop_app_session",
]);

export const agentWorkerCapabilitySnapshotSchema = z.object({
  providers: z.array(z.object({
    name: z.string().trim().min(1).max(96),
    version: z.string().trim().min(1).max(96),
  }).strict()).min(1).max(16),
  capabilities: z.array(agentWorkerCapabilityCategorySchema).min(1).max(5),
  loginStateCategories: z.array(agentWorkerLoginStateCategorySchema).max(3),
  maxConcurrency: z.number().int().positive().max(128),
}).strict();

export type AgentWorkerCapabilitySnapshot = z.infer<
  typeof agentWorkerCapabilitySnapshotSchema
>;

export function buildLocalAgentWorkerId(deviceId: string): string {
  const normalized = deviceId.trim();
  if (!normalized || normalized.length > 64) {
    throw new Error("Invalid local Agent device ID");
  }
  return `local-worker:${normalized}`;
}

export type AgentTaskEventType = Extract<
  TaskEventType,
  "local_opened" | "command_started" | "command_exited"
>;

export type ToolSessionStatus = "active" | "completed" | "interrupted";

export interface ToolSessionSummary {
  id: Id;
  sessionType: string;
  sessionName: string;
  status: ToolSessionStatus | string;
  lastOutputSummary: string | null;
}

function normalizeToolSessionPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function buildToolSessionName(input: {
  taskId: string;
  localDeviceId: string;
}): string {
  return `ht-${normalizeToolSessionPart(input.taskId)}-${normalizeToolSessionPart(input.localDeviceId)}`;
}

export interface AgentDeviceInfo {
  id: string;
  name: string;
  platform: LocalAgentPlatform;
}

export interface AgentCurrentTaskView {
  id: Id;
  title: string;
  projectId: Id;
  projectName: string;
  workflowInstanceId: Id;
  workflowTitle: string;
  status: TaskStatus;
  localPath: string | null;
  command: string | null;
  toolSession?: ToolSessionSummary | null;
}

export interface AgentCurrentTaskResponse {
  teamId: Id;
  userId: Id;
  queueLength: number;
  task: AgentCurrentTaskView | null;
}

export type AgentDeviceStatus = "authorized" | "pending" | "revoked";

const deviceExecutionIdSchema = z.string().trim().min(1).max(96);
const pathFingerprintSchema = z.string().regex(
  /^hmac-sha256:[A-Za-z0-9_-]{6,128}$/u,
);

export const projectDeviceWorkspaceSchema = z.object({
  id: deviceExecutionIdSchema,
  projectId: deviceExecutionIdSchema,
  userId: deviceExecutionIdSchema,
  localDeviceId: z.string().trim().min(1).max(64),
  status: z.enum(["ready", "unavailable", "revoked"]),
  pathFingerprint: pathFingerprintSchema,
  configurationVersion: z.number().int().positive(),
  lastValidatedAt: z.iso.datetime().nullable(),
}).strict();

/**
 * Reported strings are rendered in the platform model picker and written to logs.
 * Control characters (for example ESC) would let a local device inject terminal
 * escapes into another surface, so they are refused at the boundary.
 */
const reportedModelTextSchema = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001F\u007F]/u.test(value), "Control characters are not allowed");

export const deviceAgentRuntimeProfileSchema = z.object({
  id: deviceExecutionIdSchema,
  userId: deviceExecutionIdSchema,
  localDeviceId: z.string().trim().min(1).max(64),
  provider: z.enum(["codex", "claude"]),
  label: z.string().trim().min(1).max(191),
  status: z.enum(["ready", "missing", "unauthenticated", "disabled"]),
  version: z.number().int().positive(),
  capabilities: z.array(z.string().trim().min(1).max(64)).max(64),
  // Sites reported by the Desktop so the platform can offer a model picker.
  // The schema is strict, which is what keeps credential material (apiKey,
  // credentialRef, baseUrl secrets) out of the persisted profile.
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

export type ProjectDeviceWorkspace = z.infer<
  typeof projectDeviceWorkspaceSchema
>;
export type DeviceAgentRuntimeProfile = z.infer<
  typeof deviceAgentRuntimeProfileSchema
>;

export interface AgentEventReportRequest {
  taskId: Id;
  actorUserId: Id;
  eventType: AgentTaskEventType;
  message?: string;
  payload?: unknown;
  localDevice: AgentDeviceInfo;
}

export const agentDeviceRegisterRequestSchema = z.object({
  userId: z.string().trim().min(1).max(96),
  deviceId: z.string().trim().min(1).max(64),
  deviceName: z.string().trim().min(1).max(191),
  platform: localAgentPlatformSchema,
  capabilitySnapshot: agentWorkerCapabilitySnapshotSchema,
  agentVersion: localAgentBuildVersionSchema.optional(),
}).strict();

export type AgentDeviceRegisterRequest = z.infer<
  typeof agentDeviceRegisterRequestSchema
>;

export interface AgentDeviceRegisterResponse {
  userId: Id;
  deviceId: Id;
  status: AgentDeviceStatus;
  workerId?: Id;
  deviceToken: string;
}

export interface AgentLoginBindRequest {
  email?: string;
  password?: string;
  userId?: Id;
  bindingCode?: string;
  deviceId: Id;
  deviceName: string;
  platform: LocalAgentPlatform;
}

export interface AgentLoginBindResponse {
  teamId: Id;
  userId: Id;
  deviceId: Id;
  status: AgentDeviceStatus;
  deviceToken: string;
}

export interface WorkflowStepTemplate {
  id: Id;
  key: string;
  title: string;
  description: string;
  executorType: ExecutorType;
  assigneeUserId?: Id;
  nextStepKey?: string;
}

export interface WorkflowTemplate {
  id: Id;
  name: string;
  version: number;
  steps: WorkflowStepTemplate[];
  firstStepKey: string;
}

export interface WorkflowInstance {
  id: Id;
  projectId: Id;
  matterTypeId: Id;
  workflowTemplateId: Id;
  title: string;
  description: string;
  status: WorkflowStatus;
  currentStepKey: string;
  createdById: Id;
  createdAt: Date;
  updatedAt: Date;
}

export interface Task {
  id: Id;
  workflowInstanceId: Id;
  projectId: Id;
  stepTemplateId: Id;
  title: string;
  description: string;
  status: TaskStatus;
  executorType: ExecutorType;
  assigneeUserId?: Id;
  queuePosition: number;
  localPath?: string;
  command?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskEvent {
  id: Id;
  taskId: Id;
  workflowInstanceId: Id;
  type: TaskEventType;
  actorType: ExecutorType | "system";
  actorUserId?: Id;
  message?: string;
  payload?: unknown;
  createdAt: Date;
}
