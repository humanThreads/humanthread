import {
  assertCanReadProject,
  assertCanReadSpace,
  listProjectAutomationGrants,
  listProjectLoopBindings,
  prisma,
  readLoopDefinition,
  readLoopDefinitionReferences,
} from "@humanthread/db";
import {
  LOOP_PLATFORM_CAPS,
  loopAuthoringGraphSchema,
  validateLoopGraph,
} from "@humanthread/orchestration-core";
import { projectLoopGroupConfigSchema, type ProjectLoopGroupConfig } from "@humanthread/shared";
import { buildProjectLoopGroupConfig } from "@humanthread/shared";

interface DefinitionSummary {
  id: string;
  spaceId: string;
  name?: string;
  description?: string | null;
  latestPublishedVersion?: unknown;
  versions?: unknown[];
  scope?: unknown;
  origin?: unknown;
  readOnly?: boolean;
  status?: string;
  [key: string]: unknown;
}

interface DefinitionEditorRecord extends DefinitionSummary {
  draftGraph: unknown;
  draftRevision: number;
  versions: unknown[];
}

export interface LoopSubloopOption {
  definitionId: string;
  name: string;
  versions: Array<{ id: string; versionNumber: number }>;
}

interface ProjectSummary {
  id: string;
  spaceId: string | null;
  name?: string;
  [key: string]: unknown;
}

interface LoopProductReadModelDependencies {
  assertCanReadSpace(input: { userId: string; spaceId: string }): Promise<unknown>;
  assertCanReadProject(input: { userId: string; projectId: string }): Promise<unknown>;
  listDefinitions(input: { spaceId: string }): Promise<DefinitionSummary[]>;
  readDefinitionAccess(input: { loopDefinitionId: string }): Promise<{ id: string; spaceId: string; origin?: string } | null>;
  readDefinition(input: { loopDefinitionId: string }): Promise<unknown>;
  readDefinitionReferences(loopDefinitionId: string): ReturnType<typeof readLoopDefinitionReferences>;
  readProject(input: { projectId: string }): Promise<ProjectSummary | null>;
  listProjectBindings(input: { projectId: string }): Promise<unknown[]>;
  listPublishableDefinitions(input: { spaceId: string }): Promise<DefinitionSummary[]>;
  listAutomationGrants(input: { actorUserId: string; projectId: string }): Promise<unknown[]>;
  listAgentProfiles(input: { spaceId: string }): Promise<Array<Record<string, unknown>>>;
  listRuntimeProfiles(input: { userId: string }): Promise<Array<Record<string, unknown>>>;
  listWorkspaceBindings(input: { userId: string; projectId: string }): Promise<Array<Record<string, unknown>>>;
}

const defaultDependencies: LoopProductReadModelDependencies = {
  assertCanReadSpace: (input) => assertCanReadSpace(input),
  assertCanReadProject: (input) => assertCanReadProject(input),
  listDefinitions: (input) => prisma.loopDefinition.findMany({
    where: {
      status: { not: "archived" },
      OR: [
        { spaceId: input.spaceId, origin: "space" },
        { origin: "platform" },
      ],
    },
    include: {
      latestPublishedVersion: true,
      versions: {
        where: { status: "published" },
        select: { id: true, versionNumber: true, status: true },
        orderBy: { versionNumber: "desc" },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  }),
  readDefinitionAccess: (input) => prisma.loopDefinition.findUnique({
    where: { id: input.loopDefinitionId },
    select: { id: true, spaceId: true, origin: true },
  }),
  readDefinition: (input) => readLoopDefinition(input),
  readDefinitionReferences: (loopDefinitionId) => readLoopDefinitionReferences(loopDefinitionId),
  readProject: (input) => prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      spaceId: true,
      name: true,
      developmentTemplateKey: true,
      developmentTemplateVersion: true,
      developmentTemplateConfig: true,
      loopGroupConfig: true,
      productionBranch: true,
      stagingBranch: true,
      releaseAgentProfileId: true,
      workerPoolId: true,
      workerRepositoryUrl: true,
      workerBranchPolicy: true,
      workerImageRepository: true,
      workerImageTag: true,
      workerImageDigest: true,
      workerImageResolvedAt: true,
      workerImageVersionId: true,
      version: true,
      developmentTemplate: {
        select: {
          key: true,
          name: true,
          version: true,
          origin: true,
          kind: true,
          description: true,
          developmentLoopVersionId: true,
          releaseLoopVersionId: true,
          triggerPolicy: true,
          executionPolicy: true,
          loopGroupConfig: true,
        },
      },
    },
  }),
  listProjectBindings: async (input) => {
    const bindings = await listProjectLoopBindings(input.projectId);
    if (!Array.isArray(bindings)) throw validationError("Loop binding state is invalid");
    return bindings;
  },
  listPublishableDefinitions: (input) => prisma.loopDefinition.findMany({
    where: {
      OR: [
        { spaceId: input.spaceId, origin: "space" },
        { origin: "platform" },
      ],
      latestPublishedVersionId: { not: null },
      status: { not: "archived" },
    },
    include: { latestPublishedVersion: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  }),
  listAutomationGrants: (input) => listProjectAutomationGrants(input),
  listAgentProfiles: (input) => prisma.agentProfile.findMany({
    where: { spaceId: input.spaceId },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, spaceId: true, name: true, provider: true, status: true, capabilities: true },
  }),
  listRuntimeProfiles: (input) => prisma.deviceAgentRuntimeProfile.findMany({
    where: { userId: input.userId },
    select: { provider: true, status: true, capabilities: true },
  }),
  listWorkspaceBindings: (input) => prisma.projectDeviceWorkspace.findMany({
    where: { projectId: input.projectId, userId: input.userId },
    orderBy: [{ status: "asc" }, { localDeviceId: "asc" }, { id: "asc" }],
    select: {
      id: true,
      localDeviceId: true,
      status: true,
      configurationVersion: true,
      localDevice: { select: { name: true } },
    },
  }),
};

export const LOOP_NODE_CATALOG: ReadonlyArray<{
  type: "start" | "agent_action" | "platform_action" | "condition" | "policy_gate" | "human_gate" | "wait_callback" | "subloop_call" | "end";
  label: string;
}> = [
  { type: "start", label: "开始" },
  { type: "agent_action", label: "Agent 操作" },
  { type: "platform_action", label: "平台操作" },
  { type: "condition", label: "条件" },
  { type: "policy_gate", label: "策略门禁" },
  { type: "human_gate", label: "人工确认" },
  { type: "wait_callback", label: "等待回调" },
  { type: "subloop_call", label: "任务 SubLoop" },
  { type: "end", label: "结束" },
];

export async function listLoopDefinitionsForUser(
  input: { userId: string; spaceId: string },
  dependencies: LoopProductReadModelDependencies = defaultDependencies,
): Promise<DefinitionSummary[]> {
  await dependencies.assertCanReadSpace(input);
  const definitions = await dependencies.listDefinitions({ spaceId: input.spaceId });
  return definitions
    .filter((definition) => definition.status !== "archived")
    .map(normalizeDefinitionMetadata);
}

export async function readLoopDefinitionEditor(
  input: { userId: string; loopDefinitionId: string },
  dependencies: LoopProductReadModelDependencies = defaultDependencies,
) {
  const access = await dependencies.readDefinitionAccess({
    loopDefinitionId: input.loopDefinitionId,
  });
  if (!access) return null;
  if (access.origin !== "platform") {
    await dependencies.assertCanReadSpace({ userId: input.userId, spaceId: access.spaceId });
  }
  const definition = parseEditorRecord(await dependencies.readDefinition({
    loopDefinitionId: input.loopDefinitionId,
  }));
  if (!definition) return null;
  const accessOrigin = access.origin === "platform" ? "platform" : "space";
  if (definition.id !== access.id || definition.spaceId !== access.spaceId || definition.origin !== accessOrigin) {
    throw validationError("Loop definition scope changed during read");
  }
  const references = await dependencies.readDefinitionReferences(input.loopDefinitionId);
  const subloopOptions = definition.scope === "project"
    ? buildSubloopOptions(await dependencies.listDefinitions({ spaceId: definition.spaceId }))
    : [];
  const referenceCount = Object.values(references).reduce((total, count) => total + count, 0);
  const parsedGraph = loopAuthoringGraphSchema.safeParse(definition.draftGraph);
  const validation = parsedGraph.success
    ? validateLoopGraph(parsedGraph.data)
    : {
        ok: false as const,
        errors: parsedGraph.error.issues.map((issue) => (
          `${issue.path.join(".") || "graph"}: ${issue.message}`
        )),
      };
  return {
    definition,
    draftRevision: definition.draftRevision,
    validation,
    versions: definition.versions,
    lifecycle: {
      canArchive: definition.origin === "space" && definition.status !== "archived",
      canDelete: definition.origin === "space" && definition.status === "draft" && referenceCount === 0,
      referenceCount,
      references,
    },
    nodeCatalog: LOOP_NODE_CATALOG,
    subloopOptions,
    platformCaps: {
      maxStages: LOOP_PLATFORM_CAPS.maxStages,
      maxRepeatCount: LOOP_PLATFORM_CAPS.maxRepeatCount,
      maxTransitions: LOOP_PLATFORM_CAPS.maxTransitions,
    },
  };
}

export async function readProjectLoopSettings(
  input: { userId: string; projectId: string },
  dependencies: LoopProductReadModelDependencies = defaultDependencies,
) {
  await dependencies.assertCanReadProject(input);
  const project = await dependencies.readProject({ projectId: input.projectId });
  if (!project || !project.spaceId) return null;
  const [bindings, definitions, grants, profiles, runtimes, workspaceRows] = await Promise.all([
    dependencies.listProjectBindings({ projectId: input.projectId }),
    dependencies.listPublishableDefinitions({ spaceId: project.spaceId }),
    dependencies.listAutomationGrants({ actorUserId: input.userId, projectId: input.projectId }),
    dependencies.listAgentProfiles({ spaceId: project.spaceId }),
    dependencies.listRuntimeProfiles({ userId: input.userId }),
    dependencies.listWorkspaceBindings({ userId: input.userId, projectId: input.projectId }),
  ]);
  const referencedDefinitionIds = new Set([
    ...definitions.flatMap(collectPublishedSubloopDefinitionIds),
    ...bindings.flatMap(collectBindingSubloopDefinitionIds),
  ]);
  const knownDefinitionIds = new Set(definitions.map((definition) => definition.id));
  if (referencedDefinitionIds.size > 0) {
    const referencedDefinitions = await Promise.all([...referencedDefinitionIds]
      .filter((definitionId) => !knownDefinitionIds.has(definitionId))
      .map((definitionId) => dependencies.readDefinition({ loopDefinitionId: definitionId })));
    for (const referenced of referencedDefinitions) {
      const record = isRecord(referenced) ? referenced : null;
      if (
        record
        && record.latestPublishedVersion
        && (record.origin === "platform" || record.spaceId === project.spaceId)
      ) {
        const normalized = normalizeDefinitionMetadata(record);
        if (typeof normalized.id === "string" && typeof normalized.spaceId === "string") {
          definitions.push(normalized as DefinitionSummary);
        }
      }
    }
  }
  const agentProfiles = profiles.filter((profile) => profile.status === "active");
  const providerReadiness = (["codex", "claude"] as const).map((provider) => {
    const readyRuntimeCount = runtimes.filter((runtime) => runtime.provider === provider && runtime.status === "ready").length;
    const adapterRegistered = provider === "codex";
    return {
      provider,
      adapterRegistered,
      readyRuntimeCount,
      available: adapterRegistered && readyRuntimeCount > 0,
      reason: !adapterRegistered
        ? "尚未注册 Claude 执行适配器"
        : readyRuntimeCount === 0 ? "当前用户没有就绪的 Codex 运行时" : null,
    };
  });
  const projectRecord = isRecord(project) ? project : {};
  const developmentMode = parseDevelopmentMode(projectRecord);
  const persistedLoopGroupConfig = projectLoopGroupConfigSchema.safeParse(project.loopGroupConfig);
  const workerResource = parseProjectWorkerResource(projectRecord);
  return {
    project: {
      id: project.id,
      spaceId: project.spaceId,
      ...(typeof project.name === "string" ? { name: project.name } : {}),
      ...(Number.isInteger(project.version) ? { version: project.version } : {}),
      ...(persistedLoopGroupConfig.success ? { loopGroupConfig: persistedLoopGroupConfig.data } : {}),
      ...(workerResource ? { workerResource } : {}),
      ...(developmentMode ? { developmentMode } : {}),
    },
    bindings,
    definitions: definitions.map(normalizeDefinitionMetadata) as DefinitionSummary[],
    grants,
    agentProfiles,
    providerReadiness,
    workspaceBindings: workspaceRows.flatMap((value) => {
      const device = isRecord(value.localDevice) ? value.localDevice : null;
      if (
        typeof value.id !== "string"
        || typeof value.localDeviceId !== "string"
        || typeof value.status !== "string"
        || !Number.isInteger(value.configurationVersion)
        || !device
        || typeof device.name !== "string"
      ) return [];
      return [{
        id: value.id,
        deviceId: value.localDeviceId,
        deviceName: device.name,
        status: value.status,
        configurationVersion: value.configurationVersion as number,
      }];
    }),
    triggerTypes: ["manual", "task_event"] as const,
  };
}

function collectPublishedSubloopDefinitionIds(definition: DefinitionSummary): string[] {
  const version = isRecord(definition.latestPublishedVersion) ? definition.latestPublishedVersion : null;
  const graph = version && loopAuthoringGraphSchema.safeParse(version.graph);
  return graph && graph.success
    ? graph.data.nodes.flatMap((node) => node.type === "subloop_call" ? [node.targetLoopDefinitionId] : [])
    : [];
}

function collectBindingSubloopDefinitionIds(binding: unknown): string[] {
  const record = isRecord(binding) ? binding : null;
  const version = record && isRecord(record.activeVersion) ? record.activeVersion : null;
  const graph = version && loopAuthoringGraphSchema.safeParse(version.graph);
  return graph && graph.success
    ? graph.data.nodes.flatMap((node) => node.type === "subloop_call" ? [node.targetLoopDefinitionId] : [])
    : [];
}

function parseProjectWorkerResource(project: Record<string, unknown>): {
  poolId: string;
  repositoryUrl: string;
  branchPolicy: { allowedBranches: string[] };
  image?: { repository: string; tag: string; digest: string; resolvedAt?: string };
  imageVersionId?: string;
} | null {
  if (typeof project.workerPoolId !== "string" || !/^[a-f0-9]{32}$/u.test(project.workerPoolId)) return null;
  if (typeof project.workerRepositoryUrl !== "string" || project.workerRepositoryUrl.length > 1024) return null;
  const policy = isRecord(project.workerBranchPolicy) ? project.workerBranchPolicy : null;
  const allowedBranches = policy && Array.isArray(policy.allowedBranches)
    ? policy.allowedBranches.filter((value): value is string => typeof value === "string" && value.length > 0 && value.length <= 191)
    : [];
  if (allowedBranches.length === 0) return null;
  return {
    poolId: project.workerPoolId,
    repositoryUrl: project.workerRepositoryUrl,
    branchPolicy: { allowedBranches: [...new Set(allowedBranches)] },
    ...(typeof project.workerImageRepository === "string" && typeof project.workerImageTag === "string" && typeof project.workerImageDigest === "string" && /^sha256:[a-f0-9]{64}$/u.test(project.workerImageDigest)
      ? { image: { repository: project.workerImageRepository, tag: project.workerImageTag, digest: project.workerImageDigest, ...(project.workerImageResolvedAt instanceof Date ? { resolvedAt: project.workerImageResolvedAt.toISOString() } : {}) } }
      : {}),
    ...(typeof project.workerImageVersionId === "string" ? { imageVersionId: project.workerImageVersionId } : {}),
  };
}

function parseDevelopmentMode(project: Record<string, unknown>): {
  key: string;
  name: string;
  origin: "platform" | "space" | null;
  kind: string | null;
  description: string | null;
  version: number | null;
  productionBranch: string | null;
  stagingBranch: string | null;
  releaseAgentProfileId: string | null;
  config: Record<string, unknown>;
  loopGroupConfig: ProjectLoopGroupConfig | null;
  executionPolicy: Record<string, unknown>;
  triggerPolicy: Record<string, unknown>;
  developmentLoopVersionId: string | null;
  releaseLoopVersionId: string | null;
} | null {
  const key = typeof project.developmentTemplateKey === "string" ? project.developmentTemplateKey : null;
  if (!key) return null;
  const template = isRecord(project.developmentTemplate) ? project.developmentTemplate : {};
  const config = isRecord(project.developmentTemplateConfig) ? project.developmentTemplateConfig : {};
  const projectLoopGroupConfig = projectLoopGroupConfigSchema.safeParse(project.loopGroupConfig);
  const templateLoopGroupConfig = isRecord(template.loopGroupConfig) ? template.loopGroupConfig : null;
  const loopGroupConfig = projectLoopGroupConfig.success
    ? projectLoopGroupConfig.data
    : resolveTemplateLoopGroupConfig(templateLoopGroupConfig);
  return {
    key,
    name: typeof template.name === "string" ? template.name : key === "branch-development" ? "分支开发" : key,
    origin: template.origin === "platform" || template.origin === "space" ? template.origin : null,
    kind: typeof template.kind === "string" ? template.kind : null,
    description: typeof template.description === "string" ? template.description : null,
    version: Number.isInteger(project.developmentTemplateVersion) ? project.developmentTemplateVersion as number : null,
    productionBranch: typeof project.productionBranch === "string" ? project.productionBranch : typeof config.productionBranch === "string" ? config.productionBranch : null,
    stagingBranch: typeof project.stagingBranch === "string" ? project.stagingBranch : typeof config.stagingBranch === "string" ? config.stagingBranch : null,
    releaseAgentProfileId: typeof project.releaseAgentProfileId === "string" ? project.releaseAgentProfileId : typeof config.releaseAgentProfileId === "string" ? config.releaseAgentProfileId : null,
    config,
    loopGroupConfig,
    executionPolicy: isRecord(template.executionPolicy) ? template.executionPolicy : {},
    triggerPolicy: isRecord(template.triggerPolicy) ? template.triggerPolicy : {},
    developmentLoopVersionId: typeof template.developmentLoopVersionId === "string" ? template.developmentLoopVersionId : null,
    releaseLoopVersionId: typeof template.releaseLoopVersionId === "string" ? template.releaseLoopVersionId : null,
  };
}

function resolveTemplateLoopGroupConfig(value: Record<string, unknown> | null): ProjectLoopGroupConfig | null {
  if (!value) return null;
  const presets = Array.isArray(value.presets) ? value.presets : null;
  const selection = isRecord(value.defaultSelection) ? value.defaultSelection : null;
  if (!presets || !selection || !Array.isArray(selection.selectedPresetKeys) || typeof selection.defaultPresetKey !== "string") return null;
  try {
    return buildProjectLoopGroupConfig({
      presets: presets as never,
      selection: {
        selectedPresetKeys: selection.selectedPresetKeys.filter((key): key is string => typeof key === "string"),
        defaultPresetKey: selection.defaultPresetKey,
      },
    });
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseEditorRecord(value: unknown): DefinitionEditorRecord | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError("Loop definition state is invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string"
    || typeof record.spaceId !== "string"
    || typeof record.name !== "string"
    || !Number.isInteger(record.draftRevision)
    || (record.draftRevision as number) < 1
    || !Array.isArray(record.versions)
  ) {
    throw validationError("Loop definition state is invalid");
  }
  return normalizeDefinitionMetadata(record) as DefinitionEditorRecord;
}

function normalizeDefinitionMetadata<T extends Record<string, unknown>>(record: T): T & {
  scope: "task" | "project";
  origin: "space" | "platform";
  readOnly: boolean;
} {
  const scope = record.scope === "project" ? "project" : "task";
  const origin = record.origin === "platform" ? "platform" : "space";
  return { ...record, scope, origin, readOnly: origin === "platform" };
}

function buildSubloopOptions(definitions: DefinitionSummary[]): LoopSubloopOption[] {
  return definitions
    .filter((definition) => definition.status !== "archived" && definition.scope === "task")
    .flatMap((definition) => {
      const latest = isRecord(definition.latestPublishedVersion)
        ? definition.latestPublishedVersion
        : null;
      const versions = Array.isArray(definition.versions)
        ? definition.versions.flatMap((value) => {
            const version = isRecord(value) ? value : null;
            return version && typeof version.id === "string" && Number.isInteger(version.versionNumber)
              ? [{ id: version.id, versionNumber: version.versionNumber as number }]
              : [];
          })
        : latest && typeof latest.id === "string" && Number.isInteger(latest.versionNumber)
          ? [{ id: latest.id, versionNumber: latest.versionNumber as number }]
          : [];
      if (typeof definition.id !== "string" || typeof definition.name !== "string" || versions.length === 0) return [];
      return [{
        definitionId: definition.id,
        name: definition.name,
        versions,
      }];
    });
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}
