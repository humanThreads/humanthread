import { z } from "zod";

const isoDateTimeSchema = z.iso.datetime();
const nullableIsoDateTimeSchema = isoDateTimeSchema.nullable();
const desktopRouteSchema = z.string().regex(/^\/(?:tasks|documents|agents)(?:[/?]|$)/u);
const commandIdSchema = z.string().trim().min(1).max(128);
const pathFingerprintSchema = z.string().regex(/^hmac-sha256:[A-Za-z0-9_-]{6,128}$/u);

export const desktopWorkspaceConfigurationSchema = z.object({
  bindingId: z.string().trim().min(1).max(96),
  status: z.enum(["ready", "unavailable", "revoked"]),
  pathFingerprint: pathFingerprintSchema,
  configurationVersion: z.number().int().positive(),
  lastValidatedAt: nullableIsoDateTimeSchema,
}).strict();

export const workspaceConfigurationUpsertRequestSchema = z.object({
  commandId: commandIdSchema,
  expectedVersion: z.number().int().positive().optional(),
  status: z.enum(["ready", "unavailable"]),
  pathFingerprint: pathFingerprintSchema,
  validatedAt: isoDateTimeSchema,
}).strict();

export const workspaceConfigurationRevokeRequestSchema = z.object({
  commandId: commandIdSchema,
  expectedVersion: z.number().int().positive(),
}).strict();

export const desktopWorkspaceConfigurationMutationResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    workspace: desktopWorkspaceConfigurationSchema,
  }).strict(),
}).strict();

const projectOwnerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
}).strict();

const projectProgressSchema = z.object({
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  percent: z.number().int().min(0).max(100),
}).strict();

const projectTaskCountsSchema = z.object({
  open: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
}).strict();

const projectMilestoneSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  targetAt: nullableIsoDateTimeSchema,
  status: z.string().min(1),
}).strict();

export const desktopProjectSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  spaceLabel: z.string().min(1),
  objective: z.string().nullable(),
  owner: projectOwnerSchema.nullable(),
  status: z.string().min(1),
  health: z.enum(["healthy", "at_risk", "blocked", "complete", "unknown"]),
  progress: projectProgressSchema,
  taskCounts: projectTaskCountsSchema,
  nextMilestone: projectMilestoneSummarySchema.nullable(),
  updatedAt: isoDateTimeSchema,
}).strict();

export const desktopProjectCollectionResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    projects: z.array(desktopProjectSummarySchema),
  }).strict(),
}).strict();

const desktopProjectDetailSchema = z.object({
  project: desktopProjectSummarySchema.extend({
    description: z.string().nullable(),
    startAt: nullableIsoDateTimeSchema,
    targetAt: nullableIsoDateTimeSchema,
    visibility: z.string().min(1),
    capabilities: z.object({
      edit: z.boolean(),
      manageMembers: z.boolean(),
      changeLifecycle: z.boolean(),
      manageRoadmap: z.boolean(),
      nativeWorkspace: z.boolean(),
    }).strict(),
  }).strict(),
  health: z.object({
    objectiveState: z.enum(["complete", "missing"]),
    currentStageName: z.string().min(1).nullable(),
    nextAction: z.string().min(1),
    blockers: z.number().int().nonnegative(),
    overdueTasks: z.number().int().nonnegative(),
  }).strict(),
  resources: z.object({
    documents: z.number().int().nonnegative(),
    members: z.number().int().nonnegative(),
    activities: z.number().int().nonnegative(),
    automationState: z.string().min(1),
  }).strict(),
  taskSummary: z.object({
    total: z.number().int().nonnegative(),
    open: z.number().int().nonnegative(),
    overdue: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
  }).strict(),
  roadmap: z.array(z.object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    sortOrder: z.number().int().nonnegative(),
    name: z.string().min(1),
    status: z.string().min(1),
    startAt: nullableIsoDateTimeSchema,
    targetAt: nullableIsoDateTimeSchema,
    completedMilestones: z.number().int().nonnegative(),
    totalMilestones: z.number().int().nonnegative(),
    milestones: z.array(z.object({
      id: z.string().min(1),
      version: z.number().int().positive(),
      sortOrder: z.number().int().nonnegative(),
      name: z.string().min(1),
      status: z.string().min(1),
      targetAt: nullableIsoDateTimeSchema,
      taskCount: z.number().int().nonnegative(),
      riskSummary: z.string().min(1).nullable(),
      tasks: z.array(z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        status: z.string().min(1),
        version: z.number().int().positive(),
      }).strict()),
    }).strict()),
  }).strict()),
  tasks: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    status: z.string().min(1),
    priority: z.number().int(),
    assigneeName: z.string().min(1).nullable(),
    milestoneId: z.string().min(1).nullable(),
    updatedAt: isoDateTimeSchema,
    route: desktopRouteSchema,
  }).strict()),
  documents: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    path: z.string().min(1),
    version: z.number().int().positive(),
    updatedAt: isoDateTimeSchema,
    route: desktopRouteSchema,
  }).strict()),
  risks: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    status: z.string().min(1),
    summary: z.string().min(1),
  }).strict()),
  agents: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    status: z.string().min(1),
    currentStepKey: z.string().min(1),
    updatedAt: isoDateTimeSchema,
    route: desktopRouteSchema,
  }).strict()),
  workspace: desktopWorkspaceConfigurationSchema.nullable(),
}).strict();

export const desktopProjectDetailResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({ detail: desktopProjectDetailSchema }).strict(),
}).strict();

export type DesktopProjectSummary = z.infer<typeof desktopProjectSummarySchema>;
export type DesktopProjectCollectionResponse = z.infer<typeof desktopProjectCollectionResponseSchema>;
export type DesktopProjectDetailResponse = z.infer<typeof desktopProjectDetailResponseSchema>;
export type DesktopProjectDetail = DesktopProjectDetailResponse["data"]["detail"];
export type WorkspaceConfigurationUpsertRequest = z.infer<
  typeof workspaceConfigurationUpsertRequestSchema
>;
export type WorkspaceConfigurationRevokeRequest = z.infer<
  typeof workspaceConfigurationRevokeRequestSchema
>;
