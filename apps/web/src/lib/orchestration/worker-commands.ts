import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  appendLoopAttemptEvents,
  buildAccessibleProjectWhere,
  claimAgentRun,
  completeLoopNode,
  fingerprintJsonValue,
  heartbeatAgentRun,
  matchesAgentRunCapabilities,
  prisma,
  requestRuntimeIntervention,
  scheduledTaskProjectDigest,
  resolveProjectEnvironmentSecrets,
  resolveWorkerModelSiteSecret,
  boundedPersistenceId,
} from "@humanthread/db";
import { deriveTaskBranch, readLoopGraphFeatureFlags, validateLease } from "@humanthread/orchestration-core";
import {
  agentWorkerCapabilitySnapshotSchema,
  builtInDecisionRouterContract,
  buildLocalAgentWorkerId,
  loopAgentEventBatchSchema,
  loopAssignmentSchema,
  loopAssignmentV2Schema,
  loopExecutionPhaseSchema,
  loopNodeResultSchema,
  parsePublishedLoopGraph,
  runGraphSnapshotSchema,
  runGraphSnapshotV2Schema,
  matchesWorkerBranchPattern,
  isValidWorkerBranchName,
  workerExecutionSnapshotSchema,
  projectRepositoryConfigurationSchema,
  repositoryCredentialSecretNames,
  type AgentWorkerCapabilitySnapshot,
  type LoopAgentEvent,
  type LoopAssignment,
  type LoopAssignmentV2,
  type LoopNodeResult,
  type LocalRouteDecision,
  type WorkerExecutionSnapshot,
  loopChecklistCreatedPayloadSchema,
  loopChecklistUpdatedPayloadSchema,
} from "../../../../../packages/shared/src/index";
import type { LoopActionAuthorizationResult } from "./loop-action-authorization";
import { saveLoopReviewArtifact } from "./loop-review-artifacts";
import {
  bindTemporaryReviewPages,
  registerTemporaryReviewPage,
  TEMPORARY_REVIEW_PAGE_MAX_PER_INTERACTION,
} from "../workflow-interaction/temporary-review-page";

type RunRecord = { id: string; taskId: string | null; status: string; workerId: string | null; leaseGeneration: number; leaseExpiresAt: Date | null; lastEventSequence: number };
type LeaseInput = { runId: string; workerId: string; leaseGeneration: number; now: Date };
type Dependencies<TResult> = { loadRun(runId: string): Promise<RunRecord | null>; persist(input: unknown): Promise<TResult> };

type GraphRunRecord = RunRecord & {
  projectId?: string | null;
  loopRunId: string | null;
  loopNodeRunId: string | null;
  loopNodeAttemptId: string | null;
  attempt: number;
  nodeRunVersion: number;
  nodeRunAttemptCount: number;
  attemptVersion: number;
  checkpoint: unknown;
  linuxWorkerPoolSessionId?: string | null;
};

type WorkerCheckpointEnvelope = {
  protocol: "loop-worker-checkpoint/v1";
  commandId: string;
  fingerprint: string;
  value: unknown;
};

type ClaimLoopAssignmentInput = {
  userId: string;
  workerId: string;
  deviceId: string;
  capabilities: string[];
  activeAgentRunIds?: string[];
  acceptAssignments?: boolean;
  now: Date;
  leaseDurationMs: number;
};

export type ClaimLinuxWorkerAssignmentInput = {
  poolId: string;
  sessionId: string;
  instanceId: string;
  /** Docker workers own an isolated volume; Kubernetes replicas share storage and may switch. */
  runtime?: "docker" | "kubernetes";
  ownerType: "personal" | "company";
  ownerUserId: string | null;
  companyId: string | null;
  capabilities: Record<string, unknown>;
  requestedConcurrency: number;
  maxConcurrentRuns: number;
  resourceLimits: { gpuConcurrency: number; unityBuildConcurrency: number };
  acceptAssignments: boolean;
  now: Date;
  leaseDurationMs: number;
};

export type HeartbeatLinuxWorkerAssignmentInput = {
  agentRunId: string;
  poolId: string;
  sessionId: string;
  leaseGeneration: number;
  commandId: string;
  now: Date;
  leaseDurationMs: number;
};

export type AppendLinuxWorkerAssignmentEventsInput = {
  agentRunId: string;
  sessionId: string;
  leaseGeneration: number;
  commandId: string;
  loopNodeAttemptId: string;
  events: LoopAgentEvent[];
  now: Date;
};

export type SaveLinuxWorkerAssignmentCheckpointInput = {
  agentRunId: string;
  sessionId: string;
  leaseGeneration: number;
  commandId: string;
  loopRunId: string;
  loopNodeRunId: string;
  loopNodeAttemptId: string;
  attemptNo: number;
  checkpoint: unknown;
  now: Date;
};

export type CompleteLinuxWorkerAssignmentInput = {
  agentRunId: string;
  sessionId: string;
  leaseGeneration: number;
  commandId: string;
  loopRunId: string;
  loopNodeRunId: string;
  loopNodeAttemptId: string;
  attemptNo: number;
  result: LoopNodeResult;
  routeDecision?: LocalRouteDecision;
  now: Date;
};

export type WriteLinuxWorkerChecklistInput = {
  agentRunId: string;
  poolId: string;
  sessionId: string;
  operation: "create" | "update";
  payload: Record<string, unknown>;
  now: Date;
};

export type RequestLinuxWorkerInterventionInput = {
  agentRunId: string;
  poolId: string;
  sessionId: string;
  commandId: string;
  reason: string;
  evidence?: unknown;
  /**
   * Rendered HTML pages the human must read to answer. They are proxied from
   * short-lived process memory, never stored as platform artifacts.
   */
  pages?: Array<{ fileName: string; html: string }>;
  now: Date;
};

export type ReadLinuxWorkerAssignmentSequenceInput = {
  agentRunId: string;
  sessionId: string;
  now: Date;
};

export type WriteLocalWorkerChecklistInput = {
  agentRunId: string;
  workerId: string;
  deviceId: string;
  leaseGeneration: number;
  operation: "create" | "update";
  payload: Record<string, unknown>;
  now: Date;
};

export type RequestLocalWorkerInterventionInput = {
  agentRunId: string;
  workerId: string;
  deviceId: string;
  leaseGeneration: number;
  commandId: string;
  reason: string;
  evidence?: unknown;
  pages?: Array<{ fileName: string; html: string }>;
  now: Date;
};

type LinuxWorkerClaimCandidate = {
  id: string;
  projectId: string | null;
  project: { ownerType: string; ownerUserId: string | null; companyId: string | null; environmentConfiguration?: unknown; repositoryConfiguration?: unknown } | null;
  attempt: number;
  leaseGeneration: number;
  lastEventSequence: number;
  inputSnapshot: unknown;
  loopNodeAttempt: { id: string } | null;
  agentProfile: { id: string; provider: string; status: string; capabilities: unknown };
  loopNodeRun: { id: string; nodeKey: string } | null;
  loopRun: {
    id: string;
    inputSnapshot: unknown;
    bindingSnapshot: unknown;
    executionSnapshot: unknown;
    grantSnapshot: unknown;
    policySnapshot: unknown;
    runGraphSnapshot: unknown;
    task: TaskExecutionContext & {
      title: string;
      description: string;
      contentMarkdown: string;
      linuxWorkerPoolId?: string | null;
      linuxWorkerInstanceId?: string | null;
    } | null;
    scheduledTaskRun: {
      id: string;
      taskSnapshot: unknown;
      contentSnapshot: string | null;
    } | null;
    parentLoopRun: {
      id: string;
      projectId: string | null;
      scheduledTaskRunId: string | null;
      inputSnapshot: unknown;
    } | null;
    loopVersion: { id: string; loopDefinitionId: string; graph: unknown } | null;
  } | null;
};

export type LinuxWorkerClaimDependencies = {
  tx: {
    agentRun: {
      count(args: { where: unknown }): Promise<number>;
      findMany(args: unknown): Promise<LinuxWorkerClaimCandidate[]>;
      updateMany(args: unknown): Promise<{ count: number }>;
    };
    task: {
      updateMany(args: unknown): Promise<{ count: number }>;
    };
    loopNodeRun?: {
      updateMany(args: unknown): Promise<{ count: number }>;
    };
    projectScheduledTaskRun: {
      findUnique(args: unknown): Promise<{
        id: string;
        scheduledTaskId: string;
        projectDigest?: string | null;
        scheduledTask?: { projectDigest?: string | null } | null;
        taskSnapshot: unknown;
        contentSnapshot: string | null;
      } | null>;
    };
  };
  flags: { graphV1: boolean };
  resolveModelSiteSecret(input: {
    scope: { ownerType: "personal" | "company"; ownerUserId: string | null; companyId: string | null };
    siteId: string;
  }): Promise<{
    id: string;
    endpoint: string;
    apiKeyReference: string;
    apiKey: string;
  }>;
  resolveProjectEnvironmentSecrets(input: {
    projectId: string;
    names: string[];
  }): Promise<Record<string, string>>;
};

type ClaimExecutionConfigurationInput = {
  command: Pick<ClaimLoopAssignmentInput, "userId" | "workerId" | "deviceId" | "capabilities">;
  projectId: string;
  agentProfile: { id: string; provider: string; status: string };
  worker: { id: string; localDeviceId: string | null; status: string };
  bindingSnapshot: unknown;
  workspace: {
    id: string;
    projectId: string;
    userId: string;
    localDeviceId: string;
    status: string;
    configurationVersion: number;
    pathFingerprint: string;
  } | null;
  runtime: {
    id: string;
    userId: string;
    localDeviceId: string;
    provider: string;
    status: string;
    version: number;
  } | null;
  liveGrantScopes: unknown[];
};

type ScheduledTaskRunSelection = {
  id: string;
  taskSnapshot: unknown;
  contentSnapshot: string | null;
};

type ScheduledTaskRunReference = {
  scheduledTaskId: string | null;
  scheduledTaskRunId: string;
};

export async function resolveScheduledTaskRunForClaim(input: {
  projectId: string;
  direct: ScheduledTaskRunSelection | null;
  inputSnapshot: unknown;
  parent?: {
    id: string;
    projectId: string | null;
    scheduledTaskRunId?: string | null;
    inputSnapshot?: unknown;
  } | null;
  loadRun(scheduledTaskRunId: string): Promise<{
    id: string;
    scheduledTaskId: string;
    projectDigest?: string | null;
    scheduledTask?: { projectDigest?: string | null } | null;
    taskSnapshot: unknown;
    contentSnapshot: string | null;
  } | null>;
}): Promise<ScheduledTaskRunSelection | null> {
  const directReference = input.direct ? { scheduledTaskId: null, scheduledTaskRunId: input.direct.id } : null;
  const snapshotReference = scheduledTaskRunReference(input.inputSnapshot);
  const reference = directReference ?? snapshotReference;
  if (!reference) return null;
  if (input.direct && snapshotReference && snapshotReference.scheduledTaskRunId !== input.direct.id) {
    throw configurationRequired();
  }
  if (input.parent) {
    if (input.parent.projectId && input.parent.projectId !== input.projectId) throw configurationRequired();
    const parentReference = input.parent.scheduledTaskRunId
      ? { scheduledTaskId: null, scheduledTaskRunId: input.parent.scheduledTaskRunId }
      : scheduledTaskRunReference(input.parent.inputSnapshot);
    if (parentReference && parentReference.scheduledTaskRunId !== reference.scheduledTaskRunId) {
      throw configurationRequired();
    }
  }
  const loaded = await input.loadRun(reference.scheduledTaskRunId);
  const loadedProjectDigest = loaded?.projectDigest ?? loaded?.scheduledTask?.projectDigest ?? null;
  if (!loaded || loaded.id !== reference.scheduledTaskRunId
    || loadedProjectDigest !== scheduledTaskProjectDigest(input.projectId)
    || (reference.scheduledTaskId !== null && loaded.scheduledTaskId !== reference.scheduledTaskId)) {
    throw configurationRequired();
  }
  return {
    id: loaded.id,
    taskSnapshot: loaded.taskSnapshot,
    contentSnapshot: loaded.contentSnapshot,
  };
}

function scheduledTaskRunReference(value: unknown): ScheduledTaskRunReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const scheduledTaskRunId = record.scheduledTaskRunId;
  if (typeof scheduledTaskRunId !== "string" || !/^[a-f0-9]{32}$/u.test(scheduledTaskRunId)) return null;
  const scheduledTaskId = typeof record.scheduledTaskId === "string" && /^[a-f0-9]{32}$/u.test(record.scheduledTaskId)
    ? record.scheduledTaskId
    : null;
  return { scheduledTaskId, scheduledTaskRunId };
}

type CompleteLoopAssignmentInput = {
  agentRunId: string;
  workerId: string;
  deviceId: string;
  leaseGeneration: number;
  commandId: string;
  loopRunId: string;
  loopNodeRunId: string;
  loopNodeAttemptId: string;
  attemptNo: number;
  result: LoopNodeResult;
  routeDecision?: LocalRouteDecision;
  now: Date;
};

export type UploadLoopAssignmentArtifactInput = {
  agentRunId: string;
  workerId: string;
  deviceId: string;
  leaseGeneration: number;
  commandId: string;
  loopRunId: string;
  loopNodeRunId: string;
  loopNodeAttemptId: string;
  attemptNo: number;
  relativePath: string;
  content: string;
  now: Date;
};

type AppendLoopAssignmentEventsInput = {
  agentRunId: string;
  workerId: string;
  deviceId: string;
  leaseGeneration: number;
  commandId: string;
  loopNodeAttemptId: string;
  events: LoopAgentEvent[];
  now: Date;
};

const EXECUTION_PHASE_EVENT_TYPE = "loop.node.execution_phase_changed";

function assertExecutionPhaseEvents(batch: { events: LoopAgentEvent[] }): void {
  for (const event of batch.events) {
    if (event.eventType !== EXECUTION_PHASE_EVENT_TYPE) continue;
    const parsed = loopExecutionPhaseSchema.safeParse(event.payloadSummary);
    if (!parsed.success) {
      throw Object.assign(new Error("Execution phase payload is invalid"), { code: "validation_failed" });
    }
  }
}

type GraphMutationInput = {
  agentRunId: string;
  workerId: string;
  deviceId: string;
  leaseGeneration: number;
  commandId: string;
  loopRunId: string;
  loopNodeRunId: string;
  loopNodeAttemptId: string;
  attemptNo: number;
  now: Date;
};

export function buildLoopAssignmentExecutionView(value: unknown): LoopAssignment["graph"] {
  return parsePublishedLoopGraph(value);
}

export function resolveWorkerExecutionSnapshot(input: {
  workerPoolId: string;
  workerInstanceId?: string;
  repository: {
    url: string;
    branch: string;
    branchPolicy: { allowedBranches: string[] };
  };
  stageConfigurations: Record<string, {
    siteId: string;
    model: string;
    reasoningEffort: string;
    requireGitDelivery?: boolean;
  }>;
  modelSites: Array<{
    id: string;
    endpoint: string;
    apiKeyReference: string;
  }>;
  nodeKey: string;
  requiredCapabilities: string[];
  requireGitDelivery: boolean;
  grants: unknown[];
}): WorkerExecutionSnapshot {
  const stage = input.stageConfigurations[input.nodeKey];
  if (!stage) throw configurationRequired();
  const site = input.modelSites.find(({ id }) => id === stage.siteId);
  if (!site) throw configurationRequired();
  const parsed = workerExecutionSnapshotSchema.safeParse({
    version: 1,
    workerPoolId: input.workerPoolId,
    ...(input.workerInstanceId === undefined ? {} : { workerInstanceId: input.workerInstanceId }),
    repository: input.repository,
    model: {
      provider: "codex",
      siteId: site.id,
      endpoint: site.endpoint,
      apiKeyReference: site.apiKeyReference,
      model: stage.model,
      reasoningEffort: stage.reasoningEffort,
    },
    resources: {
      gpu: input.requiredCapabilities.includes("gpu"),
      unityBuild: input.requiredCapabilities.includes("unity") || input.requiredCapabilities.includes("unity_build"),
    },
    deliveryPolicy: { requireGitDelivery: input.requireGitDelivery },
    grants: input.grants,
    logPolicy: { redactCredentials: true },
  });
  if (!parsed.success) throw configurationRequired();
  return parsed.data;
}

function configurationRequired(): Error & { code: "configuration_required" } {
  return Object.assign(new Error("Worker execution configuration is required"), {
    code: "configuration_required" as const,
  });
}

export function buildLoopAssignmentContract(input: {
  baseAssignment: unknown;
  runGraphSnapshot: unknown;
}): LoopAssignment | LoopAssignmentV2 {
  const baseAssignment = loopAssignmentSchema.parse(input.baseAssignment);
  const v2Snapshot = runGraphSnapshotV2Schema.safeParse(input.runGraphSnapshot);
  const v1Snapshot = runGraphSnapshotSchema.safeParse(input.runGraphSnapshot);
  const snapshot = v2Snapshot.success ? v2Snapshot.data : v1Snapshot.success ? v1Snapshot.data : null;
  if (!snapshot) return baseAssignment;
  return loopAssignmentV2Schema.parse({
    ...baseAssignment,
    contractVersion: 2 as const,
    runGraphSnapshot: snapshot,
    routerContract: builtInDecisionRouterContract,
    offlineContinuation: null,
  });
}

type HeartbeatLoopAssignmentInput = {
  agentRunId: string;
  workerId: string;
  deviceId: string;
  leaseGeneration: number;
  commandId: string;
  capabilitySnapshot: AgentWorkerCapabilitySnapshot;
  agentVersion?: string;
  now: Date;
  leaseDurationMs: number;
};

function assertLease(run: RunRecord | null, input: LeaseInput): asserts run is RunRecord {
  if (!run) throw Object.assign(new Error("AgentRun not found"), { code: "not_found" });
  const validation = validateLease({ run, workerId: input.workerId, leaseGeneration: input.leaseGeneration, now: input.now });
  if (!validation.ok) throw Object.assign(new Error("Stale or expired AgentRun lease"), { code: validation.code });
}

function assertCommandId(commandId: string): void {
  if (!commandId.trim() || commandId.length > 128) {
    throw Object.assign(new Error("Invalid worker command ID"), { code: "validation_failed" });
  }
}

function assertGraphRunIdentity(
  run: RunRecord,
  input: Pick<CompleteLoopAssignmentInput,
    "loopRunId" | "loopNodeRunId" | "loopNodeAttemptId" | "attemptNo"
  >,
): asserts run is GraphRunRecord {
  const graphRun = run as Partial<GraphRunRecord>;
  if (
    graphRun.taskId !== null
    || graphRun.loopRunId !== input.loopRunId
    || graphRun.loopNodeRunId !== input.loopNodeRunId
    || graphRun.loopNodeAttemptId !== input.loopNodeAttemptId
    || graphRun.attempt !== input.attemptNo
    || graphRun.nodeRunAttemptCount !== input.attemptNo
  ) {
    throw Object.assign(new Error("Stale or mismatched graph assignment"), { code: "stale_lease" });
  }
}

export async function claimLoopAssignment(
  input: ClaimLoopAssignmentInput,
  dependencies: {
    claim(input: ClaimLoopAssignmentInput): Promise<LoopAssignment | LoopAssignmentV2 | null>;
    authorizeAssignment?(
      assignment: LoopAssignment,
      context: { now: Date },
    ): Promise<LoopActionAuthorizationResult>;
  },
): Promise<{
  assignment: LoopAssignment | LoopAssignmentV2 | null;
  leaseGeneration: number | null;
  leaseExpiresAt: string | null;
  leaseDurationMs?: number;
}> {
  if (input.workerId !== buildLocalAgentWorkerId(input.deviceId)) throw staleLeaseError();
  if (input.acceptAssignments === false) {
    return { assignment: null, leaseGeneration: null, leaseExpiresAt: null };
  }
  const claimed = await dependencies.claim(input);
  if (!claimed) {
    return { assignment: null, leaseGeneration: null, leaseExpiresAt: null };
  }

  const assignment = "contractVersion" in claimed && claimed.contractVersion === 2
    ? loopAssignmentV2Schema.parse(claimed)
    : loopAssignmentSchema.parse(claimed);
  if (dependencies.authorizeAssignment) {
    assertAssignmentAuthorization(
      await dependencies.authorizeAssignment(assignment, { now: input.now }),
    );
  }
  return {
    assignment,
    leaseGeneration: assignment.leaseGeneration,
    leaseExpiresAt: assignment.leaseExpiresAt,
    leaseDurationMs: input.leaseDurationMs,
  };
}

function assertAssignmentAuthorization(decision: LoopActionAuthorizationResult): void {
  if (decision.outcome === "allow" || decision.outcome === "auto_approve") return;
  if (decision.outcome === "deny") {
    throw Object.assign(new Error(decision.reasonCode), { code: "policy_denied" });
  }
  throw Object.assign(new Error(decision.reasonCode), {
    code: "approval_required",
    actionFingerprint: decision.actionFingerprint,
  });
}

export function buildClaimExecutionConfiguration(
  input: ClaimExecutionConfigurationInput,
): Pick<LoopAssignment, "runtime" | "workspace"> {
  const provider = input.agentProfile.provider;
  if (
    input.agentProfile.status !== "active"
    || (provider !== "codex" && provider !== "claude")
    || input.worker.id !== input.command.workerId
    || input.worker.localDeviceId !== input.command.deviceId
    || input.worker.status !== "online"
  ) throw staleLeaseError();

  const binding = recordValue(input.bindingSnapshot);
  if (
    !stringArray(binding.allowedAgentProfileIds).includes(input.agentProfile.id)
    || !stringArray(binding.allowedProviders).includes(provider)
    || !input.command.capabilities.includes(provider)
  ) throw staleLeaseError();

  const workspace = input.workspace;
  const runtime = input.runtime;
  if (
    !workspace
    || workspace.projectId !== input.projectId
    || workspace.userId !== input.command.userId
    || workspace.localDeviceId !== input.command.deviceId
    || workspace.status !== "ready"
    || !runtime
    || runtime.userId !== input.command.userId
    || runtime.localDeviceId !== input.command.deviceId
    || runtime.provider !== provider
    || runtime.status !== "ready"
  ) throw staleLeaseError();

  const grantMatches = input.liveGrantScopes.some((scope) => {
    const grantScope = recordValue(scope);
    return stringArray(grantScope.workspaceBindingIds).includes(workspace.id)
      && stringArray(grantScope.agentProfileIds).includes(input.agentProfile.id)
      && stringArray(grantScope.providers).includes(provider)
      && stringArray(grantScope.deviceIds).includes(input.command.deviceId)
      && stringArray(grantScope.workerIds).includes(input.command.workerId);
  });
  if (!grantMatches) throw staleLeaseError();

  return {
    runtime: loopAssignmentSchema.shape.runtime.parse({
      agentProfileId: input.agentProfile.id,
      provider,
      runtimeProfileId: runtime.id,
      configurationVersion: runtime.version,
    }),
    workspace: loopAssignmentSchema.shape.workspace.parse({
      bindingId: workspace.id,
      configurationVersion: workspace.configurationVersion,
      pathFingerprint: workspace.pathFingerprint,
    }),
  };
}

export async function heartbeatLoopAssignment(
  input: HeartbeatLoopAssignmentInput,
  dependencies: {
    heartbeat(input: HeartbeatLoopAssignmentInput): Promise<{ leaseExpiresAt: Date }>;
  },
): Promise<{ leaseExpiresAt: string; leaseDurationMs: number }> {
  if (input.workerId !== buildLocalAgentWorkerId(input.deviceId)) throw staleLeaseError();
  assertCommandId(input.commandId);
  const capabilitySnapshot = agentWorkerCapabilitySnapshotSchema.parse(
    input.capabilitySnapshot,
  );
  const result = await dependencies.heartbeat({ ...input, capabilitySnapshot });
  return {
    leaseExpiresAt: result.leaseExpiresAt.toISOString(),
    leaseDurationMs: input.leaseDurationMs,
  };
}

export async function heartbeatLinuxWorkerAssignment(
  input: HeartbeatLinuxWorkerAssignmentInput,
  dependencies: {
    heartbeat(input: HeartbeatLinuxWorkerAssignmentInput): Promise<{ leaseExpiresAt: Date }>;
  },
): Promise<{ leaseExpiresAt: string; leaseDurationMs: number }> {
  assertLinuxWorkerLeaseIdentity(input.poolId, input.sessionId);
  assertCommandId(input.commandId);
  if (!Number.isInteger(input.leaseGeneration) || input.leaseGeneration <= 0) throw staleLeaseError();
  const result = await dependencies.heartbeat(input);
  return {
    leaseExpiresAt: result.leaseExpiresAt.toISOString(),
    leaseDurationMs: input.leaseDurationMs,
  };
}

export async function appendLoopAssignmentEvents(
  input: AppendLoopAssignmentEventsInput,
  dependencies: { persistEvents(input: AppendLoopAssignmentEventsInput): Promise<unknown> },
): Promise<unknown> {
  if (input.workerId !== buildLocalAgentWorkerId(input.deviceId)) throw staleLeaseError();
  assertCommandId(input.commandId);
  const batch = loopAgentEventBatchSchema.parse({
    agentRunId: input.agentRunId,
    workerId: input.workerId,
    leaseGeneration: input.leaseGeneration,
    events: input.events,
  });
  if (batch.events.some((event) => event.loopNodeAttemptId !== input.loopNodeAttemptId)) {
    throw Object.assign(new Error("Event batch attempt identity mismatch"), { code: "stale_lease" });
  }
  if (new TextEncoder().encode(JSON.stringify(batch)).byteLength > 512 * 1_024) {
    throw Object.assign(new Error("AgentRun event batch exceeds 512 KiB"), { code: "validation_failed" });
  }
  assertExecutionPhaseEvents(batch);

  return dependencies.persistEvents({ ...input, events: batch.events });
}

export async function appendLinuxWorkerAssignmentEvents(
  input: AppendLinuxWorkerAssignmentEventsInput,
  dependencies: {
    persistEvents(input: AppendLinuxWorkerAssignmentEventsInput & { workerId?: undefined }): Promise<unknown>;
  },
): Promise<unknown> {
  assertLinuxWorkerSessionIdentity(input.sessionId);
  assertCommandId(input.commandId);
  const batch = loopAgentEventBatchSchema.parse({
    agentRunId: input.agentRunId,
    workerId: `linux-worker:${input.sessionId}`,
    leaseGeneration: input.leaseGeneration,
    events: input.events,
  });
  if (batch.events.some((event) => event.loopNodeAttemptId !== input.loopNodeAttemptId)) {
    throw Object.assign(new Error("Event batch attempt identity mismatch"), { code: "stale_lease" });
  }
  if (new TextEncoder().encode(JSON.stringify(batch)).byteLength > 512 * 1_024) {
    throw Object.assign(new Error("AgentRun event batch exceeds 512 KiB"), { code: "validation_failed" });
  }
  assertExecutionPhaseEvents(batch);
  return dependencies.persistEvents({ ...input, workerId: undefined, events: batch.events });
}

export async function completeLoopAssignment(
  input: CompleteLoopAssignmentInput,
  dependencies: {
    loadRun(runId: string): Promise<GraphRunRecord | null>;
    persistResult(input: {
      run: GraphRunRecord;
      command: CompleteLoopAssignmentInput;
      result: LoopNodeResult;
      routeDecision?: LocalRouteDecision;
    }): Promise<unknown>;
    executeIdempotent(input: {
      commandId: string;
      aggregateType: "loop_node";
      aggregateId: string;
      apply(): Promise<unknown>;
    }): Promise<unknown>;
  },
): Promise<unknown> {
  if (input.workerId !== buildLocalAgentWorkerId(input.deviceId)) throw staleLeaseError();
  assertCommandId(input.commandId);
  const result = loopNodeResultSchema.parse(input.result);
  const run = await dependencies.loadRun(input.agentRunId);
  if (
    !run
    || run.workerId !== input.workerId
    || !run.loopRunId
    || !run.loopNodeRunId
    || !run.loopNodeAttemptId
    || run.leaseGeneration !== input.leaseGeneration
    || !run.leaseExpiresAt
    || run.leaseExpiresAt <= input.now
  ) {
    throw Object.assign(new Error("Stale or expired AgentRun lease"), {
      code: "stale_lease",
    });
  }
  assertGraphRunIdentity(run, input);

  if (
    input.routeDecision !== undefined
    && (run.status === "succeeded" || run.status === "failed")
    && recordValue(run.checkpoint).routeDecisionId === input.routeDecision.decisionId
  ) {
    return { completed: false, duplicate: true };
  }

  return dependencies.executeIdempotent({
    commandId: input.commandId,
    aggregateType: "loop_node",
    aggregateId: input.loopNodeRunId,
    apply: () => dependencies.persistResult({ run, command: input, result, ...(input.routeDecision === undefined ? {} : { routeDecision: input.routeDecision }) }),
  });
}

export async function completeLinuxWorkerAssignment(
  input: CompleteLinuxWorkerAssignmentInput,
  dependencies: {
    loadRun(runId: string): Promise<GraphRunRecord | null>;
    persistResult(input: {
      run: GraphRunRecord;
      command: CompleteLinuxWorkerAssignmentInput;
      result: LoopNodeResult;
      routeDecision?: LocalRouteDecision;
    }): Promise<unknown>;
    executeIdempotent(input: {
      commandId: string;
      aggregateType: "loop_node";
      aggregateId: string;
      apply(): Promise<unknown>;
    }): Promise<unknown>;
  },
): Promise<unknown> {
  assertLinuxWorkerSessionIdentity(input.sessionId);
  assertCommandId(input.commandId);
  const result = loopNodeResultSchema.parse(input.result);
  const run = await dependencies.loadRun(input.agentRunId);
  if (
    !run
    || run.workerId !== null
    || run.linuxWorkerPoolSessionId !== input.sessionId
    || run.leaseGeneration !== input.leaseGeneration
    || !run.leaseExpiresAt
    || run.leaseExpiresAt <= input.now
  ) throw staleLeaseError();
  assertGraphRunIdentity(run, input);
  if (
    input.routeDecision !== undefined
    && (run.status === "succeeded" || run.status === "failed")
    && recordValue(run.checkpoint).routeDecisionId === input.routeDecision.decisionId
  ) {
    return { completed: false, duplicate: true };
  }
  return dependencies.executeIdempotent({
    commandId: input.commandId,
    aggregateType: "loop_node",
    aggregateId: input.loopNodeRunId,
    apply: () => dependencies.persistResult({
      run,
      command: input,
      result,
      ...(input.routeDecision === undefined ? {} : { routeDecision: input.routeDecision }),
    }),
  });
}

export async function saveLoopAssignmentCheckpoint(
  input: GraphMutationInput & { checkpoint: unknown },
  dependencies: {
    loadRun(runId: string): Promise<GraphRunRecord | null>;
    persistCheckpoint(input: {
      run: GraphRunRecord;
      command: GraphMutationInput & { checkpoint: unknown };
      storedCheckpoint: WorkerCheckpointEnvelope;
    }): Promise<unknown>;
  },
): Promise<unknown> {
  if (input.workerId !== buildLocalAgentWorkerId(input.deviceId)) throw staleLeaseError();
  assertCommandId(input.commandId);
  if (new TextEncoder().encode(JSON.stringify(input.checkpoint)).byteLength > 65_536) {
    throw Object.assign(new Error("AgentRun checkpoint exceeds 64 KiB"), { code: "validation_failed" });
  }
  const run = await dependencies.loadRun(input.agentRunId);
  assertLease(run, {
    runId: input.agentRunId,
    workerId: input.workerId,
    leaseGeneration: input.leaseGeneration,
    now: input.now,
  });
  assertGraphRunIdentity(run, input);
  const checkpointFingerprint = fingerprintJsonValue(input.checkpoint);
  const existingCheckpoint = parseWorkerCheckpoint(run.checkpoint);
  if (existingCheckpoint?.commandId === input.commandId) {
    if (existingCheckpoint.fingerprint !== checkpointFingerprint) {
      throw Object.assign(new Error("Checkpoint command was already accepted with different content"), {
        code: "validation_failed",
      });
    }
    return { checkpointed: true, duplicate: true };
  }
  return dependencies.persistCheckpoint({
    run,
    command: input,
    storedCheckpoint: {
      protocol: "loop-worker-checkpoint/v1",
      commandId: input.commandId,
      fingerprint: checkpointFingerprint,
      value: input.checkpoint,
    },
  });
}

export async function saveLinuxWorkerAssignmentCheckpoint(
  input: SaveLinuxWorkerAssignmentCheckpointInput,
  dependencies: {
    loadRun(runId: string): Promise<GraphRunRecord | null>;
    persistCheckpoint(input: {
      run: GraphRunRecord;
      command: SaveLinuxWorkerAssignmentCheckpointInput;
      storedCheckpoint: WorkerCheckpointEnvelope;
    }): Promise<unknown>;
  },
): Promise<unknown> {
  assertLinuxWorkerSessionIdentity(input.sessionId);
  assertCommandId(input.commandId);
  if (new TextEncoder().encode(JSON.stringify(input.checkpoint)).byteLength > 65_536) {
    throw Object.assign(new Error("AgentRun checkpoint exceeds 64 KiB"), { code: "validation_failed" });
  }
  const run = await dependencies.loadRun(input.agentRunId);
  if (
    !run
    || run.workerId !== null
    || run.linuxWorkerPoolSessionId !== input.sessionId
    || run.leaseGeneration !== input.leaseGeneration
    || !run.leaseExpiresAt
    || run.leaseExpiresAt <= input.now
  ) throw staleLeaseError();
  assertGraphRunIdentity(run, input);
  const checkpointFingerprint = fingerprintJsonValue(input.checkpoint);
  const existingCheckpoint = parseWorkerCheckpoint(run.checkpoint);
  if (existingCheckpoint?.commandId === input.commandId) {
    if (existingCheckpoint.fingerprint !== checkpointFingerprint) {
      throw Object.assign(new Error("Checkpoint command was already accepted with different content"), {
        code: "validation_failed",
      });
    }
    return { checkpointed: true, duplicate: true };
  }
  return dependencies.persistCheckpoint({
    run,
    command: input,
    storedCheckpoint: {
      protocol: "loop-worker-checkpoint/v1",
      commandId: input.commandId,
      fingerprint: checkpointFingerprint,
      value: input.checkpoint,
    },
  });
}

export async function appendRunEvents(input: LeaseInput & { firstSequence: number; events: Array<{ id: string; type: string; payload: unknown }> }, dependencies: Dependencies<{ acceptedThroughSequence: number }>) {
  const run = await dependencies.loadRun(input.runId);
  assertLease(run, input);
  if (input.firstSequence > run.lastEventSequence + 1) throw Object.assign(new Error("AgentRun event sequence gap"), { code: "sequence_gap" });
  if (input.events.length === 0 && input.firstSequence > run.lastEventSequence) throw Object.assign(new Error("AgentRun event sequence gap"), { code: "sequence_gap" });
  if (input.firstSequence <= run.lastEventSequence) return { acceptedThroughSequence: run.lastEventSequence };
  return dependencies.persist(input);
}

export async function saveRunCheckpoint(input: LeaseInput & { checkpoint: unknown }, dependencies: Dependencies<{ checkpointId?: string }>) {
  const run = await dependencies.loadRun(input.runId);
  assertLease(run, input);
  if (new TextEncoder().encode(JSON.stringify(input.checkpoint)).byteLength > 65_536) throw Object.assign(new Error("AgentRun checkpoint exceeds 64 KiB"), { code: "validation_failed" });
  return dependencies.persist(input);
}

export async function submitRunResult(input: LeaseInput & { structuredResult: unknown; artifacts: unknown[]; usage: unknown }, dependencies: Dependencies<{ evaluationId: string; taskStatus: "verifying" }>) {
  const run = await dependencies.loadRun(input.runId);
  assertLease(run, input);
  if (!input.structuredResult || typeof input.structuredResult !== "object") throw Object.assign(new Error("Invalid structured result"), { code: "validation_failed" });
  return dependencies.persist(input);
}

export async function claimLoopAssignmentWithPrisma(
  input: ClaimLoopAssignmentInput,
) {
  const flags = readLoopGraphFeatureFlags(process.env);
  return claimLoopAssignment(input, {
    claim: async (command) => {
      if (!flags.graphV1) return null;
      return prisma.$transaction(async (tx) => {
        const runtimeProfiles = await tx.deviceAgentRuntimeProfile.findMany({
          where: {
            userId: command.userId,
            localDeviceId: command.deviceId,
            status: "ready",
          },
          select: { provider: true, capabilities: true },
        });
        const runtimeCapabilitiesByProvider = new Map(runtimeProfiles.map((profile) => [
          profile.provider,
          stringArray(profile.capabilities),
        ]));
        const activeCandidates = await tx.agentRun.findMany({
          where: {
            workerId: command.workerId,
            project: { is: buildAccessibleProjectWhere({ userId: command.userId }) },
            taskId: null,
            loopNodeRunId: { not: null },
            status: { in: ["claimed", "starting", "running", "waiting_approval"] },
            leaseExpiresAt: { gt: command.now },
            worker: {
              localDeviceId: command.deviceId,
              status: "online",
            },
          loopRun: { engineKind: "graph_v1" },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 25,
          select: {
            id: true,
            inputSnapshot: true,
            agentProfile: { select: { provider: true, capabilities: true } },
            worker: { select: { capabilities: true } },
              loopNodeRun: {
                select: {
                  nodeKey: true,
                  loopRun: { select: { bindingSnapshot: true, executionSnapshot: true, runGraphSnapshot: true, loopVersion: { select: { graph: true } } } },
              },
            },
          },
        });
        const activeAgentRunIds = new Set(command.activeAgentRunIds ?? []);
        const active = activeCandidates.find((candidate) => {
          if (activeAgentRunIds.has(candidate.id)) return false;
          if (hasLinuxWorkerExecution(candidate.loopNodeRun?.loopRun.executionSnapshot, candidate.loopNodeRun?.loopRun.bindingSnapshot)) return false;
          const graphValue = candidate.loopNodeRun?.loopRun.loopVersion?.graph;
          if (graphValue === undefined) return false;
          const graph = buildLoopAssignmentExecutionView(graphValue);
          const node = graph.nodes.find(({ key }) => key === candidate.loopNodeRun?.nodeKey);
          if (!node || node.type !== "agent_action") return false;
          return matchesAgentRunCapabilities({
            workerCapabilities: stringArray(candidate.worker?.capabilities),
            advertisedCapabilities: command.capabilities,
            runtimeCapabilities: runtimeCapabilitiesByProvider.get(candidate.agentProfile.provider) ?? [],
            profileCapabilities: stringArray(candidate.agentProfile.capabilities),
            requiredCapabilities: node.requiredCapabilities ?? [],
          });
        });
        const claimed = active ?? await claimAgentRun({
          tx,
          ...command,
        }) as { id: string } | null;
        if (!claimed) return null;
        const row = await tx.agentRun.findUnique({
          where: { id: claimed.id },
          select: {
            id: true,
            taskId: true,
            loopRunId: true,
            loopNodeRunId: true,
            attempt: true,
            leaseGeneration: true,
            leaseExpiresAt: true,
            lastEventSequence: true,
            checkpoint: true,
            inputSnapshot: true,
            project: { select: { id: true } },
            agentProfile: { select: { id: true, provider: true, status: true } },
            worker: { select: { id: true, localDeviceId: true, status: true, capabilities: true } },
            loopNodeAttempt: { select: { id: true } },
            loopNodeRun: { select: { nodeKey: true } },
            loopRun: {
              select: {
                id: true,
                task: {
                  select: {
                    id: true,
                    projectId: true,
                    taskNumber: true,
                    shortId: true,
                    taskBranch: true,
                    createdAt: true,
                    project: { select: { productionBranch: true, stagingBranch: true } },
                  },
                },
                scheduledTaskRun: {
                  select: { id: true, taskSnapshot: true, contentSnapshot: true },
                },
                engineKind: true,
                inputSnapshot: true,
                parentLoopRun: {
                  select: { id: true, projectId: true, scheduledTaskRunId: true, inputSnapshot: true },
                },
                policySnapshot: true,
                grantSnapshot: true,
                runGraphSnapshot: true,
                bindingSnapshot: true,
                loopVersion: { select: { id: true, loopDefinitionId: true, graph: true } },
              },
            },
          },
        });
        if (
          !row
          || row.taskId !== null
          || !row.loopRunId
          || !row.loopNodeRunId
          || !row.loopNodeAttempt
          || !row.loopNodeRun
          || row.loopRun?.engineKind !== "graph_v1"
          || !row.loopRun.loopVersion
          || !row.project
          || !row.worker
          || row.worker.localDeviceId !== command.deviceId
          || row.worker.status !== "online"
          || row.agentProfile.status !== "active"
          || !row.leaseExpiresAt
        ) throw staleLeaseError();
        const scheduledTaskRun = await resolveScheduledTaskRunForClaim({
          projectId: row.project.id,
          direct: row.loopRun.scheduledTaskRun,
          inputSnapshot: row.loopRun.inputSnapshot,
          parent: row.loopRun.parentLoopRun,
          loadRun: async (scheduledTaskRunId) => {
            const run = await tx.projectScheduledTaskRun.findUnique({
              where: { id: scheduledTaskRunId },
              select: {
                id: true,
                taskSnapshot: true,
                contentSnapshot: true,
                scheduledTaskId: true,
                scheduledTask: { select: { projectDigest: true } },
              },
            });
            return run;
          },
        });
        const provider = row.agentProfile.provider;
        const workspace = await tx.projectDeviceWorkspace.findFirst({
          where: {
            projectId: row.project.id,
            userId: command.userId,
            localDeviceId: command.deviceId,
            status: "ready",
          },
          select: {
            id: true,
            projectId: true,
            userId: true,
            localDeviceId: true,
            status: true,
            configurationVersion: true,
            pathFingerprint: true,
          },
        });
        const runtime = await tx.deviceAgentRuntimeProfile.findFirst({
          where: {
            userId: command.userId,
            localDeviceId: command.deviceId,
            provider,
            status: "ready",
          },
          select: {
            id: true,
            userId: true,
            localDeviceId: true,
            provider: true,
            status: true,
            version: true,
          },
        });
        const grantIds = stringArray(recordValue(row.loopRun.grantSnapshot).automationGrantIds);
        const grants = grantIds.length === 0 ? [] : await tx.automationGrant.findMany({
          where: {
            id: { in: grantIds },
            projectId: row.project.id,
            status: "active",
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: command.now } }],
          },
          select: { scope: true },
        });
        const executionConfiguration = buildClaimExecutionConfiguration({
          command,
          projectId: row.project.id,
          agentProfile: row.agentProfile,
          worker: row.worker,
          bindingSnapshot: row.loopRun.bindingSnapshot,
          workspace,
          runtime,
          liveGrantScopes: grants.map(({ scope }) => scope),
        });
        const graph = buildLoopAssignmentExecutionView(row.loopRun.loopVersion.graph);
        const node = graph.nodes.find(({ key }) => key === row.loopNodeRun!.nodeKey);
        if (!node || node.type !== "agent_action") throw staleLeaseError();
        const attemptId = row.loopNodeAttempt.id;
        const checkpointSnapshot = readWorkerCheckpointValue(row.checkpoint);
        const baseAssignment = {
          id: `assignment:${createHash("sha256").update(`${row.id}\0${row.leaseGeneration}`).digest("hex")}`,
          agentRunId: row.id,
          loopRunId: row.loopRunId,
          loopNodeRunId: row.loopNodeRunId,
          loopNodeAttemptId: attemptId,
          attemptNo: row.attempt,
          leaseGeneration: row.leaseGeneration,
          leaseExpiresAt: row.leaseExpiresAt.toISOString(),
          acceptedThroughSequence: row.lastEventSequence,
          stageRef: {
            loopDefinitionId: row.loopRun.loopVersion.loopDefinitionId,
            loopVersionId: row.loopRun.loopVersion.id,
            nodeId: row.loopNodeRun.nodeKey,
            subloopId: row.loopNodeRun.nodeKey,
          },
          node,
          graph,
          inputSnapshot: withScheduledTaskExecutionContext(
            withTaskExecutionContext(row.inputSnapshot, row.loopRun.task),
            scheduledTaskRunExecutionContext(scheduledTaskRun),
          ),
          policySnapshot: row.loopRun.policySnapshot,
          grantSnapshot: row.loopRun.grantSnapshot ?? {},
          ...executionConfiguration,
          prompt: node.promptTemplate,
          resultSchemaPath: `.humanthread/loop/results/${attemptId}.schema.json`,
          ...(checkpointSnapshot === undefined ? {} : { checkpointSnapshot }),
        };
        return buildLoopAssignmentContract({
          baseAssignment,
          runGraphSnapshot: row.loopRun.runGraphSnapshot,
        });
      });
    },
  });
}

export async function claimLinuxWorkerAssignmentWithPrisma(
  input: ClaimLinuxWorkerAssignmentInput,
): Promise<{ assignment: LinuxWorkerAssignment | null; leaseDurationMs?: number }> {
  const flags = readLoopGraphFeatureFlags(process.env);
  return prisma.$transaction((tx) => claimLinuxWorkerAssignment(input, {
    tx: tx as unknown as LinuxWorkerClaimDependencies["tx"],
    flags,
    resolveModelSiteSecret: resolveWorkerModelSiteSecret,
    resolveProjectEnvironmentSecrets: async ({ projectId, names }) => resolveProjectEnvironmentSecrets({ projectId, names }),
  }), { isolationLevel: "Serializable" });
}

export async function claimLinuxWorkerAssignment(
  input: ClaimLinuxWorkerAssignmentInput,
  dependencies: LinuxWorkerClaimDependencies,
): Promise<{ assignment: LinuxWorkerAssignment | null; leaseDurationMs?: number }> {
  if (!input.acceptAssignments || !dependencies.flags.graphV1) {
    return { assignment: null };
  }
  if (!Number.isInteger(input.maxConcurrentRuns) || input.maxConcurrentRuns < 1 || input.maxConcurrentRuns > 128) {
    throw configurationRequired();
  }
  if (!input.instanceId.trim() || input.instanceId.length > 191) {
    throw configurationRequired();
  }
  const advertisedCapabilities = enabledLinuxCapabilities(input.capabilities);
  const fixedInstance = input.runtime !== "kubernetes";
  const tx = dependencies.tx;
    const sessionActiveCount = await tx.agentRun.count({
      where: {
        linuxWorkerPoolSessionId: input.sessionId,
        status: { in: ["claimed", "starting", "running", "waiting_approval"] },
        leaseExpiresAt: { gt: input.now },
      },
    });
    if (sessionActiveCount >= input.requestedConcurrency) return { assignment: null };
    const poolActiveCount = await tx.agentRun.count({
      where: {
        linuxWorkerPoolSession: { workerPoolId: input.poolId },
        status: { in: ["claimed", "starting", "running", "waiting_approval"] },
        leaseExpiresAt: { gt: input.now },
      },
    });
    if (poolActiveCount >= input.maxConcurrentRuns) return { assignment: null };
    const candidates = await tx.agentRun.findMany({
      where: {
        status: "queued",
        workerId: null,
        linuxWorkerPoolSessionId: null,
        taskId: null,
        project: {
          is: {
            ownerType: input.ownerType,
            ownerUserId: input.ownerUserId,
            companyId: input.companyId,
          },
        },
        loopNodeRunId: { not: null },
        loopRun: { engineKind: "graph_v1", status: "running" },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 25,
      select: {
        id: true,
        projectId: true,
        project: { select: { ownerType: true, ownerUserId: true, companyId: true, environmentConfiguration: true, repositoryConfiguration: true } },
        attempt: true,
        leaseGeneration: true,
        lastEventSequence: true,
        inputSnapshot: true,
        loopNodeAttempt: { select: { id: true } },
        agentProfile: { select: { id: true, provider: true, status: true, capabilities: true } },
        loopNodeRun: { select: { id: true, nodeKey: true } },
        loopRun: {
          select: {
            id: true,
            bindingSnapshot: true,
            executionSnapshot: true,
            grantSnapshot: true,
            policySnapshot: true,
            runGraphSnapshot: true,
            task: {
              select: {
                id: true,
                projectId: true,
                taskNumber: true,
                shortId: true,
                taskBranch: true,
                createdAt: true,
                title: true,
                description: true,
                contentMarkdown: true,
                linuxWorkerPoolId: true,
                linuxWorkerInstanceId: true,
                project: { select: { productionBranch: true, stagingBranch: true } },
              },
            },
            scheduledTaskRun: {
              select: { id: true, taskSnapshot: true, contentSnapshot: true },
            },
            parentLoopRun: {
              select: { id: true, projectId: true, scheduledTaskRunId: true, inputSnapshot: true },
            },
            loopVersion: { select: { id: true, loopDefinitionId: true, graph: true } },
          },
        },
      },
    });
    const activeAssignments = await tx.agentRun.findMany({
      where: {
        linuxWorkerPoolSessionId: input.sessionId,
        status: { in: ["claimed", "starting", "running", "waiting_approval"] },
        leaseExpiresAt: { gt: input.now },
      },
      select: { inputSnapshot: true },
    });
    const activeResources = activeAssignments.reduce((total, run) => {
      const resources = recordValue(recordValue(run.inputSnapshot).workerExecutionSnapshot).resources;
      if (recordValue(resources).gpu === true) total.gpu += 1;
      if (recordValue(resources).unityBuild === true) total.unityBuild += 1;
      return total;
    }, { gpu: 0, unityBuild: 0 });
    const candidate = candidates.find((row) => {
      const task = row.loopRun?.task;
      if (task && fixedInstance) {
        const boundPoolId = task.linuxWorkerPoolId ?? null;
        const boundInstanceId = task.linuxWorkerInstanceId ?? null;
        if (boundPoolId !== null || boundInstanceId !== null) {
          // A partial affinity is corrupt state. Do not let an unrelated Docker
          // instance claim it and silently change the owner.
          if (boundPoolId === null || boundInstanceId === null) return false;
          if (boundPoolId !== input.poolId || boundInstanceId !== input.instanceId) return false;
        }
      }
      if (!matchesLinuxWorkerCandidate({ row, poolId: input.poolId, scope: workerResourceScope(input), advertisedCapabilities })) return false;
      const graph = row.loopRun?.loopVersion ? buildLoopAssignmentExecutionView(row.loopRun.loopVersion.graph) : null;
      const node = graph?.nodes.find(({ key }) => key === row.loopNodeRun?.nodeKey);
      if (!node || node.type !== "agent_action") return false;
      const requiresGpu = node.requiredCapabilities?.includes("gpu") === true;
      const requiresUnity = node.requiredCapabilities?.includes("unity") === true || node.requiredCapabilities?.includes("unity_build") === true;
      return (!requiresGpu || activeResources.gpu < input.resourceLimits.gpuConcurrency)
        && (!requiresUnity || activeResources.unityBuild < input.resourceLimits.unityBuildConcurrency);
    });
    if (!candidate || !candidate.loopRun || !candidate.loopRun.loopVersion || !candidate.loopNodeRun || !candidate.loopNodeAttempt) {
      return { assignment: null };
    }
    if (!candidate.projectId) throw staleLeaseError();
    const workerConfig = parseLinuxWorkerBinding(candidate.loopRun.executionSnapshot, candidate.loopRun.bindingSnapshot);
    const stage = workerConfig.stageConfigurations[candidate.loopNodeRun.nodeKey];
    if (!stage) throw configurationRequired();
    const graph = buildLoopAssignmentExecutionView(candidate.loopRun.loopVersion.graph);
    const node = graph.nodes.find(({ key }) => key === candidate.loopNodeRun?.nodeKey);
    if (!node || node.type !== "agent_action") throw staleLeaseError();
    const branch = resolveLinuxWorkerBranch(candidate.loopRun.task?.taskBranch ?? null, workerConfig.branchPolicy);
    const task = candidate.loopRun.task;
    const scheduledTaskRun = scheduledTaskRunExecutionContext(await resolveScheduledTaskRunForClaim({
      projectId: candidate.projectId,
      direct: candidate.loopRun.scheduledTaskRun,
      inputSnapshot: candidate.loopRun.inputSnapshot,
      parent: candidate.loopRun.parentLoopRun,
      loadRun: async (scheduledTaskRunId) => {
        const run = await tx.projectScheduledTaskRun.findUnique({
          where: { id: scheduledTaskRunId },
          select: {
            id: true,
            taskSnapshot: true,
            contentSnapshot: true,
            scheduledTaskId: true,
            scheduledTask: { select: { projectDigest: true } },
          },
        });
        return run;
      },
    }));
    const workerInputSnapshot = withScheduledTaskExecutionContext(
      candidate.inputSnapshot,
      scheduledTaskRun,
    );
    const assignmentInputSnapshot = sanitizeWorkerInputSnapshot(
      withTaskExecutionContext(workerInputSnapshot, task),
    );
    const rawRepositoryConfiguration = candidate.project?.repositoryConfiguration;
    const repositoryConfiguration = projectRepositoryConfigurationSchema.safeParse(rawRepositoryConfiguration);
    if (
      (rawRepositoryConfiguration !== null && rawRepositoryConfiguration !== undefined && !repositoryConfiguration.success)
      || (repositoryConfiguration.success && repositoryConfiguration.data.verification.status !== "passed")
    ) {
      throw repositoryCredentialUnverified();
    }
    if (task && fixedInstance && task.linuxWorkerPoolId == null && task.linuxWorkerInstanceId == null) {
      const bound = await tx.task.updateMany({
        where: { id: task.id, linuxWorkerPoolId: null, linuxWorkerInstanceId: null },
        data: {
          linuxWorkerPoolId: input.poolId,
          linuxWorkerInstanceId: input.instanceId,
          version: { increment: 1 },
        },
      });
      if (bound.count !== 1) throw staleLeaseError();
    }
    const projectSecretNames = projectEnvironmentSecretNames(candidate.project?.environmentConfiguration);
    const repositorySecretNames = repositoryConfiguration.success
      ? repositoryCredentialSecretNames(repositoryConfiguration.data.authMode)
      : [];
    const requestedSecretNames = [...new Set([...projectSecretNames, ...repositorySecretNames])].sort();
    const resolvedProjectEnvironment = requestedSecretNames.length > 0
      ? await dependencies.resolveProjectEnvironmentSecrets({ projectId: candidate.projectId ?? "", names: requestedSecretNames })
      : {};
    const projectEnvironment = repositoryConfiguration.success
      ? repositoryCredentialEnvironment(repositoryConfiguration.data.authMode, resolvedProjectEnvironment)
      : resolvedProjectEnvironment;
    const modelSite = await dependencies.resolveModelSiteSecret({
      scope: workerResourceScope(input),
      siteId: stage.siteId,
    });
    const executionSnapshot = resolveWorkerExecutionSnapshot({
      workerPoolId: input.poolId,
      ...(fixedInstance ? { workerInstanceId: input.instanceId } : {}),
      repository: { url: workerConfig.repositoryUrl, branch, branchPolicy: workerConfig.branchPolicy },
      stageConfigurations: workerConfig.stageConfigurations,
      modelSites: [modelSite],
      nodeKey: candidate.loopNodeRun.nodeKey,
      requiredCapabilities: node.requiredCapabilities ?? [],
      requireGitDelivery: stage.requireGitDelivery ?? /(?:开发|实现|测试|build|code)/iu.test(node.label),
      grants: readGrantSnapshots(candidate.loopRun.grantSnapshot),
    });
    const nextGeneration = candidate.leaseGeneration + 1;
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseDurationMs);
    const claimed = await tx.agentRun.updateMany({
      where: {
        id: candidate.id,
        status: "queued",
        workerId: null,
        linuxWorkerPoolSessionId: null,
        leaseGeneration: candidate.leaseGeneration,
      },
      data: {
        status: "claimed",
        linuxWorkerPoolSessionId: input.sessionId,
        leaseGeneration: nextGeneration,
        leaseExpiresAt,
        lastHeartbeatAt: input.now,
        inputSnapshot: normalizePrismaJson(withLinuxExecutionSnapshot(candidate.inputSnapshot, executionSnapshot)),
        version: { increment: 1 },
      },
    });
    if (claimed.count !== 1) throw staleLeaseError();
    // The node is selected for a Linux Pool at claim time. Persist this before
    // the Worker starts so running and failed attempts never appear as local.
    if (tx.loopNodeRun) {
      const selected = await tx.loopNodeRun.updateMany({
        where: {
          id: candidate.loopNodeRun.id,
          loopRunId: candidate.loopRun.id,
          status: "running",
        },
        data: { selectedExecutionTarget: "linux_worker_pool" },
      });
      if (selected.count !== 1) throw staleLeaseError();
    }
    return {
      assignment: {
        workerKind: "linux",
        agentRunId: candidate.id,
        loopRunId: candidate.loopRun.id,
        loopNodeRunId: candidate.loopNodeRun.id,
        loopNodeAttemptId: candidate.loopNodeAttempt.id,
        attemptNo: candidate.attempt,
        leaseGeneration: nextGeneration,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
        acceptedThroughSequence: candidate.lastEventSequence,
        stageRef: {
          loopDefinitionId: candidate.loopRun.loopVersion.loopDefinitionId,
          loopVersionId: candidate.loopRun.loopVersion.id,
          nodeId: candidate.loopNodeRun.nodeKey,
          subloopId: candidate.loopNodeRun.nodeKey,
        },
        node,
        graph,
        inputSnapshot: assignmentInputSnapshot,
        policySnapshot: candidate.loopRun.policySnapshot,
        grantSnapshot: candidate.loopRun.grantSnapshot ?? {},
        prompt: buildLinuxWorkerStagePrompt({
          task: task ?? scheduledTaskPromptTask(scheduledTaskRun),
          node,
          taskBranch: branch,
          requireGitDelivery: executionSnapshot.deliveryPolicy.requireGitDelivery,
          inputSnapshot: assignmentInputSnapshot,
        }),
        resultSchemaPath: `.humanthread/loop/results/${candidate.loopNodeAttempt.id}.schema.json`,
        executionSnapshot,
        executionCredentials: {
          apiKey: modelSite.apiKey,
          ...(Object.keys(projectEnvironment).length > 0 ? { environment: projectEnvironment } : {}),
        },
      },
      leaseDurationMs: input.leaseDurationMs,
    };
}

export type LinuxWorkerAssignment = {
  workerKind: "linux";
  agentRunId: string;
  loopRunId: string;
  loopNodeRunId: string;
  loopNodeAttemptId: string;
  attemptNo: number;
  leaseGeneration: number;
  leaseExpiresAt: string;
  acceptedThroughSequence: number;
  stageRef: {
    loopDefinitionId: string;
    loopVersionId: string;
    nodeId: string;
    subloopId: string;
  };
  node: unknown;
  graph: unknown;
  inputSnapshot: unknown;
  policySnapshot: unknown;
  grantSnapshot: unknown;
  prompt: string;
  resultSchemaPath: string;
  executionSnapshot: WorkerExecutionSnapshot;
  executionCredentials: { apiKey: string; environment?: Record<string, string> };
  checklistMcp?: { url: string };
  liveSession?: {
    sessionId: string;
    relayUrl: string;
    authorization: string;
    initialCols: number;
    initialRows: number;
  };
};

function matchesLinuxWorkerCandidate(input: {
  row: {
    project: { ownerType: string; ownerUserId: string | null; companyId: string | null } | null;
    agentProfile: { provider: string; status: string; capabilities: unknown };
    loopNodeRun: { nodeKey: string } | null;
    loopRun: { bindingSnapshot: unknown; executionSnapshot?: unknown; loopVersion: { graph: unknown } | null } | null;
  };
  poolId: string;
  scope: { ownerType: "personal" | "company"; ownerUserId: string | null; companyId: string | null };
  advertisedCapabilities: string[];
}): boolean {
  if (!hasLinuxWorkerExecution(input.row.loopRun?.executionSnapshot, input.row.loopRun?.bindingSnapshot)) return false;
  const binding = parseLinuxWorkerBinding(input.row.loopRun?.executionSnapshot, input.row.loopRun?.bindingSnapshot);
  if (binding.poolId !== input.poolId || !sameWorkerResourceScope(input.row.project, input.scope)) return false;
  const graph = input.row.loopRun?.loopVersion
    ? buildLoopAssignmentExecutionView(input.row.loopRun.loopVersion.graph)
    : null;
  const node = graph?.nodes.find(({ key }) => key === input.row.loopNodeRun?.nodeKey);
  return Boolean(
    node
    && node.type === "agent_action"
    && matchesAgentRunCapabilities({
      workerCapabilities: input.advertisedCapabilities,
      advertisedCapabilities: input.advertisedCapabilities,
      runtimeCapabilities: input.advertisedCapabilities,
      // AgentProfile capabilities describe the Local Agent adapter. Linux
      // Workers advertise their own capabilities and must not inherit the
      // desktop profile's requirements (for example structured_result).
      profileCapabilities: [],
      requiredCapabilities: node.requiredCapabilities ?? [],
    }),
  );
}

function parseLinuxWorkerBinding(executionSnapshot: unknown, bindingSnapshot: unknown): {
  poolId: string;
  repositoryUrl: string;
  branchPolicy: { allowedBranches: string[] };
  stageConfigurations: Record<string, { siteId: string; model: string; reasoningEffort: string; requireGitDelivery?: boolean }>;
} {
  const execution = recordValue(recordValue(executionSnapshot).workerExecution);
  const legacyExecution = recordValue(recordValue(bindingSnapshot).workerExecution);
  const source = Object.keys(execution).length > 0 ? execution : legacyExecution;
  const poolId = typeof source.workerPoolId === "string" ? source.workerPoolId : "";
  const repositoryUrl = typeof source.workerRepositoryUrl === "string" ? source.workerRepositoryUrl : "";
  const branchPolicy = recordValue(source.workerBranchPolicy);
  const allowedBranches = stringArray(branchPolicy.allowedBranches);
  const stageConfigurations = Object.fromEntries(Object.entries(recordValue(source.workerStageConfigurations)).flatMap(([nodeKey, raw]) => {
    const stage = recordValue(raw);
    return typeof stage.siteId === "string" && typeof stage.model === "string" && typeof stage.reasoningEffort === "string"
      && (stage.requireGitDelivery === undefined || typeof stage.requireGitDelivery === "boolean")
      ? [[nodeKey, { siteId: stage.siteId, model: stage.model, reasoningEffort: stage.reasoningEffort, ...(typeof stage.requireGitDelivery === "boolean" ? { requireGitDelivery: stage.requireGitDelivery } : {}) }]]
      : [];
  }));
  return { poolId, repositoryUrl, branchPolicy: { allowedBranches }, stageConfigurations };
}

function projectEnvironmentSecretNames(value: unknown): string[] {
  const configuration = recordValue(value);
  const entries = Array.isArray(configuration.entries) ? configuration.entries : [];
  return [...new Set(entries.flatMap((entry) => {
    const candidate = recordValue(entry);
    const name = typeof candidate.name === "string" ? candidate.name.trim().toUpperCase() : "";
    const targets = stringArray(candidate.executionTargets);
    return /^[A-Z][A-Z0-9_]*$/u.test(name)
      && candidate.sourceType === "humanthread"
      && candidate.status === "configured"
      && targets.includes("worker")
      ? [name]
      : [];
  }))].sort();
}

function repositoryCredentialEnvironment(
  authMode: "account_password" | "project_token",
  values: Record<string, string>,
): Record<string, string> {
  const username = values.HT_GIT_USERNAME?.trim() ?? "";
  const secret = (authMode === "project_token" ? values.HT_GIT_TOKEN : values.HT_GIT_PASSWORD)?.trim() ?? "";
  if (!username || !secret) throw repositoryCredentialUnverified();
  const environment = { ...values };
  delete environment.HT_GIT_TOKEN;
  delete environment.HT_GIT_PASSWORD;
  environment.HT_GIT_USERNAME = username;
  environment.HT_GIT_SECRET = secret;
  return environment;
}

function repositoryCredentialUnverified(): Error & { code: string } {
  return Object.assign(new Error("项目仓库凭证尚未通过校验"), { code: "repository_credential_unverified" });
}

function workerResourceScope(input: Pick<ClaimLinuxWorkerAssignmentInput, "ownerType" | "ownerUserId" | "companyId">) {
  if (input.ownerType === "personal") {
    if (!input.ownerUserId || input.companyId !== null) throw configurationRequired();
  } else if (!input.companyId || input.ownerUserId !== null) {
    throw configurationRequired();
  }
  return { ownerType: input.ownerType, ownerUserId: input.ownerUserId, companyId: input.companyId };
}

function sameWorkerResourceScope(
  project: LinuxWorkerClaimCandidate["project"],
  scope: { ownerType: "personal" | "company"; ownerUserId: string | null; companyId: string | null },
): boolean {
  return project?.ownerType === scope.ownerType
    && project.ownerUserId === scope.ownerUserId
    && project.companyId === scope.companyId;
}

function enabledLinuxCapabilities(capabilities: Record<string, unknown>): string[] {
  return Object.entries(capabilities)
    .filter(([, enabled]) => enabled === true)
    .map(([capability]) => capability)
    .concat("codex");
}

export function resolveLinuxWorkerBranch(taskBranch: string | null, policy: { allowedBranches: string[] }): string {
  const literalBranches = policy.allowedBranches.filter((candidate) => isValidWorkerBranchName(candidate));
  const branch = taskBranch
    ?? literalBranches.find((candidate) => candidate === "main")
    ?? literalBranches.find((candidate) => candidate === "master")
    ?? literalBranches[0];
  if (!branch || !isValidWorkerBranchName(branch) || !policy.allowedBranches.some((pattern) => matchesWorkerBranchPattern(branch, pattern))) {
    throw configurationRequired();
  }
  return branch;
}

function readGrantSnapshots(value: unknown): unknown[] {
  const snapshot = recordValue(value);
  return Array.isArray(snapshot.grants) ? snapshot.grants : [];
}

function withLinuxExecutionSnapshot(input: unknown, executionSnapshot: WorkerExecutionSnapshot): unknown {
  return { ...recordValue(input), workerExecutionSnapshot: executionSnapshot };
}

type TaskExecutionContext = {
  id: string;
  projectId: string | null;
  taskNumber: number | null;
  shortId: string | null;
  taskBranch: string | null;
  createdAt: Date;
  project: { productionBranch: string | null; stagingBranch: string | null } | null;
};

type LinuxWorkerPromptTask = Pick<TaskExecutionContext, "id" | "projectId" | "taskNumber" | "shortId"> & {
  title: string;
  description: string;
  contentMarkdown: string;
};

type LinuxWorkerPromptNode = {
  key: string;
  label: string;
  promptTemplate: string;
};

function boundedPromptText(value: string, maxLength = 12_000): string {
  const normalized = value.trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}\n\n[Task content truncated by the platform]`;
}

const sensitiveInputKey = /(?:token|password|secret|credential|authorization|cookie|api[_-]?key|dsn|database[_-]?url|private[_-]?key|ssh[_-]?key|basic[_-]?auth|access[_-]?key|client[_-]?secret)/iu;
const sensitiveInputValue = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\b|\b(?:mysql|postgres(?:ql)?|mongodb(?:\+srv)?):\/\/[^\s]+|\bhttps?:\/\/[^\s:@]+:[^\s@]+@[^\s]+/giu;
const sensitiveInputAssignment = /((?:access[_-]?key|api[_-]?key|authorization|client[_-]?secret|credential|password|secret|token)\s*[=:]\s*)[^\s,;]+/giu;

function redactWorkerPromptInput(value: unknown, key?: string): unknown {
  if (key && sensitiveInputKey.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return value
      .replace(sensitiveInputValue, "[REDACTED]")
      .replace(sensitiveInputAssignment, "$1[REDACTED]");
  }
  if (Array.isArray(value)) return value.map((item) => redactWorkerPromptInput(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactWorkerPromptInput(entryValue, entryKey),
    ]));
  }
  return value;
}

export function sanitizeWorkerInputSnapshot(value: unknown): unknown {
  return redactWorkerPromptInput(value);
}

function serializeWorkerPromptInput(value: unknown): string {
  try {
    return boundedPromptText(JSON.stringify(redactWorkerPromptInput(value)) ?? "{}", 8_000);
  } catch {
    return "[Run input unavailable]";
  }
}

export function buildLinuxWorkerStagePrompt(input: {
  task: LinuxWorkerPromptTask | null;
  node: LinuxWorkerPromptNode;
  taskBranch: string;
  requireGitDelivery: boolean;
  inputSnapshot?: unknown;
}): string {
  const task = input.task;
  const taskIdentity = task
    ? `${task.shortId ?? task.id}${task.taskNumber === null || task.taskNumber === undefined ? "" : ` (#${task.taskNumber})`}`
    : "Unavailable task identity";
  const taskTitle = task?.title.trim() || "Untitled task";
  const taskDescription = task?.description.trim() || "No task description was provided.";
  const taskContent = task?.contentMarkdown.trim();
  const deliveryRequirement = input.requireGitDelivery
    ? "Implement the assigned work, run relevant checks, commit and push the task branch. Do not report success without a pushed task commit."
    : "Complete only this stage. Do not make or push unrelated code changes unless the stage explicitly requires it.";
  const scopeInstruction = "Keep the work within the assigned stage and its declared execution scope.";

  return [
    "You are executing one bounded HumanThread Loop stage in an isolated task worktree.",
    "Use the Run input below as execution context. Before acting, inspect repository-local instructions and Stage Package when present; follow those local rules as authoritative for this stage.",
    "",
    `Task: ${boundedPromptText(taskTitle, 512)} (${taskIdentity})`,
    `Task branch: ${input.taskBranch}`,
    `Node: ${input.node.label} (${input.node.key})`,
    "",
    "Task description:",
    boundedPromptText(taskDescription),
    ...(taskContent ? ["", "Task details and acceptance criteria:", boundedPromptText(taskContent)] : []),
    ...(input.inputSnapshot === undefined ? [] : ["", "Run input (credentials redacted):", serializeWorkerPromptInput(input.inputSnapshot)]),
    "",
    "Stage instructions:",
    boundedPromptText(input.node.promptTemplate || "Complete the stage described above.", 4_000),
    "",
    "Delivery contract:",
    deliveryRequirement,
    `${scopeInstruction} Report concrete results and any blockers through the Loop checklist protocol.`,
  ].join("\n");
}

export function withTaskExecutionContext(
  inputSnapshot: unknown,
  task: TaskExecutionContext | null,
): unknown {
  if (!task?.projectId || !task.shortId || !Number.isInteger(task.taskNumber)) return inputSnapshot;
  const taskBranch = task.taskBranch ?? deriveTaskBranch({ createdAt: task.createdAt, shortId: task.shortId });
  const input = inputSnapshot && typeof inputSnapshot === "object" && !Array.isArray(inputSnapshot)
    ? inputSnapshot as Record<string, unknown>
    : { nodeInput: inputSnapshot };
  return {
    ...input,
    taskId: task.id,
    projectId: task.projectId,
    taskNumber: task.taskNumber,
    shortId: task.shortId,
    taskBranch,
    taskCreatedAt: task.createdAt.toISOString(),
    productionBranch: task.project?.productionBranch ?? null,
    stagingBranch: task.project?.stagingBranch ?? null,
  };
}

export function scheduledTaskPromptTask(value: {
  id: string;
  taskSnapshot: unknown;
  contentMode: string;
  contentSnapshot: string | null;
} | null): LinuxWorkerPromptTask | null {
  if (!value) return null;
  if (value.contentMode !== "platform" && value.contentMode !== "loop_managed") throw configurationRequired();
  const snapshot = recordValue(value.taskSnapshot);
  const name = typeof snapshot.name === "string" ? snapshot.name : "Scheduled task";
  const description = typeof snapshot.description === "string" ? snapshot.description : "";
  const contentMarkdown = value.contentMode === "platform" ? requiredPlatformContent(value) : "";
  return {
    id: value.id,
    projectId: null,
    taskNumber: null,
    shortId: null,
    title: name,
    description,
    contentMarkdown,
  };
}

function scheduledTaskRunExecutionContext(value: ScheduledTaskRunSelection | null): {
  id: string;
  taskSnapshot: unknown;
  contentMode: string;
  contentSnapshot: string | null;
} | null {
  if (!value) return null;
  const contentMode = recordValue(value.taskSnapshot).contentMode;
  if (contentMode !== "platform" && contentMode !== "loop_managed") throw configurationRequired();
  return { ...value, contentMode };
}

export function withScheduledTaskExecutionContext(
  inputSnapshot: unknown,
  value: {
    id: string;
    taskSnapshot: unknown;
    contentMode: string;
    contentSnapshot: string | null;
  } | null,
): unknown {
  if (!value) return inputSnapshot;
  if (value.contentMode !== "platform" && value.contentMode !== "loop_managed") throw configurationRequired();
  const snapshot = recordValue(value.taskSnapshot);
  const scheduledTask = {
    id: value.id,
    name: typeof snapshot.name === "string" ? snapshot.name : "Scheduled task",
    description: typeof snapshot.description === "string" ? snapshot.description : "",
    contentMode: value.contentMode,
    ...(value.contentMode === "platform" ? { contentMarkdown: requiredPlatformContent(value) } : {}),
  };
  return { ...recordValue(inputSnapshot), scheduledTask };
}

function requiredPlatformContent(value: {
  contentMode: string;
  contentSnapshot: string | null;
}): string {
  const contentMarkdown = value.contentSnapshot?.trim();
  if (value.contentMode !== "platform" || !contentMarkdown) throw configurationRequired();
  return contentMarkdown;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function heartbeatLoopAssignmentWithPrisma(
  input: Parameters<typeof heartbeatLoopAssignment>[0],
) {
  return heartbeatLoopAssignment(input, {
    heartbeat: (command) => prisma.$transaction(async (tx) => {
      const advertisedCapabilities = [
        ...command.capabilitySnapshot.capabilities,
        ...command.capabilitySnapshot.providers.map(({ name }) => name),
      ];
      const run = await tx.agentRun.findUnique({
        where: { id: command.agentRunId },
        select: {
          taskId: true,
          workerId: true,
          leaseGeneration: true,
          leaseExpiresAt: true,
          status: true,
          agentProfile: { select: { provider: true, capabilities: true } },
          worker: {
            select: {
              localDeviceId: true,
              status: true,
              capabilities: true,
            },
          },
          loopNodeRun: {
            select: {
              nodeKey: true,
              loopRun: {
                select: {
                  engineKind: true,
                  loopVersion: { select: { graph: true } },
                },
              },
            },
          },
        },
      });
      const graphValue = run?.loopNodeRun?.loopRun.loopVersion?.graph;
      if (
        !run
        || run.taskId !== null
        || run.workerId !== command.workerId
        || run.leaseGeneration !== command.leaseGeneration
        || !run.leaseExpiresAt
        || run.leaseExpiresAt <= command.now
        || !["claimed", "starting", "running", "waiting_approval"].includes(run.status)
        || run.worker?.localDeviceId !== command.deviceId
        || run.worker.status !== "online"
        || run.loopNodeRun?.loopRun.engineKind !== "graph_v1"
        || graphValue === undefined
      ) throw staleLeaseError();
      const graph = buildLoopAssignmentExecutionView(graphValue);
      const node = graph.nodes.find(({ key }) => key === run.loopNodeRun?.nodeKey);
      const runtime = await tx.deviceAgentRuntimeProfile.findFirst({
        where: {
          localDeviceId: command.deviceId,
          provider: run.agentProfile.provider,
          status: "ready",
        },
        select: { capabilities: true },
      });
      if (
        !node
        || node.type !== "agent_action"
        || !matchesAgentRunCapabilities({
          workerCapabilities: stringArray(run.worker.capabilities),
          advertisedCapabilities,
          runtimeCapabilities: stringArray(runtime?.capabilities),
          profileCapabilities: stringArray(run.agentProfile.capabilities),
          requiredCapabilities: node.requiredCapabilities ?? [],
        })
      ) throw staleLeaseError();
      const worker = await tx.agentWorker.updateMany({
        where: {
          id: command.workerId,
          localDeviceId: command.deviceId,
          status: "online",
        },
        data: {
          capabilities: advertisedCapabilities,
          maxConcurrentRuns: command.capabilitySnapshot.maxConcurrency,
          ...(command.agentVersion === undefined ? {} : { agentVersion: command.agentVersion }),
          lastHeartbeatAt: command.now,
        },
      });
      const device = await tx.localDevice.updateMany({
        where: { id: command.deviceId, status: "authorized" },
        data: {
          capabilitySnapshot: command.capabilitySnapshot,
          lastSeenAt: command.now,
        },
      });
      if (worker.count !== 1 || device.count !== 1) throw staleLeaseError();
      return heartbeatAgentRun({
        tx,
        runId: command.agentRunId,
        workerId: command.workerId,
        leaseGeneration: command.leaseGeneration,
        now: command.now,
        leaseDurationMs: command.leaseDurationMs,
      });
    }),
  });
}

export async function heartbeatLinuxWorkerAssignmentWithPrisma(
  input: HeartbeatLinuxWorkerAssignmentInput,
) {
  return heartbeatLinuxWorkerAssignment(input, {
    heartbeat: (command) => prisma.$transaction(async (tx) => {
      const run = await tx.agentRun.findUnique({
        where: { id: command.agentRunId },
        select: {
          taskId: true,
          workerId: true,
          linuxWorkerPoolSessionId: true,
          leaseGeneration: true,
          leaseExpiresAt: true,
          status: true,
          loopNodeRun: { select: { loopRun: { select: { engineKind: true } } } },
        },
      });
      if (
        !run
        || run.taskId !== null
        || run.workerId !== null
        || run.linuxWorkerPoolSessionId !== command.sessionId
        || run.leaseGeneration !== command.leaseGeneration
        || !run.leaseExpiresAt
        || run.leaseExpiresAt <= command.now
        || !["claimed", "starting", "running", "waiting_approval"].includes(run.status)
        || run.loopNodeRun?.loopRun.engineKind !== "graph_v1"
      ) throw staleLeaseError();

      const [session, pool] = await Promise.all([
        tx.workerPoolSession.updateMany({
          where: {
            id: command.sessionId,
            workerPoolId: command.poolId,
            status: "active",
            revokedAt: null,
            expiresAt: { gt: command.now },
          },
          data: { lastSeenAt: command.now },
        }),
        tx.workerPool.updateMany({
          where: { id: command.poolId, status: "active", revokedAt: null },
          data: { lastSeenAt: command.now },
        }),
      ]);
      if (session.count !== 1 || pool.count !== 1) throw staleLeaseError();

      const leaseExpiresAt = new Date(command.now.getTime() + command.leaseDurationMs);
      const updated = await tx.agentRun.updateMany({
        where: {
          id: command.agentRunId,
          taskId: null,
          workerId: null,
          linuxWorkerPoolSessionId: command.sessionId,
          leaseGeneration: command.leaseGeneration,
          status: { in: ["claimed", "starting", "running", "waiting_approval"] },
          leaseExpiresAt: { gt: command.now },
        },
        data: {
          lastHeartbeatAt: command.now,
          leaseExpiresAt,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw staleLeaseError();
      return { leaseExpiresAt };
    }),
  });
}

export async function appendLoopAssignmentEventsWithPrisma(
  input: AppendLoopAssignmentEventsInput,
) {
  return appendLoopAssignmentEvents(input, {
    persistEvents: async (command) => {
      await appendLoopAttemptEvents({
        agentRunId: command.agentRunId,
        attemptId: command.loopNodeAttemptId,
        workerId: command.workerId,
        leaseGeneration: command.leaseGeneration,
        events: command.events,
      });
      return {
        acceptedThroughSequence: command.events.at(-1)?.sequence ?? 0,
      };
    },
  });
}

export async function appendLinuxWorkerAssignmentEventsWithPrisma(
  input: AppendLinuxWorkerAssignmentEventsInput,
) {
  return appendLinuxWorkerAssignmentEvents(input, {
    persistEvents: async (command) => {
      await appendLoopAttemptEvents({
        agentRunId: command.agentRunId,
        attemptId: command.loopNodeAttemptId,
        linuxWorkerPoolSessionId: command.sessionId,
        leaseGeneration: command.leaseGeneration,
        events: command.events,
      });
      return {
        acceptedThroughSequence: command.events.at(-1)?.sequence ?? 0,
      };
    },
  });
}

/**
 * The execution model never supplies Run/Attempt/lease identity for a runtime
 * checklist. This command resolves the live lease from the authenticated
 * Worker session and creates the next durable lifecycle event server-side.
 */
export async function writeLinuxWorkerChecklistWithPrisma(
  input: WriteLinuxWorkerChecklistInput,
): Promise<{ acceptedThroughSequence: number }> {
  return writeChecklistWithSequenceRetry(
    () => writeLinuxWorkerChecklistOnce(input),
  );
}

/**
 * Opens the one runtime intervention for the Attempt on this Worker lease.
 *
 * A stage Agent is the only actor that knows when it is genuinely blocked, so
 * it may ask for a human directly instead of ending its turn with prose that
 * the platform would otherwise record as success. Every piece of orchestration
 * identity is resolved from the authenticated lease: the caller supplies only
 * a command id, a reason and optional evidence.
 */
export async function requestLinuxWorkerInterventionWithPrisma(
  input: RequestLinuxWorkerInterventionInput,
): Promise<{ interactionId: string; status: string; loopRunId: string }> {
  const agentRun = await prisma.agentRun.findUnique({
    where: { id: input.agentRunId },
    select: {
      id: true,
      status: true,
      attempt: true,
      loopRunId: true,
      loopNodeRunId: true,
      leaseGeneration: true,
      leaseExpiresAt: true,
      linuxWorkerPoolSessionId: true,
      loopNodeAttempt: { select: { id: true } },
    },
  });
  if (
    !agentRun
    || !agentRun.loopRunId
    || !agentRun.loopNodeRunId
    || !agentRun.loopNodeAttempt
    || agentRun.linuxWorkerPoolSessionId !== input.sessionId
    || !agentRun.leaseExpiresAt
    || agentRun.leaseExpiresAt <= input.now
    || !["claimed", "starting", "running", "waiting_approval"].includes(agentRun.status)
  ) throw staleLeaseError();
  const pages = registerInterventionPages(input.pages);
  const result = await requestRuntimeIntervention({
    loopNodeAttemptId: agentRun.loopNodeAttempt.id,
    actor: { type: "agent", id: `worker:${input.poolId}`, runId: agentRun.id },
    commandId: input.commandId,
    reason: input.reason,
    ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
    ...(pages.length === 0 ? {} : { reviewPages: pages }),
    occurredAt: input.now,
    correlationId: `loop:${agentRun.loopRunId}`,
  });
  // Pages only become readable once they are bound to the interaction the
  // human was actually asked to answer.
  if (pages.length > 0) {
    bindTemporaryReviewPages({
      interactionId: result.interactionId,
      tokens: pages.map((page) => page.token),
    });
  }
  return {
    interactionId: result.interactionId,
    status: result.status,
    loopRunId: result.loopRunId,
  };
}

/**
 * Turns Agent-supplied HTML into proxy references. Registration happens before
 * the intervention exists; the platform layer binds the returned tokens to the
 * interaction it creates, so an unbound page is never readable.
 */
function registerInterventionPages(
  pages: Array<{ fileName: string; html: string }> | undefined,
): Array<{ token: string; fileName: string; byteSize: number; checksum: string }> {
  if (!pages || pages.length === 0) return [];
  if (pages.length > TEMPORARY_REVIEW_PAGE_MAX_PER_INTERACTION) {
    throw Object.assign(
      new Error(`A runtime intervention may attach at most ${TEMPORARY_REVIEW_PAGE_MAX_PER_INTERACTION} review pages`),
      { code: "validation_failed" },
    );
  }
  return pages.map((page) => registerTemporaryReviewPage({ fileName: page.fileName, html: page.html }));
}

/**
 * Reads the intervention attached to this Attempt. A resumed stage uses it to
 * learn the human's answer; without it the Agent would re-ask the same
 * question and the Loop would stall in a request/answer cycle.
 */
export async function readLinuxWorkerInterventionWithPrisma(
  input: { agentRunId: string; poolId: string; sessionId: string; now: Date },
): Promise<{ interactionId: string | null; status: string | null; decision: unknown; messages: unknown[] }> {
  const agentRun = await prisma.agentRun.findUnique({
    where: { id: input.agentRunId },
    select: {
      id: true,
      status: true,
      loopRunId: true,
      loopNodeRunId: true,
      leaseGeneration: true,
      leaseExpiresAt: true,
      linuxWorkerPoolSessionId: true,
      loopNodeAttempt: { select: { id: true } },
    },
  });
  if (
    !agentRun
    || !agentRun.loopRunId
    || !agentRun.loopNodeRunId
    || !agentRun.loopNodeAttempt
    || agentRun.linuxWorkerPoolSessionId !== input.sessionId
    || !agentRun.leaseExpiresAt
    || agentRun.leaseExpiresAt <= input.now
    || !["claimed", "starting", "running", "waiting_approval"].includes(agentRun.status)
  ) throw staleLeaseError();
  const interaction = await prisma.workflowInteraction.findFirst({
    where: {
      loopRunId: agentRun.loopRunId,
      // The interaction is bound to the node run activation, not to a single
      // Attempt, so a resumed stage still finds the human's decision.
      loopNodeRunId: agentRun.loopNodeRunId,
      kind: "runtime_intervention",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      status: true,
      decision: { select: { decision: true, reason: true, selectedEdgeId: true } },
      messages: {
        orderBy: [{ sequence: "asc" }],
        select: { sequence: true, actorType: true, body: true, structuredAnswers: true, createdAt: true },
      },
    },
  });
  if (!interaction) return { interactionId: null, status: null, decision: null, messages: [] };
  return {
    interactionId: interaction.id,
    status: interaction.status,
    decision: interaction.decision,
    messages: interaction.messages,
  };
}

async function writeLinuxWorkerChecklistOnce(
  input: WriteLinuxWorkerChecklistInput,
): Promise<{ acceptedThroughSequence: number }> {
  const agentRun = await prisma.agentRun.findUnique({
    where: { id: input.agentRunId },
    select: {
      id: true,
      loopRunId: true,
      loopNodeRunId: true,
      attempt: true,
      leaseGeneration: true,
      lastEventSequence: true,
      linuxWorkerPoolSessionId: true,
      leaseExpiresAt: true,
      status: true,
      loopNodeAttempt: { select: { id: true } },
    },
  });
  if (
    !agentRun
    || !agentRun.loopRunId
    || !agentRun.loopNodeRunId
    || !agentRun.loopNodeAttempt
    || agentRun.linuxWorkerPoolSessionId !== input.sessionId
    || !agentRun.leaseExpiresAt
    || agentRun.leaseExpiresAt <= input.now
    || !["claimed", "starting", "running", "waiting_approval"].includes(agentRun.status)
  ) throw staleLeaseError();
  const sequence = agentRun.lastEventSequence + 1;
  const candidatePayload = {
    loopRunId: agentRun.loopRunId,
    loopNodeRunId: agentRun.loopNodeRunId,
    loopNodeAttemptId: agentRun.loopNodeAttempt.id,
    attemptNo: agentRun.attempt,
    leaseGeneration: agentRun.leaseGeneration,
    ...input.payload,
  };
  const boundPayload = input.operation === "create"
    ? loopChecklistCreatedPayloadSchema.parse(candidatePayload)
    : loopChecklistUpdatedPayloadSchema.parse(candidatePayload);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([input.operation, boundPayload]))
    .digest("hex");
  await appendLinuxWorkerAssignmentEventsWithPrisma({
    agentRunId: agentRun.id,
    sessionId: input.sessionId,
    leaseGeneration: agentRun.leaseGeneration,
    commandId: `checklist:${fingerprint}`,
    loopNodeAttemptId: agentRun.loopNodeAttempt.id,
    events: [{
      eventId: boundedPersistenceId("checklist", [agentRun.id, agentRun.loopNodeAttempt.id, input.operation, fingerprint]),
      loopRunId: agentRun.loopRunId,
      loopNodeRunId: agentRun.loopNodeRunId,
      loopNodeAttemptId: agentRun.loopNodeAttempt.id,
      attemptNo: agentRun.attempt,
      leaseGeneration: agentRun.leaseGeneration,
      sequence,
      eventType: input.operation === "create" ? "loop.checklist.created" : "loop.checklist.updated",
      occurredAt: input.now.toISOString(),
      payloadSummary: boundPayload,
      artifactRefs: [],
    }],
    now: input.now,
  });
  return { acceptedThroughSequence: sequence };
}

export async function readLinuxWorkerAssignmentSequenceWithPrisma(
  input: ReadLinuxWorkerAssignmentSequenceInput,
): Promise<{ acceptedThroughSequence: number }> {
  const run = await prisma.agentRun.findUnique({
    where: { id: input.agentRunId },
    select: { linuxWorkerPoolSessionId: true, leaseExpiresAt: true, status: true, lastEventSequence: true },
  });
  if (
    !run
    || run.linuxWorkerPoolSessionId !== input.sessionId
    || !run.leaseExpiresAt
    || run.leaseExpiresAt <= input.now
    || !["claimed", "starting", "running", "waiting_approval"].includes(run.status)
  ) throw staleLeaseError();
  return { acceptedThroughSequence: run.lastEventSequence };
}

export async function writeLocalWorkerChecklistWithPrisma(
  input: WriteLocalWorkerChecklistInput,
): Promise<{ acceptedThroughSequence: number }> {
  return writeChecklistWithSequenceRetry(
    () => writeLocalWorkerChecklistOnce(input),
  );
}

/**
 * Desktop Local Agent equivalent of the Worker intervention command. The Loop
 * identity comes from the leased AgentRun, never from the model.
 */
export async function requestLocalWorkerInterventionWithPrisma(
  input: RequestLocalWorkerInterventionInput,
): Promise<{ interactionId: string; status: string; loopRunId: string }> {
  const run = await loadGraphRun(input.agentRunId);
  if (
    !run
    || run.workerId !== input.workerId
    || run.leaseGeneration !== input.leaseGeneration
    || !run.leaseExpiresAt
    || run.leaseExpiresAt <= input.now
    || !run.loopNodeAttemptId
    || !run.loopNodeRunId
  ) throw staleLeaseError();
  const pages = registerInterventionPages(input.pages);
  const result = await requestRuntimeIntervention({
    loopNodeAttemptId: run.loopNodeAttemptId,
    actor: { type: "agent", id: `local-agent:${input.workerId}`, runId: run.id },
    commandId: input.commandId,
    reason: input.reason,
    ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
    ...(pages.length === 0 ? {} : { reviewPages: pages }),
    occurredAt: input.now,
    correlationId: `loop:${run.loopRunId}`,
  });
  if (pages.length > 0) {
    bindTemporaryReviewPages({
      interactionId: result.interactionId,
      tokens: pages.map((page) => page.token),
    });
  }
  return {
    interactionId: result.interactionId,
    status: result.status,
    loopRunId: result.loopRunId,
  };
}

/**
 * Desktop Local Agent equivalent of the Worker intervention read-back.
 */
export async function readLocalWorkerInterventionWithPrisma(
  input: { agentRunId: string; workerId: string; deviceId: string; leaseGeneration: number; now: Date },
): Promise<{ interactionId: string | null; status: string | null; decision: unknown; messages: unknown[] }> {
  const run = await loadGraphRun(input.agentRunId);
  if (
    !run
    || run.workerId !== input.workerId
    || run.leaseGeneration !== input.leaseGeneration
    || !run.leaseExpiresAt
    || run.leaseExpiresAt <= input.now
    || !run.loopNodeAttemptId
    || !run.loopNodeRunId
  ) throw staleLeaseError();
  const loopNodeRunId = run.loopNodeRunId;
  const interaction = await prisma.workflowInteraction.findFirst({
    where: {
      // Bound to the node run activation so a resumed Attempt still sees the
      // decision the human made for this stage.
      loopNodeRunId,
      kind: "runtime_intervention",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      status: true,
      decision: { select: { decision: true, reason: true, selectedEdgeId: true } },
      messages: {
        orderBy: [{ sequence: "asc" }],
        select: { sequence: true, actorType: true, body: true, structuredAnswers: true, createdAt: true },
      },
    },
  });
  if (!interaction) return { interactionId: null, status: null, decision: null, messages: [] };
  return {
    interactionId: interaction.id,
    status: interaction.status,
    decision: interaction.decision,
    messages: interaction.messages,
  };
}

async function writeLocalWorkerChecklistOnce(
  input: WriteLocalWorkerChecklistInput,
): Promise<{ acceptedThroughSequence: number }> {
  const run = await loadGraphRun(input.agentRunId);
  if (
    !run
    || run.workerId !== input.workerId
    || run.leaseGeneration !== input.leaseGeneration
    || !run.leaseExpiresAt
    || run.leaseExpiresAt <= input.now
  ) throw staleLeaseError();
  const loopRunId = run.loopRunId;
  const loopNodeRunId = run.loopNodeRunId;
  const loopNodeAttemptId = run.loopNodeAttemptId;
  if (!loopRunId || !loopNodeRunId || !loopNodeAttemptId) throw staleLeaseError();
  const candidatePayload = {
    loopRunId,
    loopNodeRunId,
    loopNodeAttemptId,
    attemptNo: run.attempt,
    leaseGeneration: run.leaseGeneration,
    ...input.payload,
  };
  const payload = input.operation === "create"
    ? loopChecklistCreatedPayloadSchema.parse(candidatePayload)
    : loopChecklistUpdatedPayloadSchema.parse(candidatePayload);
  const fingerprint = createHash("sha256").update(JSON.stringify([input.operation, payload])).digest("hex");
  const sequence = run.lastEventSequence + 1;
  await appendLoopAssignmentEventsWithPrisma({
    agentRunId: input.agentRunId,
    workerId: input.workerId,
    deviceId: input.deviceId,
    leaseGeneration: input.leaseGeneration,
    commandId: `checklist:${fingerprint}`,
    loopNodeAttemptId,
    events: [{
      eventId: boundedPersistenceId("checklist", [run.id, loopNodeAttemptId, input.operation, fingerprint]),
      loopRunId,
      loopNodeRunId,
      loopNodeAttemptId,
      attemptNo: run.attempt,
      leaseGeneration: run.leaseGeneration,
      sequence,
      eventType: input.operation === "create" ? "loop.checklist.created" : "loop.checklist.updated",
      occurredAt: input.now.toISOString(),
      payloadSummary: payload,
      artifactRefs: [],
    }],
    now: input.now,
  });
  return { acceptedThroughSequence: sequence };
}

/**
 * App Server MCP calls can overlap a normal lifecycle write. Both paths are
 * lease-fenced, so retry just once after a sequence CAS loss; a real lease
 * loss is still rejected by the fresh read in the next attempt.
 */
async function writeChecklistWithSequenceRetry(
  write: () => Promise<{ acceptedThroughSequence: number }>,
): Promise<{ acceptedThroughSequence: number }> {
  try {
    return await write();
  } catch (error) {
    if (!(error && typeof error === "object" && Reflect.get(error, "code") === "stale_lease")) throw error;
    return write();
  }
}

export async function readLocalWorkerAssignmentSequenceWithPrisma(input: {
  agentRunId: string;
  workerId: string;
  leaseGeneration: number;
  now: Date;
}): Promise<{ acceptedThroughSequence: number }> {
  const run = await loadGraphRun(input.agentRunId);
  if (!run || run.workerId !== input.workerId || run.leaseGeneration !== input.leaseGeneration || !run.leaseExpiresAt || run.leaseExpiresAt <= input.now) {
    throw staleLeaseError();
  }
  return { acceptedThroughSequence: run.lastEventSequence };
}

export async function saveLoopAssignmentCheckpointWithPrisma(
  input: GraphMutationInput & { checkpoint: unknown },
) {
  return saveLoopAssignmentCheckpoint(input, {
    loadRun: loadGraphRun,
    persistCheckpoint: ({ run, command, storedCheckpoint }) => prisma.$transaction(async (tx) => {
      const checkpoint = normalizePrismaJson(storedCheckpoint);
      const agentRun = await tx.agentRun.updateMany({
        where: {
          id: run.id,
          taskId: null,
          loopRunId: command.loopRunId,
          loopNodeRunId: command.loopNodeRunId,
          attempt: command.attemptNo,
          workerId: command.workerId,
          leaseGeneration: command.leaseGeneration,
          status: { in: ["claimed", "starting", "running", "waiting_approval"] },
          leaseExpiresAt: { gt: command.now },
        },
        data: { checkpoint, version: { increment: 1 } },
      });
      const attempt = await tx.loopNodeAttempt.updateMany({
        where: {
          id: command.loopNodeAttemptId,
          loopNodeRunId: command.loopNodeRunId,
          agentRunId: command.agentRunId,
          executorType: "local",
          status: "running",
          version: run.attemptVersion,
        },
        data: { checkpoint, version: { increment: 1 } },
      });
      if (agentRun.count !== 1 || attempt.count !== 1) throw staleLeaseError();
      return { checkpointed: true, duplicate: false };
    }),
  });
}

export async function saveLinuxWorkerAssignmentCheckpointWithPrisma(
  input: SaveLinuxWorkerAssignmentCheckpointInput,
) {
  return saveLinuxWorkerAssignmentCheckpoint(input, {
    loadRun: loadGraphRun,
    persistCheckpoint: ({ run, command, storedCheckpoint }) => prisma.$transaction(async (tx) => {
      const checkpoint = normalizePrismaJson(storedCheckpoint);
      const agentRun = await tx.agentRun.updateMany({
        where: {
          id: run.id,
          taskId: null,
          loopRunId: command.loopRunId,
          loopNodeRunId: command.loopNodeRunId,
          attempt: command.attemptNo,
          workerId: null,
          linuxWorkerPoolSessionId: command.sessionId,
          leaseGeneration: command.leaseGeneration,
          status: { in: ["claimed", "starting", "running", "waiting_approval"] },
          leaseExpiresAt: { gt: command.now },
        },
        data: { checkpoint, version: { increment: 1 } },
      });
      const attempt = await tx.loopNodeAttempt.updateMany({
        where: {
          id: command.loopNodeAttemptId,
          loopNodeRunId: command.loopNodeRunId,
          agentRunId: command.agentRunId,
          executorType: "local",
          status: "running",
          version: run.attemptVersion,
        },
        data: { checkpoint, version: { increment: 1 } },
      });
      if (agentRun.count !== 1 || attempt.count !== 1) throw staleLeaseError();
      return { checkpointed: true, duplicate: false };
    }),
  });
}

export async function completeLoopAssignmentWithPrisma(
  input: CompleteLoopAssignmentInput,
) {
  return completeLoopAssignment(input, {
    loadRun: loadGraphRun,
    executeIdempotent: ({ apply }) => apply(),
    persistResult: ({ run, command, result, routeDecision }) => completeLoopNode({
      loopRunId: command.loopRunId,
      nodeRunId: command.loopNodeRunId,
      nodeRunVersion: run.nodeRunVersion,
      attemptId: command.loopNodeAttemptId,
      attemptNo: command.attemptNo,
      attemptVersion: run.attemptVersion,
      agentRunId: command.agentRunId,
      workerId: command.workerId,
      leaseGeneration: command.leaseGeneration,
      commandId: command.commandId,
      result,
      ...(routeDecision === undefined ? {} : { routeDecision }),
      occurredAt: command.now,
      correlationId: `loop:${command.loopRunId}`,
      actor: { type: "worker", id: command.workerId },
    }),
  });
}

export async function uploadLoopAssignmentArtifactWithPrisma(
  input: UploadLoopAssignmentArtifactInput,
) {
  if (input.workerId !== buildLocalAgentWorkerId(input.deviceId)) throw staleLeaseError();
  assertCommandId(input.commandId);
  const run = await loadGraphRun(input.agentRunId);
  assertLease(run, {
    runId: input.agentRunId,
    workerId: input.workerId,
    leaseGeneration: input.leaseGeneration,
    now: input.now,
  });
  assertGraphRunIdentity(run, input);
  if (!run.projectId) {
    throw Object.assign(new Error("Graph assignment Project is unavailable"), {
      code: "validation_failed",
    });
  }
  return saveLoopReviewArtifact({
    projectId: run.projectId,
    taskId: run.taskId,
    agentRunId: input.agentRunId,
    loopNodeRunId: input.loopNodeRunId,
    relativePath: input.relativePath,
    content: input.content,
    now: input.now,
  });
}

export async function uploadLinuxWorkerAssignmentArtifactWithPrisma(input: {
  agentRunId: string;
  sessionId: string;
  leaseGeneration: number;
  commandId: string;
  loopRunId: string;
  loopNodeRunId: string;
  loopNodeAttemptId: string;
  attemptNo: number;
  relativePath: string;
  content: string;
  now: Date;
}) {
  assertLinuxWorkerSessionIdentity(input.sessionId);
  assertCommandId(input.commandId);
  const run = await loadGraphRun(input.agentRunId);
  if (
    !run
    || run.workerId !== null
    || run.linuxWorkerPoolSessionId !== input.sessionId
    || run.leaseGeneration !== input.leaseGeneration
    || !run.leaseExpiresAt
    || run.leaseExpiresAt <= input.now
  ) throw staleLeaseError();
  assertGraphRunIdentity(run, input);
  if (!run.projectId) {
    throw Object.assign(new Error("Graph assignment Project is unavailable"), {
      code: "validation_failed",
    });
  }
  return saveLoopReviewArtifact({
    projectId: run.projectId,
    taskId: run.taskId,
    agentRunId: input.agentRunId,
    loopNodeRunId: input.loopNodeRunId,
    relativePath: input.relativePath,
    content: input.content,
    now: input.now,
  });
}

export async function completeLinuxWorkerAssignmentWithPrisma(
  input: CompleteLinuxWorkerAssignmentInput,
) {
  return completeLinuxWorkerAssignment(input, {
    loadRun: loadGraphRun,
    executeIdempotent: ({ apply }) => apply(),
    persistResult: ({ run, command, result, routeDecision }) => completeLoopNode({
      loopRunId: command.loopRunId,
      nodeRunId: command.loopNodeRunId,
      nodeRunVersion: run.nodeRunVersion,
      attemptId: command.loopNodeAttemptId,
      attemptNo: command.attemptNo,
      attemptVersion: run.attemptVersion,
      agentRunId: command.agentRunId,
      linuxWorkerPoolSessionId: command.sessionId,
      leaseGeneration: command.leaseGeneration,
      commandId: command.commandId,
      result,
      ...(routeDecision === undefined ? {} : { routeDecision }),
      occurredAt: command.now,
      correlationId: `loop:${command.loopRunId}`,
      actor: { type: "worker", id: `linux-worker:${command.sessionId}` },
    }),
  });
}

async function loadGraphRun(runId: string): Promise<GraphRunRecord | null> {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      projectId: true,
      taskId: true,
      loopRunId: true,
      loopNodeRunId: true,
      attempt: true,
      status: true,
      workerId: true,
      linuxWorkerPoolSessionId: true,
      leaseGeneration: true,
      leaseExpiresAt: true,
      lastEventSequence: true,
      checkpoint: true,
      loopNodeRun: { select: { version: true, attemptCount: true } },
      loopNodeAttempt: { select: { id: true, version: true } },
    },
  });
  if (!run || !run.loopNodeRun || !run.loopNodeAttempt) return null;
  return {
    ...run,
    loopNodeAttemptId: run.loopNodeAttempt.id,
    nodeRunVersion: run.loopNodeRun.version,
    nodeRunAttemptCount: run.loopNodeRun.attemptCount,
    attemptVersion: run.loopNodeAttempt.version,
  };
}

function staleLeaseError(): Error {
  return Object.assign(new Error("Stale or expired graph assignment lease"), {
    code: "stale_lease",
  });
}

function assertLinuxWorkerLeaseIdentity(poolId: string, sessionId: string): void {
  if (!/^[a-f0-9]{32}$/u.test(poolId)) {
    throw staleLeaseError();
  }
  assertLinuxWorkerSessionIdentity(sessionId);
}

function assertLinuxWorkerSessionIdentity(sessionId: string): void {
  if (!/^[a-f0-9]{32}$/u.test(sessionId)) throw staleLeaseError();
}

function normalizePrismaJson(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw Object.assign(new Error("Worker payload is not JSON serializable"), {
      code: "validation_failed",
    });
  }
  return JSON.parse(serialized) as Prisma.InputJsonValue;
}

function hasLinuxWorkerExecution(executionSnapshot: unknown, bindingSnapshot: unknown): boolean {
  const target = recordValue(executionSnapshot).target;
  if (recordValue(target).type === "linux_worker_pool") return true;
  if (recordValue(target).type === "local_agent") return false;
  return Object.prototype.hasOwnProperty.call(recordValue(bindingSnapshot), "workerExecution");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}

function parseWorkerCheckpoint(value: unknown): WorkerCheckpointEnvelope | null {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Reflect.get(value, "protocol") !== "loop-worker-checkpoint/v1"
    || typeof Reflect.get(value, "commandId") !== "string"
    || typeof Reflect.get(value, "fingerprint") !== "string"
  ) return null;
  return value as WorkerCheckpointEnvelope;
}

function readWorkerCheckpointValue(value: unknown): unknown {
  return parseWorkerCheckpoint(value)?.value;
}
