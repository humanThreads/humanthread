import { createHash } from "node:crypto";
import {
  activateLoopVersion,
  archiveLoopDefinition,
  assertCanReadProject,
  assertCanWriteProject,
  assertCanWriteSpace,
  deleteLoopDefinition,
  disableProjectTaskLoopBinding,
  listProjectLoopBindings,
  prisma,
  publishLoopVersion,
  readLoopDefinition,
  saveLoopDraft,
  upsertProjectWorkerExecutionResource,
  upsertProjectLoopBinding,
} from "@humanthread/db";

interface LoopDefinitionSnapshot {
  id: string;
  spaceId: string;
  name: string;
  description: string | null;
  draftGraph: unknown;
  draftRevision: number;
  latestPublishedVersion: { versionNumber: number } | null;
  versions?: unknown[];
  scope: "task" | "project";
  origin: "space" | "platform";
}

interface LoopDefinitionCommandDependencies {
  now(): Date;
  assertCanWriteSpace(input: { userId: string; spaceId: string }): Promise<unknown>;
  assertCanReadProject(input: { userId: string; projectId: string }): Promise<unknown>;
  assertCanWriteProject(input: { userId: string; projectId: string }): Promise<unknown>;
  readProject(projectId: string): Promise<{ id: string; spaceId: string | null } | null>;
  readLoopDefinition(input: { loopDefinitionId: string }): Promise<unknown>;
  saveLoopDraft(input: Parameters<typeof saveLoopDraft>[0]): ReturnType<typeof saveLoopDraft>;
  publishLoopVersion(input: Parameters<typeof publishLoopVersion>[0]): ReturnType<typeof publishLoopVersion>;
  activateLoopVersion(input: Parameters<typeof activateLoopVersion>[0]): ReturnType<typeof activateLoopVersion>;
  upsertProjectLoopBinding(input: Parameters<typeof upsertProjectLoopBinding>[0]): ReturnType<typeof upsertProjectLoopBinding>;
  upsertProjectWorkerExecutionResource?(input: Parameters<typeof upsertProjectWorkerExecutionResource>[0]): ReturnType<typeof upsertProjectWorkerExecutionResource>;
  disableProjectTaskLoopBinding(
    input: Parameters<typeof disableProjectTaskLoopBinding>[0],
  ): ReturnType<typeof disableProjectTaskLoopBinding>;
  archiveLoopDefinition(input: Parameters<typeof archiveLoopDefinition>[0]): ReturnType<typeof archiveLoopDefinition>;
  deleteLoopDefinition(input: Parameters<typeof deleteLoopDefinition>[0]): ReturnType<typeof deleteLoopDefinition>;
  listProjectLoopBindings(projectId: string): Promise<unknown>;
  listAgentProfiles(input: { ids: string[] }): Promise<Array<{ id: string; spaceId: string; provider: string; status: string }>>;
}

const defaultDependencies: LoopDefinitionCommandDependencies = {
  now: () => new Date(),
  assertCanWriteSpace: (input) => assertCanWriteSpace(input),
  assertCanReadProject: (input) => assertCanReadProject(input),
  assertCanWriteProject: (input) => assertCanWriteProject(input),
  readProject: (projectId) => prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, spaceId: true },
  }),
  readLoopDefinition: (input) => readLoopDefinition(input),
  saveLoopDraft: (input) => saveLoopDraft(input),
  publishLoopVersion: (input) => publishLoopVersion(input),
  activateLoopVersion: (input) => activateLoopVersion(input),
  upsertProjectLoopBinding: (input) => upsertProjectLoopBinding(input),
  upsertProjectWorkerExecutionResource: (input) => upsertProjectWorkerExecutionResource(input),
  disableProjectTaskLoopBinding: (input) => disableProjectTaskLoopBinding(input),
  archiveLoopDefinition: (input) => archiveLoopDefinition(input),
  deleteLoopDefinition: (input) => deleteLoopDefinition(input),
  listProjectLoopBindings: (projectId) => listProjectLoopBindings(projectId),
  listAgentProfiles: (input) => prisma.agentProfile.findMany({
    where: { id: { in: input.ids } },
    select: { id: true, spaceId: true, provider: true, status: true },
  }),
};

function digest(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function persistenceId(prefix: string, parts: readonly string[]): string {
  return `${prefix}_${digest(parts)}`;
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}

function authorizationDenied(message: string): Error {
  return Object.assign(new Error(message), { code: "authorization_denied" });
}

function versionConflict(message: string, currentRevision?: number): Error {
  return Object.assign(new Error(message), {
    code: "version_conflict",
    ...(currentRevision === undefined ? {} : { currentRevision }),
  });
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: "not_found" });
}

function command(input: {
  externalCommandId: string;
  scopeType: "loop_definition" | "project";
  scopeId: string;
  actorUserId: string;
  issuedAt: Date;
  expectedVersion?: number;
  payload: unknown;
}) {
  return {
    commandId: persistenceId("loop_command", [input.scopeType, input.scopeId, input.externalCommandId]),
    correlationId: `${input.scopeType}:${input.scopeId}`,
    actor: { type: "user" as const, id: input.actorUserId },
    ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
    payload: input.payload,
    issuedAt: input.issuedAt,
  };
}

function asLoopDefinition(value: unknown): LoopDefinitionSnapshot {
  if (!value || typeof value !== "object") throw notFound("Loop definition not found");
  const record = value as Record<string, unknown>;
  const latest = record.latestPublishedVersion;
  if (
    typeof record.id !== "string"
    || typeof record.spaceId !== "string"
    || typeof record.name !== "string"
    || !(record.description === null || typeof record.description === "string")
    || !Number.isInteger(record.draftRevision)
    || (record.draftRevision as number) < 1
    || !(latest === null || (
      typeof latest === "object"
      && latest !== null
      && Number.isInteger((latest as Record<string, unknown>).versionNumber)
      && ((latest as Record<string, unknown>).versionNumber as number) > 0
    ))
  ) {
    throw validationError("Loop definition state is invalid");
  }
  return {
    ...record,
    scope: record.scope === "project" ? "project" : "task",
    origin: record.origin === "platform" ? "platform" : "space",
  } as LoopDefinitionSnapshot;
}

function versionRequiresLocalAgent(definition: LoopDefinitionSnapshot, activeVersionId: string): boolean {
  const version = definition.versions?.find((value) => (
    value && typeof value === "object" && !Array.isArray(value)
    && (value as Record<string, unknown>).id === activeVersionId
  ));
  if (!version || typeof version !== "object" || Array.isArray(version)) return false;
  const graph = (version as Record<string, unknown>).graph;
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) return false;
  const nodes = (graph as Record<string, unknown>).nodes;
  return Array.isArray(nodes) && nodes.some((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return false;
    const record = node as Record<string, unknown>;
    return record.type === "agent_action"
      && (record.executionTarget === "local" || record.executionTarget === "either");
  });
}

async function loadAuthorizedDefinition(input: {
  loopDefinitionId: string;
  actorUserId: string;
}, dependencies: LoopDefinitionCommandDependencies): Promise<LoopDefinitionSnapshot> {
  const definition = asLoopDefinition(await dependencies.readLoopDefinition({
    loopDefinitionId: input.loopDefinitionId,
  }));
  if (definition.origin === "platform") {
    throw authorizationDenied("Platform Loop definitions are read-only");
  }
  await dependencies.assertCanWriteSpace({ userId: input.actorUserId, spaceId: definition.spaceId });
  return definition;
}

export async function createLoopDraftCommand(input: {
  actorUserId: string;
  commandId: string;
  spaceId: string;
  scope?: "task" | "project";
  name: string;
  description?: string | null;
  graph: unknown;
}, dependencies: LoopDefinitionCommandDependencies = defaultDependencies) {
  await dependencies.assertCanWriteSpace({ userId: input.actorUserId, spaceId: input.spaceId });
  const loopDefinitionId = persistenceId("loop_definition", [input.spaceId, input.actorUserId, input.commandId]);
  return dependencies.saveLoopDraft({
    command: command({
      externalCommandId: input.commandId,
      scopeType: "loop_definition",
      scopeId: loopDefinitionId,
      actorUserId: input.actorUserId,
      issuedAt: dependencies.now(),
      payload: { operation: "create_draft" },
    }),
    loopDefinitionId,
    spaceId: input.spaceId,
    name: input.name,
    ...(input.description === undefined ? {} : { description: input.description }),
    ownerUserId: input.actorUserId,
    scope: input.scope ?? "task",
    origin: "space",
    graph: input.graph,
  });
}

export async function updateLoopDraftCommand(input: {
  actorUserId: string;
  commandId: string;
  loopDefinitionId: string;
  expectedDraftRevision: number;
  name: string;
  description?: string | null;
  graph: unknown;
}, dependencies: LoopDefinitionCommandDependencies = defaultDependencies) {
  const definition = await loadAuthorizedDefinition(input, dependencies);
  if (definition.draftRevision !== input.expectedDraftRevision) {
    throw versionConflict("Loop definition draft changed", definition.draftRevision);
  }
  return dependencies.saveLoopDraft({
    command: command({
      externalCommandId: input.commandId,
      scopeType: "loop_definition",
      scopeId: input.loopDefinitionId,
      actorUserId: input.actorUserId,
      issuedAt: dependencies.now(),
      expectedVersion: input.expectedDraftRevision,
      payload: { operation: "update_draft" },
    }),
    loopDefinitionId: input.loopDefinitionId,
    expectedDraftRevision: input.expectedDraftRevision,
    name: input.name,
    ...(input.description === undefined ? {} : { description: input.description }),
    graph: input.graph,
  });
}

export async function publishLoopDefinitionCommand(input: {
  actorUserId: string;
  commandId: string;
  loopDefinitionId: string;
  expectedDraftRevision: number;
}, dependencies: LoopDefinitionCommandDependencies = defaultDependencies) {
  const definition = await loadAuthorizedDefinition(input, dependencies);
  if (definition.draftRevision !== input.expectedDraftRevision) {
    throw versionConflict("Loop definition draft changed", definition.draftRevision);
  }
  const nextVersion = (definition.latestPublishedVersion?.versionNumber ?? 0) + 1;
  return dependencies.publishLoopVersion({
    command: command({
      externalCommandId: input.commandId,
      scopeType: "loop_definition",
      scopeId: input.loopDefinitionId,
      actorUserId: input.actorUserId,
      issuedAt: dependencies.now(),
      expectedVersion: input.expectedDraftRevision,
      payload: { operation: "publish", versionNumber: nextVersion },
    }),
    loopDefinitionId: input.loopDefinitionId,
    versionId: persistenceId("loop_version", [input.loopDefinitionId, String(nextVersion)]),
    nextVersion,
    expectedDraftRevision: input.expectedDraftRevision,
    graph: definition.draftGraph,
  });
}

export async function activateLoopVersionCommand(input: {
  actorUserId: string;
  commandId: string;
  loopDefinitionId: string;
  activeVersionId: string;
  expectedDraftRevision: number;
}, dependencies: LoopDefinitionCommandDependencies = defaultDependencies) {
  const definition = await loadAuthorizedDefinition(input, dependencies);
  if (definition.draftRevision !== input.expectedDraftRevision) {
    throw versionConflict("Loop definition changed", definition.draftRevision);
  }
  return dependencies.activateLoopVersion({
    command: command({
      externalCommandId: input.commandId,
      scopeType: "loop_definition",
      scopeId: input.loopDefinitionId,
      actorUserId: input.actorUserId,
      issuedAt: dependencies.now(),
      expectedVersion: input.expectedDraftRevision,
      payload: { operation: "activate_version", activeVersionId: input.activeVersionId },
    }),
    loopDefinitionId: input.loopDefinitionId,
    activeVersionId: input.activeVersionId,
    expectedDraftRevision: input.expectedDraftRevision,
  });
}

export async function listLoopBindingsCommand(input: {
  actorUserId: string;
  projectId: string;
}, dependencies: LoopDefinitionCommandDependencies = defaultDependencies) {
  await dependencies.assertCanReadProject({ userId: input.actorUserId, projectId: input.projectId });
  return dependencies.listProjectLoopBindings(input.projectId);
}

export async function upsertLoopBindingCommand(input: {
  actorUserId: string;
  projectId: string;
  commandId: string;
  expectedVersion?: number;
  loopDefinitionId: string;
  activeVersionId: string;
  status: "enabled" | "disabled";
  triggerPolicy: { manual: boolean; taskEvents: string[] };
  parameterOverrides: Record<string, unknown>;
  notificationPolicy: Record<string, unknown>;
  automationGrantIds: string[];
  allowedAgentProfileIds: string[];
  allowedProviders: Array<"codex" | "claude">;
  workerStageConfigurations?: Record<string, unknown>;
  bindingRole?: "task_development" | "milestone_release";
}, dependencies: LoopDefinitionCommandDependencies = defaultDependencies) {
  await dependencies.assertCanWriteProject({ userId: input.actorUserId, projectId: input.projectId });
  const [project, definitionValue, bindingValues] = await Promise.all([
    dependencies.readProject(input.projectId),
    dependencies.readLoopDefinition({ loopDefinitionId: input.loopDefinitionId }),
    dependencies.listProjectLoopBindings(input.projectId),
  ]);
  if (!project) throw notFound("Project not found");
  const definition = asLoopDefinition(definitionValue);
  if (!project.spaceId || (definition.origin !== "platform" && project.spaceId !== definition.spaceId)) {
    throw validationError("Loop definition belongs to another Space");
  }
  const profileIds = [...new Set(input.allowedAgentProfileIds)];
  const providers = [...new Set(input.allowedProviders)];
  const hasLinuxWorkerConfiguration = hasWorkerStageConfigurations(input.workerStageConfigurations);
  if (versionRequiresLocalAgent(definition, input.activeVersionId) && !hasLinuxWorkerConfiguration && (!profileIds.length || !providers.length)) {
    throw validationError("Local Agent nodes require an Agent Profile and Provider");
  }
  if (providers.some((provider) => provider !== "codex")) {
    throw validationError("Selected Provider has no registered executable adapter");
  }
  const profiles = await dependencies.listAgentProfiles({ ids: profileIds });
  if (profiles.length !== profileIds.length) throw validationError("Agent Profile is unavailable");
  for (const profile of profiles) {
    if (profile.spaceId !== project.spaceId || profile.status !== "active") {
      throw validationError("Agent Profile is inactive or belongs to another Space");
    }
    if (!providers.includes(profile.provider as "codex" | "claude")) {
      throw validationError("Agent Profile Provider is not allowed by the binding");
    }
  }
  if (providers.some((provider) => !profiles.some((profile) => profile.provider === provider))) {
    throw validationError("Allowed Provider has no selected Agent Profile");
  }
  const bindingId = resolveUpsertBindingId({
    bindings: bindingValues,
    projectId: input.projectId,
    loopDefinitionId: input.loopDefinitionId,
    ...(input.bindingRole === undefined ? {} : { bindingRole: input.bindingRole }),
    ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
  });
  return dependencies.upsertProjectLoopBinding({
    command: command({
      externalCommandId: input.commandId,
      scopeType: "project",
      scopeId: input.projectId,
      actorUserId: input.actorUserId,
      issuedAt: dependencies.now(),
      ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
      payload: { operation: "upsert_loop_binding", bindingId },
    }),
    bindingId,
    projectId: input.projectId,
    loopDefinitionId: input.loopDefinitionId,
    activeVersionId: input.activeVersionId,
    status: input.status,
    triggerPolicy: input.triggerPolicy,
    parameterOverrides: input.parameterOverrides,
    notificationPolicy: input.notificationPolicy,
    automationGrantIds: input.automationGrantIds,
    allowedAgentProfileIds: profileIds,
    allowedProviders: providers,
    ...(input.bindingRole === undefined ? {} : { bindingRole: input.bindingRole }),
    ...(input.workerStageConfigurations === undefined ? {} : { workerStageConfigurations: input.workerStageConfigurations }),
    createdByUserId: input.actorUserId,
    ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
  });
}

function hasWorkerStageConfigurations(value: unknown): boolean {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length > 0;
}

export async function upsertProjectWorkerResourceCommand(input: {
  actorUserId: string;
  projectId: string;
  commandId: string;
  expectedVersion: number;
  workerPoolId: string;
  workerRepositoryUrl: string;
  workerBranchPolicy: { allowedBranches: string[] };
  workerImageRepository?: string;
  workerImageTag?: string;
  workerImageDigest?: string;
  workerImageResolvedAt?: Date;
}, dependencies: LoopDefinitionCommandDependencies = defaultDependencies) {
  await dependencies.assertCanWriteProject({ userId: input.actorUserId, projectId: input.projectId });
  if (!dependencies.upsertProjectWorkerExecutionResource) {
    throw new Error("Project Worker resource persistence is unavailable");
  }
  return dependencies.upsertProjectWorkerExecutionResource({
    command: command({
      externalCommandId: input.commandId,
      scopeType: "project",
      scopeId: input.projectId,
      actorUserId: input.actorUserId,
      issuedAt: dependencies.now(),
      expectedVersion: input.expectedVersion,
      payload: { operation: "upsert_project_worker_resource" },
    }),
    projectId: input.projectId,
    workerPoolId: input.workerPoolId,
    workerRepositoryUrl: input.workerRepositoryUrl,
    workerBranchPolicy: input.workerBranchPolicy,
    ...(input.workerImageRepository === undefined ? {} : { workerImageRepository: input.workerImageRepository }),
    workerImageTag: input.workerImageTag,
    workerImageDigest: input.workerImageDigest,
    workerImageResolvedAt: input.workerImageResolvedAt,
    expectedVersion: input.expectedVersion,
  });
}

function resolveUpsertBindingId(input: {
  bindings: unknown;
  projectId: string;
  loopDefinitionId: string;
  bindingRole?: "task_development" | "milestone_release";
  expectedVersion?: number;
}): string {
  const derivedId = input.bindingRole === undefined
    ? persistenceId("loop_binding", [input.projectId, input.loopDefinitionId])
    : `binding:${input.projectId}:${input.bindingRole}`;
  if (input.expectedVersion === undefined) return derivedId;
  if (!Array.isArray(input.bindings)) throw validationError("Loop binding state is invalid");

  const candidates = input.bindings.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    if (
      typeof record.id !== "string"
      || record.projectId !== input.projectId
      || record.loopDefinitionId !== input.loopDefinitionId
      || (input.bindingRole !== undefined && record.bindingRole !== input.bindingRole)
      || !Number.isInteger(record.version)
    ) return [];
    return [{ id: record.id, version: record.version as number }];
  });
  const exact = candidates.filter(({ version }) => version === input.expectedVersion);
  if (exact.length === 1) return exact[0]!.id;
  if (exact.length > 1) throw validationError("Loop binding state is ambiguous");
  const currentVersion = candidates.reduce<number | undefined>((current, candidate) => (
    current === undefined || candidate.version > current ? candidate.version : current
  ), undefined);
  throw versionConflict("Loop binding changed", currentVersion);
}

export async function disableLoopBindingCommand(input: {
  actorUserId: string;
  projectId: string;
  commandId: string;
  bindingId: string;
  expectedVersion: number;
}, dependencies: LoopDefinitionCommandDependencies = defaultDependencies) {
  await dependencies.assertCanWriteProject({ userId: input.actorUserId, projectId: input.projectId });
  return dependencies.disableProjectTaskLoopBinding({
    command: command({
      externalCommandId: input.commandId,
      scopeType: "project",
      scopeId: input.projectId,
      actorUserId: input.actorUserId,
      issuedAt: dependencies.now(),
      expectedVersion: input.expectedVersion,
      payload: { operation: "disable_task_loop_binding", bindingId: input.bindingId },
    }),
    bindingId: input.bindingId,
    projectId: input.projectId,
    expectedVersion: input.expectedVersion,
  });
}

export async function archiveLoopDefinitionCommand(input: {
  actorUserId: string;
  commandId: string;
  loopDefinitionId: string;
  expectedDraftRevision: number;
}, dependencies: LoopDefinitionCommandDependencies = defaultDependencies) {
  const definition = await loadAuthorizedDefinition(input, dependencies);
  if (definition.draftRevision !== input.expectedDraftRevision) {
    throw versionConflict("Loop definition draft changed", definition.draftRevision);
  }
  return dependencies.archiveLoopDefinition({
    command: command({
      externalCommandId: input.commandId,
      scopeType: "loop_definition",
      scopeId: input.loopDefinitionId,
      actorUserId: input.actorUserId,
      issuedAt: dependencies.now(),
      expectedVersion: input.expectedDraftRevision,
      payload: { operation: "archive_loop_definition" },
    }),
    loopDefinitionId: input.loopDefinitionId,
    expectedRevision: input.expectedDraftRevision,
  });
}

export async function deleteLoopDefinitionCommand(input: {
  actorUserId: string;
  commandId: string;
  loopDefinitionId: string;
  expectedDraftRevision: number;
}, dependencies: LoopDefinitionCommandDependencies = defaultDependencies) {
  const definition = await loadAuthorizedDefinition(input, dependencies);
  if (definition.draftRevision !== input.expectedDraftRevision) {
    throw versionConflict("Loop definition draft changed", definition.draftRevision);
  }
  return dependencies.deleteLoopDefinition({
    command: command({
      externalCommandId: input.commandId,
      scopeType: "loop_definition",
      scopeId: input.loopDefinitionId,
      actorUserId: input.actorUserId,
      issuedAt: dependencies.now(),
      expectedVersion: input.expectedDraftRevision,
      payload: { operation: "delete_loop_definition" },
    }),
    loopDefinitionId: input.loopDefinitionId,
    expectedRevision: input.expectedDraftRevision,
  });
}
