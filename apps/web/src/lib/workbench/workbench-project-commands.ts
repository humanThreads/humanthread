import { createHash, randomUUID } from "node:crypto";
import {
  assertCanWriteProject,
  assertCanWriteSpace,
  getPublishedDevelopmentTemplate,
  prisma,
  selectProjectWorkerImageVersion,
} from "@humanthread/db";
import { validateJsonSchemaValue } from "@humanthread/orchestration-core";
import {
  branchDevelopmentConfigSchema,
  buildProjectLoopGroupConfig,
  projectLoopGroupConfigSchema,
  type ProjectLoopGroupConfig,
} from "@humanthread/shared";
import { deriveProjectShortCode, validateProjectShortCode } from "../tasks/task-business-fields";
import { normalizeProjectEnvironmentConfiguration, type ProjectEnvironmentConfiguration } from "./project-environment-configuration";
import { projectWorkerDeploymentConfigurationSchema, type ProjectWorkerDeploymentConfiguration } from "../orchestration/project-worker-deployment-configuration";

const DEVELOPMENT_TEMPLATE_KIND_REGISTRY = {
  "branch-development": { configSchema: branchDevelopmentConfigSchema },
} as const;

interface ProjectCreateDb {
  space: {
    findUnique(input: unknown): Promise<{
      id: string;
      type: string;
      companyId: string | null;
      ownerUserId: string | null;
      status: string;
    } | null>;
  };
  user: {
    findUnique(input: unknown): Promise<{ id: string; teamId: string } | null>;
  };
  companyMember: {
    findFirst(input: unknown): Promise<{ id: string } | null>;
  };
  project?: {
    findFirst(input: unknown): Promise<{ id: string } | null>;
  };
  agentProfile?: {
    findFirst(input: unknown): Promise<{ id: string } | null>;
  };
  loopVersion?: {
    findMany(input: unknown): Promise<Array<{ id: string; loopDefinitionId: string; status: string; loopDefinition?: { scope: string } | null }>>;
  };
  $transaction<T>(callback: (tx: {
    project: { create(input: unknown): Promise<{ id: string; version: number }> };
    projectMember: { createMany(input: unknown): Promise<{ count: number }> };
    projectLoopBinding?: { createMany(input: unknown): Promise<{ count: number }> };
  }) => Promise<T>): Promise<T>;
}

interface ProjectUpdateDb {
  project: {
    findFirst(input: unknown): Promise<{ id: string; teamId?: string; spaceId?: string | null; shortCode?: string | null; version: number; developmentTemplateKey?: string | null; developmentTemplateVersion?: number | null; developmentTemplateConfig?: unknown; environmentConfigurationVersion?: number } | null>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  agentProfile?: ProjectCreateDb["agentProfile"];
  loopVersion?: ProjectCreateDb["loopVersion"];
  projectLoopBinding?: { createMany(input: unknown): Promise<{ count: number }>; upsert?(input: unknown): Promise<unknown> };
  $transaction?<T>(callback: (tx: { project: ProjectUpdateDb["project"]; projectLoopBinding: { createMany?(input: unknown): Promise<{ count: number }>; upsert?(input: unknown): Promise<unknown> } }) => Promise<T>): Promise<T>;
}

export async function updateWorkbenchProjectRepositoryConfiguration(input: {
  userId: string;
  projectId: string;
  expectedVersion: number;
  repositoryUrl: string;
  allowedBranches: string[];
  dependencies?: { assertCanWriteProject: typeof assertCanWriteProject; db: ProjectUpdateDb };
}): Promise<{ projectId: string; version: number }> {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw validationError("Project version is invalid");
  const repositoryUrl = input.repositoryUrl.trim();
  if (!/^https?:\/\//u.test(repositoryUrl) || repositoryUrl.length > 1024) throw validationError("Git 仓库地址必须是 HTTP 或 HTTPS 地址");
  const allowedBranches = [...new Set(input.allowedBranches.map((branch) => branch.trim()).filter(Boolean))];
  if (allowedBranches.length === 0 || allowedBranches.length > 64) throw validationError("至少配置一个允许分支");
  const dependencies = input.dependencies ?? { assertCanWriteProject, db: prisma as unknown as ProjectUpdateDb };
  await dependencies.assertCanWriteProject({ userId: input.userId, projectId: input.projectId });
  const updated = await dependencies.db.project.updateMany({
    where: { id: input.projectId, version: input.expectedVersion },
    data: { workerRepositoryUrl: repositoryUrl, workerBranchPolicy: { allowedBranches }, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw Object.assign(new Error("Project changed while updating Git repository"), { code: "version_conflict" });
  return { projectId: input.projectId, version: input.expectedVersion + 1 };
}

export async function updateWorkbenchProjectWorkerPool(input: {
  userId: string;
  projectId: string;
  expectedVersion: number;
  workerPoolId: string;
  dependencies?: { assertCanWriteProject: typeof assertCanWriteProject; db: ProjectUpdateDb };
}): Promise<{ projectId: string; version: number }> {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw validationError("Project version is invalid");
  if (!/^[a-f0-9]{32}$/u.test(input.workerPoolId)) throw validationError("Worker Pool 标识无效");
  const dependencies = input.dependencies ?? { assertCanWriteProject, db: prisma as unknown as ProjectUpdateDb };
  await dependencies.assertCanWriteProject({ userId: input.userId, projectId: input.projectId });
  const updated = await dependencies.db.project.updateMany({
    where: { id: input.projectId, version: input.expectedVersion },
    data: { workerPoolId: input.workerPoolId, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw Object.assign(new Error("Project changed while updating Worker Pool"), { code: "version_conflict" });
  return { projectId: input.projectId, version: input.expectedVersion + 1 };
}

export async function createWorkbenchProject(input: {
  userId: string;
  spaceId: string;
  name: string;
  shortCode?: string;
  objective: string;
  managerUserId: string;
  startAt?: Date;
  targetAt?: Date;
  developmentTemplateKey?: string;
  developmentTemplateVersion?: number;
  developmentTemplateConfig?: unknown;
  createId?: () => string;
  dependencies?: {
    assertCanWriteSpace: typeof assertCanWriteSpace;
    db: ProjectCreateDb;
    developmentModesEnabled?: boolean;
    getPublishedDevelopmentTemplate?: typeof getPublishedDevelopmentTemplate;
    initializeKnowledge?: (input: { projectId: string; actorUserId: string; projectName: string; objective: string }) => Promise<unknown>;
  };
}): Promise<{ projectId: string; version: number }> {
  const name = input.name.trim();
  const shortCode = input.shortCode ? validateProjectShortCode(input.shortCode) : deriveProjectShortCode(name);
  const objective = input.objective.trim();
  if (!name) throw Object.assign(new Error("Project name is required"), { code: "validation_failed" });
  if (!objective) throw Object.assign(new Error("Project objective is required"), { code: "validation_failed" });
  if (input.startAt && input.targetAt && input.targetAt < input.startAt) {
    throw Object.assign(new Error("Project target date must be after start date"), { code: "validation_failed" });
  }

  const dependencies = input.dependencies ?? {
    assertCanWriteSpace,
    db: prisma as unknown as ProjectCreateDb,
  };
  const developmentModesEnabled = input.dependencies?.developmentModesEnabled
    ?? process.env.HUMANTHREAD_DEVELOPMENT_MODES === "true";
  await dependencies.assertCanWriteSpace({ userId: input.userId, spaceId: input.spaceId });
  const [space, creator] = await Promise.all([
    dependencies.db.space.findUnique({
      where: { id: input.spaceId },
      select: { id: true, type: true, companyId: true, ownerUserId: true, status: true },
    }),
    dependencies.db.user.findUnique({
      where: { id: input.userId },
      select: { id: true, teamId: true },
    }),
  ]);
  if (!space || space.status !== "active" || !creator) {
    throw Object.assign(new Error("Project Space is unavailable"), { code: "not_found" });
  }
  if (!input.managerUserId.trim()) {
    throw Object.assign(new Error("Project manager is required"), { code: "validation_failed" });
  }
  if (space.type === "personal" && (space.ownerUserId !== input.userId || input.managerUserId !== input.userId)) {
    throw Object.assign(new Error("Personal project manager must own the Space"), { code: "authorization_denied" });
  }
  if (space.type === "company") {
    const managerMembership = await dependencies.db.companyMember.findFirst({
      where: { companyId: space.companyId, userId: input.managerUserId, status: "active" },
      select: { id: true },
    });
    if (!managerMembership) {
      throw Object.assign(new Error("Project manager is not an active company member"), { code: "authorization_denied" });
    }
  }

  const existingShortCode = await dependencies.db.project?.findFirst({
    where: { teamId: creator.teamId, shortCode },
    select: { id: true },
  });
  if (existingShortCode) {
    throw Object.assign(new Error("Project short code already exists in this Team"), { code: "validation_failed" });
  }

  const templateSelection = await resolveDevelopmentTemplateSelection({
    input,
    spaceId: space.id,
    dependencies,
    enabled: developmentModesEnabled,
  });

  const projectId = input.createId?.() ?? `project_${randomUUID()}`;
  const memberIds = input.managerUserId === input.userId
    ? [{ userId: input.userId, role: "owner" }]
    : [
        { userId: input.userId, role: "owner" },
        { userId: input.managerUserId, role: "maintainer" },
      ];
  const created = await dependencies.db.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        id: projectId,
        teamId: creator.teamId,
        spaceId: space.id,
        ownerType: space.type,
        companyId: space.type === "company" ? space.companyId : null,
        ownerUserId: space.type === "personal" ? space.ownerUserId : null,
        visibility: "private",
        name,
        shortCode,
        description: objective,
        objective,
        managerUserId: input.managerUserId,
        orchestrationStatus: "draft",
        ...(templateSelection ? {
          developmentTemplateKey: templateSelection.template.key,
          developmentTemplateVersion: templateSelection.template.version,
          developmentTemplateConfig: templateSelection.config,
          productionBranch: templateSelection.config.productionBranch,
          stagingBranch: templateSelection.config.stagingBranch,
          releaseAgentProfileId: templateSelection.config.releaseAgentProfileId,
          loopGroupConfig: templateSelection.loopGroupConfig,
        } : {}),
        ...(input.startAt ? { startAt: input.startAt } : {}),
        ...(input.targetAt ? { targetAt: input.targetAt } : {}),
      },
      select: { id: true, version: true },
    });
    await tx.projectMember.createMany({
      data: memberIds.map((member, index) => ({
        id: `pm:${projectId}:${index}`,
        projectId,
        userId: member.userId,
        role: member.role,
        status: "active",
      })),
    });
    if (templateSelection) {
      if (!tx.projectLoopBinding) throw validationError("Project Loop binding storage is unavailable");
      await persistProjectLoopBindings(tx.projectLoopBinding, projectId, input.userId, templateSelection);
    }
    return { projectId: project.id, version: project.version };
  });
  if (dependencies.initializeKnowledge) {
    try {
      await dependencies.initializeKnowledge({
        projectId: created.projectId,
        actorUserId: input.userId,
        projectName: name,
        objective,
      });
    } catch (error) {
      console.error(JSON.stringify({
        event: "project_knowledge_initialization_failed",
        projectId: created.projectId,
        error: error instanceof Error ? error.message : "unknown",
      }));
    }
  }
  return created;
}

async function resolveDevelopmentTemplateSelection(input: {
  input: {
    developmentTemplateKey?: string;
    developmentTemplateVersion?: number;
    developmentTemplateConfig?: unknown;
  };
  spaceId: string;
  dependencies: {
    db: ProjectCreateDb;
    getPublishedDevelopmentTemplate?: typeof getPublishedDevelopmentTemplate;
  };
  enabled: boolean;
}) {
  const supplied = [
    input.input.developmentTemplateKey,
    input.input.developmentTemplateVersion,
    input.input.developmentTemplateConfig,
  ];
  if (supplied.every((value) => value === undefined)) return null;
  if (supplied.some((value) => value === undefined)) {
    throw validationError("Development template key, version, and configuration are required together");
  }
  if (!input.enabled) throw validationError("Project development modes are not enabled");

  const template = await (input.dependencies.getPublishedDevelopmentTemplate ?? getPublishedDevelopmentTemplate)({
    key: input.input.developmentTemplateKey!,
    version: input.input.developmentTemplateVersion!,
    spaceId: input.spaceId,
  }, { db: input.dependencies.db as never });
  if (!template) throw validationError("Published development template version not found");

  const schemaValidation = validateJsonSchemaValue(template.projectConfigSchema, input.input.developmentTemplateConfig);
  if (!schemaValidation.ok) throw validationError(`Invalid development template configuration: ${schemaValidation.errors.join("; ")}`, schemaValidation.issues);
  const kindDefinition = DEVELOPMENT_TEMPLATE_KIND_REGISTRY[template.kind as keyof typeof DEVELOPMENT_TEMPLATE_KIND_REGISTRY];
  if (!kindDefinition) throw validationError(`Unsupported development template kind: ${template.kind}`);
  const parsedConfig = kindDefinition.configSchema.safeParse(input.input.developmentTemplateConfig);
  if (!parsedConfig.success) {
    throw validationError(
      `Invalid ${template.kind} configuration: ${parsedConfig.error.issues.map((issue) => issue.message).join("; ")}`,
      parsedConfig.error.issues,
    );
  }
  const config = parsedConfig.data;

  const releaseProfile = await input.dependencies.db.agentProfile?.findFirst({
    where: { id: config.releaseAgentProfileId, spaceId: input.spaceId, status: "active" },
    select: { id: true },
  });
  if (!releaseProfile) throw validationError("Release AgentProfile must be active in the Project Space");

  const developmentLoopVersionId = template.developmentLoopVersionId;
  const releaseLoopVersionId = template.releaseLoopVersionId;
  if (!developmentLoopVersionId || !releaseLoopVersionId) {
    throw validationError("Published development template Loop versions are unavailable");
  }

  const templateLoopGroupConfig = template.loopGroupConfig;
  const loopGroupConfig = resolveTemplateLoopGroupConfig(templateLoopGroupConfig, developmentLoopVersionId, releaseLoopVersionId);
  const requestedLoopVersionIds = [...new Set([
    ...loopGroupConfig.taskLoopVersionIds,
    ...loopGroupConfig.projectLoopVersionIds,
    developmentLoopVersionId,
    releaseLoopVersionId,
  ])];
  const loopVersions = await input.dependencies.db.loopVersion?.findMany({
    where: { id: { in: requestedLoopVersionIds }, status: "published" },
    select: { id: true, loopDefinitionId: true, status: true, loopDefinition: { select: { scope: true } } },
  });
  const versionsById = new Map((loopVersions ?? []).map((version) => [version.id, version]));
  const selectedLoopVersionIds = [...new Set([
    ...loopGroupConfig.taskLoopVersionIds,
    ...loopGroupConfig.projectLoopVersionIds,
  ])];
  if (selectedLoopVersionIds.some((id) => !versionsById.has(id))) {
    throw validationError("Development template Loop group contains unavailable published Loop versions");
  }
  const developmentLoop = versionsById.get(developmentLoopVersionId);
  const releaseLoop = versionsById.get(releaseLoopVersionId);
  if (!developmentLoop || !releaseLoop) {
    throw validationError("Development template Loop versions are unavailable");
  }
  if (!hasExplicitLoopGroupConfig(templateLoopGroupConfig)
    && (developmentLoop.loopDefinition?.scope !== "project" || releaseLoop.loopDefinition?.scope !== "project")) {
    throw validationError("Development template Loop versions must belong to published project-scoped Loop definitions");
  }

  return {
    template,
    config,
    loopGroupConfig,
    developmentLoop,
    releaseLoop,
    taskLoops: loopGroupConfig.taskLoopVersionIds.map((id) => versionsById.get(id)!).filter(Boolean),
    projectLoops: loopGroupConfig.projectLoopVersionIds.map((id) => versionsById.get(id)!).filter(Boolean),
  };
}

function hasExplicitLoopGroupConfig(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const record = raw as Record<string, unknown>;
  return Array.isArray(record.presets)
    && record.defaultSelection !== null
    && typeof record.defaultSelection === "object"
    && !Array.isArray(record.defaultSelection);
}

function resolveTemplateLoopGroupConfig(
  raw: unknown,
  developmentLoopVersionId: string,
  releaseLoopVersionId: string,
): ProjectLoopGroupConfig {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    const presets = Array.isArray(record.presets) ? record.presets : null;
    const selection = record.defaultSelection && typeof record.defaultSelection === "object" && !Array.isArray(record.defaultSelection)
      ? record.defaultSelection as { selectedPresetKeys?: unknown; defaultPresetKey?: unknown }
      : null;
    if (presets && selection && Array.isArray(selection.selectedPresetKeys) && typeof selection.defaultPresetKey === "string") {
      try {
        return buildProjectLoopGroupConfig({
          presets: presets as never,
          selection: {
            selectedPresetKeys: selection.selectedPresetKeys.filter((key): key is string => typeof key === "string"),
            defaultPresetKey: selection.defaultPresetKey,
          },
        });
      } catch (cause) {
        throw validationError(cause instanceof Error ? cause.message : "Loop group configuration is invalid");
      }
    }
  }
  return projectLoopGroupConfigSchema.parse({
    taskLoopVersionIds: [developmentLoopVersionId],
    // 旧模板只有两个单值字段：开发 Loop 仍作为可复用任务 Loop，
    // 默认任务角色迁移到项目级发布 Loop。
    defaultTaskLoopVersionId: releaseLoopVersionId,
    projectLoopVersionIds: [releaseLoopVersionId],
    defaultProjectLoopVersionId: releaseLoopVersionId,
    selectedPresetKeys: ["legacy"],
    defaultPresetKey: "legacy",
  });
}

function projectLoopBindingRow(input: {
  projectId: string;
  userId: string;
  role: "task_development" | "milestone_release" | null;
  loop: { id: string; loopDefinitionId: string };
  triggerPolicy: unknown;
  allowedAgentProfileIds?: string[];
}) {
  const allowedAgentProfileIds = input.allowedAgentProfileIds ?? [];
  return {
    id: input.role === null
      ? `binding:${input.projectId}:member:${createMemberBindingSuffix(input.loop.id)}`
      : `binding:${input.projectId}:${input.role}`,
    projectId: input.projectId,
    loopDefinitionId: input.loop.loopDefinitionId,
    activeVersionId: input.loop.id,
    bindingRole: input.role,
    status: "enabled",
    triggerPolicy: input.triggerPolicy,
    parameterOverrides: {},
    notificationPolicy: {},
    automationGrantIds: [],
    allowedAgentProfileIds,
    allowedProviders: allowedAgentProfileIds.length > 0 ? ["codex"] : [],
    version: 1,
    createdByUserId: input.userId,
  };
}

function validationError(message: string, issues?: unknown[]) {
  return Object.assign(new Error(message), { code: "validation_failed", ...(issues?.length ? { issues } : {}) });
}

export async function updateWorkbenchProject(input: {
  userId: string;
  projectId: string;
  shortCode: string;
  expectedVersion: number;
  dependencies?: {
    assertCanWriteProject: typeof assertCanWriteProject;
    db: ProjectUpdateDb;
  };
}): Promise<{ projectId: string; shortCode: string; version: number }> {
  const shortCode = validateProjectShortCode(input.shortCode);
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw Object.assign(new Error("Project version is invalid"), { code: "validation_failed" });
  }
  const dependencies = input.dependencies ?? {
    assertCanWriteProject,
    db: prisma as unknown as ProjectUpdateDb,
  };
  await dependencies.assertCanWriteProject({ userId: input.userId, projectId: input.projectId });
  const project = await dependencies.db.project.findFirst({
    where: { id: input.projectId },
    select: { id: true, teamId: true, spaceId: true, shortCode: true, version: true, developmentTemplateKey: true },
  });
  if (!project) throw Object.assign(new Error("Project not found"), { code: "not_found" });
  const duplicate = await dependencies.db.project.findFirst({
    where: { teamId: project.teamId, shortCode, NOT: { id: input.projectId } },
    select: { id: true },
  });
  if (duplicate) throw Object.assign(new Error("Project short code already exists in this Team"), { code: "validation_failed" });
  const updated = await dependencies.db.project.updateMany({
    where: { id: input.projectId, version: input.expectedVersion },
    data: { shortCode, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw Object.assign(new Error("Project changed while updating short code"), { code: "version_conflict" });
  return { projectId: input.projectId, shortCode, version: input.expectedVersion + 1 };
}

export async function updateWorkbenchProjectEnvironmentConfiguration(input: {
  userId: string;
  projectId: string;
  expectedVersion: number;
  configuration: unknown;
  dependencies?: { assertCanWriteProject: typeof assertCanWriteProject; db: ProjectUpdateDb };
}): Promise<{ projectId: string; version: number; environmentConfigurationVersion: number; configuration: ProjectEnvironmentConfiguration }> {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw validationError("Project version is invalid");
  const configuration = normalizeProjectEnvironmentConfiguration(input.configuration);
  const dependencies = input.dependencies ?? { assertCanWriteProject, db: prisma as unknown as ProjectUpdateDb };
  await dependencies.assertCanWriteProject({ userId: input.userId, projectId: input.projectId });
  const project = await dependencies.db.project.findFirst({
    where: { id: input.projectId },
    select: { id: true, version: true, environmentConfigurationVersion: true },
  });
  if (!project) throw Object.assign(new Error("Project not found"), { code: "not_found" });
  const updated = await dependencies.db.project.updateMany({
    where: { id: input.projectId, version: input.expectedVersion },
    data: { environmentConfiguration: configuration, environmentConfigurationVersion: { increment: 1 }, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw Object.assign(new Error("Project changed while updating environment configuration"), { code: "version_conflict" });
  return { projectId: input.projectId, version: input.expectedVersion + 1, environmentConfigurationVersion: (project.environmentConfigurationVersion ?? 1) + 1, configuration };
}

export async function updateWorkbenchProjectWorkerDeploymentConfiguration(input: {
  userId: string;
  projectId: string;
  expectedVersion: number;
  configuration: unknown;
  dependencies?: { assertCanWriteProject: typeof assertCanWriteProject; db: ProjectUpdateDb };
}): Promise<{ projectId: string; version: number; environmentConfigurationVersion: number; configuration: ProjectWorkerDeploymentConfiguration }> {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw validationError("Project version is invalid");
  const parsed = projectWorkerDeploymentConfigurationSchema.safeParse(input.configuration);
  if (!parsed.success) throw validationError("Worker 部署配置无效", parsed.error.issues);
  const dependencies = input.dependencies ?? { assertCanWriteProject, db: prisma as unknown as ProjectUpdateDb };
  await dependencies.assertCanWriteProject({ userId: input.userId, projectId: input.projectId });
  const project = await dependencies.db.project.findFirst({
    where: { id: input.projectId },
    select: { id: true, version: true, environmentConfigurationVersion: true },
  });
  if (!project) throw Object.assign(new Error("Project not found"), { code: "not_found" });
  const updated = await dependencies.db.project.updateMany({
    where: { id: input.projectId, version: input.expectedVersion },
    data: {
      workerDeploymentConfiguration: parsed.data,
      environmentConfigurationVersion: { increment: 1 },
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) throw Object.assign(new Error("Project changed while updating Worker deployment configuration"), { code: "version_conflict" });
  return {
    projectId: input.projectId,
    version: input.expectedVersion + 1,
    environmentConfigurationVersion: (project.environmentConfigurationVersion ?? 1) + 1,
    configuration: parsed.data,
  };
}

export async function updateWorkbenchProjectWorkerImageVersion(input: {
  userId: string;
  projectId: string;
  expectedVersion: number;
  workerImageVersionId: string;
}): Promise<{ projectId: string; version: number; workerImageVersionId: string }> {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw validationError("Project version is invalid");
  if (!/^[a-f0-9]{32}$/u.test(input.workerImageVersionId)) throw validationError("Worker 镜像版本标识无效");
  await assertCanWriteProject({ userId: input.userId, projectId: input.projectId });
  return selectProjectWorkerImageVersion({
    projectId: input.projectId,
    expectedVersion: input.expectedVersion,
    workerImageVersionId: input.workerImageVersionId,
  });
}

export async function updateWorkbenchProjectLoopGroupConfig(input: {
  userId: string;
  projectId: string;
  expectedVersion: number;
  configuration: unknown;
  dependencies?: { assertCanWriteProject: typeof assertCanWriteProject; db: ProjectUpdateDb };
}): Promise<{ projectId: string; version: number; loopGroupConfig: ProjectLoopGroupConfig }> {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw validationError("Project version is invalid");
  const parsed = projectLoopGroupConfigSchema.safeParse(input.configuration);
  if (!parsed.success) throw validationError("Project Loop configuration is invalid", parsed.error.issues);
  const dependencies = input.dependencies ?? { assertCanWriteProject, db: prisma as unknown as ProjectUpdateDb };
  await dependencies.assertCanWriteProject({ userId: input.userId, projectId: input.projectId });
  const project = await dependencies.db.project.findFirst({ where: { id: input.projectId }, select: { id: true, version: true } });
  if (!project) throw Object.assign(new Error("Project not found"), { code: "not_found" });
  if (project.version !== input.expectedVersion) throw Object.assign(new Error("Project changed while updating Loop configuration"), { code: "version_conflict" });
  const updated = await dependencies.db.project.updateMany({
    where: { id: input.projectId, version: input.expectedVersion },
    data: { loopGroupConfig: parsed.data, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw Object.assign(new Error("Project changed while updating Loop configuration"), { code: "version_conflict" });
  return { projectId: input.projectId, version: input.expectedVersion + 1, loopGroupConfig: parsed.data };
}

export async function initializeWorkbenchProjectDevelopmentMode(input: {
  userId: string;
  projectId: string;
  expectedVersion: number;
  developmentTemplateKey: string;
  developmentTemplateVersion: number;
  developmentTemplateConfig: unknown;
  dependencies?: {
    assertCanWriteProject: typeof assertCanWriteProject;
    db: ProjectUpdateDb;
    getPublishedDevelopmentTemplate?: typeof getPublishedDevelopmentTemplate;
  };
}): Promise<{ projectId: string; version: number; developmentTemplateKey: string }> {
  if (process.env.HUMANTHREAD_DEVELOPMENT_MODES !== "true") throw validationError("Project development modes are not enabled");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw validationError("Project version is invalid");
  const dependencies = input.dependencies ?? {
    assertCanWriteProject,
    db: prisma as unknown as ProjectUpdateDb,
  };
  await dependencies.assertCanWriteProject({ userId: input.userId, projectId: input.projectId });
  const project = await dependencies.db.project.findFirst({
    where: { id: input.projectId },
    select: { id: true, teamId: true, spaceId: true, shortCode: true, version: true, developmentTemplateKey: true },
  });
  if (!project) throw Object.assign(new Error("Project not found"), { code: "not_found" });
  if (project.version !== input.expectedVersion) throw Object.assign(new Error("Project changed while configuring development mode"), { code: "version_conflict" });
  if (project.developmentTemplateKey) throw validationError("Project development mode is already configured");
  if (!project.spaceId) throw validationError("Project has no Space");

  const selection = await resolveDevelopmentTemplateSelection({
    input: {
      developmentTemplateKey: input.developmentTemplateKey,
      developmentTemplateVersion: input.developmentTemplateVersion,
      developmentTemplateConfig: input.developmentTemplateConfig,
    },
    spaceId: project.spaceId,
    dependencies: {
      db: dependencies.db as unknown as ProjectCreateDb,
      ...(dependencies.getPublishedDevelopmentTemplate ? { getPublishedDevelopmentTemplate: dependencies.getPublishedDevelopmentTemplate } : {}),
    },
    enabled: true,
  });
  if (!selection) throw validationError("Development template configuration is required");
  const transaction = dependencies.db.$transaction;
  const run = async (tx: { project: ProjectUpdateDb["project"]; projectLoopBinding: { createMany?(input: unknown): Promise<{ count: number }>; upsert?(input: unknown): Promise<unknown> } }) => {
    const updated = await tx.project.updateMany({
      where: { id: input.projectId, version: input.expectedVersion, developmentTemplateKey: null },
      data: {
        developmentTemplateKey: selection.template.key,
        developmentTemplateVersion: selection.template.version,
        developmentTemplateConfig: selection.config,
        productionBranch: selection.config.productionBranch,
        stagingBranch: selection.config.stagingBranch,
        releaseAgentProfileId: selection.config.releaseAgentProfileId,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw Object.assign(new Error("Project changed while configuring development mode"), { code: "version_conflict" });
    await persistProjectLoopBindings(tx.projectLoopBinding, input.projectId, input.userId, selection);
    return { projectId: input.projectId, version: input.expectedVersion + 1, developmentTemplateKey: selection.template.key };
  };
  if (transaction) return transaction(run);
  if (!dependencies.db.projectLoopBinding) throw validationError("Project Loop binding storage is unavailable");
  return run({ project: dependencies.db.project, projectLoopBinding: dependencies.db.projectLoopBinding });
}

export async function upgradeWorkbenchProjectDevelopmentMode(input: {
  userId: string;
  projectId: string;
  expectedVersion: number;
  developmentTemplateKey: string;
  developmentTemplateVersion: number;
  developmentTemplateConfig: unknown;
  dependencies?: {
    assertCanWriteProject: typeof assertCanWriteProject;
    db: ProjectUpdateDb;
    getPublishedDevelopmentTemplate?: typeof getPublishedDevelopmentTemplate;
  };
}): Promise<{ projectId: string; version: number; developmentTemplateKey: string }> {
  if (process.env.HUMANTHREAD_DEVELOPMENT_MODES !== "true") throw validationError("Project development modes are not enabled");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw validationError("Project version is invalid");
  const dependencies = input.dependencies ?? { assertCanWriteProject, db: prisma as unknown as ProjectUpdateDb };
  await dependencies.assertCanWriteProject({ userId: input.userId, projectId: input.projectId });
  const project = await dependencies.db.project.findFirst({
    where: { id: input.projectId },
    select: { id: true, teamId: true, spaceId: true, shortCode: true, version: true, developmentTemplateKey: true },
  });
  if (!project) throw Object.assign(new Error("Project not found"), { code: "not_found" });
  if (project.version !== input.expectedVersion) throw Object.assign(new Error("Project changed while upgrading development mode"), { code: "version_conflict" });
  if (!project.developmentTemplateKey) throw validationError("Project development mode is not initialized");
  if (!project.spaceId) throw validationError("Project has no Space");
  const selection = await resolveDevelopmentTemplateSelection({
    input: { developmentTemplateKey: input.developmentTemplateKey, developmentTemplateVersion: input.developmentTemplateVersion, developmentTemplateConfig: input.developmentTemplateConfig },
    spaceId: project.spaceId,
    dependencies: { db: dependencies.db as unknown as ProjectCreateDb, ...(dependencies.getPublishedDevelopmentTemplate ? { getPublishedDevelopmentTemplate: dependencies.getPublishedDevelopmentTemplate } : {}) },
    enabled: true,
  });
  if (!selection) throw validationError("Development template configuration is required");
  const run = async (tx: { project: ProjectUpdateDb["project"]; projectLoopBinding: { createMany?(input: unknown): Promise<{ count: number }>; upsert?(input: unknown): Promise<unknown> } }) => {
    const updated = await tx.project.updateMany({
      where: { id: input.projectId, version: input.expectedVersion },
      data: {
        developmentTemplateKey: selection.template.key,
        developmentTemplateVersion: selection.template.version,
        developmentTemplateConfig: selection.config,
        productionBranch: selection.config.productionBranch,
        stagingBranch: selection.config.stagingBranch,
        releaseAgentProfileId: selection.config.releaseAgentProfileId,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw Object.assign(new Error("Project changed while upgrading development mode"), { code: "version_conflict" });
    await persistProjectLoopBindings(tx.projectLoopBinding, input.projectId, input.userId, selection);
    return { projectId: input.projectId, version: input.expectedVersion + 1, developmentTemplateKey: selection.template.key };
  };
  if (dependencies.db.$transaction) return dependencies.db.$transaction(run);
  if (!dependencies.db.projectLoopBinding) throw validationError("Project Loop binding storage is unavailable");
  return run({ project: dependencies.db.project, projectLoopBinding: dependencies.db.projectLoopBinding });
}

async function persistProjectLoopBindings(
  bindings: { createMany?(input: unknown): Promise<{ count: number }>; upsert?(input: unknown): Promise<unknown> },
  projectId: string,
  userId: string,
  selection: {
    config: { releaseAgentProfileId: string };
    loopGroupConfig: ProjectLoopGroupConfig;
    taskLoops: Array<{ id: string; loopDefinitionId: string }>;
    projectLoops: Array<{ id: string; loopDefinitionId: string }>;
  },
) {
  const rows = [
    ...selection.taskLoops.map((loop) => projectLoopBindingRow({
      projectId,
      userId,
      role: null,
      loop,
      triggerPolicy: { manual: false, taskEvents: ["task.execution.requested"], milestoneEvents: [] },
      allowedAgentProfileIds: [selection.config.releaseAgentProfileId],
    })),
    ...selection.projectLoops.filter((loop) => loop.id === selection.loopGroupConfig.defaultTaskLoopVersionId).map((loop) => projectLoopBindingRow({
      projectId,
      userId,
      role: "task_development",
      loop,
      triggerPolicy: { manual: false, taskEvents: ["task.execution.requested"], milestoneEvents: [] },
      allowedAgentProfileIds: [selection.config.releaseAgentProfileId],
    })),
    ...selection.projectLoops.map((loop) => projectLoopBindingRow({
      projectId,
      userId,
      role: loop.id === selection.loopGroupConfig.defaultProjectLoopVersionId ? "milestone_release" : null,
      loop,
      triggerPolicy: { manual: true, taskEvents: [], milestoneEvents: ["milestone.release_ready"] },
      allowedAgentProfileIds: [selection.config.releaseAgentProfileId],
    })),
  ];
  if (bindings.upsert) {
    for (const row of rows) {
      const update = Object.fromEntries(Object.entries(row).filter(([key]) => !["id", "version", "createdByUserId"].includes(key)));
      await bindings.upsert({
        where: { projectId_bindingRole: { projectId, bindingRole: row.bindingRole } },
        create: row,
        update: { ...update, version: { increment: 1 } },
      });
    }
    return;
  }
  if (!bindings.createMany) throw validationError("Project Loop binding storage is unavailable");
  await bindings.createMany({ data: rows });
}

function createMemberBindingSuffix(loopVersionId: string): string {
  return createHash("md5").update(loopVersionId).digest("hex");
}
