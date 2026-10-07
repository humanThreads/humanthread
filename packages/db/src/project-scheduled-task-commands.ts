import type { Prisma } from "@prisma/client";
import {
  calculateNextScheduledTaskOccurrence,
  parseScheduledTaskCron,
  transitionScheduledTaskStatus,
} from "@humanthread/orchestration-core";
import {
  changeProjectScheduledTaskStatusSchema,
  createProjectScheduledTaskSchema,
  updateProjectScheduledTaskSchema,
  type ScheduledTaskContentMode,
  type ScheduledTaskExecutionTargetInput,
  type ScheduledTaskStatus,
} from "@humanthread/shared";
import { assertCanWriteProject } from "./access-control";
import { prisma } from "./prisma";
import { isPrismaUniqueConstraintError } from "./prisma-errors";
import {
  projectScheduledTaskEventId,
  projectScheduledTaskId,
  scheduledTaskActorDigest,
  scheduledTaskExecutionTargetDigest,
  scheduledTaskLoopBindingDigest,
  scheduledTaskProjectDigest,
} from "./project-scheduled-task-identity";

export type ScheduledTaskExecutionTargetSnapshot =
  | { type: "local_agent"; id: string; displayName: string; provider: "codex" | "claude" }
  | { type: "linux_worker_pool"; id: string; displayName: string; provider: null };

export interface ProjectScheduledTaskCommandOperations {
  createTask(input: { data: Record<string, unknown> }): Promise<unknown>;
  updateTask(input: { where: { id: string; version: number }; data: Record<string, unknown> }): Promise<unknown>;
  createEvent(input: { data: Record<string, unknown> }): Promise<unknown>;
}

export interface ProjectScheduledTaskCommandDependencies {
  assertCanWriteProject(input: { userId: string; projectId: string }): Promise<unknown>;
  loadBinding(input: { projectId: string; bindingId: string }): Promise<unknown | null>;
  loadTarget(input: { projectId: string; target: ScheduledTaskExecutionTargetInput }): Promise<ScheduledTaskExecutionTargetSnapshot | null>;
  loadTask(input: { scheduledTaskId: string; projectDigest: string }): Promise<unknown | null>;
  loadEvent(input: { scheduledTaskId: string; commandId: string }): Promise<unknown | null>;
  executeCommand<T>(fn: (operations: ProjectScheduledTaskCommandOperations) => Promise<T>): Promise<T>;
}

export interface ProjectScheduledTaskCommandResult {
  id: string;
  status: ScheduledTaskStatus;
  version: number;
  nextRunAt: string | null;
}

type ScheduledTaskBinding = {
  id: string;
  projectId: string;
  status: string;
  loopDefinitionId: string;
  activeVersionId: string;
  allowedAgentProfileIds?: unknown;
  allowedProviders?: unknown;
  workerPoolId?: string | null;
  workerStageConfigurations?: unknown;
  project?: { workerPoolId?: string | null } | null;
  loopDefinition?: {
    name?: string;
    scope?: string;
    status?: string;
    latestPublishedVersion?: { status: string } | null;
  } | null;
  activeVersion?: { status: string } | null;
};

type LoadedScheduledTask = {
  id: string;
  projectDigest: string;
  status: string;
  version: number;
  name?: string;
  description?: string;
  cronExpression?: string;
  timezone?: string;
  contentMode?: string;
  contentMarkdown?: string | null;
  loopBindingDigest?: string;
  executionTargetDigest?: string;
  configurationSnapshot?: unknown;
  executionTargetSnapshot?: unknown;
  pendingScheduledFor?: Date | string | null;
  lastScheduledFor?: Date | string | null;
  nextRunAt?: Date | string | null;
};

function validationError(message: string): Error & { code: "validation_failed" } {
  return Object.assign(new Error(message), { code: "validation_failed" as const });
}

function notFound(message: string): Error & { code: "not_found" } {
  return Object.assign(new Error(message), { code: "not_found" as const });
}

function versionConflict(message: string): Error & { code: "version_conflict" } {
  return Object.assign(new Error(message), { code: "version_conflict" as const });
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function asTask(value: unknown | null): LoadedScheduledTask | null {
  return value as LoadedScheduledTask | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bindingSnapshot(projectId: string, binding: ScheduledTaskBinding): Record<string, unknown> {
  return {
    projectId,
    projectDigest: scheduledTaskProjectDigest(projectId),
    loopBindingId: binding.id,
    loopBindingDigest: scheduledTaskLoopBindingDigest(binding.id),
    loopDefinitionId: binding.loopDefinitionId,
    ...(binding.loopDefinition?.name ? { loopName: binding.loopDefinition.name } : {}),
    loopVersionId: binding.activeVersionId,
    loopScope: binding.loopDefinition?.scope ?? "project",
  };
}

function executionTargetSnapshotData(
  target: ScheduledTaskExecutionTargetInput,
  snapshot: ScheduledTaskExecutionTargetSnapshot,
): Record<string, unknown> {
  return { ...snapshot, executionTargetDigest: scheduledTaskExecutionTargetDigest(target) };
}

function validateBinding(binding: ScheduledTaskBinding | null, projectId: string): ScheduledTaskBinding {
  if (!binding || binding.projectId !== projectId || binding.status !== "enabled") {
    throw notFound("Scheduled task Loop binding not found");
  }

  const definition = binding.loopDefinition;
  const activeVersion = binding.activeVersion;
  const publishedVersion = definition?.latestPublishedVersion;
  const scope = definition?.scope;
  if (
    definition?.status === "archived"
    || (scope !== "project" && scope !== "task")
    || activeVersion?.status !== "published"
    || publishedVersion?.status !== "published"
  ) {
    if (definition?.status === "archived") throw notFound("Scheduled task Loop binding not found");
    throw validationError("Scheduled task Loop binding is not published for this project");
  }

  return binding;
}

function createInputFromRequest(input: {
  commandId: string;
  name: string;
  description: string;
  loopBindingId: string;
  cronExpression: string;
  timezone: string;
  contentMode: ScheduledTaskContentMode;
  contentMarkdown?: string;
  executionTarget: ScheduledTaskExecutionTargetInput;
}) {
  return createProjectScheduledTaskSchema.parse({
    commandId: input.commandId,
    name: input.name,
    description: input.description,
    loopBindingId: input.loopBindingId,
    cronExpression: input.cronExpression,
    timezone: input.timezone,
    contentMode: input.contentMode,
    ...(input.contentMarkdown === undefined ? {} : { contentMarkdown: input.contentMarkdown }),
    executionTarget: input.executionTarget,
  });
}

function updateInputFromRequest(input: {
  commandId: string;
  expectedVersion: number;
  name?: string;
  description?: string;
  loopBindingId?: string;
  cronExpression?: string;
  timezone?: string;
  contentMode?: ScheduledTaskContentMode;
  contentMarkdown?: string | null;
  executionTarget?: ScheduledTaskExecutionTargetInput;
}) {
  return updateProjectScheduledTaskSchema.parse({
    commandId: input.commandId,
    expectedVersion: input.expectedVersion,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.loopBindingId === undefined ? {} : { loopBindingId: input.loopBindingId }),
    ...(input.cronExpression === undefined ? {} : { cronExpression: input.cronExpression }),
    ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
    ...(input.contentMode === undefined ? {} : { contentMode: input.contentMode }),
    ...(input.contentMarkdown === undefined ? {} : { contentMarkdown: input.contentMarkdown }),
    ...(input.executionTarget === undefined ? {} : { executionTarget: input.executionTarget }),
  });
}

function statusInputFromRequest(input: {
  commandId: string;
  expectedVersion: number;
  command: "enable" | "deactivate" | "disable" | "restore";
}) {
  return changeProjectScheduledTaskStatusSchema.parse({
    commandId: input.commandId,
    expectedVersion: input.expectedVersion,
    command: input.command,
  });
}

function assertUpdateApplied(updated: unknown): void {
  if (isRecord(updated) && updated.count === 0) {
    throw versionConflict("Scheduled task was changed by another command");
  }
}

function commandResultPayload(
  result: ProjectScheduledTaskCommandResult,
  commandId: string,
): Record<string, unknown> {
  return {
    id: result.id,
    commandId,
    status: result.status,
    version: result.version,
    nextRunAt: result.nextRunAt,
  };
}

function readCommandResult(event: unknown | null): ProjectScheduledTaskCommandResult | null {
  if (!isRecord(event) || !isRecord(event.payload)) return null;
  const payload = event.payload;
  const id = payload.id;
  const status = payload.status;
  const version = payload.version;
  const nextRunAt = payload.nextRunAt;
  if (typeof id !== "string" || typeof status !== "string" || typeof version !== "number") return null;
  if (status !== "inactive" && status !== "enabled" && status !== "disabled") return null;
  return {
    id,
    status,
    version,
    nextRunAt: typeof nextRunAt === "string" ? nextRunAt : null,
  };
}

async function replayCommand(
  dependencies: ProjectScheduledTaskCommandDependencies,
  scheduledTaskId: string,
  commandId: string,
): Promise<ProjectScheduledTaskCommandResult | null> {
  const event = await dependencies.loadEvent({ scheduledTaskId, commandId });
  return readCommandResult(event);
}

async function loadOwnedTaskForReplay(
  dependencies: ProjectScheduledTaskCommandDependencies,
  input: { scheduledTaskId: string; projectId: string },
): Promise<LoadedScheduledTask> {
  const projectDigest = scheduledTaskProjectDigest(input.projectId);
  const task = asTask(await dependencies.loadTask({
    scheduledTaskId: input.scheduledTaskId,
    projectDigest,
  }));
  if (!task || task.projectDigest !== projectDigest) {
    throw notFound("Scheduled task not found");
  }
  return task;
}

function assertExpectedVersion(task: LoadedScheduledTask, expectedVersion: number): void {
  if (task.version !== expectedVersion) {
    throw versionConflict("Scheduled task version does not match the command");
  }
}

async function resolveBinding(
  dependencies: ProjectScheduledTaskCommandDependencies,
  input: { projectId: string; bindingId: string },
): Promise<ScheduledTaskBinding> {
  const binding = await dependencies.loadBinding({
    projectId: input.projectId,
    bindingId: input.bindingId,
  });
  return validateBinding(binding as ScheduledTaskBinding | null, input.projectId);
}

async function resolveTargetSnapshot(
  dependencies: ProjectScheduledTaskCommandDependencies,
  input: {
    projectId: string;
    target: ScheduledTaskExecutionTargetInput;
    binding?: ScheduledTaskBinding;
  },
): Promise<ScheduledTaskExecutionTargetSnapshot> {
  const target = await dependencies.loadTarget(input);
  if (!target) throw validationError("Scheduled task execution target is invalid");
  if (input.binding) validateTargetAgainstBinding(input.binding, input.target, target);
  return target;
}

function validateTargetAgainstBinding(
  binding: ScheduledTaskBinding,
  target: ScheduledTaskExecutionTargetInput,
  snapshot: ScheduledTaskExecutionTargetSnapshot,
): void {
  if (target.type === "local_agent") {
    const allowedProfiles = Array.isArray(binding.allowedAgentProfileIds)
      ? binding.allowedAgentProfileIds.filter((id): id is string => typeof id === "string")
      : [];
    const allowedProviders = new Set(Array.isArray(binding.allowedProviders)
      ? binding.allowedProviders.filter((provider): provider is string => typeof provider === "string")
      : []);
    if (
      !allowedProfiles.includes(target.agentProfileId)
      || snapshot.type !== "local_agent"
      || !allowedProviders.has(snapshot.provider)
    ) {
      throw validationError("Scheduled task execution target is not allowed by the selected Loop binding");
    }
    return;
  }

  const effectivePoolId = binding.workerPoolId ?? binding.project?.workerPoolId ?? null;
  const stageConfigurations = binding.workerStageConfigurations;
  const hasStageConfigurations = isRecord(stageConfigurations) && Object.keys(stageConfigurations).length > 0;
  if (
    snapshot.type !== "linux_worker_pool"
    || effectivePoolId !== target.workerPoolId
    || !hasStageConfigurations
  ) {
    throw validationError("Scheduled task execution target is not allowed by the selected Loop binding");
  }
}

function targetInputFromSnapshot(value: unknown): ScheduledTaskExecutionTargetInput | null {
  if (!isRecord(value)) return null;
  if (value.type === "local_agent" && typeof value.id === "string") {
    return { type: "local_agent", agentProfileId: value.id };
  }
  if (value.type === "linux_worker_pool" && typeof value.id === "string" && /^[a-f0-9]{32}$/u.test(value.id)) {
    return { type: "linux_worker_pool", workerPoolId: value.id };
  }
  return null;
}

function eventData(input: {
  scheduledTaskId: string;
  eventType: string;
  actorDigest: string;
  commandId: string;
  payload: Record<string, unknown>;
  now: Date;
}): Record<string, unknown> {
  return {
    id: projectScheduledTaskEventId(input.scheduledTaskId, input.commandId),
    scheduledTaskId: input.scheduledTaskId,
    eventType: input.eventType,
    actorDigest: input.actorDigest,
    payload: input.payload,
    occurredAt: input.now,
  };
}

async function resolveTargetSnapshotWithPrisma(input: {
  projectId: string;
  target: ScheduledTaskExecutionTargetInput;
}): Promise<ScheduledTaskExecutionTargetSnapshot | null> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { ownerType: true, ownerUserId: true, companyId: true },
  });
  if (!project) return null;

  if (input.target.type === "local_agent") {
    const profile = await prisma.agentProfile.findFirst({
      where: {
        id: input.target.agentProfileId,
        status: "active",
        space: { projects: { some: { id: input.projectId } } },
      },
      select: { id: true, name: true, provider: true },
    });
    if (!profile || (profile.provider !== "codex" && profile.provider !== "claude")) return null;
    return { type: "local_agent", id: profile.id, displayName: profile.name, provider: profile.provider };
  }

  const scope = project.ownerType === "personal"
    ? { ownerType: "personal" as const, ownerUserId: project.ownerUserId, companyId: null }
    : project.ownerType === "company"
      ? { ownerType: "company" as const, ownerUserId: null, companyId: project.companyId }
      : null;
  if (!scope) return null;

  const pool = await prisma.workerPool.findFirst({
    where: {
      id: input.target.workerPoolId,
      ownerType: scope.ownerType,
      ownerUserId: scope.ownerUserId,
      companyId: scope.companyId,
      status: "active",
      revokedAt: null,
    },
    select: { id: true, displayName: true },
  });
  if (!pool) return null;
  return { type: "linux_worker_pool", id: pool.id, displayName: pool.displayName, provider: null };
}

function uniqueConstraintTarget(error: unknown): string[] {
  if (!isRecord(error) || !isRecord(error.meta)) return [];
  const target = error.meta.target;
  if (!Array.isArray(target)) return [];
  return target.filter((value): value is string => typeof value === "string");
}

function mapScheduledTaskPrismaError(error: unknown): unknown {
  if (isPrismaUniqueConstraintError(error) && uniqueConstraintTarget(error).includes("name")) {
    return validationError("Scheduled task name already exists in this project");
  }
  return error;
}

const DEFAULT_DEPENDENCIES: ProjectScheduledTaskCommandDependencies = {
  assertCanWriteProject,
  loadBinding: ({ projectId, bindingId }) => prisma.projectLoopBinding.findFirst({
    where: { id: bindingId, projectId, status: "enabled" },
    select: {
      id: true, projectId: true, loopDefinitionId: true, activeVersionId: true, status: true,
      allowedAgentProfileIds: true,
      allowedProviders: true,
      workerPoolId: true,
      workerStageConfigurations: true,
      project: { select: { workerPoolId: true } },
      activeVersion: { select: { id: true, status: true } },
      loopDefinition: {
        select: {
          name: true,
          scope: true,
          status: true,
          latestPublishedVersion: { select: { status: true } },
        },
      },
    },
  }),
  loadTarget: resolveTargetSnapshotWithPrisma,
  loadTask: ({ scheduledTaskId, projectDigest }) => prisma.projectScheduledTask.findFirst({
    where: { id: scheduledTaskId, projectDigest },
  }),
  loadEvent: ({ scheduledTaskId, commandId }) => prisma.projectScheduledTaskEvent.findUnique({
    where: { id: projectScheduledTaskEventId(scheduledTaskId, commandId) },
  }),
  executeCommand: async (fn) => {
    try {
      return await prisma.$transaction((tx) => fn({
        createTask: ({ data }) => tx.projectScheduledTask.create({
          data: data as Prisma.ProjectScheduledTaskUncheckedCreateInput,
        }),
        updateTask: async ({ where, data }) => {
          const result = await tx.projectScheduledTask.updateMany({
            where,
            data: data as Prisma.ProjectScheduledTaskUncheckedUpdateManyInput,
          });
          return { count: result.count };
        },
        createEvent: ({ data }) => tx.projectScheduledTaskEvent.create({
          data: data as Prisma.ProjectScheduledTaskEventUncheckedCreateInput,
        }),
      }));
    } catch (error) {
      throw mapScheduledTaskPrismaError(error);
    }
  },
};

export async function createProjectScheduledTask(input: {
  actorUserId: string;
  projectId: string;
  commandId: string;
  name: string;
  description: string;
  loopBindingId: string;
  cronExpression: string;
  timezone: string;
  contentMode: ScheduledTaskContentMode;
  contentMarkdown?: string;
  executionTarget: ScheduledTaskExecutionTargetInput;
}, dependencies: ProjectScheduledTaskCommandDependencies = DEFAULT_DEPENDENCIES): Promise<ProjectScheduledTaskCommandResult> {
  const parsed = createInputFromRequest(input);
  await dependencies.assertCanWriteProject({ userId: input.actorUserId, projectId: input.projectId });

  const projectDigest = scheduledTaskProjectDigest(input.projectId);
  const id = projectScheduledTaskId(input.projectId, input.commandId);

  const replayed = await replayCommand(dependencies, id, input.commandId);
  if (replayed) return replayed;

  const existing = asTask(await dependencies.loadTask({ scheduledTaskId: id, projectDigest }));
  if (existing && existing.projectDigest === projectDigest) {
    return {
      id,
      status: existing.status as ScheduledTaskStatus,
      version: existing.version,
      nextRunAt: toIsoString(existing.nextRunAt),
    };
  }

  const binding = await resolveBinding(dependencies, {
    projectId: input.projectId,
    bindingId: parsed.loopBindingId,
  });
  const now = new Date();
  parseScheduledTaskCron(parsed.cronExpression);
  calculateNextScheduledTaskOccurrence({
    rule: parsed.cronExpression,
    timezone: parsed.timezone,
    after: now,
  });

  const targetSnapshot = await resolveTargetSnapshot(dependencies, {
    projectId: input.projectId,
    target: parsed.executionTarget,
    binding,
  });
  const actorDigest = scheduledTaskActorDigest(input.actorUserId);
  const contentMarkdown = parsed.contentMode === "loop_managed" ? null : parsed.contentMarkdown ?? null;

  const taskData: Record<string, unknown> = {
    id,
    projectDigest,
    name: parsed.name,
    description: parsed.description,
    status: "inactive",
    cronExpression: parsed.cronExpression,
    timezone: parsed.timezone,
    contentMode: parsed.contentMode,
    contentMarkdown,
    loopBindingDigest: scheduledTaskLoopBindingDigest(binding.id),
    executionTargetDigest: scheduledTaskExecutionTargetDigest(parsed.executionTarget),
    configurationSnapshot: bindingSnapshot(input.projectId, binding),
    executionTargetSnapshot: executionTargetSnapshotData(parsed.executionTarget, targetSnapshot),
    lastScheduledFor: null,
    pendingScheduledFor: null,
    nextRunAt: null,
    version: 1,
    createdByDigest: actorDigest,
    updatedByDigest: actorDigest,
  };

  const result: ProjectScheduledTaskCommandResult = { id, status: "inactive", version: 1, nextRunAt: null };

  await dependencies.executeCommand(async (operations) => {
    await operations.createTask({ data: taskData });
    await operations.createEvent({
      data: eventData({
        scheduledTaskId: id,
        eventType: "scheduled_task.created",
        actorDigest,
        commandId: input.commandId,
        payload: commandResultPayload(result, input.commandId),
        now,
      }),
    });
    return result;
  });

  return result;
}

export async function updateProjectScheduledTask(input: {
  actorUserId: string;
  projectId: string;
  scheduledTaskId: string;
  commandId: string;
  expectedVersion: number;
  name?: string;
  description?: string;
  loopBindingId?: string;
  cronExpression?: string;
  timezone?: string;
  contentMode?: ScheduledTaskContentMode;
  contentMarkdown?: string | null;
  executionTarget?: ScheduledTaskExecutionTargetInput;
}, dependencies: ProjectScheduledTaskCommandDependencies = DEFAULT_DEPENDENCIES): Promise<ProjectScheduledTaskCommandResult> {
  const parsed = updateInputFromRequest(input);
  await dependencies.assertCanWriteProject({ userId: input.actorUserId, projectId: input.projectId });
  const ownedTask = await loadOwnedTaskForReplay(dependencies, {
    scheduledTaskId: input.scheduledTaskId,
    projectId: input.projectId,
  });

  const replayed = await replayCommand(dependencies, input.scheduledTaskId, input.commandId);
  if (replayed) return replayed;

  assertExpectedVersion(ownedTask, input.expectedVersion);
  const task = ownedTask;

  const changes: Record<string, unknown> = {};
  if (input.name !== undefined) changes.name = parsed.name;
  if (input.description !== undefined) changes.description = parsed.description;
  if (input.cronExpression !== undefined) changes.cronExpression = parsed.cronExpression;
  if (input.timezone !== undefined) changes.timezone = parsed.timezone;

  const mergedContentMode = input.contentMode !== undefined
    ? parsed.contentMode as ScheduledTaskContentMode
    : task.contentMode as ScheduledTaskContentMode;
  const mergedContentMarkdown = input.contentMarkdown !== undefined
    ? parsed.contentMarkdown
    : task.contentMarkdown ?? null;

  if (mergedContentMode === "loop_managed") {
    if (input.contentMarkdown != null) {
      throw validationError("Project-managed scheduled task content cannot be submitted by the platform");
    }
    if (input.contentMode !== undefined) changes.contentMode = "loop_managed";
    changes.contentMarkdown = null;
  } else {
    if (!mergedContentMarkdown?.trim()) {
      throw validationError("Platform-managed scheduled task content is required");
    }
    if (input.contentMode !== undefined) changes.contentMode = "platform";
    if (input.contentMarkdown !== undefined) changes.contentMarkdown = mergedContentMarkdown;
  }

  const targetOrBindingChanged = input.loopBindingId !== undefined || input.executionTarget !== undefined;
  if (targetOrBindingChanged) {
    const configuredBindingId = isRecord(task.configurationSnapshot)
      && typeof task.configurationSnapshot.loopBindingId === "string"
      ? task.configurationSnapshot.loopBindingId
      : null;
    if (!input.loopBindingId && !configuredBindingId) {
      throw validationError("Scheduled task Loop binding is unavailable");
    }
    const explicitBinding = input.loopBindingId !== undefined
      ? await resolveBinding(dependencies, {
        projectId: input.projectId,
        bindingId: parsed.loopBindingId as string,
      })
      : null;
    const target = (parsed.executionTarget as ScheduledTaskExecutionTargetInput | undefined)
      ?? targetInputFromSnapshot(task.executionTargetSnapshot);
    if (!target) throw validationError("Scheduled task execution target is unavailable");
    const targetSnapshot = await resolveTargetSnapshot(dependencies, {
      projectId: input.projectId,
      target,
    });
    const binding = explicitBinding ?? await resolveBinding(dependencies, {
      projectId: input.projectId,
      bindingId: configuredBindingId!,
    });
    validateTargetAgainstBinding(binding, target, targetSnapshot);
    if (input.loopBindingId !== undefined) {
      changes.loopBindingDigest = scheduledTaskLoopBindingDigest(binding.id);
      changes.configurationSnapshot = bindingSnapshot(input.projectId, binding);
    }
    if (input.executionTarget !== undefined) {
      changes.executionTargetDigest = scheduledTaskExecutionTargetDigest(target);
      changes.executionTargetSnapshot = executionTargetSnapshotData(target, targetSnapshot);
    }
  }

  const mergedCron = input.cronExpression !== undefined ? parsed.cronExpression : task.cronExpression;
  const mergedTimezone = input.timezone !== undefined ? parsed.timezone : task.timezone;
  const now = new Date();
  parseScheduledTaskCron(mergedCron as string);
  const candidateNextRunAt = calculateNextScheduledTaskOccurrence({
    rule: mergedCron as string,
    timezone: mergedTimezone as string,
    after: now,
  });

  const scheduleAffected = input.cronExpression !== undefined || input.timezone !== undefined;
  const nextRunAt = task.status === "enabled" && scheduleAffected ? candidateNextRunAt : task.nextRunAt ?? null;
  if (task.status === "enabled" && scheduleAffected) changes.nextRunAt = nextRunAt;
  if (scheduleAffected) changes.pendingScheduledFor = null;

  const version = input.expectedVersion + 1;
  const result: ProjectScheduledTaskCommandResult = {
    id: task.id,
    status: task.status as ScheduledTaskStatus,
    version,
    nextRunAt: toIsoString(nextRunAt),
  };

  await dependencies.executeCommand(async (operations) => {
    const updated = await operations.updateTask({
      where: { id: task.id, version: input.expectedVersion },
      data: {
        ...changes,
        status: task.status,
        version,
        updatedByDigest: scheduledTaskActorDigest(input.actorUserId),
      },
    });
    assertUpdateApplied(updated);
    await operations.createEvent({
      data: eventData({
        scheduledTaskId: task.id,
        eventType: "scheduled_task.updated",
        actorDigest: scheduledTaskActorDigest(input.actorUserId),
        commandId: input.commandId,
        payload: commandResultPayload(result, input.commandId),
        now,
      }),
    });
    return result;
  });

  return result;
}

export async function changeProjectScheduledTaskStatus(input: {
  actorUserId: string;
  projectId: string;
  scheduledTaskId: string;
  commandId: string;
  expectedVersion: number;
  command: "enable" | "deactivate" | "disable" | "restore";
}, dependencies: ProjectScheduledTaskCommandDependencies = DEFAULT_DEPENDENCIES): Promise<ProjectScheduledTaskCommandResult> {
  const parsed = statusInputFromRequest(input);
  await dependencies.assertCanWriteProject({ userId: input.actorUserId, projectId: input.projectId });
  const ownedTask = await loadOwnedTaskForReplay(dependencies, {
    scheduledTaskId: input.scheduledTaskId,
    projectId: input.projectId,
  });

  const replayed = await replayCommand(dependencies, input.scheduledTaskId, input.commandId);
  if (replayed) return replayed;

  assertExpectedVersion(ownedTask, input.expectedVersion);
  const task = ownedTask;

  const now = new Date();
  const transition = transitionScheduledTaskStatus(task.status as ScheduledTaskStatus, parsed.command, now);
  const nextRunAt = parsed.command === "enable"
    ? calculateNextScheduledTaskOccurrence({
      rule: task.cronExpression as string,
      timezone: task.timezone as string,
      after: now,
    })
    : transition.nextRunAt;
  const version = input.expectedVersion + 1;
  const result: ProjectScheduledTaskCommandResult = {
    id: task.id,
    status: transition.status,
    version,
    nextRunAt: toIsoString(nextRunAt),
  };

  await dependencies.executeCommand(async (operations) => {
    const updated = await operations.updateTask({
      where: { id: task.id, version: input.expectedVersion },
      data: {
        status: transition.status,
        nextRunAt,
        pendingScheduledFor: transition.pendingScheduledFor,
        version,
        updatedByDigest: scheduledTaskActorDigest(input.actorUserId),
      },
    });
    assertUpdateApplied(updated);
    await operations.createEvent({
      data: eventData({
        scheduledTaskId: task.id,
        eventType: "scheduled_task.status_changed",
        actorDigest: scheduledTaskActorDigest(input.actorUserId),
        commandId: input.commandId,
        payload: {
          ...commandResultPayload(result, input.commandId),
          command: parsed.command,
          from: task.status,
          to: transition.status,
        },
        now,
      }),
    });
    return result;
  });

  return result;
}
