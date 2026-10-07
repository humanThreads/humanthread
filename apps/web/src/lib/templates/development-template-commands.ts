import { createHash } from "node:crypto";
import {
  assertCanWriteSpace,
  assertCanReadSpace,
  compareDevelopmentTemplateVersions as compareDevelopmentTemplateVersionsRepository,
  createDevelopmentTemplateDraft as createDevelopmentTemplateDraftRepository,
  deprecateDevelopmentTemplate as deprecateDevelopmentTemplateRepository,
  publishDevelopmentTemplate as publishDevelopmentTemplateRepository,
  readDevelopmentTemplate,
  prisma,
  setDevelopmentTemplateMarketVisibility as setDevelopmentTemplateMarketVisibilityRepository,
  deleteDevelopmentTemplate as deleteDevelopmentTemplateRepository,
  updateDevelopmentTemplateDraft as updateDevelopmentTemplateDraftRepository,
} from "@humanthread/db";
import type { ProjectDevelopmentTemplate } from "@humanthread/shared";

type Template = ProjectDevelopmentTemplate;
type LoopVersion = { id: string; status: string; loopDefinition: { scope: string; origin: string; spaceId: string } | null };

interface Dependencies {
  now(): Date;
  assertCanWriteSpace(input: { userId: string; spaceId: string }): Promise<unknown>;
  getTemplate(input: { templateId: string }): Promise<Template | null>;
  listLoopVersions(ids: string[]): Promise<LoopVersion[]>;
  createDraft(input: Parameters<typeof createDevelopmentTemplateDraftRepository>[0]): ReturnType<typeof createDevelopmentTemplateDraftRepository>;
  updateDraft(input: Parameters<typeof updateDevelopmentTemplateDraftRepository>[0]): ReturnType<typeof updateDevelopmentTemplateDraftRepository>;
  publish(input: Parameters<typeof publishDevelopmentTemplateRepository>[0]): ReturnType<typeof publishDevelopmentTemplateRepository>;
  deprecate(input: Parameters<typeof deprecateDevelopmentTemplateRepository>[0]): ReturnType<typeof deprecateDevelopmentTemplateRepository>;
  setMarketVisibility(input: Parameters<typeof setDevelopmentTemplateMarketVisibilityRepository>[0]): ReturnType<typeof setDevelopmentTemplateMarketVisibilityRepository>;
  deleteTemplate(input: Parameters<typeof deleteDevelopmentTemplateRepository>[0]): ReturnType<typeof deleteDevelopmentTemplateRepository>;
  readCommandResult(commandId: string, templateId: string): Promise<unknown | undefined>;
}

const dependencies: Dependencies = {
  now: () => new Date(),
  assertCanWriteSpace,
  getTemplate: readDevelopmentTemplate,
  listLoopVersions: (ids) => import("@humanthread/db").then(({ prisma }) => prisma.loopVersion.findMany({
    where: { id: { in: ids }, status: "published" },
    select: { id: true, status: true, loopDefinition: { select: { scope: true, origin: true, spaceId: true } } },
  }) as Promise<LoopVersion[]>),
  createDraft: createDevelopmentTemplateDraftRepository,
  updateDraft: updateDevelopmentTemplateDraftRepository,
  publish: publishDevelopmentTemplateRepository,
  deprecate: deprecateDevelopmentTemplateRepository,
  setMarketVisibility: setDevelopmentTemplateMarketVisibilityRepository,
  deleteTemplate: deleteDevelopmentTemplateRepository,
  readCommandResult: async (commandId, templateId) => {
    const receipt = await prisma.commandReceipt.findUnique({ where: { id: commandId }, select: { aggregateId: true, status: true, result: true } });
    return receipt?.status === "completed" && receipt.aggregateId === templateId ? receipt.result ?? undefined : undefined;
  },
};

const defaultProjectConfigSchema = {
  type: "object", required: ["productionBranch", "stagingBranch", "releaseAgentProfileId"],
  properties: { productionBranch: { type: "string" }, stagingBranch: { type: "string" }, releaseAgentProfileId: { type: "string" } },
};
const defaultTaskFieldSchema = {
  type: "object", required: ["taskBranch"], properties: { taskBranch: { type: "string", pattern: "^[0-9]{4}-[A-Z0-9]+$" } },
};

function error(code: "authorization_denied" | "not_found" | "validation_failed" | "version_conflict", message: string, currentRevision?: number, issues?: Array<{ path: string[]; message: string }>): Error {
  return Object.assign(new Error(message), { code, ...(currentRevision === undefined ? {} : { currentRevision }), ...(issues === undefined ? {} : { issues }) });
}

function id(prefix: string, parts: string[]): string {
  return `${prefix}_${createHash("sha256").update(parts.join("\0")).digest("hex")}`;
}

function object(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw error("validation_failed", `${field} must be a JSON object`);
}

const forbiddenConfigKey = /secret|token|password|credential|accessKey|localPath|absolutePath/i;

function assertNoSensitiveConfig(value: unknown, field: string, path: string[] = [field]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveConfig(item, field, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenConfigKey.test(key)) {
      throw error("validation_failed", `${field} cannot contain sensitive fields`, undefined, [{ path: [...path, key], message: "Sensitive configuration fields are not allowed" }]);
    }
    assertNoSensitiveConfig(nested, field, [...path, key]);
  }
}

async function writableTemplate(input: { actorUserId: string; templateId: string }, deps: Dependencies): Promise<Template> {
  const template = await deps.getTemplate({ templateId: input.templateId });
  if (!template) throw error("not_found", "Development template not found");
  if (template.origin === "platform" || !template.spaceId) throw error("authorization_denied", "Platform development templates are read-only");
  const access = await deps.assertCanWriteSpace({ userId: input.actorUserId, spaceId: template.spaceId }) as { role?: string };
  if (template.createdByUserId !== input.actorUserId && access.role !== "owner" && access.role !== "admin") {
    throw error("authorization_denied", "只有模板创建人或 Space 管理员可以编辑此 Loop 模板");
  }
  return template;
}

async function validateLoopVersions(template: Template, deps: Dependencies): Promise<void> {
  const configured = readLoopGroupLoopIds(template.loopGroupConfig);
  const ids = [...new Set([
    template.developmentLoopVersionId,
    template.releaseLoopVersionId,
    ...configured.taskLoopIds,
    ...configured.projectLoopIds,
  ].filter((id): id is string => Boolean(id)))];
  if (!template.developmentLoopVersionId || !template.releaseLoopVersionId) throw error("validation_failed", "Select both project Loop versions before publishing", undefined, [
    ...(!template.developmentLoopVersionId ? [{ path: ["developmentLoopVersionId"], message: "Development Loop version is required" }] : []),
    ...(!template.releaseLoopVersionId ? [{ path: ["releaseLoopVersionId"], message: "Release Loop version is required" }] : []),
  ]);
  const loopVersions = await deps.listLoopVersions(ids);
  if (loopVersions.length !== ids.length) throw error("validation_failed", "Development template Loop versions are unavailable");
  for (const loop of loopVersions) {
    const definition = loop.loopDefinition;
    if (loop.status !== "published" || !definition) {
      throw error("validation_failed", "Development templates require published Loop versions");
    }
    if (definition.origin !== "platform" && definition.spaceId !== template.spaceId) {
      throw error("validation_failed", "Development template Loop belongs to another Space");
    }
    if (configured.taskLoopIds.includes(loop.id) && definition.scope !== "task") {
      throw error("validation_failed", "Task Loop groups can contain only task-scoped Loop versions");
    }
    if (configured.projectLoopIds.includes(loop.id) && definition.scope !== "project") {
      throw error("validation_failed", "Project Loop groups can contain only project-scoped Loop versions");
    }
  }
}

function readLoopGroupLoopIds(config: Template["loopGroupConfig"]): { taskLoopIds: string[]; projectLoopIds: string[] } {
  if (!config) return { taskLoopIds: [], projectLoopIds: [] };
  return {
    taskLoopIds: [...new Set(config.presets.flatMap((preset) => [...preset.taskLoopIds]))],
    projectLoopIds: [...new Set(config.presets.flatMap((preset) => [...preset.projectLoopIds]))],
  };
}

function ensureRevision(template: Template, expectedRevision: number): void {
  if (template.revision !== expectedRevision) throw error("version_conflict", "Development template changed", template.revision);
}

export async function createDevelopmentTemplateDraft(input: { actorUserId: string; commandId: string; spaceId: string; name: string }, deps = dependencies) {
  await deps.assertCanWriteSpace({ userId: input.actorUserId, spaceId: input.spaceId });
  return deps.createDraft({
    id: id("development_template", [input.spaceId, input.actorUserId, input.commandId]),
    key: `space_${input.spaceId}_${id("template", [input.commandId]).slice(-24)}`,
    version: 1, spaceId: input.spaceId, kind: "branch-development", name: input.name,
    description: null, sourceTemplateId: null, projectConfigSchema: defaultProjectConfigSchema,
    taskFieldSchema: defaultTaskFieldSchema, developmentLoopVersionId: null, releaseLoopVersionId: null,
    triggerPolicy: { releaseTriggers: ["milestone.release_ready", "manual"] },
    executionPolicy: { taskBranchPattern: "{year}-{shortId}", taskBranchBase: "staging", taskBranchCreation: "on_first_execution", integrationMode: "local_merge_test_push", productionApprovalRequired: true },
    actorUserId: input.actorUserId,
  });
}

export async function createDevelopmentTemplateRevisionDraft(input: { actorUserId: string; commandId: string; templateId: string }, deps = dependencies) {
  const template = await writableTemplate(input, deps);
  if (template.status !== "published") throw error("validation_failed", "Only published development templates can create a new draft version");
  return deps.createDraft({
    id: id("development_template", [template.id, input.actorUserId, input.commandId]),
    key: template.key,
    version: template.version + 1,
    spaceId: template.spaceId!,
    kind: template.kind,
    name: template.name,
    description: template.description,
    sourceTemplateId: template.id,
    projectConfigSchema: template.projectConfigSchema,
    taskFieldSchema: template.taskFieldSchema,
    developmentLoopVersionId: template.developmentLoopVersionId,
    releaseLoopVersionId: template.releaseLoopVersionId,
    triggerPolicy: template.triggerPolicy,
    executionPolicy: template.executionPolicy,
    loopGroupConfig: template.loopGroupConfig,
    industryTags: template.industryTags ?? [],
    actorUserId: input.actorUserId,
  });
}

export async function updateDevelopmentTemplateDraft(input: {
  actorUserId: string; commandId: string; templateId: string; expectedRevision: number; name: string;
  description?: string | null; projectConfigSchema?: Record<string, unknown>; taskFieldSchema?: Record<string, unknown>;
  developmentLoopVersionId?: string | null; releaseLoopVersionId?: string | null;
  triggerPolicy?: Record<string, unknown>; executionPolicy?: Record<string, unknown>;
  loopGroupConfig?: unknown;
  industryTags?: readonly string[];
}, deps = dependencies) {
  const template = await writableTemplate(input, deps);
  const replay = await deps.readCommandResult(input.commandId, input.templateId);
  if (replay !== undefined) return replay as Awaited<ReturnType<Dependencies["updateDraft"]>>;
  ensureRevision(template, input.expectedRevision);
  const projectConfigSchema = input.projectConfigSchema ?? template.projectConfigSchema;
  object(projectConfigSchema, "projectConfigSchema");
  assertNoSensitiveConfig(projectConfigSchema, "projectConfigSchema");
  assertNoSensitiveConfig(input.taskFieldSchema ?? template.taskFieldSchema, "taskFieldSchema");
  assertNoSensitiveConfig(input.triggerPolicy ?? template.triggerPolicy, "triggerPolicy");
  assertNoSensitiveConfig(input.executionPolicy ?? template.executionPolicy, "executionPolicy");
  assertNoSensitiveConfig(input.loopGroupConfig ?? template.loopGroupConfig, "loopGroupConfig");
  return deps.updateDraft({
    id: template.id, key: template.key, version: template.version, expectedRevision: input.expectedRevision,
    spaceId: template.spaceId!, kind: template.kind, name: input.name,
    description: input.description === undefined ? template.description : input.description,
    sourceTemplateId: template.sourceTemplateId, projectConfigSchema,
    taskFieldSchema: input.taskFieldSchema ?? template.taskFieldSchema,
    developmentLoopVersionId: input.developmentLoopVersionId === undefined ? template.developmentLoopVersionId : input.developmentLoopVersionId,
    releaseLoopVersionId: input.releaseLoopVersionId === undefined ? template.releaseLoopVersionId : input.releaseLoopVersionId,
    triggerPolicy: input.triggerPolicy ?? template.triggerPolicy, executionPolicy: input.executionPolicy ?? template.executionPolicy,
    loopGroupConfig: input.loopGroupConfig === undefined ? template.loopGroupConfig : input.loopGroupConfig,
    industryTags: input.industryTags ?? template.industryTags ?? [],
    actorUserId: input.actorUserId,
    commandId: input.commandId,
  });
}

export async function copyDevelopmentTemplate(input: { actorUserId: string; commandId: string; templateId: string; spaceId: string; name: string }, deps = dependencies) {
  await deps.assertCanWriteSpace({ userId: input.actorUserId, spaceId: input.spaceId });
  const template = await deps.getTemplate({ templateId: input.templateId });
  if (!template) throw error("not_found", "Development template not found");
  if (template.origin !== "platform" && template.spaceId !== input.spaceId && template.isPublic !== true) throw error("authorization_denied", "Development template belongs to another Space");
  return deps.createDraft({
    id: id("development_template", [input.spaceId, input.actorUserId, input.commandId]),
    key: `space_${input.spaceId}_${id("template", [input.commandId]).slice(-24)}`,
    version: 1, spaceId: input.spaceId, kind: template.kind, name: input.name,
    description: template.description, sourceTemplateId: template.id,
    projectConfigSchema: template.projectConfigSchema, taskFieldSchema: template.taskFieldSchema,
    developmentLoopVersionId: template.developmentLoopVersionId, releaseLoopVersionId: template.releaseLoopVersionId,
    triggerPolicy: template.triggerPolicy, executionPolicy: template.executionPolicy, loopGroupConfig: template.loopGroupConfig, actorUserId: input.actorUserId,
    industryTags: template.industryTags ?? [],
  });
}

export async function publishDevelopmentTemplate(input: { actorUserId: string; commandId: string; templateId: string; expectedRevision: number }, deps = dependencies) {
  const template = await writableTemplate(input, deps);
  const replay = await deps.readCommandResult(input.commandId, input.templateId);
  if (replay !== undefined) return replay as Awaited<ReturnType<Dependencies["publish"]>>;
  ensureRevision(template, input.expectedRevision);
  await validateLoopVersions(template, deps);
  return deps.publish({ templateId: input.templateId, expectedRevision: input.expectedRevision, actorUserId: input.actorUserId, commandId: input.commandId });
}

export async function deprecateDevelopmentTemplate(input: { actorUserId: string; commandId: string; templateId: string; expectedRevision: number }, deps = dependencies) {
  const template = await writableTemplate(input, deps);
  const replay = await deps.readCommandResult(input.commandId, input.templateId);
  if (replay !== undefined) return replay as Awaited<ReturnType<Dependencies["deprecate"]>>;
  ensureRevision(template, input.expectedRevision);
  return deps.deprecate({ templateId: input.templateId, expectedRevision: input.expectedRevision, actorUserId: input.actorUserId, commandId: input.commandId });
}

export async function setDevelopmentTemplateMarketVisibility(input: {
  actorUserId: string;
  templateId: string;
  expectedRevision: number;
  isPublic: boolean;
  industryTags: readonly string[];
}, deps = dependencies) {
  const template = await writableTemplate(input, deps);
  if (input.isPublic) await validateLoopVersions(template, deps);
  await deps.setMarketVisibility({
    templateId: input.templateId,
    expectedRevision: input.expectedRevision,
    isPublic: input.isPublic,
    industryTags: input.industryTags,
    publicAt: input.isPublic ? (template.publicAt ? new Date(template.publicAt) : new Date()) : null,
  });
  return { ...template, isPublic: input.isPublic, industryTags: [...input.industryTags], publicAt: input.isPublic ? (template.publicAt ?? new Date().toISOString()) : null, revision: template.revision + 1 };
}

export async function deleteDevelopmentTemplate(input: {
  actorUserId: string;
  commandId: string;
  templateId: string;
  expectedRevision: number;
}, deps = dependencies) {
  const template = await writableTemplate(input, deps);
  if (template.deletedAt) throw error("not_found", "Development template not found");
  const replay = await deps.readCommandResult(input.commandId, input.templateId);
  if (replay !== undefined) return replay;
  await deps.deleteTemplate({ templateId: input.templateId, expectedRevision: input.expectedRevision });
  return { ...template, status: "deprecated" as const, isPublic: false, publicAt: null, deletedAt: new Date().toISOString(), revision: template.revision + 1 };
}

export async function compareDevelopmentTemplateVersions(input: {
  actorUserId: string;
  templateId: string;
  spaceId: string;
  fromVersion: number;
  toVersion: number;
}, deps: {
  assertCanReadSpace(input: { userId: string; spaceId: string }): Promise<unknown>;
  compare(input: { templateId: string; spaceId: string; fromVersion: number; toVersion: number }): ReturnType<typeof compareDevelopmentTemplateVersionsRepository>;
} = {
  assertCanReadSpace,
  compare: compareDevelopmentTemplateVersionsRepository,
}) {
  await deps.assertCanReadSpace({ userId: input.actorUserId, spaceId: input.spaceId });
  return deps.compare({
    templateId: input.templateId,
    spaceId: input.spaceId,
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
  });
}
