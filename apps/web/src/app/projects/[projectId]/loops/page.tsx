import { loopAuthoringGraphSchema } from "@humanthread/orchestration-core";
import { isWorkerBranchPattern, projectLoopGroupConfigSchema } from "@humanthread/shared";
import { redirect } from "next/navigation";
import {
  type ProjectWorkerResource,
  type ProjectLoopSettingsModel,
  type WorkerExecutionConfiguration,
  type WorkerReasoningEffort,
} from "../../../components/loops/project-loop-bindings";
import {
  projectLoopGraphToFlow,
  projectLoopGraphToGrantScope,
} from "../../../components/loops/project-loop-flow";
import type { AutomationGrantProject } from "../../../components/loops/automation-grant-dialog";

export const dynamic = "force-dynamic";
export const PROJECT_LOOP_SETTINGS_PAGE_TITLE = "项目 Loop 设置";

export default async function ProjectLoopSettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/projects/${encodeURIComponent(projectId)}/settings?tab=loops`);
}

export function buildProjectLoopSettingsModel(value: {
  project: unknown;
  definitions: unknown[];
  bindings: unknown[];
  grants: unknown[];
  triggerTypes: readonly string[];
  agentProfiles?: unknown[];
  providerReadiness?: unknown[];
  workspaceBindings?: unknown[];
}): ProjectLoopSettingsModel {
  const project = asRecord(value.project);
  const projectId = requiredString(project.id, "Project ID");
  const spaceId = requiredString(project.spaceId, "Project Space ID");
  const developmentMode = parseDevelopmentMode(project.developmentMode);
  const loopGroupConfig = projectLoopGroupConfigSchema.safeParse(project.loopGroupConfig);
  const grants = value.grants.flatMap((item) => parseGrant(item));
  const definitions = value.definitions.flatMap((item) => parseDefinition(item, developmentMode));
  for (const bindingValue of value.bindings) {
    const binding = asRecord(bindingValue, false);
    const pinnedVersion = binding ? parseVersion(binding.activeVersion) : null;
    if (!binding || typeof binding.loopDefinitionId !== "string" || !pinnedVersion) continue;
    let definition = definitions.find((item) => item.id === binding.loopDefinitionId);
    if (!definition) {
      const rawDefinition = asRecord(binding.loopDefinition, false);
      definition = {
        id: binding.loopDefinitionId,
        name: rawDefinition && typeof rawDefinition.name === "string" ? rawDefinition.name : "未命名 Loop",
        versions: [],
      };
      definitions.push(definition);
    }
    if (!definition.versions.some((version) => version.id === pinnedVersion.id)) {
      definition.versions.push(pinnedVersion);
      definition.versions.sort((left, right) => right.versionNumber - left.versionNumber);
    }
    if (pinnedVersion.flow) definition.flow = pinnedVersion.flow;
  }
  for (const definition of definitions) {
    const role = developmentMode?.developmentLoopVersionId && definition.versions.some((version) => version.id === developmentMode.developmentLoopVersionId)
      ? "task_development"
      : developmentMode?.releaseLoopVersionId && definition.versions.some((version) => version.id === developmentMode.releaseLoopVersionId)
        ? "milestone_release"
        : undefined;
    if (role) definition.role = role;
  }
  const workerResource = parseProjectWorkerResource(project.workerResource);
  return {
    project: {
      id: projectId,
      name: typeof project.name === "string" ? project.name : "未命名项目",
      spaceId,
      version: Number.isInteger(project.version) ? project.version as number : 1,
      ...(loopGroupConfig.success ? { loopGroupConfig: loopGroupConfig.data } : {}),
      ...(developmentMode ? { developmentMode } : {}),
      ...(workerResource ? { workerResource } : {}),
      workspaceBindings: (value.workspaceBindings ?? []).flatMap((item) => parseWorkspaceBinding(item)),
    },
    definitions,
    bindings: value.bindings.flatMap((item) => parseBinding(item, workerResource)),
    agentProfiles: (value.agentProfiles ?? []).flatMap((item) => parseAgentProfile(item)),
    providerReadiness: (value.providerReadiness ?? []).flatMap((item) => parseProviderReadiness(item)),
    grants,
    triggerTypes: value.triggerTypes.filter((type): type is "manual" | "task_event" => type === "manual" || type === "task_event"),
  };
}

function parseProjectWorkerResource(value: unknown): ProjectWorkerResource | null {
  const record = asRecord(value, false);
  const policy = record ? asRecord(record.branchPolicy, false) : null;
  if (!record || typeof record.poolId !== "string" || typeof record.repositoryUrl !== "string" || !policy || !Array.isArray(policy.allowedBranches)) return null;
  const allowedBranches = policy.allowedBranches.filter((branch): branch is string => typeof branch === "string" && isWorkerBranchPattern(branch));
  if (allowedBranches.length === 0) return null;
  const imageRecord = asRecord(record.image, false);
  const image = imageRecord
    && typeof imageRecord.repository === "string"
    && typeof imageRecord.tag === "string"
    && typeof imageRecord.digest === "string"
    && /^sha256:[a-f0-9]{64}$/u.test(imageRecord.digest)
    ? {
        repository: imageRecord.repository,
        tag: imageRecord.tag,
        digest: imageRecord.digest,
        ...(typeof imageRecord.resolvedAt === "string" ? { resolvedAt: imageRecord.resolvedAt } : {}),
      }
    : undefined;
  return {
    poolId: record.poolId,
    repositoryUrl: record.repositoryUrl,
    branchPolicy: { allowedBranches },
    ...(image ? { image } : {}),
    ...(typeof record.imageVersionId === "string" ? { imageVersionId: record.imageVersionId } : {}),
  };
}

function parseDefinition(
  value: unknown,
  developmentMode: ProjectLoopSettingsModel["project"]["developmentMode"] | null = null,
): ProjectLoopSettingsModel["definitions"] {
  const record = asRecord(value, false);
  if (!record) return [];
  const latest = parseVersion(record.latestPublishedVersion);
  if (!latest || typeof record.id !== "string") return [];
  const flow = latest.flow ?? [];
  return [{
      id: record.id,
    name: typeof record.name === "string" ? record.name : "未命名 Loop",
    scope: record.scope === "project" ? "project" : "task",
    description: typeof record.description === "string" ? record.description : null,
      flow,
    ...(latest.id === developmentMode?.developmentLoopVersionId
      ? { role: "task_development" as const }
      : latest.id === developmentMode?.releaseLoopVersionId ? { role: "milestone_release" as const } : {}),
    versions: [latest],
  }];
}

function parseVersion(value: unknown): ProjectLoopSettingsModel["definitions"][number]["versions"][number] | null {
  const record = asRecord(value, false);
  if (!record || typeof record.id !== "string" || !Number.isInteger(record.versionNumber)) return null;
  const graph = loopAuthoringGraphSchema.safeParse(record.graph);
  if (!graph.success) return null;
  return {
    id: record.id,
    versionNumber: record.versionNumber as number,
    humanGateCount: graph.data.nodes.filter((node) => node.type === "human_gate").length,
    maxStages: graph.data.limits.maxStages,
    maxRepeatCount: graph.data.limits.maxRepeatCount,
    agentNodeKeys: graph.data.nodes
      .filter((node) => node.type === "agent_action")
      .map((node) => node.key),
    agentNodeLabels: Object.fromEntries(graph.data.nodes
      .filter((node) => node.type === "agent_action")
      .map((node) => [node.key, node.label])),
    flow: projectLoopGraphToFlow(graph.data),
    subloopDefinitionIds: graph.data.nodes.flatMap((node) => node.type === "subloop_call" ? [node.targetLoopDefinitionId] : []),
    grantScope: projectLoopGraphToGrantScope(graph.data),
  };
}

function parseDevelopmentMode(value: unknown): NonNullable<ProjectLoopSettingsModel["project"]["developmentMode"]> | null {
  const record = asRecord(value, false);
  if (!record || typeof record.key !== "string" || typeof record.name !== "string") return null;
  return {
    key: record.key,
    name: record.name,
    origin: record.origin === "platform" || record.origin === "space" ? record.origin : null,
    kind: typeof record.kind === "string" ? record.kind : null,
    description: typeof record.description === "string" ? record.description : null,
    version: Number.isInteger(record.version) ? record.version as number : null,
    productionBranch: typeof record.productionBranch === "string" ? record.productionBranch : null,
    stagingBranch: typeof record.stagingBranch === "string" ? record.stagingBranch : null,
    releaseAgentProfileId: typeof record.releaseAgentProfileId === "string" ? record.releaseAgentProfileId : null,
    config: asRecord(record.config, false) ?? {},
    executionPolicy: asRecord(record.executionPolicy, false) ?? {},
    triggerPolicy: asRecord(record.triggerPolicy, false) ?? {},
    loopGroupConfig: (asRecord(record.loopGroupConfig, false) as NonNullable<ProjectLoopSettingsModel["project"]["developmentMode"]>["loopGroupConfig"]) ?? null,
    developmentLoopVersionId: typeof record.developmentLoopVersionId === "string" ? record.developmentLoopVersionId : null,
    releaseLoopVersionId: typeof record.releaseLoopVersionId === "string" ? record.releaseLoopVersionId : null,
  };
}

function parseBinding(
  value: unknown,
  projectWorkerResource: ProjectWorkerResource | null,
): ProjectLoopSettingsModel["bindings"] {
  const record = asRecord(value, false);
  const triggerPolicy = record ? asRecord(record.triggerPolicy, false) : null;
  if (!record || !triggerPolicy || typeof record.id !== "string" || typeof record.loopDefinitionId !== "string" || typeof record.activeVersionId !== "string" || !Number.isInteger(record.version)) return [];
  const workerExecution = parseWorkerExecution(record, projectWorkerResource);
  return [{
    id: record.id,
    loopDefinitionId: record.loopDefinitionId,
    activeVersionId: record.activeVersionId,
    ...(record.bindingRole === "task_development" || record.bindingRole === "milestone_release" ? { bindingRole: record.bindingRole } : {}),
    status: record.status === "disabled" ? "disabled" : "enabled",
    version: record.version as number,
    triggerPolicy: {
      manual: triggerPolicy.manual === true,
      taskEvents: Array.isArray(triggerPolicy.taskEvents) ? triggerPolicy.taskEvents.filter((item): item is string => typeof item === "string") : [],
    },
    automationGrantIds: Array.isArray(record.automationGrantIds) ? record.automationGrantIds.filter((item): item is string => typeof item === "string") : [],
    allowedAgentProfileIds: Array.isArray(record.allowedAgentProfileIds) ? record.allowedAgentProfileIds.filter((item): item is string => typeof item === "string") : [],
    allowedProviders: Array.isArray(record.allowedProviders) ? record.allowedProviders.filter((item): item is "codex" | "claude" => item === "codex" || item === "claude") : [],
    ...(workerExecution ? { workerExecution } : {}),
  }];
}

function parseWorkerExecution(
  record: Record<string, unknown>,
  projectWorkerResource: ProjectWorkerResource | null,
): WorkerExecutionConfiguration | null {
  const legacyPoolId = typeof record.workerPoolId === "string" && /^[a-f0-9]{32}$/u.test(record.workerPoolId)
    ? record.workerPoolId : null;
  const legacyRepositoryUrl = validUrl(record.workerRepositoryUrl);
  const legacyBranchPolicy = asRecord(record.workerBranchPolicy, false);
  const poolId = projectWorkerResource?.poolId ?? legacyPoolId;
  const repositoryUrl = projectWorkerResource?.repositoryUrl ?? legacyRepositoryUrl;
  const branchPolicy = projectWorkerResource?.branchPolicy ?? legacyBranchPolicy;
  const stageConfigurations = asRecord(record.workerStageConfigurations, false);
  if (!poolId || !repositoryUrl || !branchPolicy || !stageConfigurations) return null;
  const rawAllowedBranches = Array.isArray(branchPolicy.allowedBranches) ? branchPolicy.allowedBranches : null;
  if (!rawAllowedBranches || rawAllowedBranches.length === 0 || rawAllowedBranches.length > 64) return null;
  const allowedBranches = rawAllowedBranches.map((value) => typeof value === "string" ? value.trim() : "");
  if (
    !allowedBranches.every(isWorkerBranchPattern)
    || new Set(allowedBranches).size !== allowedBranches.length
  ) return null;
  const entries = Object.entries(stageConfigurations);
  if (entries.length === 0 || entries.length > 96) return null;
  const parsedStages = entries.flatMap(([nodeKey, configuration]) => {
    const stage = asRecord(configuration, false);
    const siteId = stage && typeof stage.siteId === "string" && /^[a-f0-9]{32}$/u.test(stage.siteId) ? stage.siteId : null;
    const model = stage && typeof stage.model === "string" && stage.model.trim().length > 0 && stage.model.trim().length <= 191
      ? stage.model.trim()
      : null;
    const reasoningEffort = stage && isWorkerReasoningEffort(stage.reasoningEffort) ? stage.reasoningEffort : null;
    if (!nodeKey.trim() || nodeKey.length > 96 || !siteId || !model || !reasoningEffort) return [];
    return [[nodeKey, { siteId, model, reasoningEffort }] as const];
  });
  if (parsedStages.length !== entries.length) return null;
  return {
    poolId,
    repositoryUrl,
    branchPolicy: { allowedBranches: [...new Set(allowedBranches.map((branch) => branch.trim()))] },
    stageConfigurations: Object.fromEntries(parsedStages),
  };
}

function validUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1_024) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function isWorkerReasoningEffort(value: unknown): value is WorkerReasoningEffort {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max" || value === "ultra";
}

function parseAgentProfile(value: unknown): ProjectLoopSettingsModel["agentProfiles"] {
  const record = asRecord(value, false);
  if (!record || typeof record.id !== "string" || typeof record.name !== "string" || (record.provider !== "codex" && record.provider !== "claude")) return [];
  return [{ id: record.id, name: record.name, provider: record.provider, capabilities: Array.isArray(record.capabilities) ? record.capabilities.filter((item): item is string => typeof item === "string") : [] }];
}

function parseProviderReadiness(value: unknown): ProjectLoopSettingsModel["providerReadiness"] {
  const record = asRecord(value, false);
  if (!record || (record.provider !== "codex" && record.provider !== "claude") || typeof record.adapterRegistered !== "boolean" || typeof record.readyRuntimeCount !== "number" || typeof record.available !== "boolean") return [];
  return [{ provider: record.provider, adapterRegistered: record.adapterRegistered, readyRuntimeCount: record.readyRuntimeCount, available: record.available, reason: typeof record.reason === "string" ? record.reason : null }];
}

function parseGrant(value: unknown): ProjectLoopSettingsModel["grants"] {
  const record = asRecord(value, false);
  if (!record || typeof record.id !== "string") return [];
  const permission = record.permission === "workspace_full" || record.permission === "read_only" ? record.permission : "none";
  return [{
    id: record.id,
    status: record.status === "revoked" ? "revoked" : "active",
    permission,
    workspaceBindingIds: Array.isArray(record.workspaceBindingIds) ? record.workspaceBindingIds.filter((item): item is string => typeof item === "string") : [],
    allowedRelativePathPrefixes: Array.isArray(record.allowedRelativePathPrefixes) ? record.allowedRelativePathPrefixes.filter((item): item is string => typeof item === "string") : [],
    bindingIds: Array.isArray(record.bindingIds) ? record.bindingIds.filter((item): item is string => typeof item === "string") : [],
    expiresAt: typeof record.expiresAt === "string" ? record.expiresAt : null,
    revokedAt: typeof record.revokedAt === "string" ? record.revokedAt : null,
  }];
}

function parseWorkspaceBinding(value: unknown): AutomationGrantProject["workspaceBindings"] {
  const record = asRecord(value, false);
  const device = record ? asRecord(record.localDevice, false) : null;
  const deviceId = record && typeof record.deviceId === "string"
    ? record.deviceId
    : record && typeof record.localDeviceId === "string" ? record.localDeviceId : null;
  const deviceName = record && typeof record.deviceName === "string"
    ? record.deviceName
    : device && typeof device.name === "string" ? device.name : null;
  if (
    !record
    || typeof record.id !== "string"
    || !deviceId
    || !deviceName
    || !Number.isInteger(record.configurationVersion)
  ) return [];
  return [{
    id: record.id,
    deviceId,
    deviceName,
    status: record.status === "ready" ? "ready" : "revoked",
    configurationVersion: record.configurationVersion as number,
  }];
}

function asRecord(value: unknown): Record<string, unknown>;
function asRecord(value: unknown, required: false): Record<string, unknown> | null;
function asRecord(value: unknown, required = true): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (required) throw new Error("Project Loop settings are invalid");
  return null;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} is invalid`);
  return value;
}
