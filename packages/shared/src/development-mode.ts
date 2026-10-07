import { z } from "zod";
import { loopGroupPresetSchema, loopGroupSelectionSchema } from "./loop-group-presets";

const idSchema = z.string().trim().min(1).max(128);
const branchNameSchema = z.string().trim().min(1).max(191).refine(
  (value) => (
    !value.startsWith("/")
    && !value.endsWith("/")
    && !value.includes("..")
    && !/[~^:?*\[\\\u0000-\u001f\u007f]/u.test(value)
    && /^[A-Za-z0-9._/-]+$/u.test(value)
  ),
  { message: "Invalid Git branch name" },
);
const commitSchema = z.string().regex(/^[a-f0-9]{40,64}$/u);
const repositoryRelativePathSchema = z.string().trim().min(1).max(512).refine(
  (value) => (
    !value.startsWith("/")
    && !value.includes("\\")
    && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  ),
  { message: "Path must be repository-relative and use forward slashes" },
);

export const projectLoopBindingRoleSchema = z.enum([
  "task_development",
  "milestone_release",
]);

export const developmentTemplateOriginSchema = z.enum(["space", "platform"]);

export const DEVELOPMENT_TEMPLATE_INDUSTRIES = [
  "农林牧渔", "石油石化", "煤炭", "金属及金属矿", "建材及非金属", "基础化工",
  "医药生物", "食品饮料", "纺织服装", "轻工制造", "汽车", "家用电器", "机械设备",
  "航空航天与国防", "电力设备", "信息技术", "建筑业", "房地产", "金融业",
  "交通运输、仓储及物流业", "环保", "公用事业", "文化传媒", "社会服务", "商业服务",
  "商贸零售", "公共管理、社会保障和社会组织", "综合",
] as const;

export const developmentTemplateIndustrySchema = z.enum(DEVELOPMENT_TEMPLATE_INDUSTRIES);

const templateTimestampSchema = z.union([
  z.iso.datetime(),
  z.date().transform((value) => value.toISOString()),
]);

export const branchDevelopmentConfigSchema = z.object({
  productionBranch: branchNameSchema,
  stagingBranch: branchNameSchema,
  releaseAgentProfileId: idSchema,
  taskBranchPattern: z.literal("{year}-{shortId}").default("{year}-{shortId}"),
  taskBranchBase: z.literal("staging").default("staging"),
  taskBranchCreation: z.literal("on_first_execution").default("on_first_execution"),
  integrationMode: z.literal("local_merge_test_push").default("local_merge_test_push"),
  productionApprovalRequired: z.literal(true).default(true),
  releaseTriggers: z.tuple([
    z.literal("milestone.release_ready"),
    z.literal("manual"),
  ]).default(["milestone.release_ready", "manual"]),
  loopGroupSelection: z.object({
    selectedPresetKeys: z.array(z.string().trim().min(1).max(96)).min(1).max(32),
    defaultPresetKey: z.string().trim().min(1).max(96),
    presets: z.array(loopGroupPresetSchema).max(32).optional(),
  }).strict().optional(),
}).strict().superRefine((config, context) => {
  if (config.productionBranch === config.stagingBranch) {
    context.addIssue({
      code: "custom",
      message: "Production and staging branches must be different",
      path: ["stagingBranch"],
    });
  }
  if (config.loopGroupSelection && !config.loopGroupSelection.selectedPresetKeys.includes(config.loopGroupSelection.defaultPresetKey)) {
    context.addIssue({ code: "custom", message: "Default Loop group preset must be selected", path: ["loopGroupSelection", "defaultPresetKey"] });
  }
});

export const projectDevelopmentTemplateSchema = z.object({
  id: idSchema,
  key: z.string().trim().min(1).max(96),
  name: z.string().trim().min(1).max(191),
  version: z.number().int().positive(),
  status: z.enum(["draft", "published", "deprecated"]),
  spaceId: idSchema.nullable(),
  origin: developmentTemplateOriginSchema,
  kind: z.string().trim().min(1).max(96),
  description: z.string().trim().max(20_000).nullable(),
  createdByUserId: idSchema.nullable(),
  sourceTemplateId: idSchema.nullable(),
  revision: z.number().int().positive(),
  projectConfigSchema: z.unknown(),
  taskFieldSchema: z.unknown(),
  developmentLoopVersionId: idSchema.nullable(),
  releaseLoopVersionId: idSchema.nullable(),
  triggerPolicy: z.unknown(),
  executionPolicy: z.unknown(),
  isPublic: z.boolean().optional(),
  publicAt: templateTimestampSchema.nullable().optional(),
  deletedAt: templateTimestampSchema.nullable().optional(),
  industryTags: z.array(developmentTemplateIndustrySchema).max(DEVELOPMENT_TEMPLATE_INDUSTRIES.length).optional(),
  starCount: z.number().int().nonnegative().optional(),
  loopGroupConfig: z.object({
    presets: z.array(loopGroupPresetSchema).min(1).max(32),
    defaultSelection: loopGroupSelectionSchema,
  }).strict().nullable().optional(),
}).strict().superRefine((template, context) => {
  if (template.status === "published" && template.developmentLoopVersionId === null) {
    context.addIssue({
      code: "custom",
      message: "Published templates require a development Loop version",
      path: ["developmentLoopVersionId"],
    });
  }
  if (template.status === "published" && template.releaseLoopVersionId === null) {
    context.addIssue({
      code: "custom",
      message: "Published templates require a release Loop version",
      path: ["releaseLoopVersionId"],
    });
  }
});

export const taskBranchAssignmentSchema = z.object({
  taskId: idSchema,
  branch: branchNameSchema,
  year: z.number().int().min(2000).max(9999),
  shortId: z.string().trim().regex(/^[A-Z][A-Z0-9]{1,31}\d+$/u),
  assignedAt: z.iso.datetime({ offset: true }),
  assignedByActor: z.string().trim().min(1).max(191),
}).strict().superRefine((assignment, context) => {
  if (assignment.branch !== `${assignment.year}-${assignment.shortId}`) {
    context.addIssue({
      code: "custom",
      message: "Task branch must match its year and short ID",
      path: ["branch"],
    });
  }
});

const passedEvidenceSchema = z.object({
  status: z.literal("passed"),
  evidenceRefs: z.array(idSchema).min(1).max(100),
}).strict();

export const taskRequirementResultSchema = passedEvidenceSchema.extend({
  requirementId: idSchema,
}).strict();

export const taskCheckResultSchema = passedEvidenceSchema.extend({
  name: z.string().trim().min(1).max(191),
}).strict();

export const taskTestReportSchema = z.object({
  taskId: idSchema,
  branch: branchNameSchema,
  commit: commitSchema,
  status: z.literal("passed"),
  requirements: z.array(taskRequirementResultSchema).min(1).max(200),
  checks: z.array(taskCheckResultSchema).min(1).max(200),
}).strict();

const releaseTaskSchema = z.object({
  taskId: idSchema,
  taskNumber: z.number().int().positive(),
  branch: branchNameSchema,
  headCommit: commitSchema,
  taskDocument: z.object({
    documentId: idSchema,
    version: z.number().int().positive(),
  }).strict(),
  knowledgeRefs: z.array(z.object({
    path: repositoryRelativePathSchema,
    commit: commitSchema,
  }).strict()).min(1).max(100),
  testReportRef: idSchema,
  requirements: z.array(z.object({
    requirementId: idSchema,
    status: z.enum(["passed", "failed", "inconclusive", "skipped"]),
  }).strict()).optional(),
}).strict();

export const milestoneReleaseSnapshotSchema = z.object({
  projectId: idSchema,
  milestoneId: idSchema,
  milestoneVersion: z.number().int().positive(),
  triggerType: z.enum(["manual", "milestone_event"]),
  stagingBranch: branchNameSchema,
  tasks: z.array(releaseTaskSchema).min(1).max(500),
  stagingBaseCommit: commitSchema,
  productionBaseCommit: commitSchema,
  createdAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((snapshot, context) => {
  const taskIds = new Set<string>();
  const branches = new Set<string>();
  snapshot.tasks.forEach((task, index) => {
    if (taskIds.has(task.taskId)) {
      context.addIssue({ code: "custom", message: "Release Task IDs must be unique", path: ["tasks", index, "taskId"] });
    }
    if (branches.has(task.branch)) {
      context.addIssue({ code: "custom", message: "Release Task branches must be unique", path: ["tasks", index, "branch"] });
    }
    taskIds.add(task.taskId);
    branches.add(task.branch);
  });
});

export const milestoneReleaseReadyEventSchema = z.object({
  projectId: idSchema,
  milestoneId: idSchema,
  milestoneVersion: z.number().int().positive(),
}).strict();

export type ProjectLoopBindingRole = z.infer<typeof projectLoopBindingRoleSchema>;
export type BranchDevelopmentConfig = z.infer<typeof branchDevelopmentConfigSchema>;
export type ProjectDevelopmentTemplate = z.infer<typeof projectDevelopmentTemplateSchema>;
export type TaskBranchAssignment = z.infer<typeof taskBranchAssignmentSchema>;
export type TaskRequirementResult = z.infer<typeof taskRequirementResultSchema>;
export type TaskCheckResult = z.infer<typeof taskCheckResultSchema>;
export type TaskTestReport = z.infer<typeof taskTestReportSchema>;
export type MilestoneReleaseSnapshot = z.infer<typeof milestoneReleaseSnapshotSchema>;
export type MilestoneReleaseReadyEvent = z.infer<typeof milestoneReleaseReadyEventSchema>;
