import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import {
  buildLoopTriggerIdentity,
  resolveDueScheduledTaskSlot,
  resolveLoopExecutionSnapshot,
  resolveLoopTriggerSnapshots,
  resolvePublishedRunGraphSnapshot,
  resolveScheduledPublishedRunGraphSnapshot,
  type LoopExecutionTarget,
} from "@humanthread/orchestration-core";
import type {
  ScheduledTaskRunStatus,
  ScheduledTaskTriggerSource,
} from "@humanthread/shared";
import { assertCanWriteProject } from "./access-control";
import { snapshotBindingGrants } from "./automation-grants";
import { derivedPersistenceId } from "./bounded-id";
import { createGraphLoopRun, type CreateGraphLoopRunInput } from "./loop-runtime";
import { readPublishedLoopVersionsForProject } from "./loop-run-snapshot-catalog";
import { prisma } from "./prisma";
import { isPrismaUniqueConstraintError } from "./prisma-errors";
import type { ScheduledTaskExecutionTargetSnapshot } from "./project-scheduled-task-commands";
import {
  projectScheduledTaskEventId,
  projectScheduledTaskRunId,
  scheduledTaskActorDigest,
  scheduledTaskProjectDigest,
} from "./project-scheduled-task-identity";

const ACTIVE_RUN_STATUSES = ["preparing", "running", "waiting"] as const;
const ACTIVE_LOOP_RUN_STATUSES = ["pending", "running", "waiting", "paused"] as const;
const ACTIVE_AGENT_RUN_STATUSES = ["claimed", "starting", "running", "waiting_approval"] as const;
const PREPARATION_LEASE_MS = 2 * 60_000;
const RECOVERY_MIN_AGE_MS = 30_000;
const RUN_STATUSES = new Set<string>([
  "preparing",
  "running",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
  "blocked",
]);

type LoadedScheduledTask = {
  id: string;
  projectDigest: string;
  status: string;
  version: number;
  name: string;
  description: string;
  cronExpression: string;
  timezone: string;
  contentMode: "platform" | "loop_managed";
  contentMarkdown: string | null;
  configurationSnapshot: Record<string, unknown>;
  executionTargetSnapshot: ScheduledTaskExecutionTargetSnapshot;
};

type ExistingScheduledTaskRun = {
  id: string;
  status: ScheduledTaskRunStatus;
};

type RunFailure = {
  status: "blocked" | "failed";
  failureCode: string;
  failureMessage: string;
};

type PreparingScheduledTaskRun = {
  id: string;
  scheduledTaskId: string;
  triggerKey: string;
  triggerSource: ScheduledTaskTriggerSource;
  scheduledFor: Date | null;
  triggeredAt: Date;
  version: number;
  preparationLeaseToken: string | null;
  preparationLeaseExpiresAt: Date | null;
  preparationSnapshot: unknown;
  taskSnapshot: Record<string, unknown>;
  contentSnapshot: string | null;
  executionTargetSnapshot: ScheduledTaskExecutionTargetSnapshot;
  loopRun: ScheduledTaskLoopRunReference | null;
};

type ScheduledTaskPreparation = {
  loopRunInput: Record<string, unknown>;
  taskSnapshot: Record<string, unknown>;
  executionTargetSnapshot: ScheduledTaskExecutionTargetSnapshot;
};

type ScheduledTaskLoopRunReference = {
  id: string;
  engineKind: "graph_v1";
  scheduledTaskRunId?: string | null;
  status?: string;
  finishedAt?: Date | null;
};

export interface ScheduledTaskExecutionTargetReadinessInput {
  project: {
    spaceId: string;
    ownerType: string;
    ownerUserId: string | null;
    companyId: string | null;
    workerPoolId: string | null;
  } | null;
  target: ScheduledTaskExecutionTargetSnapshot;
  profile?: { id: string; name: string; provider: string; status: string } | null;
  localWorkers?: Array<{
    status: string;
    lastHeartbeatAt: Date | null;
    providers: string[];
  }>;
  pool?: {
    id: string;
    displayName: string;
    status: string;
    revokedAt: Date | null;
    maxConcurrentRuns: number;
    sessions: Array<{
      requestedConcurrency: number;
      lastSeenAt: Date | null;
      expiresAt: Date;
      status: string;
      revokedAt: Date | null;
      linuxRuns: Array<{ id: string; status: string; leaseExpiresAt: Date | null }>;
    }>;
  } | null;
  now?: Date;
}

export interface ProjectScheduledTaskRunTriggerResult {
  runId: string;
  status: ScheduledTaskRunStatus;
  duplicate: boolean;
}

export interface ProjectScheduledTaskRuntimeDependencies {
  assertCanWriteProject(input: { userId: string; projectId: string }): Promise<unknown>;
  loadTask(input: { scheduledTaskId: string; projectDigest: string }): Promise<unknown | null>;
  countActiveRuns(input: { scheduledTaskId: string }): Promise<number>;
  findByTriggerKey(input: { triggerKey: string }): Promise<unknown | null>;
  createRunWithActiveGuard(input: { scheduledTaskId: string; data: Record<string, unknown> }): Promise<unknown>;
  persistPreparationSnapshot(input: {
    runId: string;
    expectedVersion: number;
    leaseToken: string;
    snapshot: ScheduledTaskPreparation;
    now: Date;
  }): Promise<{ updated: boolean; version: number | null }>;
  claimPreparingRun(input: {
    runId: string;
    expectedVersion: number;
    staleBefore: Date;
    leaseToken: string;
    leaseExpiresAt: Date;
    now: Date;
  }): Promise<{ claimed: boolean; version: number | null }>;
  completeRun(input: {
    runId: string;
    scheduledTaskId: string;
    commandId: string;
    loopRunReference: { id: string; engineKind: "graph_v1" };
    expectedVersion: number;
    leaseToken: string;
    status: ScheduledTaskRunStatus;
    finishedAt: Date | null;
    startedAt: Date;
    eventType: "scheduled_task.run_created";
    actorDigest: string;
    payload: Record<string, unknown>;
    taskSnapshot?: Record<string, unknown>;
    executionTargetSnapshot?: ScheduledTaskExecutionTargetSnapshot;
  }): Promise<unknown>;
  failRun(input: {
    runId: string;
    scheduledTaskId: string;
    commandId: string;
    finishedAt: Date;
    status: "blocked" | "failed";
    expectedVersion: number;
    leaseToken: string;
    failureCode: string;
    failureMessage: string;
    eventType: "scheduled_task.run_failed";
    actorDigest: string;
    payload: Record<string, unknown>;
  }): Promise<unknown>;
  createLoopRun(input: Record<string, unknown>): Promise<{ id: string; engineKind: "graph_v1" }>;
  loadLoopRunReference(input: { loopRunId: string }): Promise<(ScheduledTaskLoopRunReference & {
    projectId: string | null;
  }) | null>;
  loadBinding(input: { projectId: string; bindingId: string }): Promise<unknown | null>;
  loadPublishedVersions(input: { projectId: string }): Promise<unknown[]>;
  snapshotGrantRows(input: { bindingId: string; now: Date }): Promise<unknown[]>;
  resolveExecutionTarget(input: {
    projectId: string;
    target: ScheduledTaskExecutionTargetSnapshot;
  }): Promise<{ target: LoopExecutionTarget; resolvedAt: string }>;
  listPreparingRuns(input: { limit: number; now: Date; staleBefore: Date }): Promise<unknown[]>;
  now?(): Date;
}

const loopTriggerBindingSelect = {
  id: true,
  projectId: true,
  loopDefinitionId: true,
  activeVersionId: true,
  status: true,
  version: true,
  bindingRole: true,
  createdByUserId: true,
  triggerPolicy: true,
  parameterOverrides: true,
  notificationPolicy: true,
  automationGrantIds: true,
  allowedAgentProfileIds: true,
  allowedProviders: true,
  workerPoolId: true,
  workerRepositoryUrl: true,
  workerBranchPolicy: true,
  workerStageConfigurations: true,
  project: {
    select: {
      workerPoolId: true,
      workerRepositoryUrl: true,
      workerBranchPolicy: true,
    },
  },
  activeVersion: {
    select: {
      id: true,
      status: true,
      maxStages: true,
      maxRepeatCount: true,
      platformMaxTransitions: true,
    },
  },
  loopDefinition: {
    select: {
      name: true,
      scope: true,
      status: true,
      latestPublishedVersion: {
        select: {
          id: true,
          status: true,
          maxStages: true,
          maxRepeatCount: true,
          platformMaxTransitions: true,
        },
      },
    },
  },
} as const;

function validationError(message: string): Error & { code: "validation_failed" } {
  return Object.assign(new Error(message), { code: "validation_failed" as const });
}

function notFound(message: string): Error & { code: "not_found" } {
  return Object.assign(new Error(message), { code: "not_found" as const });
}

function policyDenied(message: string): Error & { code: "policy_denied" } {
  return Object.assign(new Error(message), { code: "policy_denied" as const });
}

function runInProgress(message: string): Error & { code: "run_in_progress" } {
  return Object.assign(new Error(message), { code: "run_in_progress" as const });
}

function scheduledTaskFailure(message: string, code: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function scheduledTaskRunOccupiesActiveSlot(run: {
  status: string;
  loopRun: { status: string } | null;
}): boolean {
  if ((ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status)) return true;
  return run.status === "blocked"
    && run.loopRun !== null
    && (ACTIVE_LOOP_RUN_STATUSES as readonly string[]).includes(run.loopRun.status);
}

function activeScheduledTaskRunWhere(scheduledTaskId: string): Prisma.ProjectScheduledTaskRunWhereInput {
  return {
    scheduledTaskId,
    OR: [
      { status: { in: [...ACTIVE_RUN_STATUSES] } },
      {
        status: "blocked",
        loopRun: { is: { status: { in: [...ACTIVE_LOOP_RUN_STATUSES] } } },
      },
    ],
  };
}

function newPreparationLeaseToken(): string {
  return randomBytes(16).toString("hex");
}

function preparationLeaseFields(at: Date, token = newPreparationLeaseToken()) {
  return {
    preparationLeaseToken: token,
    preparationLeaseExpiresAt: new Date(at.getTime() + PREPARATION_LEASE_MS),
  };
}

export async function transitionPreparingScheduledTaskRun(input: {
  runId: string;
  scheduledTaskId: string;
  expectedVersion: number;
  leaseToken: string;
  status: ScheduledTaskRunStatus;
  finishedAt: Date | null;
  failureCode?: string;
  failureMessage?: string;
  loopRunReference?: { id: string; engineKind: "graph_v1" };
  startedAt?: Date;
  taskSnapshot?: Record<string, unknown>;
  executionTargetSnapshot?: ScheduledTaskExecutionTargetSnapshot;
  event: {
    id: string;
    eventType: string;
    actorDigest: string;
    payload: Record<string, unknown>;
    occurredAt: Date;
  };
}, db: {
  projectScheduledTaskRun: {
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  projectScheduledTaskEvent: {
    upsert(input: {
      where: { id: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
  };
}): Promise<boolean> {
  const updated = await db.projectScheduledTaskRun.updateMany({
    where: {
      id: input.runId,
      status: "preparing",
      version: input.expectedVersion,
      preparationLeaseToken: input.leaseToken,
    },
    data: {
      status: input.status,
      preparationLeaseToken: null,
      preparationLeaseExpiresAt: null,
      version: { increment: 1 },
      ...(input.loopRunReference === undefined ? {} : { loopRunReference: input.loopRunReference }),
      ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
      ...(input.finishedAt === null ? {} : { finishedAt: input.finishedAt }),
      ...(input.failureCode === undefined ? {} : { failureCode: input.failureCode }),
      ...(input.failureMessage === undefined ? {} : { failureMessage: input.failureMessage }),
      ...(input.taskSnapshot === undefined ? {} : { taskSnapshot: input.taskSnapshot }),
      ...(input.executionTargetSnapshot === undefined
        ? {}
        : { executionTargetSnapshot: input.executionTargetSnapshot }),
    },
  });
  if (updated.count !== 1) return false;
  await db.projectScheduledTaskEvent.upsert({
    where: { id: input.event.id },
    create: {
      id: input.event.id,
      scheduledTaskId: input.scheduledTaskId,
      eventType: input.event.eventType,
      actorDigest: input.event.actorDigest,
      payload: input.event.payload,
      occurredAt: input.event.occurredAt,
    },
    update: {},
  });
  return true;
}

function requiredText(value: unknown, field: string, maxLength = 128): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw validationError(`${field} is invalid`);
  }
  return value.trim();
}

function optionalText(value: unknown, maxLength = 10_000): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > maxLength) throw validationError("Task content is invalid");
  return value;
}

function readErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string" && error.code.trim()) {
    return error.code.trim();
  }
  return "loop_run_creation_failed";
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() && error.message.length <= 500) {
    return error.message.trim();
  }
  return "Loop Run preparation failed";
}

function classifyRunFailure(error: unknown): RunFailure {
  const code = readErrorCode(error);
  switch (code) {
    case "not_found":
    case "execution_target_invalid":
      return { status: "blocked", failureCode: "execution_target_invalid", failureMessage: safeFailureMessage(error) };
    case "validation_failed":
      return { status: "blocked", failureCode: "execution_target_invalid", failureMessage: safeFailureMessage(error) };
    case "execution_target_unavailable":
      return { status: "failed", failureCode: "execution_target_unavailable", failureMessage: safeFailureMessage(error) };
    case "task_content_missing":
      return { status: "blocked", failureCode: "task_content_missing", failureMessage: safeFailureMessage(error) };
    case "loop_binding_unavailable":
    case "loop_version_unavailable":
      return { status: "blocked", failureCode: code, failureMessage: safeFailureMessage(error) };
    case "policy_denied":
      return { status: "blocked", failureCode: "execution_target_invalid", failureMessage: safeFailureMessage(error) };
    default:
      return {
        status: "failed",
        failureCode: "loop_run_creation_failed",
        failureMessage: "Loop Run creation failed",
      };
  }
}

function isExplicitPreparationFailure(error: unknown): boolean {
  return new Set([
    "validation_failed",
    "not_found",
    "policy_denied",
    "task_content_missing",
    "execution_target_invalid",
    "execution_target_unavailable",
    "loop_binding_unavailable",
    "loop_version_unavailable",
  ]).has(readErrorCode(error));
}

export function resolveScheduledTaskExecutionTargetReadiness(
  input: ScheduledTaskExecutionTargetReadinessInput,
): { target: LoopExecutionTarget; resolvedAt: string } {
  const now = input.now ?? new Date();
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    throw validationError("Scheduled task target readiness time is invalid");
  }
  const project = input.project;
  if (!project?.spaceId) {
    throw scheduledTaskFailure("Project execution resource is unavailable", "execution_target_invalid");
  }

  if (input.target.type === "local_agent") {
    const profile = input.profile;
    if (!profile || profile.id !== input.target.id || profile.status !== "active"
      || (profile.provider !== "codex" && profile.provider !== "claude")) {
      throw scheduledTaskFailure("Selected Local Agent is unavailable", "execution_target_invalid");
    }
    const cutoff = now.getTime() - 60_000;
    const online = (input.localWorkers ?? []).some((worker) => (
      worker.status === "online"
      && worker.lastHeartbeatAt !== null
      && worker.lastHeartbeatAt.getTime() >= cutoff
      && worker.providers.includes(profile.provider)
    ));
    if (!online) {
      throw scheduledTaskFailure("Selected Local Agent is offline", "execution_target_unavailable");
    }
    return {
      target: {
        type: "local_agent",
        agentProfileId: profile.id,
        profileDisplayName: profile.name,
        provider: profile.provider,
      },
      resolvedAt: now.toISOString(),
    };
  }

  const pool = input.pool;
  if (!pool || pool.id !== input.target.id || pool.status === "revoked" || pool.revokedAt !== null) {
    throw scheduledTaskFailure("Selected Linux Worker Pool is unavailable", "execution_target_invalid");
  }
  if (pool.status !== "active" || project.workerPoolId !== pool.id) {
    throw scheduledTaskFailure("Selected Linux Worker Pool is unavailable", "execution_target_invalid");
  }
  const freshSessions = pool.sessions.filter((session) => (
    session.status === "active"
    && session.revokedAt === null
    && session.expiresAt > now
    && session.lastSeenAt !== null
    && session.lastSeenAt.getTime() >= now.getTime() - 90_000
  ));
  const capacity = Math.min(
    pool.maxConcurrentRuns,
    freshSessions.reduce((total, session) => total + session.requestedConcurrency, 0),
  );
  const currentRuns = freshSessions.reduce((total, session) => total + session.linuxRuns.filter((run) => (
    (ACTIVE_AGENT_RUN_STATUSES as readonly string[]).includes(run.status)
    && run.leaseExpiresAt !== null
    && run.leaseExpiresAt > now
  )).length, 0);
  if (capacity <= currentRuns) {
    throw scheduledTaskFailure("Selected Linux Worker Pool has no available capacity", "execution_target_unavailable");
  }
  return {
    target: {
      type: "linux_worker_pool",
      workerPoolId: pool.id,
      poolDisplayName: pool.displayName,
    },
    resolvedAt: now.toISOString(),
  };
}

function parseRunStatus(value: unknown): ScheduledTaskRunStatus {
  if (typeof value !== "string" || !RUN_STATUSES.has(value)) {
    throw validationError("Scheduled task Run status is invalid");
  }
  return value as ScheduledTaskRunStatus;
}

function parseExistingRun(value: unknown | null): ExistingScheduledTaskRun | null {
  if (!isRecord(value)) return null;
  return {
    id: requiredText(value.id, "Scheduled task Run id", 32),
    status: parseRunStatus(value.status),
  };
}

function parseTask(value: unknown | null): LoadedScheduledTask | null {
  if (!isRecord(value)) return null;
  const id = requiredText(value.id, "Scheduled task id", 32);
  const projectDigest = requiredText(value.projectDigest, "Scheduled task projectDigest", 32);
  if (!/^[a-f0-9]{32}$/u.test(id) || !/^[a-f0-9]{32}$/u.test(projectDigest)) {
    throw validationError("Scheduled task identity is invalid");
  }
  const status = requiredText(value.status, "Scheduled task status", 16);
  if (status !== "inactive" && status !== "enabled" && status !== "disabled") {
    throw validationError("Scheduled task status is invalid");
  }
  if (!Number.isInteger(value.version) || (value.version as number) < 1) {
    throw validationError("Scheduled task version is invalid");
  }
  const contentMode = value.contentMode === "loop_managed" ? "loop_managed" : "platform";
  const contentMarkdown = optionalText(value.contentMarkdown, 100_000);
  if (contentMode === "loop_managed" && value.contentMarkdown != null) {
    throw validationError("Project-managed scheduled task content is invalid");
  }
  return {
    id,
    projectDigest,
    status,
    version: value.version as number,
    name: requiredText(value.name, "Scheduled task name", 191),
    description: optionalText(value.description) ?? "",
    cronExpression: requiredText(value.cronExpression, "Scheduled task cronExpression", 191),
    timezone: requiredText(value.timezone, "Scheduled task timezone", 64),
    contentMode,
    contentMarkdown,
    configurationSnapshot: isRecord(value.configurationSnapshot) ? value.configurationSnapshot : {},
    executionTargetSnapshot: parseExecutionTargetSnapshot(value.executionTargetSnapshot),
  };
}

function parseExecutionTargetSnapshot(value: unknown): ScheduledTaskExecutionTargetSnapshot {
  if (!isRecord(value) || (value.type !== "local_agent" && value.type !== "linux_worker_pool")) {
    throw validationError("Scheduled task execution target snapshot is invalid");
  }
  const id = requiredText(value.id, "Execution target id", 96);
  const displayName = requiredText(value.displayName, "Execution target displayName", 191);
  if (value.type === "local_agent") {
    if (value.provider !== "codex" && value.provider !== "claude") {
      throw validationError("Execution target provider is invalid");
    }
    return { type: "local_agent", id, displayName, provider: value.provider };
  }
  return { type: "linux_worker_pool", id, displayName, provider: null };
}

function parsePreparationSnapshot(value: unknown): ScheduledTaskPreparation | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || !isRecord(value.loopRunInput) || !isRecord(value.taskSnapshot)) {
    throw validationError("Scheduled task preparation snapshot is invalid");
  }
  const occurredAt = normalizeScheduledFor(value.loopRunInput.occurredAt);
  if (!occurredAt) throw validationError("Scheduled task preparation snapshot time is invalid");
  return {
    loopRunInput: {
      ...value.loopRunInput,
      occurredAt,
    },
    taskSnapshot: value.taskSnapshot,
    executionTargetSnapshot: parseExecutionTargetSnapshot(value.executionTargetSnapshot),
  };
}

function serializePreparationSnapshot(snapshot: ScheduledTaskPreparation): ScheduledTaskPreparation {
  const occurredAt = snapshot.loopRunInput.occurredAt;
  if (!(occurredAt instanceof Date) || Number.isNaN(occurredAt.valueOf())) {
    throw validationError("Scheduled task preparation snapshot time is invalid");
  }
  return {
    ...snapshot,
    loopRunInput: {
      ...snapshot.loopRunInput,
      occurredAt: occurredAt.toISOString(),
    },
  };
}

function parsePreparingScheduledTaskRun(value: unknown): PreparingScheduledTaskRun {
  if (!isRecord(value)) throw validationError("Preparing scheduled task Run is invalid");
  const id = requiredText(value.id, "Scheduled task Run id", 32);
  const scheduledTaskId = requiredText(value.scheduledTaskId, "Scheduled task id", 32);
  const triggerKey = requiredText(value.triggerKey, "Scheduled task trigger key", 32);
  const triggerSource = value.triggerSource;
  if (!/^[a-f0-9]{32}$/u.test(id) || !/^[a-f0-9]{32}$/u.test(scheduledTaskId) || !/^[a-f0-9]{32}$/u.test(triggerKey)) {
    throw validationError("Preparing scheduled task Run identity is invalid");
  }
  if (triggerSource !== "manual" && triggerSource !== "scheduled" && triggerSource !== "catch_up") {
    throw validationError("Preparing scheduled task Run trigger source is invalid");
  }
  const triggeredAt = normalizeScheduledFor(value.triggeredAt);
  if (!triggeredAt) throw validationError("Preparing scheduled task Run trigger time is invalid");
  const version = Number.isInteger(value.version) && (value.version as number) > 0
    ? value.version as number
    : 1;
  const preparationLeaseToken = value.preparationLeaseToken === null || value.preparationLeaseToken === undefined
    ? null
    : requiredText(value.preparationLeaseToken, "Scheduled task preparation lease token", 32);
  if (preparationLeaseToken !== null && !/^[a-f0-9]{32}$/u.test(preparationLeaseToken)) {
    throw validationError("Scheduled task preparation lease token is invalid");
  }
  if (!isRecord(value.taskSnapshot)) throw validationError("Preparing scheduled task Run snapshot is invalid");
  const linked = isRecord(value.loopRun) && typeof value.loopRun.id === "string"
    ? {
      id: value.loopRun.id,
      engineKind: "graph_v1" as const,
      scheduledTaskRunId: typeof value.loopRun.scheduledTaskRunId === "string"
        ? value.loopRun.scheduledTaskRunId
        : null,
      ...(typeof value.loopRun.status === "string" ? { status: value.loopRun.status } : {}),
      ...(value.loopRun.finishedAt === null || value.loopRun.finishedAt === undefined
        ? { finishedAt: null }
        : { finishedAt: normalizeScheduledFor(value.loopRun.finishedAt) }),
    }
    : null;
  return {
    id,
    scheduledTaskId,
    triggerKey,
    triggerSource,
    scheduledFor: normalizeScheduledFor(value.scheduledFor),
    triggeredAt,
    version,
    preparationLeaseToken,
    preparationLeaseExpiresAt: normalizeScheduledFor(value.preparationLeaseExpiresAt),
    preparationSnapshot: value.preparationSnapshot ?? null,
    taskSnapshot: value.taskSnapshot,
    contentSnapshot: value.contentSnapshot === null ? null : optionalText(value.contentSnapshot, 100_000),
    executionTargetSnapshot: parseExecutionTargetSnapshot(value.executionTargetSnapshot),
    loopRun: linked,
  };
}

function taskFromPreparingRun(run: PreparingScheduledTaskRun): LoadedScheduledTask {
  const snapshot = run.taskSnapshot;
  const configurationSnapshot = isRecord(snapshot.configurationSnapshot) ? snapshot.configurationSnapshot : {};
  const projectId = requiredText(configurationSnapshot.projectId, "Scheduled task project id", 64);
  const status = requiredText(snapshot.status, "Scheduled task status", 16);
  if (status !== "inactive" && status !== "enabled" && status !== "disabled") {
    throw validationError("Scheduled task status is invalid");
  }
  const contentMode = snapshot.contentMode === "loop_managed" ? "loop_managed" : "platform";
  return {
    id: run.scheduledTaskId,
    projectDigest: scheduledTaskProjectDigest(projectId),
    status,
    version: Number.isInteger(snapshot.version) && (snapshot.version as number) > 0 ? snapshot.version as number : 1,
    name: requiredText(snapshot.name, "Scheduled task name", 191),
    description: optionalText(snapshot.description) ?? "",
    cronExpression: requiredText(snapshot.cronExpression, "Scheduled task cronExpression", 191),
    timezone: requiredText(snapshot.timezone, "Scheduled task timezone", 64),
    contentMode,
    contentMarkdown: run.contentSnapshot,
    configurationSnapshot,
    executionTargetSnapshot: run.executionTargetSnapshot,
  };
}

function normalizeScheduledFor(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  if (!(value instanceof Date) && typeof value !== "string") {
    throw validationError("Scheduled time is invalid");
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw validationError("Scheduled time is invalid");
  return date;
}

function assertValidDate(value: Date, name: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw validationError(`${name} is invalid`);
  }
}

async function loadTaskForTrigger(
  dependencies: ProjectScheduledTaskRuntimeDependencies,
  input: { scheduledTaskId: string; projectId: string },
): Promise<LoadedScheduledTask> {
  const projectDigest = scheduledTaskProjectDigest(input.projectId);
  const task = parseTask(await dependencies.loadTask({
    scheduledTaskId: input.scheduledTaskId,
    projectDigest,
  }));
  if (!task || task.id !== input.scheduledTaskId) {
    throw notFound("Scheduled task not found");
  }
  return task;
}

function bindingIdFromConfiguration(configurationSnapshot: Record<string, unknown>): string {
  return requiredText(configurationSnapshot.loopBindingId, "Scheduled task Loop binding id", 96);
}

async function loadAvailableBinding(
  dependencies: ProjectScheduledTaskRuntimeDependencies,
  input: { projectId: string; bindingId: string },
): Promise<Record<string, unknown> & { loopDefinition: Record<string, unknown> }> {
  const fullBinding = await dependencies.loadBinding(input);
  if (!fullBinding || !isRecord(fullBinding) || !isRecord(fullBinding.loopDefinition)) {
    throw scheduledTaskFailure("Scheduled task Loop binding is unavailable", "loop_binding_unavailable");
  }
  const loopDefinition = fullBinding.loopDefinition;
  if (loopDefinition.status === "archived") {
    throw scheduledTaskFailure("Scheduled task Loop definition is archived", "loop_binding_unavailable");
  }
  return fullBinding as Record<string, unknown> & { loopDefinition: Record<string, unknown> };
}

function loopScopeFromBinding(fullBinding: unknown, configurationSnapshot: Record<string, unknown>): "project" | "task" {
  if (isRecord(fullBinding) && isRecord(fullBinding.loopDefinition)) {
    const scope = fullBinding.loopDefinition.scope;
    if (scope === "project" || scope === "task") return scope;
  }
  const scope = configurationSnapshot.loopScope;
  if (scope === "project" || scope === "task") return scope;
  return "project";
}

function bindingSnapshotFromFullBinding(binding: unknown): {
  bindingSnapshot: Record<string, unknown>;
  policySnapshot: Record<string, unknown>;
  budgetSnapshot: Record<string, unknown>;
} {
  const snapshots = resolveLoopTriggerSnapshots(binding);
  return {
    bindingSnapshot: snapshots.bindingSnapshot as unknown as Record<string, unknown>,
    policySnapshot: snapshots.policySnapshot as unknown as Record<string, unknown>,
    budgetSnapshot: snapshots.budgetSnapshot as unknown as Record<string, unknown>,
  };
}

function grantSnapshot(grants: unknown[]): { automationGrantIds: string[]; grants: unknown[] } {
  const normalized = grants.map((grant) => {
    if (!isRecord(grant) || typeof grant.id !== "string") {
      throw validationError("AutomationGrant snapshot is invalid");
    }
    return grant;
  });
  return {
    automationGrantIds: normalized.map((grant) => grant.id as string),
    grants: normalized,
  };
}

function taskSnapshot(task: LoadedScheduledTask, loopName?: string | null): Record<string, unknown> {
  return {
    scheduledTaskId: task.id,
    name: task.name,
    description: task.description,
    status: task.status,
    version: task.version,
    contentMode: task.contentMode,
    cronExpression: task.cronExpression,
    timezone: task.timezone,
    configurationSnapshot: {
      ...task.configurationSnapshot,
      ...(loopName ? { loopName } : {}),
    },
    executionTargetSnapshot: task.executionTargetSnapshot,
    ...(loopName ? { loopName } : {}),
  };
}

function runEventPayload(input: {
  runId: string;
  triggerKey: string;
  triggerSource: ScheduledTaskTriggerSource;
  status: ScheduledTaskRunStatus;
  failureCode?: string;
  failureMessage?: string;
  loopRunId?: string;
  engineKind?: "graph_v1";
}): Record<string, unknown> {
  return {
    runId: input.runId,
    triggerKey: input.triggerKey,
    triggerSource: input.triggerSource,
    status: input.status,
    ...(input.failureCode === undefined ? {} : { failureCode: input.failureCode }),
    ...(input.failureMessage === undefined ? {} : { failureMessage: input.failureMessage }),
    ...(input.loopRunId === undefined ? {} : { loopRunId: input.loopRunId }),
    ...(input.engineKind === undefined ? {} : { engineKind: input.engineKind }),
  };
}

async function resolveExecutionTargetWithPrisma(
  projectId: string,
  target: ScheduledTaskExecutionTargetSnapshot,
): Promise<{ target: LoopExecutionTarget; resolvedAt: string }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      spaceId: true,
      ownerType: true,
      ownerUserId: true,
      companyId: true,
      workerPoolId: true,
    },
  });
  if (!project?.spaceId) {
    throw scheduledTaskFailure("Project execution resource is unavailable", "execution_target_invalid");
  }
  const spaceId = project.spaceId;

  if (target.type === "local_agent") {
    const profile = await prisma.agentProfile.findFirst({
      where: {
        id: target.id,
        spaceId,
        status: "active",
      },
      select: { id: true, name: true, provider: true, status: true },
    });
    const provider = profile?.provider;
    const workers = profile && (provider === "codex" || provider === "claude")
      ? await prisma.agentWorker.findMany({
        where: {
          spaceId,
          status: "online",
          lastHeartbeatAt: { gte: new Date(Date.now() - 120_000) },
          localDevice: {
            status: "authorized",
            runtimeProfiles: { some: { provider, status: "ready" } },
          },
        },
        select: { status: true, lastHeartbeatAt: true },
      })
      : [];
    return resolveScheduledTaskExecutionTargetReadiness({
      project: { ...project, spaceId },
      target,
      profile,
      localWorkers: workers.map((worker) => ({
        status: worker.status,
        lastHeartbeatAt: worker.lastHeartbeatAt,
        providers: provider ? [provider] : [],
      })),
    });
  }

  const scope = project.ownerType === "personal" && project.ownerUserId && !project.companyId
    ? { ownerUserId: project.ownerUserId, companyId: null }
    : project.ownerType === "company" && project.companyId && !project.ownerUserId
      ? { ownerUserId: null, companyId: project.companyId }
      : null;
  if (!scope) {
    throw scheduledTaskFailure("Project Worker resource scope is invalid", "execution_target_invalid");
  }
  const pool = await prisma.workerPool.findFirst({
    where: {
      id: target.id,
      ...scope,
    },
    select: {
      id: true,
      displayName: true,
      status: true,
      revokedAt: true,
      maxConcurrentRuns: true,
      sessions: {
        select: {
          requestedConcurrency: true,
          lastSeenAt: true,
          expiresAt: true,
          status: true,
          revokedAt: true,
          linuxRuns: {
            where: {
              status: { in: [...ACTIVE_AGENT_RUN_STATUSES] },
              leaseExpiresAt: { gt: new Date() },
            },
            select: { id: true, status: true, leaseExpiresAt: true },
          },
        },
      },
    },
  });
  return resolveScheduledTaskExecutionTargetReadiness({
    project: { ...project, spaceId },
    target,
    pool,
  });
}

function resolvedExecutionTargetSnapshot(target: LoopExecutionTarget): ScheduledTaskExecutionTargetSnapshot {
  return target.type === "local_agent"
    ? {
      type: "local_agent",
      id: target.agentProfileId,
      displayName: target.profileDisplayName,
      provider: target.provider,
    }
    : {
      type: "linux_worker_pool",
      id: target.workerPoolId,
      displayName: target.poolDisplayName,
      provider: null,
    };
}

const DEFAULT_RUNTIME_DEPENDENCIES: ProjectScheduledTaskRuntimeDependencies = {
  assertCanWriteProject: (input) => assertCanWriteProject(input),
  loadTask: ({ scheduledTaskId, projectDigest }) => prisma.projectScheduledTask.findFirst({
    where: { id: scheduledTaskId, projectDigest },
  }),
  countActiveRuns: ({ scheduledTaskId }) => prisma.projectScheduledTaskRun.count({
    where: activeScheduledTaskRunWhere(scheduledTaskId),
  }),
  findByTriggerKey: ({ triggerKey }) => prisma.projectScheduledTaskRun.findUnique({
    where: { triggerKey },
    select: { id: true, status: true },
  }),
  createRunWithActiveGuard: ({ scheduledTaskId, data }) => prisma.$transaction(async (tx) => {
    const activeRunCount = await tx.projectScheduledTaskRun.count({
      where: activeScheduledTaskRunWhere(scheduledTaskId),
    });
    if (activeRunCount > 0) throw runInProgress("Scheduled task already has an active run");
    return tx.projectScheduledTaskRun.create({
      data: data as Prisma.ProjectScheduledTaskRunUncheckedCreateInput,
    });
  }, { isolationLevel: "Serializable" }),
  persistPreparationSnapshot: async (input) => prisma.$transaction(async (tx) => {
    const updated = await tx.projectScheduledTaskRun.updateMany({
      where: {
        id: input.runId,
        status: "preparing",
        version: input.expectedVersion,
        preparationLeaseToken: input.leaseToken,
        preparationLeaseExpiresAt: { gt: input.now },
      },
      data: {
        preparationSnapshot: input.snapshot as unknown as Prisma.InputJsonValue,
        preparationLeaseExpiresAt: new Date(input.now.getTime() + PREPARATION_LEASE_MS),
        version: { increment: 1 },
      },
    });
    return updated.count === 1
      ? { updated: true, version: input.expectedVersion + 1 }
      : { updated: false, version: null };
  }),
  claimPreparingRun: async (input) => prisma.$transaction(async (tx) => {
    const claimed = await tx.projectScheduledTaskRun.updateMany({
      where: {
        id: input.runId,
        status: "preparing",
        version: input.expectedVersion,
        triggeredAt: { lte: input.staleBefore },
        OR: [
          { preparationLeaseExpiresAt: null },
          { preparationLeaseExpiresAt: { lte: input.staleBefore } },
        ],
      },
      data: {
        preparationLeaseToken: input.leaseToken,
        preparationLeaseExpiresAt: input.leaseExpiresAt,
        version: { increment: 1 },
      },
    });
    return claimed.count === 1
      ? { claimed: true, version: input.expectedVersion + 1 }
      : { claimed: false, version: null };
  }),
  completeRun: async (input) => prisma.$transaction(async (tx) => {
    const current = await tx.projectScheduledTaskRun.findUnique({
      where: { id: input.runId },
      select: { status: true, loopRunReference: true },
    });
    if (!current) throw notFound("Scheduled task Run not found");
    if (
      current.status === input.status
      && isRecord(current.loopRunReference)
      && current.loopRunReference.id === input.loopRunReference.id
      && current.loopRunReference.engineKind === input.loopRunReference.engineKind
    ) return;
    if (current.status !== "preparing") throw runInProgress("Scheduled task Run is not preparing");
    const transitioned = await transitionPreparingScheduledTaskRun({
      runId: input.runId,
      scheduledTaskId: input.scheduledTaskId,
      expectedVersion: input.expectedVersion,
      leaseToken: input.leaseToken,
      status: input.status,
      finishedAt: input.finishedAt,
      loopRunReference: input.loopRunReference,
      startedAt: input.startedAt,
      ...(input.taskSnapshot === undefined ? {} : { taskSnapshot: input.taskSnapshot }),
      ...(input.executionTargetSnapshot === undefined
        ? {}
        : { executionTargetSnapshot: input.executionTargetSnapshot }),
      event: {
        id: projectScheduledTaskEventId(input.scheduledTaskId, input.commandId),
        eventType: input.eventType,
        actorDigest: input.actorDigest,
        payload: input.payload,
        occurredAt: input.startedAt,
      },
    }, tx as never);
    if (!transitioned) throw runInProgress("Scheduled task Run completion lost its lease");
  }),
  failRun: async (input) => prisma.$transaction(async (tx) => {
    const transitioned = await transitionPreparingScheduledTaskRun({
      runId: input.runId,
      scheduledTaskId: input.scheduledTaskId,
      expectedVersion: input.expectedVersion,
      leaseToken: input.leaseToken,
      status: input.status,
      finishedAt: input.finishedAt,
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
      event: {
        id: projectScheduledTaskEventId(input.scheduledTaskId, input.commandId),
        eventType: input.eventType,
        actorDigest: input.actorDigest,
        payload: input.payload,
        occurredAt: input.finishedAt,
      },
    }, tx as never);
    if (!transitioned) throw runInProgress("Scheduled task Run failure lost its lease");
  }),
  createLoopRun: (input) => createGraphLoopRun(input as unknown as CreateGraphLoopRunInput),
  loadLoopRunReference: async ({ loopRunId }) => {
    const row = await prisma.loopRun.findFirst({
      where: { id: loopRunId, engineKind: "graph_v1" },
      select: {
        id: true,
        projectId: true,
        scheduledTaskRunId: true,
        status: true,
        finishedAt: true,
      },
    });
    return row ? { ...row, engineKind: "graph_v1" as const } : null;
  },
  loadBinding: ({ projectId, bindingId }) => prisma.projectLoopBinding.findFirst({
    where: { id: bindingId, projectId, status: "enabled" },
    select: loopTriggerBindingSelect,
  }),
  loadPublishedVersions: ({ projectId }) => readPublishedLoopVersionsForProject(projectId),
  snapshotGrantRows: ({ bindingId, now }) => snapshotBindingGrants({ bindingId, now }),
  resolveExecutionTarget: ({ projectId, target }) => resolveExecutionTargetWithPrisma(projectId, target),
  listPreparingRuns: ({ limit, staleBefore }) => prisma.projectScheduledTaskRun.findMany({
    where: {
      status: "preparing",
      triggeredAt: { lte: staleBefore },
      OR: [
        { preparationLeaseExpiresAt: null },
        { preparationLeaseExpiresAt: { lte: staleBefore } },
      ],
    },
    orderBy: [{ triggeredAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      scheduledTaskId: true,
      triggerKey: true,
      triggerSource: true,
      scheduledFor: true,
      triggeredAt: true,
      version: true,
      preparationSnapshot: true,
      preparationLeaseToken: true,
      preparationLeaseExpiresAt: true,
      taskSnapshot: true,
      contentSnapshot: true,
      executionTargetSnapshot: true,
      loopRun: {
        select: {
          id: true,
          engineKind: true,
          scheduledTaskRunId: true,
          status: true,
          finishedAt: true,
        },
      },
    },
  }),
  now: () => new Date(),
};

function validateDependencies(dependencies: ProjectScheduledTaskRuntimeDependencies): void {
  for (const [name, value] of Object.entries({
    assertCanWriteProject: dependencies.assertCanWriteProject,
    loadTask: dependencies.loadTask,
    countActiveRuns: dependencies.countActiveRuns,
    findByTriggerKey: dependencies.findByTriggerKey,
    createRunWithActiveGuard: dependencies.createRunWithActiveGuard,
    persistPreparationSnapshot: dependencies.persistPreparationSnapshot,
    claimPreparingRun: dependencies.claimPreparingRun,
    completeRun: dependencies.completeRun,
    failRun: dependencies.failRun,
    createLoopRun: dependencies.createLoopRun,
    loadLoopRunReference: dependencies.loadLoopRunReference,
    loadBinding: dependencies.loadBinding,
    loadPublishedVersions: dependencies.loadPublishedVersions,
    snapshotGrantRows: dependencies.snapshotGrantRows,
    resolveExecutionTarget: dependencies.resolveExecutionTarget,
    listPreparingRuns: dependencies.listPreparingRuns,
  } as Record<string, unknown>)) {
    if (typeof value !== "function") throw validationError(`Scheduled task runtime dependency ${name} is unavailable`);
  }
}

async function buildPreparation(input: {
  dependencies: ProjectScheduledTaskRuntimeDependencies;
  projectId: string;
  scheduledTask: LoadedScheduledTask;
  scheduledTaskRunId: string;
  triggerKey: string;
  triggerSource: ScheduledTaskTriggerSource;
  commandId: string;
  occurredAt: Date;
  actorUserId?: string;
}): Promise<{
  preparation: ScheduledTaskPreparation;
} > {
  const configurationSnapshot = input.scheduledTask.configurationSnapshot;
  const bindingId = bindingIdFromConfiguration(configurationSnapshot);
  const fullBinding = await loadAvailableBinding(input.dependencies, {
    projectId: input.projectId,
    bindingId,
  });
  const loopName = typeof fullBinding.loopDefinition.name === "string"
    ? fullBinding.loopDefinition.name
    : null;
  const context = bindingSnapshotFromFullBinding(fullBinding);
  const bindingSnapshot = context.bindingSnapshot;

  const resolvedTarget = await input.dependencies.resolveExecutionTarget({
    projectId: input.projectId,
    target: input.scheduledTask.executionTargetSnapshot,
  });
  const executionSnapshot = resolveLoopExecutionSnapshot({
    target: resolvedTarget.target,
    bindingSnapshot: bindingSnapshot as never,
    resolvedAt: new Date(resolvedTarget.resolvedAt),
  });

  const grants = await input.dependencies.snapshotGrantRows({
    bindingId,
    now: input.occurredAt,
  });

  const publishedVersions = await input.dependencies.loadPublishedVersions({ projectId: input.projectId });
  const loopScope = loopScopeFromBinding(fullBinding, configurationSnapshot);
  const activeVersionId = bindingSnapshot.activeVersionId;
  if (typeof activeVersionId !== "string" || !publishedVersions.some((version) => (
    isRecord(version) && version.loopVersionId === activeVersionId
  ))) {
    throw scheduledTaskFailure("Scheduled task Loop version is unavailable", "loop_version_unavailable");
  }
  const runGraphSnapshot = loopScope === "task"
    ? resolveScheduledPublishedRunGraphSnapshot({
      rootLoopVersionId: activeVersionId,
      versions: publishedVersions as never,
    })
    : resolvePublishedRunGraphSnapshot({
      rootLoopVersionId: activeVersionId,
      versions: publishedVersions as never,
    });

  const loopIdentity = buildLoopTriggerIdentity({
    bindingId,
    triggerType: input.triggerSource,
    sourceEventId: input.triggerKey,
  });
  const loopRunInput: CreateGraphLoopRunInput = {
    id: loopIdentity.runId,
    triggerReceiptId: loopIdentity.triggerReceiptId,
    bindingId,
    triggerType: input.triggerSource,
    sourceEventId: input.triggerKey,
    commandId: input.commandId,
    scheduledTaskRunId: input.scheduledTaskRunId,
    projectId: input.projectId,
    loopVersionId: bindingSnapshot.activeVersionId as string,
    inputSnapshot: {
      scheduledTaskId: input.scheduledTask.id,
      scheduledTaskRunId: input.scheduledTaskRunId,
      scheduledTaskName: input.scheduledTask.name,
      contentMode: input.scheduledTask.contentMode,
      contentReference: input.scheduledTask.contentMode === "platform"
        ? { kind: "scheduled_task_run", id: input.scheduledTaskRunId }
        : null,
    },
    bindingSnapshot,
    executionSnapshot,
    policySnapshot: context.policySnapshot,
    grantSnapshot: grantSnapshot(grants),
    runGraphSnapshot,
    budgetSnapshot: context.budgetSnapshot,
    occurredAt: input.occurredAt,
    correlationId: `scheduled-task:${input.scheduledTask.id}`,
    actor: input.triggerSource === "manual"
      ? { type: "user", id: input.actorUserId ?? "scheduled-task" }
      : { type: "system", id: "scheduled-task" },
  };

  return {
    preparation: {
      loopRunInput: loopRunInput as unknown as Record<string, unknown>,
      taskSnapshot: taskSnapshot(input.scheduledTask, loopName),
      executionTargetSnapshot: resolvedExecutionTargetSnapshot(resolvedTarget.target),
    },
  };
}

function preparationLoopRunIdentity(
  preparation: ScheduledTaskPreparation,
  run: Pick<PreparingScheduledTaskRun, "id" | "triggerKey" | "triggerSource">,
  projectId: string,
): { id: string; bindingId: string } {
  const loopRunInput = preparation.loopRunInput;
  const bindingId = requiredText(loopRunInput.bindingId, "Prepared Loop binding id", 96);
  const expected = buildLoopTriggerIdentity({
    bindingId,
    triggerType: run.triggerSource,
    sourceEventId: run.triggerKey,
  });
  if (
    loopRunInput.id !== expected.runId
    || loopRunInput.triggerReceiptId !== expected.triggerReceiptId
    || loopRunInput.sourceEventId !== run.triggerKey
    || loopRunInput.scheduledTaskRunId !== run.id
    || loopRunInput.projectId !== projectId
  ) {
    throw validationError("Scheduled task preparation snapshot identity is inconsistent");
  }
  return { id: expected.runId, bindingId };
}

function preparationForLinkedRun(run: PreparingScheduledTaskRun): ScheduledTaskPreparation {
  try {
    return parsePreparationSnapshot(run.preparationSnapshot) ?? {
      loopRunInput: {},
      taskSnapshot: run.taskSnapshot,
      executionTargetSnapshot: run.executionTargetSnapshot,
    };
  } catch {
    return {
      loopRunInput: {},
      taskSnapshot: run.taskSnapshot,
      executionTargetSnapshot: run.executionTargetSnapshot,
    };
  }
}

export async function createProjectScheduledTaskRunRecord(input: {
  scheduledTaskId: string;
  triggerKey: string;
  triggerSource: ScheduledTaskTriggerSource;
  scheduledFor?: Date | string | null;
  triggeredAt: Date;
  status: ScheduledTaskRunStatus;
  taskSnapshot: unknown;
  contentSnapshot: string | null;
  executionTargetSnapshot: unknown;
}, dependencies: Pick<ProjectScheduledTaskRuntimeDependencies, "createRunWithActiveGuard">): Promise<ProjectScheduledTaskRunTriggerResult> {
  requiredText(input.scheduledTaskId, "scheduledTaskId", 32);
  requiredText(input.triggerKey, "triggerKey", 32);
  if (!/^[a-f0-9]{32}$/u.test(input.scheduledTaskId) || !/^[a-f0-9]{32}$/u.test(input.triggerKey)) {
    throw validationError("Scheduled task Run identity is invalid");
  }
  if (input.triggerSource !== "manual" && input.triggerSource !== "scheduled" && input.triggerSource !== "catch_up") {
    throw validationError("Scheduled task trigger source is invalid");
  }
  assertValidDate(input.triggeredAt, "Scheduled task Run trigger time");
  const runId = projectScheduledTaskRunId(input.scheduledTaskId, input.triggerKey);
  const lease = preparationLeaseFields(input.triggeredAt);
  await dependencies.createRunWithActiveGuard({
    scheduledTaskId: input.scheduledTaskId,
    data: {
      id: runId,
      scheduledTaskId: input.scheduledTaskId,
      triggerKey: input.triggerKey,
      triggerSource: input.triggerSource,
      scheduledFor: normalizeScheduledFor(input.scheduledFor),
      triggeredAt: input.triggeredAt,
      status: input.status,
      taskSnapshot: input.taskSnapshot,
      contentSnapshot: input.contentSnapshot,
      executionTargetSnapshot: input.executionTargetSnapshot,
      ...lease,
    },
  });
  return { runId, status: input.status, duplicate: false };
}

export async function triggerProjectScheduledTaskRun(input: {
  actorUserId?: string;
  projectId: string;
  scheduledTaskId: string;
  commandId: string;
  triggerSource: ScheduledTaskTriggerSource;
  scheduledFor?: Date | string;
}, dependencies: ProjectScheduledTaskRuntimeDependencies = DEFAULT_RUNTIME_DEPENDENCIES): Promise<ProjectScheduledTaskRunTriggerResult> {
  validateDependencies(dependencies);
  const triggerSource = input.triggerSource;
  if (triggerSource !== "manual" && triggerSource !== "scheduled" && triggerSource !== "catch_up") {
    throw validationError("Scheduled task trigger source is invalid");
  }
  requiredText(input.scheduledTaskId, "scheduledTaskId", 32);
  requiredText(input.projectId, "projectId", 64);
  requiredText(input.commandId, "commandId", 128);
  if (!/^[a-f0-9]{32}$/u.test(input.scheduledTaskId)) {
    throw validationError("Scheduled task id is invalid");
  }

  const scheduledFor = normalizeScheduledFor(input.scheduledFor);
  if (triggerSource !== "manual" && scheduledFor === null) {
    throw validationError("Scheduled task automatic trigger requires scheduledFor");
  }
  const triggerKey = triggerSource === "manual"
    ? derivedPersistenceId([
      "scheduled-task-trigger",
      input.scheduledTaskId,
      triggerSource,
      input.commandId,
    ])
    : derivedPersistenceId([
      "scheduled-task-trigger",
      input.scheduledTaskId,
      "scheduled_slot",
      scheduledFor!.toISOString(),
    ]);

  let scheduledTask: LoadedScheduledTask | null = null;
  if (triggerSource === "manual") {
    const actorUserId = requiredText(input.actorUserId, "actorUserId", 64);
    await dependencies.assertCanWriteProject({ userId: actorUserId, projectId: input.projectId });
    scheduledTask = await loadTaskForTrigger(dependencies, {
      scheduledTaskId: input.scheduledTaskId,
      projectId: input.projectId,
    });
    const existing = parseExistingRun(await dependencies.findByTriggerKey({ triggerKey }));
    if (existing) {
      return { runId: existing.id, status: existing.status, duplicate: true };
    }
    if (scheduledTask.status === "disabled") {
      throw policyDenied("Scheduled task is disabled");
    }
    if (scheduledTask.status !== "inactive" && scheduledTask.status !== "enabled") {
      throw policyDenied("Scheduled task cannot be run manually");
    }
  } else {
    const existing = parseExistingRun(await dependencies.findByTriggerKey({ triggerKey }));
    if (existing) {
      return { runId: existing.id, status: existing.status, duplicate: true };
    }
    scheduledTask = await loadTaskForTrigger(dependencies, {
      scheduledTaskId: input.scheduledTaskId,
      projectId: input.projectId,
    });
    if (scheduledTask.status !== "enabled") {
      throw policyDenied("Scheduled task is not enabled");
    }
  }

  const now = (dependencies.now ?? (() => new Date()))();
  const runId = projectScheduledTaskRunId(input.scheduledTaskId, triggerKey);
  const contentSnapshot = scheduledTask.contentMode === "platform"
    ? scheduledTask.contentMarkdown
    : null;
  const lease = preparationLeaseFields(now);
  const runData: Record<string, unknown> = {
    id: runId,
    scheduledTaskId: input.scheduledTaskId,
    triggerKey,
    triggerSource,
    scheduledFor,
    triggeredAt: now,
    status: "preparing",
    taskSnapshot: taskSnapshot(scheduledTask),
    contentSnapshot,
    executionTargetSnapshot: scheduledTask.executionTargetSnapshot,
    ...lease,
  };

  try {
    await dependencies.createRunWithActiveGuard({
      scheduledTaskId: input.scheduledTaskId,
      data: runData,
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      const raced = parseExistingRun(await dependencies.findByTriggerKey({ triggerKey }));
      if (raced) return { runId: raced.id, status: raced.status, duplicate: true };
    }
    throw error;
  }

  let prepared: (ScheduledTaskPreparation & {
    loopRun: { id: string; engineKind: "graph_v1" };
  }) | null = null;
  let preparationVersion = 1;
  try {
    if (scheduledTask.contentMode === "platform" && !contentSnapshot?.trim()) {
      throw scheduledTaskFailure("Scheduled task platform content is missing", "task_content_missing");
    }
    const built = await buildPreparation({
      dependencies,
      projectId: input.projectId,
      scheduledTask,
      scheduledTaskRunId: runId,
      triggerKey,
      triggerSource,
      commandId: input.commandId,
      occurredAt: now,
      ...(input.actorUserId === undefined ? {} : { actorUserId: input.actorUserId }),
    });
    const persisted = await dependencies.persistPreparationSnapshot({
      runId,
      expectedVersion: preparationVersion,
      leaseToken: lease.preparationLeaseToken,
      snapshot: serializePreparationSnapshot(built.preparation),
      now,
    });
    if (!persisted.updated || persisted.version === null) {
      throw Object.assign(new Error("Scheduled task preparation lease was lost"), {
        code: "preparation_lease_lost",
      });
    }
    preparationVersion = persisted.version;
    const loopRun = await dependencies.createLoopRun({
      ...built.preparation.loopRunInput,
      scheduledTaskPreparationFence: {
        scheduledTaskRunId: runId,
        expectedVersion: preparationVersion,
        leaseToken: lease.preparationLeaseToken,
        now,
      },
    });
    prepared = { ...built.preparation, loopRun };
    let completionError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await completePreparedScheduledTaskRun({
          dependencies,
          prepared,
          scheduledTaskId: input.scheduledTaskId,
          scheduledTaskRunId: runId,
          triggerKey,
          triggerSource,
          commandId: input.commandId,
          actorDigest: scheduledTaskActorDigest(input.actorUserId ?? "system"),
          startedAt: now,
          expectedVersion: preparationVersion,
          leaseToken: lease.preparationLeaseToken,
        });
        return { runId, status: "running", duplicate: false };
      } catch (error) {
        completionError = error;
      }
    }
    throw completionError;
  } catch (error) {
    if (prepared) throw error;
    if (!isExplicitPreparationFailure(error)) throw error;
    const failure = classifyRunFailure(error);
    await dependencies.failRun({
      runId,
      scheduledTaskId: input.scheduledTaskId,
      commandId: `${input.commandId}:run_failed`,
      finishedAt: new Date(),
      status: failure.status,
      expectedVersion: preparationVersion,
      leaseToken: lease.preparationLeaseToken,
      failureCode: failure.failureCode,
      failureMessage: failure.failureMessage,
      eventType: "scheduled_task.run_failed",
      actorDigest: scheduledTaskActorDigest(input.actorUserId ?? "system"),
      payload: runEventPayload({
        runId,
        triggerKey,
        triggerSource,
        status: failure.status,
        failureCode: failure.failureCode,
        failureMessage: failure.failureMessage,
      }),
    });
    throw error;
  }
}

async function completePreparedScheduledTaskRun(input: {
  dependencies: ProjectScheduledTaskRuntimeDependencies;
  prepared: ScheduledTaskPreparation & {
    loopRun: { id: string; engineKind: "graph_v1" };
  };
  scheduledTaskId: string;
  scheduledTaskRunId: string;
  triggerKey: string;
  triggerSource: ScheduledTaskTriggerSource;
  commandId: string;
  actorDigest: string;
  startedAt: Date;
  expectedVersion: number;
  leaseToken: string;
  status?: ScheduledTaskRunStatus;
  finishedAt?: Date | null;
}): Promise<void> {
  const status = input.status ?? "running";
  await input.dependencies.completeRun({
    runId: input.scheduledTaskRunId,
    scheduledTaskId: input.scheduledTaskId,
    commandId: `${input.commandId}:run_created`,
    loopRunReference: {
      id: input.prepared.loopRun.id,
      engineKind: input.prepared.loopRun.engineKind,
    },
    expectedVersion: input.expectedVersion,
    leaseToken: input.leaseToken,
    status,
    finishedAt: input.finishedAt ?? null,
    startedAt: input.startedAt,
    eventType: "scheduled_task.run_created",
    actorDigest: input.actorDigest,
    payload: runEventPayload({
      runId: input.scheduledTaskRunId,
      triggerKey: input.triggerKey,
      triggerSource: input.triggerSource,
      status,
      loopRunId: input.prepared.loopRun.id,
      engineKind: input.prepared.loopRun.engineKind,
    }),
    taskSnapshot: input.prepared.taskSnapshot,
    executionTargetSnapshot: input.prepared.executionTargetSnapshot,
  });
}

export interface RecoverPreparingProjectScheduledTaskRunsResult {
  scanned: number;
  recovered: number;
  failed: number;
  errors: number;
}

export async function recoverPreparingProjectScheduledTaskRuns(
  input: { limit?: number },
  dependencies: ProjectScheduledTaskRuntimeDependencies = DEFAULT_RUNTIME_DEPENDENCIES,
): Promise<RecoverPreparingProjectScheduledTaskRunsResult> {
  validateDependencies(dependencies);
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw validationError("Scheduled task recovery limit is invalid");
  }
  const now = (dependencies.now ?? (() => new Date()))();
  assertValidDate(now, "Scheduled task recovery time");
  const staleBefore = new Date(now.getTime() - RECOVERY_MIN_AGE_MS);
  const rows = await dependencies.listPreparingRuns({ limit, now, staleBefore });
  const result: RecoverPreparingProjectScheduledTaskRunsResult = {
    scanned: rows.length,
    recovered: 0,
    failed: 0,
    errors: 0,
  };

  for (const value of rows) {
    let run: PreparingScheduledTaskRun | null = null;
    let claimed = false;
    let leaseToken = "";
    let preparationVersion = 0;
    let prepared: (ScheduledTaskPreparation & {
      loopRun: ScheduledTaskLoopRunReference;
    }) | null = null;
    try {
      run = parsePreparingScheduledTaskRun(value);
      if (run.triggeredAt > staleBefore) continue;
      if (
        run.preparationLeaseToken !== null
        && run.preparationLeaseExpiresAt !== null
        && run.preparationLeaseExpiresAt > staleBefore
      ) {
        continue;
      }
      leaseToken = newPreparationLeaseToken();
      const claim = await dependencies.claimPreparingRun({
        runId: run.id,
        expectedVersion: run.version,
        staleBefore,
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + PREPARATION_LEASE_MS),
        now,
      });
      if (!claim.claimed || claim.version === null) continue;
      claimed = true;
      preparationVersion = claim.version;

      const task = taskFromPreparingRun(run);
      const projectId = requiredText(task.configurationSnapshot.projectId, "Scheduled task project id", 64);
      const bindingId = bindingIdFromConfiguration(task.configurationSnapshot);
      const loopIdentity = buildLoopTriggerIdentity({
        bindingId,
        triggerType: run.triggerSource,
        sourceEventId: run.triggerKey,
      });
      const existingLoopRun = await dependencies.loadLoopRunReference({ loopRunId: loopIdentity.runId });
      if (run.loopRun) {
        if (run.loopRun.scheduledTaskRunId && run.loopRun.scheduledTaskRunId !== run.id) {
          throw validationError("Preparing scheduled task Run is linked to another Run");
        }
        prepared = {
          ...preparationForLinkedRun(run),
          loopRun: run.loopRun,
        };
      } else if (existingLoopRun) {
        if (existingLoopRun.projectId !== projectId) {
          throw validationError("Recovered LoopRun belongs to another project");
        }
        if (existingLoopRun.scheduledTaskRunId && existingLoopRun.scheduledTaskRunId !== run.id) {
          throw validationError("Recovered LoopRun belongs to another scheduled task Run");
        }
        prepared = {
          ...preparationForLinkedRun(run),
          loopRun: {
            id: existingLoopRun.id,
            engineKind: existingLoopRun.engineKind,
            ...(existingLoopRun.status === undefined ? {} : { status: existingLoopRun.status }),
            ...(existingLoopRun.finishedAt === undefined ? {} : { finishedAt: existingLoopRun.finishedAt }),
          },
        };
      } else {
        let preparation = parsePreparationSnapshot(run.preparationSnapshot);
        if (preparation) {
          preparationLoopRunIdentity(preparation, run, projectId);
          await loadAvailableBinding(dependencies, { projectId, bindingId });
        } else {
          const built = await buildPreparation({
            dependencies,
            projectId,
            scheduledTask: task,
            scheduledTaskRunId: run.id,
            triggerKey: run.triggerKey,
            triggerSource: run.triggerSource,
            commandId: `recovery:${run.id}`,
            occurredAt: now,
          });
          preparation = built.preparation;
          const persisted = await dependencies.persistPreparationSnapshot({
            runId: run.id,
            expectedVersion: preparationVersion,
            leaseToken,
            snapshot: serializePreparationSnapshot(preparation),
            now,
          });
          if (!persisted.updated || persisted.version === null) {
            throw Object.assign(new Error("Scheduled task recovery lease was lost"), {
              code: "preparation_lease_lost",
            });
          }
          preparationVersion = persisted.version;
        }
        const loopRun = await dependencies.createLoopRun({
          ...preparation.loopRunInput,
          scheduledTaskPreparationFence: {
            scheduledTaskRunId: run.id,
            expectedVersion: preparationVersion,
            leaseToken,
            now,
          },
        });
        prepared = { ...preparation, loopRun };
      }
      const projectedStatus = prepared.loopRun.status === undefined
        ? "running"
        : projectScheduledTaskRunStatus(prepared.loopRun.status);
      await completePreparedScheduledTaskRun({
        dependencies,
        prepared,
        scheduledTaskId: run.scheduledTaskId,
        scheduledTaskRunId: run.id,
        triggerKey: run.triggerKey,
        triggerSource: run.triggerSource,
        commandId: `recovery:${run.id}`,
        actorDigest: scheduledTaskActorDigest("system"),
        startedAt: now,
        expectedVersion: preparationVersion,
        leaseToken,
        status: projectedStatus,
        finishedAt: prepared.loopRun.finishedAt
          ?? (TERMINAL_SCHEDULED_TASK_RUN_STATUSES.has(projectedStatus) ? now : null),
      });
      result.recovered += 1;
    } catch (error) {
      if (run && claimed && prepared === null && isExplicitPreparationFailure(error)) {
        const failure = classifyRunFailure(error);
        try {
          await dependencies.failRun({
            runId: run.id,
            scheduledTaskId: run.scheduledTaskId,
            commandId: `recovery:${run.id}:run_failed`,
            finishedAt: now,
            status: failure.status,
            expectedVersion: preparationVersion,
            leaseToken,
            failureCode: failure.failureCode,
            failureMessage: failure.failureMessage,
            eventType: "scheduled_task.run_failed",
            actorDigest: scheduledTaskActorDigest("system"),
            payload: runEventPayload({
              runId: run.id,
              triggerKey: run.triggerKey,
              triggerSource: run.triggerSource,
              status: failure.status,
              failureCode: failure.failureCode,
              failureMessage: failure.failureMessage,
            }),
          });
          result.failed += 1;
          continue;
        } catch {
          result.errors += 1;
          continue;
        }
      }
      result.errors += 1;
    }
  }
  return result;
}

export interface ScheduledTaskScheduleWriteInput {
  scheduledTaskId: string;
  scheduledFor: Date;
  nextRunAt: Date;
  now: Date;
  expectedNextRunAt: Date | null;
  expectedPendingScheduledFor: Date | null;
  expectedLastScheduledFor: Date | null;
}

export interface ScheduledTaskScheduleWriteResult {
  matched: boolean;
  alreadyAdvanced: boolean;
}

export interface ScheduledTaskScheduleWriteDb {
  updateMany(input: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
  findUnique(input: {
    where: { id: string };
    select: { nextRunAt: boolean; pendingScheduledFor: boolean; lastScheduledFor: boolean };
  }): Promise<{
    nextRunAt: Date | null;
    pendingScheduledFor: Date | null;
    lastScheduledFor: Date | null;
  } | null>;
}

export interface RunDueProjectScheduledTaskDependencies {
  listDueTasks?: (limit: number, now: Date) => Promise<unknown[]>;
  hasActiveRun?: (scheduledTaskId: string) => Promise<boolean>;
  createRun?: typeof triggerProjectScheduledTaskRun;
  deferTask?: (input: ScheduledTaskScheduleWriteInput) => Promise<ScheduledTaskScheduleWriteResult>;
  advanceTask?: (input: ScheduledTaskScheduleWriteInput) => Promise<ScheduledTaskScheduleWriteResult>;
}

export interface RunDueProjectScheduledTasksResult {
  scanned: number;
  created: number;
  deferred: number;
  blocked: number;
  failed: number;
  failureCodes?: Record<string, number>;
}

type DueScheduledTaskRow = {
  id: string;
  projectId: string;
  cronExpression: string;
  timezone: string;
  nextRunAt: Date;
  pendingScheduledFor: Date | null;
  lastScheduledFor: Date | null;
};

function scheduleWriteWhere(
  scheduledTaskId: string,
  input: ScheduledTaskScheduleWriteInput,
): Record<string, unknown> {
  return {
    id: scheduledTaskId,
    nextRunAt: input.expectedNextRunAt,
    pendingScheduledFor: input.expectedPendingScheduledFor,
    lastScheduledFor: input.expectedLastScheduledFor,
  };
}

function dateAtOrAfter(value: Date | null, target: Date): boolean {
  return value != null && value.getTime() >= target.getTime();
}

export async function deferDueScheduledTaskSchedule(
  db: ScheduledTaskScheduleWriteDb,
  input: ScheduledTaskScheduleWriteInput,
): Promise<ScheduledTaskScheduleWriteResult> {
  const result = await db.updateMany({
    where: scheduleWriteWhere(input.scheduledTaskId, input),
    data: { pendingScheduledFor: input.scheduledFor, nextRunAt: input.nextRunAt },
  });
  return { matched: result.count === 1, alreadyAdvanced: false };
}

export async function advanceDueScheduledTaskSchedule(
  db: ScheduledTaskScheduleWriteDb,
  input: ScheduledTaskScheduleWriteInput,
): Promise<ScheduledTaskScheduleWriteResult> {
  const result = await db.updateMany({
    where: scheduleWriteWhere(input.scheduledTaskId, input),
    data: {
      lastScheduledFor: input.scheduledFor,
      pendingScheduledFor: null,
      nextRunAt: input.nextRunAt,
    },
  });
  if (result.count === 1) return { matched: true, alreadyAdvanced: false };

  const current = await db.findUnique({
    where: { id: input.scheduledTaskId },
    select: { nextRunAt: true, pendingScheduledFor: true, lastScheduledFor: true },
  });
  if (!current) return { matched: false, alreadyAdvanced: false };
  if (current.pendingScheduledFor === null
    && dateAtOrAfter(current.lastScheduledFor, input.scheduledFor)
    && dateAtOrAfter(current.nextRunAt, input.nextRunAt)) {
    return { matched: false, alreadyAdvanced: true };
  }

  if (current.pendingScheduledFor != null
    && current.pendingScheduledFor.getTime() === input.scheduledFor.getTime()
    && dateAtOrAfter(current.nextRunAt, input.nextRunAt)) {
    const finalized = await db.updateMany({
      where: {
        id: input.scheduledTaskId,
        pendingScheduledFor: input.scheduledFor,
        nextRunAt: { gte: input.nextRunAt },
      },
      data: {
        lastScheduledFor: input.scheduledFor,
        pendingScheduledFor: null,
      },
    });
    if (finalized.count === 1) return { matched: true, alreadyAdvanced: false };

    const afterFinalization = await db.findUnique({
      where: { id: input.scheduledTaskId },
      select: { nextRunAt: true, pendingScheduledFor: true, lastScheduledFor: true },
    });
    const alreadyAdvancedAfterFinalization = afterFinalization != null
      && afterFinalization.pendingScheduledFor === null
      && dateAtOrAfter(afterFinalization.lastScheduledFor, input.scheduledFor)
      && dateAtOrAfter(afterFinalization.nextRunAt, input.nextRunAt);
    return { matched: false, alreadyAdvanced: alreadyAdvancedAfterFinalization };
  }

  return { matched: false, alreadyAdvanced: false };
}

const dueScheduledTaskSelect = {
  id: true,
  configurationSnapshot: true,
  cronExpression: true,
  timezone: true,
  nextRunAt: true,
  pendingScheduledFor: true,
  lastScheduledFor: true,
} as const;

const DEFAULT_DUE_PROJECT_SCHEDULED_TASK_DEPENDENCIES: RunDueProjectScheduledTaskDependencies = {
  listDueTasks: async (limit, now) => {
    const pendingRows = await prisma.projectScheduledTask.findMany({
      where: { status: "enabled", pendingScheduledFor: { not: null } },
      orderBy: [{ pendingScheduledFor: "asc" }, { id: "asc" }],
      take: limit,
      select: dueScheduledTaskSelect,
    });
    if (pendingRows.length >= limit) return pendingRows;

    const pendingIds = new Set(pendingRows.map((row) => row.id));
    const dueRows = await prisma.projectScheduledTask.findMany({
      where: {
        status: "enabled",
        nextRunAt: { lte: now },
        ...(pendingIds.size > 0 ? { id: { notIn: [...pendingIds] } } : {}),
      },
      orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
      take: limit - pendingRows.length,
      select: dueScheduledTaskSelect,
    });
    return [...pendingRows, ...dueRows];
  },
  hasActiveRun: async (scheduledTaskId) => {
    const count = await prisma.projectScheduledTaskRun.count({
      where: activeScheduledTaskRunWhere(scheduledTaskId),
    });
    return count > 0;
  },
  createRun: (input) => triggerProjectScheduledTaskRun(input),
  deferTask: (input) => deferDueScheduledTaskSchedule(
    prisma.projectScheduledTask as unknown as ScheduledTaskScheduleWriteDb,
    input,
  ),
  advanceTask: (input) => advanceDueScheduledTaskSchedule(
    prisma.projectScheduledTask as unknown as ScheduledTaskScheduleWriteDb,
    input,
  ),
};

function parseDueScheduledTaskRow(value: unknown): DueScheduledTaskRow {
  if (!isRecord(value)) throw validationError("Scheduled task scan row is invalid");
  const id = requiredText(value.id, "Scheduled task id", 32);
  if (!/^[a-f0-9]{32}$/u.test(id)) throw validationError("Scheduled task identity is invalid");
  const configurationSnapshot = isRecord(value.configurationSnapshot) ? value.configurationSnapshot : {};
  const projectId = typeof configurationSnapshot.projectId === "string"
    ? configurationSnapshot.projectId
    : "";
  const nextRunAt = parseDueDate(value.nextRunAt, "Scheduled task nextRunAt");
  return {
    id,
    projectId,
    cronExpression: requiredText(value.cronExpression, "Scheduled task cronExpression", 191),
    timezone: requiredText(value.timezone, "Scheduled task timezone", 64),
    nextRunAt,
    pendingScheduledFor: value.pendingScheduledFor == null
      ? null
      : parseDueDate(value.pendingScheduledFor, "Scheduled task pendingScheduledFor"),
    lastScheduledFor: value.lastScheduledFor == null
      ? null
      : parseDueDate(value.lastScheduledFor, "Scheduled task lastScheduledFor"),
  };
}

function parseDueDate(value: unknown, field: string): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.valueOf())) throw validationError(`${field} is invalid`);
  return date;
}

function parseOptionalDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.valueOf()) ? null : date;
}

function safeProjectionErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string" && error.code.trim()) {
    return error.code.trim();
  }
  return "projection_failed";
}

export async function runDueProjectScheduledTasks(input: {
  now: Date;
  limit?: number;
  dependencies?: RunDueProjectScheduledTaskDependencies;
}): Promise<RunDueProjectScheduledTasksResult> {
  assertValidDate(input.now, "Scheduled task scan time");
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1) throw validationError("Scheduled task scan limit is invalid");
  const dependencies = { ...DEFAULT_DUE_PROJECT_SCHEDULED_TASK_DEPENDENCIES, ...input.dependencies };
  if (typeof dependencies.listDueTasks !== "function"
    || typeof dependencies.hasActiveRun !== "function"
    || typeof dependencies.createRun !== "function"
    || typeof dependencies.deferTask !== "function"
    || typeof dependencies.advanceTask !== "function") {
    throw validationError("Scheduled task dispatch dependency is unavailable");
  }

  const rows = await dependencies.listDueTasks(limit, input.now);
  const result: RunDueProjectScheduledTasksResult = {
    scanned: 0,
    created: 0,
    deferred: 0,
    blocked: 0,
    failed: 0,
    failureCodes: {},
  };

  for (const row of rows) {
    try {
      result.scanned += 1;
      const task = parseDueScheduledTaskRow(row);
      const slot = resolveDueScheduledTaskSlot({
        rule: task.cronExpression,
        timezone: task.timezone,
        now: input.now,
        nextRunAt: task.nextRunAt,
        pendingScheduledFor: task.pendingScheduledFor,
        lastScheduledFor: task.lastScheduledFor,
      });
      if (!slot) continue;
      const expected = {
        expectedNextRunAt: task.nextRunAt,
        expectedPendingScheduledFor: task.pendingScheduledFor,
        expectedLastScheduledFor: task.lastScheduledFor,
      };
      const hasActiveRun = await dependencies.hasActiveRun(task.id);
      if (hasActiveRun) {
        const write = await dependencies.deferTask({
          scheduledTaskId: task.id,
          scheduledFor: slot.scheduledFor,
          nextRunAt: slot.nextRunAt,
          now: input.now,
          ...expected,
        });
        if (write.matched) result.deferred += 1;
        continue;
      }

      const run = await dependencies.createRun({
        projectId: task.projectId,
        scheduledTaskId: task.id,
        commandId: `scheduled-due:${task.id}:${slot.scheduledFor.toISOString()}`,
        triggerSource: slot.source,
        scheduledFor: slot.scheduledFor,
      });
      const write = await dependencies.advanceTask({
        scheduledTaskId: task.id,
        scheduledFor: slot.scheduledFor,
        nextRunAt: slot.nextRunAt,
        now: input.now,
        ...expected,
      });
      if (!write.matched && !write.alreadyAdvanced) {
        throw new Error("Scheduled task schedule changed while advancing");
      }
      if (!run.duplicate) result.created += 1;
    } catch (error) {
      const failure = classifyRunFailure(error);
      const failureCodes = result.failureCodes ?? {};
      failureCodes[failure.failureCode] = (failureCodes[failure.failureCode] ?? 0) + 1;
      result.failureCodes = failureCodes;
      if (failure.status === "blocked") result.blocked += 1;
      else result.failed += 1;
    }
  }

  return result;
}

export function projectScheduledTaskRunStatus(loopRunStatus: string): ScheduledTaskRunStatus {
  if (loopRunStatus === "pending" || loopRunStatus === "running") return "running";
  if (loopRunStatus === "waiting" || loopRunStatus === "paused") return "waiting";
  if (loopRunStatus === "completed") return "succeeded";
  if (loopRunStatus === "cancelled") return "cancelled";
  if (loopRunStatus === "failed" || loopRunStatus === "exhausted") return "failed";
  throw Object.assign(
    new Error(`Unsupported LoopRun status for scheduled task projection: ${loopRunStatus}`),
    { code: "unsupported_loop_run_status" },
  );
}

export interface ProjectScheduledTaskRunStatusDependencies {
  listNonTerminalRuns?: (limit: number) => Promise<unknown[]>;
  updateRunStatus?: (input: {
    runId: string;
    status: ScheduledTaskRunStatus;
    finishedAt: Date | null;
  }) => Promise<void>;
  onProjectionError?: (input: { runId: string | null; errorCode: string }) => void;
}

const DEFAULT_PROJECT_SCHEDULED_TASK_RUN_STATUS_DEPENDENCIES: ProjectScheduledTaskRunStatusDependencies = {
  listNonTerminalRuns: (limit) => prisma.projectScheduledTaskRun.findMany({
    where: { status: { in: [...ACTIVE_RUN_STATUSES] } },
    orderBy: [{ triggeredAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      status: true,
      loopRun: { select: { status: true, finishedAt: true } },
    },
  }),
  updateRunStatus: async ({ runId, status, finishedAt }) => {
    await prisma.projectScheduledTaskRun.updateMany({
      where: { id: runId, status: { in: [...ACTIVE_RUN_STATUSES] } },
      data: {
        status,
        finishedAt,
      } as Prisma.ProjectScheduledTaskRunUncheckedUpdateInput,
    });
  },
};

const TERMINAL_SCHEDULED_TASK_RUN_STATUSES = new Set<ScheduledTaskRunStatus>([
  "succeeded",
  "failed",
  "cancelled",
  "blocked",
]);

export async function projectScheduledTaskRunStatuses(input: {
  now: Date;
  limit?: number;
  dependencies?: ProjectScheduledTaskRunStatusDependencies;
}): Promise<{ scanned: number; terminalized: number; errors: number }> {
  assertValidDate(input.now, "Scheduled task projection time");
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1) throw validationError("Scheduled task projection limit is invalid");
  const dependencies = { ...DEFAULT_PROJECT_SCHEDULED_TASK_RUN_STATUS_DEPENDENCIES, ...input.dependencies };
  if (typeof dependencies.listNonTerminalRuns !== "function" || typeof dependencies.updateRunStatus !== "function") {
    throw validationError("Scheduled task projection dependency is unavailable");
  }

  const rows = await dependencies.listNonTerminalRuns(limit);
  let terminalized = 0;
  let errors = 0;
  for (const row of rows) {
    let runId: string | null = null;
    try {
      if (!isRecord(row)) continue;
      runId = requiredText(row.id, "Scheduled task Run id", 32);
      if (!isRecord(row.loopRun)) continue;
      const loopRunStatus = requiredText(row.loopRun.status, "LoopRun status", 24);
      const projectedStatus = projectScheduledTaskRunStatus(loopRunStatus);
      if (TERMINAL_SCHEDULED_TASK_RUN_STATUSES.has(projectedStatus)) {
        const loopRunFinishedAt = parseOptionalDate(row.loopRun.finishedAt);
        await dependencies.updateRunStatus({
          runId,
          status: projectedStatus,
          finishedAt: loopRunFinishedAt ?? input.now,
        });
        terminalized += 1;
      } else {
        await dependencies.updateRunStatus({ runId, status: projectedStatus, finishedAt: null });
      }
    } catch (error) {
      errors += 1;
      dependencies.onProjectionError?.({
        runId,
        errorCode: safeProjectionErrorCode(error),
      });
    }
  }
  return { scanned: rows.length, terminalized, errors };
}
