import { createHash } from "node:crypto";
import { createEventEnvelope, LOOP_PLATFORM_CAPS, validateLoopGraph } from "@humanthread/orchestration-core";
import {
  automationGrantSchema,
  loopAuthoringGraphSchema,
  loopDefinitionOriginSchema,
  loopDefinitionScopeSchema,
  parsePublishedLoopGraph,
  projectLoopBindingRoleSchema,
  workerBranchPatternSchema,
  type AutomationGrantSnapshot,
  type LoopAuthoringGraph,
  type OrchestrationCommand,
} from "@humanthread/shared";
import { boundedPersistenceId } from "./bounded-id";
import {
  executeIdempotentCommand,
  OrchestrationPersistenceError,
  type OrchestrationCommandDb,
  type OrchestrationEventsTx,
} from "./orchestration-events";
import { prisma } from "./prisma";
import { normalizeWorkerResourceScope, workerResourceScopeWhere, type WorkerResourceScope } from "./worker-resource-tenancy";

type JsonRecord = Record<string, unknown>;

export interface LoopDefinitionTx extends OrchestrationEventsTx {
  loopDefinition: {
    create(args: { data: JsonRecord }): Promise<unknown>;
    updateMany(args: { where: JsonRecord; data: JsonRecord }): Promise<{ count: number }>;
    findUnique(args: unknown): Promise<LoopDefinitionPublicationSnapshot | null>;
    findFirst(args: unknown): Promise<LoopDefinitionLifecycleSnapshot | null>;
    deleteMany(args: { where: JsonRecord }): Promise<{ count: number }>;
  };
  loopVersion: {
    create(args: { data: JsonRecord }): Promise<unknown>;
    findUnique(args: { where: { id: string }; select: JsonRecord }): Promise<LoopVersionLimitSnapshot | null>;
    count(args: { where: JsonRecord }): Promise<number>;
  };
  projectLoopBinding: {
    create(args: { data: JsonRecord }): Promise<unknown>;
    updateMany(args: { where: JsonRecord; data: JsonRecord }): Promise<{ count: number }>;
    findMany?(args: unknown): Promise<unknown>;
    count(args: { where: JsonRecord }): Promise<number>;
    findUnique?(args: unknown): Promise<{
      id: string;
      projectId: string;
      status: string;
      version: number;
      bindingRole: string | null;
      loopDefinition: { scope: string };
    } | null>;
  };
  loopRun: {
    count(args: { where: JsonRecord }): Promise<number>;
  };
  triggerReceipt: {
    count(args: { where: JsonRecord }): Promise<number>;
  };
  automationGrant: {
    findMany(args: unknown): Promise<Array<{
      id: string;
      projectId: string;
      status: string;
      scope: unknown;
      expiresAt: Date | null;
      revokedAt: Date | null;
    }>>;
    count(args: { where: JsonRecord }): Promise<number>;
  };
  project: {
    findUnique(args: unknown): Promise<{
      ownerType: string;
      ownerUserId: string | null;
      companyId: string | null;
      version?: number;
      workerRepositoryUrl?: string | null;
      workerBranchPolicy?: unknown;
      repositoryConfiguration?: unknown;
    } | null>;
    updateMany(args: { where: JsonRecord; data: JsonRecord }): Promise<{ count: number }>;
  };
  workerPool: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
  workerModelSite: {
    findMany(args: unknown): Promise<Array<{ id: string }>>;
  };
}

export interface LoopDefinitionDb extends OrchestrationCommandDb<LoopDefinitionTx> {
  loopDefinition?: {
    findUnique(args: unknown): Promise<unknown>;
    findMany?(args: unknown): Promise<unknown>;
  };
  projectLoopBinding?: { findMany(args: unknown): Promise<unknown> };
}

export interface SaveLoopDraftInput {
  command: OrchestrationCommand<unknown>;
  loopDefinitionId: string;
  spaceId?: string;
  name: string;
  description?: string | null;
  ownerUserId?: string;
  scope?: "task" | "project";
  origin?: "space" | "platform";
  graph: unknown;
  expectedDraftRevision?: number;
}

export interface PublishLoopVersionInput {
  command: OrchestrationCommand<unknown>;
  loopDefinitionId: string;
  versionId: string;
  nextVersion: number;
  expectedDraftRevision: number;
  graph: unknown;
}

export interface ActivateLoopVersionInput {
  command: OrchestrationCommand<unknown>;
  loopDefinitionId: string;
  activeVersionId: string;
  expectedDraftRevision: number;
}

export interface UpsertProjectLoopBindingInput {
  command: OrchestrationCommand<unknown>;
  bindingId: string;
  projectId: string;
  loopDefinitionId: string;
  activeVersionId: string;
  status: "enabled" | "disabled";
  triggerPolicy: unknown;
  parameterOverrides: JsonRecord;
  notificationPolicy: unknown;
  automationGrantIds: unknown;
  allowedAgentProfileIds?: unknown;
  allowedProviders?: unknown;
  workerStageConfigurations?: unknown;
  bindingRole?: unknown;
  createdByUserId: string;
  expectedVersion?: number;
}

export interface UpsertProjectWorkerExecutionResourceInput {
  command: OrchestrationCommand<unknown>;
  projectId: string;
  workerPoolId: unknown;
  workerRepositoryUrl: unknown;
  workerBranchPolicy: unknown;
  workerImageRepository?: unknown;
  workerImageTag?: unknown;
  workerImageDigest?: unknown;
  workerImageResolvedAt?: unknown;
  expectedVersion: number;
}

export interface DisableProjectTaskLoopBindingInput {
  command: OrchestrationCommand<unknown>;
  bindingId: string;
  projectId: string;
  expectedVersion: number;
}

export interface LoopDefinitionLifecycleInput {
  command: OrchestrationCommand<unknown>;
  loopDefinitionId: string;
  expectedRevision: number;
}

interface LoopVersionLimitSnapshot {
  loopDefinitionId: string;
  status: string;
  maxStages: number;
  maxRepeatCount: number;
  platformMaxTransitions: number;
  graph: unknown;
}

interface LoopDefinitionPublicationSnapshot {
  draftRevision: number;
  latestPublishedVersion: { versionNumber: number } | null;
}

interface LoopDefinitionLifecycleSnapshot {
  id: string;
  origin: string;
  status: string;
  draftRevision: number;
}

interface LoopDefinitionReferenceSummary {
  versions: number;
  bindings: number;
  runs: number;
  receipts: number;
  grants: number;
}

interface WorkerStageConfiguration {
  workerStageConfigurations: Record<string, {
    siteId: string;
    model: string;
    reasoningEffort: "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
    requireGitDelivery?: boolean;
  }>;
}

interface ProjectWorkerExecutionResource {
  workerPoolId: string;
  workerRepositoryUrl: string;
  workerBranchPolicy: { allowedBranches: string[] };
  workerImageRepository?: string;
  workerImageTag?: string;
  workerImageDigest?: string;
  workerImageResolvedAt?: Date;
}

export type LoopDefinitionReferences = LoopDefinitionReferenceSummary;

interface LoopDefinitionReferenceDb {
  loopVersion: { count(args: { where: JsonRecord }): Promise<number> };
  projectLoopBinding: { count(args: { where: JsonRecord }): Promise<number> };
  loopRun: { count(args: { where: JsonRecord }): Promise<number> };
  triggerReceipt: { count(args: { where: JsonRecord }): Promise<number> };
  automationGrant: { count(args: { where: JsonRecord }): Promise<number> };
}

const DEFAULTS = {
  db: prisma as unknown as LoopDefinitionDb,
};

export async function upsertProjectWorkerExecutionResource(
  input: UpsertProjectWorkerExecutionResourceInput,
  dependencies: { db: LoopDefinitionDb } = DEFAULTS,
): Promise<{ projectId: string; version: number }> {
  const expectedVersion = positiveInteger(input.expectedVersion, "expectedVersion");
  const configuration = parseProjectWorkerExecutionResource(input);
  const result = { projectId: input.projectId, version: expectedVersion + 1 };
  return executeIdempotentCommand({
    command: input.command,
    aggregate: { type: "project", id: input.projectId },
    db: dependencies.db,
    apply: async (tx) => {
      await assertProjectWorkerResourceOwnership({ tx, configuration, projectId: input.projectId });
      return {
        result,
        events: [],
        persist: async (currentTx) => (await currentTx.project.updateMany({
          where: { id: input.projectId, version: expectedVersion },
          data: { ...configuration, version: result.version },
        })).count,
      };
    },
  });
}

export async function saveLoopDraft(
  input: SaveLoopDraftInput,
  dependencies: { db: LoopDefinitionDb } = DEFAULTS,
): Promise<{ loopDefinitionId: string; draftRevision: number }> {
  const graph = parseJsonLoopGraph(input.graph);
  const name = requiredText(input.name, "Loop definition name is required");

  if (input.expectedDraftRevision === undefined) {
    if (!input.spaceId || !input.ownerUserId) {
      throw validationError("Creating a loop draft requires spaceId and ownerUserId");
    }
    const scope = loopDefinitionScopeSchema.optional().default("task").parse(input.scope);
    const origin = loopDefinitionOriginSchema.optional().default("space").parse(input.origin);

    const result = { loopDefinitionId: input.loopDefinitionId, draftRevision: 1 };
    return executeIdempotentCommand({
      command: input.command,
      aggregate: { type: "loop_definition", id: input.loopDefinitionId },
      db: dependencies.db,
      apply: async () => ({
        result,
        events: [loopDefinitionEvent({
          command: input.command,
          definitionId: input.loopDefinitionId,
          revision: result.draftRevision,
          eventType: "loop.definition.draft_saved",
          payload: { draftRevision: result.draftRevision },
        })],
        persist: async (tx) => {
          await tx.loopDefinition.create({
            data: {
              id: input.loopDefinitionId,
              spaceId: input.spaceId,
              name,
              ...(input.description === undefined ? {} : { description: input.description }),
              ownerUserId: input.ownerUserId,
              scope,
              origin,
              draftGraph: graph,
              draftRevision: result.draftRevision,
              status: "draft",
            },
          });
          return 1;
        },
      }),
    });
  }

  const expectedDraftRevision = positiveInteger(input.expectedDraftRevision, "expectedDraftRevision");
  const result = { loopDefinitionId: input.loopDefinitionId, draftRevision: expectedDraftRevision + 1 };
  return executeIdempotentCommand({
    command: input.command,
    aggregate: { type: "loop_definition", id: input.loopDefinitionId },
    db: dependencies.db,
    apply: async () => ({
      result,
      events: [loopDefinitionEvent({
        command: input.command,
        definitionId: input.loopDefinitionId,
        revision: result.draftRevision,
        eventType: "loop.definition.draft_saved",
        payload: { draftRevision: result.draftRevision },
      })],
      persist: async (tx) => {
        const updated = await tx.loopDefinition.updateMany({
          where: { id: input.loopDefinitionId, draftRevision: expectedDraftRevision },
          data: {
            name,
            ...(input.description === undefined ? {} : { description: input.description }),
            draftGraph: graph,
            draftRevision: result.draftRevision,
          },
        });
        return updated.count;
      },
    }),
  });
}

export async function publishLoopVersion(
  input: PublishLoopVersionInput,
  dependencies: { db: LoopDefinitionDb } = DEFAULTS,
): Promise<{
  loopDefinitionId: string;
  versionId: string;
  versionNumber: number;
  checksum: string;
  maxTransitions: number;
}> {
  const graph = parseJsonLoopGraph(input.graph);
  const validation = validateLoopGraph(graph);
  if (!validation.ok) throw validationError(validation.errors.join("; "));
  assertPublishedCaps(graph, validation.maxTransitions);

  const nextVersion = positiveInteger(input.nextVersion, "nextVersion");
  const expectedDraftRevision = positiveInteger(input.expectedDraftRevision, "expectedDraftRevision");
  const checksum = checksumGraph(graph);
  const result = {
    loopDefinitionId: input.loopDefinitionId,
    versionId: input.versionId,
    versionNumber: nextVersion,
    checksum,
    maxTransitions: validation.maxTransitions,
  };

  return executeIdempotentCommand({
    command: input.command,
    aggregate: { type: "loop_definition", id: input.loopDefinitionId },
    db: dependencies.db,
    apply: async (tx) => {
      const current = await tx.loopDefinition.findUnique({
        where: { id: input.loopDefinitionId },
        select: {
          draftRevision: true,
          latestPublishedVersion: { select: { versionNumber: true } },
        },
      });
      if (!current || current.draftRevision !== expectedDraftRevision) {
        throw new OrchestrationPersistenceError(
          "version_conflict",
          `Loop definition changed while processing command: ${input.command.commandId}`,
        );
      }
      const expectedVersionNumber = (current.latestPublishedVersion?.versionNumber ?? 0) + 1;
      if (nextVersion !== expectedVersionNumber) {
        throw validationError(`nextVersion must be ${expectedVersionNumber}`);
      }

      return {
        result,
        events: [loopDefinitionEvent({
          command: input.command,
          definitionId: input.loopDefinitionId,
          revision: expectedDraftRevision + 1,
          eventType: "loop.version.published",
          payload: {
            versionId: input.versionId,
            versionNumber: nextVersion,
            checksum,
            maxTransitions: validation.maxTransitions,
          },
        })],
        persist: async (currentTx) => {
          await currentTx.loopVersion.create({
            data: {
              id: input.versionId,
              loopDefinitionId: input.loopDefinitionId,
              versionNumber: nextVersion,
              graphSchemaVersion: graph.schemaVersion,
              graph,
              maxStages: graph.limits.maxStages,
              maxRepeatCount: graph.limits.maxRepeatCount,
              platformMaxTransitions: validation.maxTransitions,
              checksum,
              publishedByUserId: input.command.actor.id,
              publishedAt: input.command.issuedAt,
              status: "published",
            },
          });
          const updated = await currentTx.loopDefinition.updateMany({
            where: { id: input.loopDefinitionId, draftRevision: expectedDraftRevision },
            data: {
              latestPublishedVersionId: input.versionId,
              status: "published",
              draftRevision: expectedDraftRevision + 1,
            },
          });
          return updated.count;
        },
      };
    },
  });
}

export async function activateLoopVersion(
  input: ActivateLoopVersionInput,
  dependencies: { db: LoopDefinitionDb } = DEFAULTS,
): Promise<{ loopDefinitionId: string; activeVersionId: string; draftRevision: number }> {
  const expectedDraftRevision = positiveInteger(input.expectedDraftRevision, "expectedDraftRevision");
  const result = {
    loopDefinitionId: input.loopDefinitionId,
    activeVersionId: input.activeVersionId,
    draftRevision: expectedDraftRevision + 1,
  };
  return executeIdempotentCommand({
    command: input.command,
    aggregate: { type: "loop_definition", id: input.loopDefinitionId },
    db: dependencies.db,
    apply: async (tx) => {
      const version = await tx.loopVersion.findUnique({
        where: { id: input.activeVersionId },
        select: { loopDefinitionId: true, status: true },
      });
      if (!version || version.loopDefinitionId !== input.loopDefinitionId || version.status !== "published") {
        throw validationError("Loop version is not a published version of this definition");
      }
      return {
        result,
        events: [loopDefinitionEvent({
          command: input.command,
          definitionId: input.loopDefinitionId,
          revision: result.draftRevision,
          eventType: "loop.version.activated",
          payload: { activeVersionId: input.activeVersionId },
        })],
        persist: async (currentTx) => (await currentTx.loopDefinition.updateMany({
          where: { id: input.loopDefinitionId, draftRevision: expectedDraftRevision },
          data: {
            latestPublishedVersionId: input.activeVersionId,
            draftRevision: result.draftRevision,
          },
        })).count,
      };
    },
  });
}

export async function upsertProjectLoopBinding(
  input: UpsertProjectLoopBindingInput,
  dependencies: { db: LoopDefinitionDb } = DEFAULTS,
): Promise<{
  id: string;
  projectId: string;
  loopDefinitionId: string;
  activeVersionId: string;
  status: "enabled" | "disabled";
  version: number;
}> {
  const nextVersion = input.expectedVersion === undefined
    ? 1
    : positiveInteger(input.expectedVersion, "expectedVersion") + 1;
  const result = {
    id: input.bindingId,
    projectId: input.projectId,
    loopDefinitionId: input.loopDefinitionId,
    activeVersionId: input.activeVersionId,
    status: input.status,
    version: nextVersion,
  };
  const automationGrantIds = parseAutomationGrantIds(input.automationGrantIds);
  const allowedAgentProfileIds = parseBindingScopeIds(
    input.allowedAgentProfileIds ?? [],
    "Agent Profile",
    32,
  );
  const allowedProviders = parseBindingScopeIds(input.allowedProviders ?? [], "Provider", 16);
  const bindingRole = input.bindingRole === undefined
    ? undefined
    : projectLoopBindingRoleSchema.parse(input.bindingRole);
  const workerStageConfiguration = parseWorkerStageConfiguration(input.workerStageConfigurations);

  return executeIdempotentCommand({
    command: input.command,
    aggregate: { type: "loop_binding", id: input.bindingId },
    db: dependencies.db,
    apply: async (tx) => {
      const activeVersion = await tx.loopVersion.findUnique({
        where: { id: input.activeVersionId },
        select: {
          loopDefinitionId: true,
          status: true,
          maxStages: true,
          maxRepeatCount: true,
          platformMaxTransitions: true,
          graph: true,
        },
      });
      assertPublishedBindingTarget(input, activeVersion);
      assertWorkerExecutionStages(workerStageConfiguration, activeVersion.graph);
      await assertWorkerStageConfigurationOwnership({
        tx,
        configuration: workerStageConfiguration,
        projectId: input.projectId,
      });
      await assertBindingAutomationGrants({
        tx,
        grantIds: automationGrantIds,
        bindingId: input.bindingId,
        projectId: input.projectId,
        now: input.command.issuedAt,
      });

      return {
        result,
        events: [loopBindingEvent({ command: input.command, input, version: result.version })],
        persist: async (currentTx) => {
          const data = {
            projectId: input.projectId,
            loopDefinitionId: input.loopDefinitionId,
            activeVersionId: input.activeVersionId,
            status: input.status,
            triggerPolicy: input.triggerPolicy,
            parameterOverrides: input.parameterOverrides,
            notificationPolicy: input.notificationPolicy,
            automationGrantIds,
            allowedAgentProfileIds,
            allowedProviders,
            ...(workerStageConfiguration === undefined ? {} : workerStageConfiguration),
            ...(bindingRole === undefined ? {} : { bindingRole }),
            ...(input.expectedVersion === undefined ? { createdByUserId: input.createdByUserId } : {}),
            version: result.version,
          };
          if (input.expectedVersion === undefined) {
            await currentTx.projectLoopBinding.create({ data: { id: input.bindingId, ...data } });
            return 1;
          }
          const updated = await currentTx.projectLoopBinding.updateMany({
            where: { id: input.bindingId, version: input.expectedVersion },
            data,
          });
          return updated.count;
        },
      };
    },
  });
}

function parseWorkerStageConfiguration(value: unknown): WorkerStageConfiguration | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isJsonRecord(value)) throw validationError("Worker stage configuration is invalid");
  return { workerStageConfigurations: parseWorkerStageConfigurations(value) };
}

function parseProjectWorkerExecutionResource(input: Pick<UpsertProjectWorkerExecutionResourceInput,
  "workerPoolId" | "workerRepositoryUrl" | "workerBranchPolicy" | "workerImageRepository" | "workerImageTag" | "workerImageDigest" | "workerImageResolvedAt"
>): ProjectWorkerExecutionResource {
  if (typeof input.workerPoolId !== "string" || !/^[a-f0-9]{32}$/u.test(input.workerPoolId)) {
    throw validationError("Worker Pool is invalid");
  }
  if (typeof input.workerRepositoryUrl !== "string" || input.workerRepositoryUrl.length > 1024) {
    throw validationError("Worker repository URL is invalid");
  }
  try {
    const url = new URL(input.workerRepositoryUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
  } catch {
    throw validationError("Worker repository URL is invalid");
  }
  if (!isJsonRecord(input.workerBranchPolicy)) throw validationError("Worker branch policy is invalid");
  const image = parseWorkerImage(input);
  return {
    workerPoolId: input.workerPoolId,
    workerRepositoryUrl: input.workerRepositoryUrl,
    workerBranchPolicy: { allowedBranches: parseAllowedBranches(input.workerBranchPolicy) },
    ...(image ?? {}),
  };
}

function parseWorkerImage(input: Pick<UpsertProjectWorkerExecutionResourceInput, "workerImageRepository" | "workerImageTag" | "workerImageDigest" | "workerImageResolvedAt">): Pick<ProjectWorkerExecutionResource, "workerImageRepository" | "workerImageTag" | "workerImageDigest" | "workerImageResolvedAt"> | null {
  const hasImage = input.workerImageRepository !== undefined || input.workerImageTag !== undefined || input.workerImageDigest !== undefined;
  if (!hasImage) return null;
  if (typeof input.workerImageRepository !== "string" || input.workerImageRepository.trim().length < 1 || input.workerImageRepository.length > 1024) throw validationError("Worker image repository is invalid");
  if (typeof input.workerImageTag !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/u.test(input.workerImageTag) || /^(latest|stable|dev)$/iu.test(input.workerImageTag)) throw validationError("Worker image tag is invalid");
  if (typeof input.workerImageDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(input.workerImageDigest)) throw validationError("Worker image digest is invalid");
  return {
    workerImageRepository: input.workerImageRepository.trim(),
    workerImageTag: input.workerImageTag.trim(),
    workerImageDigest: input.workerImageDigest,
    ...(input.workerImageResolvedAt instanceof Date ? { workerImageResolvedAt: input.workerImageResolvedAt } : {}),
  };
}

function parseAllowedBranches(value: JsonRecord): string[] {
  if (Object.keys(value).length !== 1 || !Array.isArray(value.allowedBranches)) {
    throw validationError("Worker branch policy is invalid");
  }
  if (value.allowedBranches.length === 0 || value.allowedBranches.length > 64) {
    throw validationError("Worker branch policy is invalid");
  }
  const branches = value.allowedBranches.map((branch) => {
    const normalized = requiredTextValue(branch, "Worker branch", 191);
    if (!workerBranchPatternSchema.safeParse(normalized).success) throw validationError("Worker branch policy is invalid");
    return normalized;
  });
  if (new Set(branches).size !== branches.length) throw validationError("Worker branch policy is invalid");
  return branches;
}

function parseWorkerStageConfigurations(value: JsonRecord): WorkerStageConfiguration["workerStageConfigurations"] {
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 96) throw validationError("Worker stage configuration is invalid");
  return Object.fromEntries(entries.map(([nodeKey, configuration]) => {
    const parsedNodeKey = requiredTextValue(nodeKey, "Worker stage", 96);
    if (!isJsonRecord(configuration) || ![3, 4].includes(Object.keys(configuration).length)) {
      throw validationError("Worker stage configuration is invalid");
    }
    const siteId = configuration.siteId;
    if (typeof siteId !== "string" || !/^[a-f0-9]{32}$/u.test(siteId)) {
      throw validationError("Worker model site is invalid");
    }
    const reasoningEffort = configuration.reasoningEffort;
    if (reasoningEffort !== "low" && reasoningEffort !== "medium" && reasoningEffort !== "high"
      && reasoningEffort !== "xhigh" && reasoningEffort !== "max" && reasoningEffort !== "ultra") {
      throw validationError("Worker reasoning effort is invalid");
    }
    return [parsedNodeKey, {
      siteId,
      model: requiredTextValue(configuration.model, "Worker model", 191),
      reasoningEffort,
      ...(typeof configuration.requireGitDelivery === "boolean" ? { requireGitDelivery: configuration.requireGitDelivery } : {}),
    }];
  }));
}

async function assertWorkerStageConfigurationOwnership(input: {
  tx: Pick<LoopDefinitionTx, "project" | "workerPool" | "workerModelSite">;
  configuration: WorkerStageConfiguration | undefined;
  projectId: string;
}): Promise<void> {
  if (!input.configuration) return;
  const project = await input.tx.project.findUnique({
    where: { id: input.projectId },
    select: {
      ownerType: true,
      ownerUserId: true,
      companyId: true,
    },
  });
  if (!project) throw validationError("Project is unavailable");
  const scope = projectResourceScope(project);
  const siteIds = [...new Set(Object.values(input.configuration.workerStageConfigurations).map(({ siteId }) => siteId))];
  const sites = await input.tx.workerModelSite.findMany({
    where: {
      id: { in: siteIds },
      ...workerResourceScopeWhere(scope),
      provider: "codex",
      status: "active",
    },
    select: { id: true },
  });
  if (sites.length !== siteIds.length || new Set(sites.map(({ id }) => id)).size !== siteIds.length) {
    throw validationError("Worker model site is unavailable");
  }
}

async function assertProjectWorkerResourceOwnership(input: {
  tx: Pick<LoopDefinitionTx, "project" | "workerPool">;
  configuration: ProjectWorkerExecutionResource;
  projectId: string;
}): Promise<void> {
  const project = await input.tx.project.findUnique({
    where: { id: input.projectId },
    select: {
      ownerType: true,
      ownerUserId: true,
      companyId: true,
      workerRepositoryUrl: true,
      workerBranchPolicy: true,
      repositoryConfiguration: true,
    },
  });
  if (!project) throw validationError("Project is unavailable");
  if (project.repositoryConfiguration !== null && project.repositoryConfiguration !== undefined) {
    let currentBranches: string[] = [];
    try {
      currentBranches = parseAllowedBranches(isJsonRecord(project.workerBranchPolicy) ? project.workerBranchPolicy : {});
    } catch {
      throw Object.assign(new Error("项目仓库配置由项目仓库向导托管"), { code: "repository_configuration_managed" });
    }
    const requestedBranches = input.configuration.workerBranchPolicy.allowedBranches;
    const currentSorted = [...currentBranches].sort();
    const requestedSorted = [...requestedBranches].sort();
    if (
      project.workerRepositoryUrl !== input.configuration.workerRepositoryUrl
      || currentSorted.length !== requestedSorted.length
      || currentSorted.some((branch, index) => branch !== requestedSorted[index])
    ) {
      throw Object.assign(new Error("项目仓库地址和分支策略由项目仓库向导托管"), { code: "repository_configuration_managed" });
    }
  }
  const pool = await input.tx.workerPool.findFirst({
    where: {
      id: input.configuration.workerPoolId,
      ...workerResourceScopeWhere(projectResourceScope(project)),
      status: "active",
      revokedAt: null,
    },
    select: { id: true },
  });
  if (!pool) throw validationError("Worker Pool is unavailable");
}

function projectResourceScope(project: {
  ownerType: string;
  ownerUserId: string | null;
  companyId: string | null;
}): WorkerResourceScope {
  if (project.ownerType !== "personal" && project.ownerType !== "company") {
    throw validationError("Project Worker resource scope is invalid");
  }
  try {
    return normalizeWorkerResourceScope({
      ownerType: project.ownerType,
      ownerUserId: project.ownerUserId,
      companyId: project.companyId,
    });
  } catch {
    throw validationError("Project Worker resource scope is invalid");
  }
}

function assertWorkerExecutionStages(
  configuration: WorkerStageConfiguration | undefined,
  graphValue: unknown,
): void {
  if (!configuration) return;
  const graph = parsePublishedLoopGraph(graphValue);
  const expectedNodeKeys = graph.nodes
    .filter((node) => node.type === "agent_action")
    .map((node) => node.key)
    .sort();
  const configuredNodeKeys = Object.keys(configuration.workerStageConfigurations).sort();
  if (
    expectedNodeKeys.length !== configuredNodeKeys.length
    || expectedNodeKeys.some((nodeKey, index) => nodeKey !== configuredNodeKeys[index])
  ) {
    throw validationError("Worker stage configuration must cover every agent action");
  }
}

function requiredTextValue(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw validationError(`${field} is invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw validationError(`${field} is invalid`);
  return normalized;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const ACTIVE_TASK_LOOP_RUN_STATUSES = [
  "pending",
  "running",
  "waiting",
  "claimed",
  "starting",
  "waiting_approval",
] as const;

export async function disableProjectTaskLoopBinding(
  input: DisableProjectTaskLoopBindingInput,
  dependencies: { db: LoopDefinitionDb } = DEFAULTS,
): Promise<{ id: string; status: "disabled"; version: number }> {
  const expectedVersion = positiveInteger(input.expectedVersion, "expectedVersion");
  const result = { id: input.bindingId, status: "disabled" as const, version: expectedVersion + 1 };

  return executeIdempotentCommand({
    command: input.command,
    aggregate: { type: "loop_binding", id: input.bindingId },
    db: dependencies.db,
    transactionOptions: { isolationLevel: "Serializable" },
    apply: async (tx) => {
      if (!tx.projectLoopBinding.findUnique) {
        throw new Error("Loop binding disable requires a projectLoopBinding repository");
      }
      const binding = await tx.projectLoopBinding.findUnique({
        where: { id: input.bindingId },
        select: {
          id: true,
          projectId: true,
          status: true,
          version: true,
          bindingRole: true,
          loopDefinition: { select: { scope: true } },
        },
      });
      if (
        !binding
        || binding.projectId !== input.projectId
        || binding.loopDefinition.scope !== "task"
        || binding.bindingRole === "task_development"
        || binding.bindingRole === "milestone_release"
      ) {
        throw validationError("Only task-scoped Loop bindings can be disabled through this command");
      }
      if (binding.version !== expectedVersion) {
        throw new OrchestrationPersistenceError(
          "version_conflict",
          `Loop binding changed while processing command: ${input.command.commandId}`,
        );
      }

      const activeRunCount = await tx.loopRun.count({
        where: {
          projectId: input.projectId,
          status: { in: ACTIVE_TASK_LOOP_RUN_STATUSES },
          OR: [
            { bindingId: input.bindingId },
            { childLoopRuns: { some: { bindingId: input.bindingId } } },
          ],
        },
      });
      if (activeRunCount !== 0) {
        throw new OrchestrationPersistenceError(
          "version_conflict",
          "Task Loop binding has active Runs",
        );
      }

      return {
        result,
        events: [loopBindingDisabledEvent({ command: input.command, input, version: result.version })],
        persist: async (currentTx) => {
          const updated = await currentTx.projectLoopBinding.updateMany({
            where: {
              id: input.bindingId,
              projectId: input.projectId,
              status: "enabled",
              version: expectedVersion,
            },
            data: { status: "disabled", version: result.version },
          });
          return updated.count;
        },
      };
    },
  });
}

export async function archiveLoopDefinition(
  input: LoopDefinitionLifecycleInput,
  dependencies: { db: LoopDefinitionDb } = DEFAULTS,
): Promise<{ id: string; status: "archived"; draftRevision: number }> {
  const expectedRevision = positiveInteger(input.expectedRevision, "expectedRevision");
  const result = {
    id: input.loopDefinitionId,
    status: "archived" as const,
    draftRevision: expectedRevision + 1,
  };
  return executeIdempotentCommand({
    command: input.command,
    aggregate: { type: "loop_definition", id: input.loopDefinitionId },
    db: dependencies.db,
    apply: async (tx) => {
      const definition = await readLifecycleDefinition(tx, input.loopDefinitionId);
      assertSpaceLifecycleDefinition(definition);
      if (definition.draftRevision !== expectedRevision) throw lifecycleVersionConflict(input.command.commandId);
      return {
        result,
        events: [loopDefinitionLifecycleEvent({
          command: input.command,
          definitionId: input.loopDefinitionId,
          revision: result.draftRevision,
          eventType: "loop.definition.archived",
          payload: { status: result.status },
        })],
        persist: async (currentTx) => {
          const updated = await currentTx.loopDefinition.updateMany({
            where: { id: input.loopDefinitionId, origin: "space", draftRevision: expectedRevision },
            data: { status: "archived", draftRevision: result.draftRevision },
          });
          return updated.count;
        },
      };
    },
  });
}

export async function deleteLoopDefinition(
  input: LoopDefinitionLifecycleInput,
  dependencies: { db: LoopDefinitionDb } = DEFAULTS,
): Promise<{ id: string; deleted: true }> {
  const expectedRevision = positiveInteger(input.expectedRevision, "expectedRevision");
  const result = { id: input.loopDefinitionId, deleted: true as const };
  return executeIdempotentCommand({
    command: input.command,
    aggregate: { type: "loop_definition", id: input.loopDefinitionId },
    db: dependencies.db,
    transactionOptions: { isolationLevel: "Serializable" },
    apply: async (tx) => {
      const definition = await readLifecycleDefinition(tx, input.loopDefinitionId);
      assertSpaceLifecycleDefinition(definition);
      if (definition.status !== "draft") throw validationError("Only draft Loop definitions can be deleted");
      if (definition.draftRevision !== expectedRevision) throw lifecycleVersionConflict(input.command.commandId);
      const references = await countLoopDefinitionReferences(tx, input.loopDefinitionId);
      if (Object.values(references).some((count) => count !== 0)) {
        throw new OrchestrationPersistenceError(
          "version_conflict",
          "Loop definition has historical references and must be archived",
        );
      }
      return {
        result,
        events: [loopDefinitionLifecycleEvent({
          command: input.command,
          definitionId: input.loopDefinitionId,
          revision: expectedRevision + 1,
          eventType: "loop.definition.deleted",
          payload: { deleted: true },
        })],
        persist: async (currentTx) => {
          const deleted = await currentTx.loopDefinition.deleteMany({
            where: { id: input.loopDefinitionId, origin: "space", draftRevision: expectedRevision },
          });
          return deleted.count;
        },
      };
    },
  });
}

export async function readLoopDefinitionReferences(
  loopDefinitionId: string,
  db: LoopDefinitionReferenceDb = prisma as unknown as LoopDefinitionReferenceDb,
): Promise<LoopDefinitionReferences> {
  return countLoopDefinitionReferences(db, loopDefinitionId);
}

export async function readLoopDefinition(
  input: { loopDefinitionId: string; db?: Pick<LoopDefinitionDb, "loopDefinition"> },
): Promise<unknown> {
  const db = input.db ?? (prisma as unknown as Pick<LoopDefinitionDb, "loopDefinition">);
  if (!db.loopDefinition) throw new Error("Loop definition reads require a loopDefinition repository");
  return db.loopDefinition.findUnique({
    where: { id: input.loopDefinitionId },
    include: { versions: { orderBy: { versionNumber: "desc" } }, latestPublishedVersion: true },
  });
}

export async function listProjectLoopBindings(
  projectId: string,
  db: Pick<LoopDefinitionDb, "projectLoopBinding"> = prisma as unknown as Pick<LoopDefinitionDb, "projectLoopBinding">,
): Promise<unknown> {
  if (!db.projectLoopBinding) throw new Error("Loop binding reads require a projectLoopBinding repository");
  return db.projectLoopBinding.findMany({
    where: { projectId },
    include: { activeVersion: true, loopDefinition: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function listPublishedLoopDefinitionsForSpace(
  spaceId: string,
  db: Pick<LoopDefinitionDb, "loopDefinition"> = prisma as unknown as Pick<LoopDefinitionDb, "loopDefinition">,
): Promise<unknown[]> {
  if (!db.loopDefinition?.findMany) throw new Error("Published Loop catalog reads require a loopDefinition repository");
  const rows = await db.loopDefinition.findMany({
    where: {
      latestPublishedVersionId: { not: null },
      status: { not: "archived" },
      OR: [
        { spaceId },
        { origin: "platform" },
      ],
    },
    include: {
      versions: {
        where: { status: "published" },
        orderBy: [{ versionNumber: "asc" }, { id: "asc" }],
      },
    },
    orderBy: [{ id: "asc" }],
  });
  return Array.isArray(rows) ? rows : [];
}

export function checksumGraph(graph: LoopAuthoringGraph): string {
  assertJsonValue(graph);
  return createHash("sha256").update(canonicalJson(graph)).digest("hex");
}

function parseJsonLoopGraph(input: unknown): LoopAuthoringGraph {
  assertJsonValue(input);
  const graph = loopAuthoringGraphSchema.parse(input);
  assertJsonValue(graph);
  return graph;
}

function loopDefinitionEvent(input: {
  command: OrchestrationCommand<unknown>;
  definitionId: string;
  revision: number;
  eventType: string;
  payload: JsonRecord;
}) {
  return createEventEnvelope({
    id: boundedPersistenceId("event", [input.eventType, input.command.commandId]),
    eventType: input.eventType,
    aggregate: { type: "loop_definition", id: input.definitionId, version: input.revision },
    sequence: input.revision,
    correlationId: input.command.correlationId,
    commandId: input.command.commandId,
    actor: input.command.actor,
    occurredAt: input.command.issuedAt,
    payload: input.payload,
  });
}

function loopDefinitionLifecycleEvent(input: {
  command: OrchestrationCommand<unknown>;
  definitionId: string;
  revision: number;
  eventType: "loop.definition.archived" | "loop.definition.deleted";
  payload: JsonRecord;
}) {
  return createEventEnvelope({
    id: boundedPersistenceId("event", [input.eventType, input.command.commandId]),
    eventType: input.eventType,
    aggregate: { type: "loop_definition", id: input.definitionId, version: input.revision },
    sequence: input.revision,
    correlationId: input.command.correlationId,
    commandId: input.command.commandId,
    actor: input.command.actor,
    occurredAt: input.command.issuedAt,
    payload: input.payload,
  });
}

function loopBindingEvent(input: {
  command: OrchestrationCommand<unknown>;
  input: UpsertProjectLoopBindingInput;
  version: number;
}) {
  return createEventEnvelope({
    id: boundedPersistenceId("event", ["loop.binding.upserted", input.command.commandId]),
    eventType: "loop.binding.upserted",
    aggregate: { type: "loop_binding", id: input.input.bindingId, version: input.version },
    sequence: input.version,
    correlationId: input.command.correlationId,
    commandId: input.command.commandId,
    actor: input.command.actor,
    occurredAt: input.command.issuedAt,
    payload: {
      projectId: input.input.projectId,
      loopDefinitionId: input.input.loopDefinitionId,
      activeVersionId: input.input.activeVersionId,
      status: input.input.status,
      ...(input.input.bindingRole === undefined ? {} : { bindingRole: input.input.bindingRole }),
    },
  });
}

function loopBindingDisabledEvent(input: {
  command: OrchestrationCommand<unknown>;
  input: DisableProjectTaskLoopBindingInput;
  version: number;
}) {
  return createEventEnvelope({
    id: boundedPersistenceId("event", ["loop.binding.disabled", input.command.commandId]),
    eventType: "loop.binding.disabled",
    aggregate: { type: "loop_binding", id: input.input.bindingId, version: input.version },
    sequence: input.version,
    correlationId: input.command.correlationId,
    commandId: input.command.commandId,
    actor: input.command.actor,
    occurredAt: input.command.issuedAt,
    payload: { projectId: input.input.projectId },
  });
}

async function readLifecycleDefinition(
  tx: LoopDefinitionTx,
  loopDefinitionId: string,
): Promise<LoopDefinitionLifecycleSnapshot> {
  const definition = await tx.loopDefinition.findFirst({
    where: { id: loopDefinitionId },
    select: { id: true, origin: true, status: true, draftRevision: true },
  });
  if (!definition) throw validationError("Loop definition not found");
  return definition;
}

function assertSpaceLifecycleDefinition(definition: LoopDefinitionLifecycleSnapshot): void {
  if (definition.origin !== "space") throw validationError("Platform Loop definitions are read-only");
}

function lifecycleVersionConflict(commandId: string): OrchestrationPersistenceError {
  return new OrchestrationPersistenceError(
    "version_conflict",
    `Loop definition changed while processing command: ${commandId}`,
  );
}

async function countLoopDefinitionReferences(
  tx: LoopDefinitionReferenceDb,
  loopDefinitionId: string,
): Promise<LoopDefinitionReferenceSummary> {
  const [versions, bindings, runs, receipts, grants] = await Promise.all([
    tx.loopVersion.count({ where: { loopDefinitionId } }),
    tx.projectLoopBinding.count({ where: { loopDefinitionId } }),
    tx.loopRun.count({
      where: {
        OR: [
          { loopVersion: { loopDefinitionId } },
          { binding: { loopDefinitionId } },
        ],
      },
    }),
    tx.triggerReceipt.count({ where: { binding: { loopDefinitionId } } }),
    tx.automationGrant.count({ where: { binding: { loopDefinitionId } } }),
  ]);
  return { versions, bindings, runs, receipts, grants };
}

function assertPublishedCaps(graph: LoopAuthoringGraph, maxTransitions: number): void {
  if (
    graph.limits.maxStages > LOOP_PLATFORM_CAPS.maxStages
    || graph.limits.maxRepeatCount > LOOP_PLATFORM_CAPS.maxRepeatCount
    || maxTransitions > LOOP_PLATFORM_CAPS.maxTransitions
  ) {
    throw validationError("Loop graph exceeds platform publication limits");
  }
}

function assertPublishedBindingTarget(
  input: UpsertProjectLoopBindingInput,
  version: LoopVersionLimitSnapshot | null,
): asserts version is LoopVersionLimitSnapshot {
  if (!version || version.status !== "published") {
    throw validationError("Loop binding requires a published loop version");
  }
  if (version.loopDefinitionId !== input.loopDefinitionId) {
    throw validationError("Loop version does not belong to the loop definition");
  }
  assertBindingLimits(input.parameterOverrides, version);
}

function assertBindingLimits(overrides: JsonRecord, version: LoopVersionLimitSnapshot): void {
  const limits = overrides.limits;
  if (limits !== undefined && !isRecord(limits)) {
    throw validationError("Binding limits must be an object");
  }
  const nested = limits ?? {};
  for (const [key, ceiling] of [
    ["maxStages", version.maxStages],
    ["maxRepeatCount", version.maxRepeatCount],
    ["maxTransitions", version.platformMaxTransitions],
  ] as const) {
    if (overrides[key] !== undefined && nested[key] !== undefined && overrides[key] !== nested[key]) {
      throw validationError(`Binding ${key} declarations conflict`);
    }
    for (const value of [overrides[key], nested[key]]) {
      if (value === undefined) continue;
      if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > ceiling) {
        throw validationError(`Binding ${key} must be a positive integer no greater than the published limit`);
      }
    }
  }
}

async function assertBindingAutomationGrants(input: {
  tx: LoopDefinitionTx;
  grantIds: string[];
  bindingId: string;
  projectId: string;
  now: Date;
}): Promise<void> {
  if (input.grantIds.length === 0) return;
  const rows = await input.tx.automationGrant.findMany({
    where: { id: { in: input.grantIds } },
    select: {
      id: true,
      projectId: true,
      status: true,
      scope: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const grantId of input.grantIds) {
    const row = byId.get(grantId);
    if (
      !row
      || row.projectId !== input.projectId
      || row.status !== "active"
      || row.revokedAt !== null
      || (row.expiresAt !== null && row.expiresAt <= input.now)
    ) throw validationError("Loop binding requires active AutomationGrants from the same Project");
    const grant = parseAutomationGrant(row.scope);
    if (
      grant.id !== row.id
      || grant.projectId !== input.projectId
      || !grant.bindingIds.includes(input.bindingId)
      || Date.parse(grant.confirmedAt) > input.now.getTime()
    ) throw validationError("AutomationGrant does not cover this Loop binding");
  }
}

function parseAutomationGrant(value: unknown): AutomationGrantSnapshot {
  const parsed = automationGrantSchema.safeParse(value);
  if (!parsed.success) throw validationError("AutomationGrant scope is invalid");
  return parsed.data;
}

function parseAutomationGrantIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32) {
    throw validationError("Loop automation grants are invalid");
  }
  const ids = value.map((grantId) => {
    if (
      typeof grantId !== "string"
      || grantId.length === 0
      || grantId.length > 96
      || grantId !== grantId.trim()
    ) throw validationError("Loop automation grant ID is invalid");
    return grantId;
  });
  return [...new Set(ids)].sort();
}

function parseBindingScopeIds(value: unknown, label: string, maxItems: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw validationError(`Loop binding ${label} scope is invalid`);
  }
  const ids = value.map((id) => {
    if (typeof id !== "string" || !id || id.length > 96 || id !== id.trim()) {
      throw validationError(`Loop binding ${label} ID is invalid`);
    }
    return id;
  });
  return [...new Set(ids)].sort();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as JsonRecord;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function assertJsonValue(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw validationError("Loop graph must contain only JSON values");
  }
  if (typeof value !== "object") throw validationError("Loop graph must contain only JSON values");
  if (ancestors.has(value)) throw validationError("Loop graph must not contain cycles");
  ancestors.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) {
      throw validationError("Loop graph must contain only JSON values");
    }
    const properties = Object.getOwnPropertyNames(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor
      || !('value' in lengthDescriptor)
      || lengthDescriptor.value !== value.length
      || lengthDescriptor.enumerable
      || properties.length !== value.length + 1
    ) {
      throw validationError("Loop graph must contain only JSON values");
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw validationError("Loop graph must contain only JSON values");
      }
      assertJsonValue(descriptor.value, ancestors);
    }
    ancestors.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw validationError("Loop graph must contain only JSON values");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw validationError("Loop graph must contain only JSON values");
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw validationError("Loop graph must contain only JSON values");
    }
    assertJsonValue(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}

function requiredText(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw validationError(message);
  return trimmed;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw validationError(`${name} must be a positive integer`);
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validationError(message: string): OrchestrationPersistenceError {
  return new OrchestrationPersistenceError("validation_failed", message);
}
