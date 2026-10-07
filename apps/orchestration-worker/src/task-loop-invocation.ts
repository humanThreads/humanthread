import {
  createGraphLoopRun,
  prisma,
  resumeParentAfterChildLoop,
  snapshotBindingGrants,
  type CreateGraphLoopRunInput,
} from "@humanthread/db";
import {
  buildLoopTriggerIdentity,
  parseRunGraphSnapshot,
  parseRunGraphSnapshotV2,
  resolveLoopTriggerSnapshots,
  type RunGraphSnapshot,
  type RunGraphSnapshotV2,
} from "@humanthread/orchestration-core";

interface TaskLoopInvocationDependencies {
  now(): Date;
  loadTask(taskId: string): Promise<unknown>;
  loadParentRun(loopRunId: string): Promise<unknown>;
  loadPinnedLoopVersion(loopVersionId: string): Promise<unknown>;
  listEnabledTaskBindings(projectId: string): Promise<unknown[]>;
  snapshotBindingGrants(input: { bindingId: string; now: Date }): Promise<unknown[]>;
  createGraphLoopRun(input: CreateGraphLoopRunInput): ReturnType<typeof createGraphLoopRun>;
}

const defaultDependencies: TaskLoopInvocationDependencies = {
  now: () => new Date(),
  loadTask: (taskId) => prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, projectId: true },
  }),
  loadParentRun: (loopRunId) => prisma.loopRun.findUnique({
    where: { id: loopRunId },
    select: { id: true, projectId: true, taskId: true, scheduledTaskRunId: true, runGraphSnapshot: true },
  }),
  loadPinnedLoopVersion: (loopVersionId) => prisma.loopVersion.findUnique({
    where: { id: loopVersionId },
    select: {
      id: true,
      loopDefinitionId: true,
      status: true,
      maxStages: true,
      maxRepeatCount: true,
      platformMaxTransitions: true,
    },
  }),
  listEnabledTaskBindings: (projectId) => prisma.projectLoopBinding.findMany({
    where: {
      projectId,
      status: "enabled",
      loopDefinition: { scope: "task" },
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      projectId: true,
      loopDefinitionId: true,
      activeVersionId: true,
      status: true,
      version: true,
      createdByUserId: true,
      triggerPolicy: true,
      parameterOverrides: true,
      notificationPolicy: true,
      automationGrantIds: true,
      allowedAgentProfileIds: true,
      allowedProviders: true,
      workerStageConfigurations: true,
      project: { select: { workerPoolId: true, workerRepositoryUrl: true, workerBranchPolicy: true } },
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
          scope: true,
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
    },
  }),
  snapshotBindingGrants: (input) => snapshotBindingGrants(input),
  createGraphLoopRun: (input) => createGraphLoopRun(input),
};

export async function handleChildLoopTerminalEvent(
  input: unknown,
  dependencies: {
    resumeParentAfterChildLoop(input: {
      childLoopRunId: string;
      occurredAt: Date;
      correlationId: string;
      actor: { type: "system"; id: string };
    }): Promise<{ resumed: boolean; duplicate: boolean }>;
  } = {
    resumeParentAfterChildLoop: (resumeInput) => resumeParentAfterChildLoop(resumeInput),
  },
): Promise<{ resumed: boolean; duplicate: boolean }> {
  const event = requireRecord(input, "Child Loop event is invalid");
  if (event.eventType !== "loop.node.completed") return { resumed: false, duplicate: false };
  const payload = requireRecord(event.payload, "Child Loop event payload is invalid");
  const occurredAt = new Date(requiredText(event.occurredAt, "event.occurredAt", 64));
  if (!Number.isFinite(occurredAt.getTime())) throw validationError("Child Loop event occurredAt is invalid");
  return dependencies.resumeParentAfterChildLoop({
    childLoopRunId: requiredText(payload.loopRunId, "event.payload.loopRunId", 96),
    occurredAt,
    correlationId: requiredText(event.correlationId, "event.correlationId", 128),
    actor: { type: "system", id: "loop-child-resumer" },
  });
}

export async function invokeTaskScopedChildLoop(
  input: {
    projectId: string;
    taskId?: string;
    parent: { loopRunId: string; nodeRunId: string; attemptId: string };
    inputSnapshot: unknown;
    correlationId: string;
    actorUserId: string;
    targetLoopDefinitionId?: string;
    targetLoopVersionId?: string;
  },
  dependencies: TaskLoopInvocationDependencies = defaultDependencies,
): Promise<{ childLoopRunId: string }> {
  requiredText(input.projectId, "projectId", 64);
  if (input.taskId !== undefined) requiredText(input.taskId, "taskId", 96);
  requiredText(input.actorUserId, "actorUserId", 64);
  requiredText(input.correlationId, "correlationId", 128);
  validateParent(input.parent);
  const target = parseTarget(input);
  let task: { id: string; projectId: string | null } | null = null;
  if (input.taskId !== undefined) {
    task = asTask(await dependencies.loadTask(input.taskId));
    if (!task || task.projectId !== input.projectId) {
      throw configurationRequired("Task-scoped Loop binding is not configured");
    }
  }
  const parentRun = asParentRun(await dependencies.loadParentRun(input.parent.loopRunId));
  const scheduledTaskRunId = parentRun?.scheduledTaskRunId ?? null;
  if (
    !parentRun
    || parentRun.id !== input.parent.loopRunId
    || parentRun.projectId !== input.projectId
    || (scheduledTaskRunId === null
      ? !input.taskId || parentRun.taskId !== input.taskId
      : input.taskId !== undefined || parentRun.taskId !== null)
  ) {
    throw validationError("Parent LoopRun does not match the task child invocation");
  }
  let runGraphSnapshot: RunGraphSnapshot | RunGraphSnapshotV2 | undefined;
  let pinnedTarget: (RunGraphSnapshot | RunGraphSnapshotV2)["loopVersions"][number] | undefined;
  if (target === undefined) {
    runGraphSnapshot = legacyParentSnapshot(parentRun.runGraphSnapshot);
  } else {
    runGraphSnapshot = isV2RunGraphSnapshot(parentRun.runGraphSnapshot)
      ? parseRunGraphSnapshotV2(parentRun.runGraphSnapshot)
      : parseRunGraphSnapshot(parentRun.runGraphSnapshot);
    pinnedTarget = findPinnedTarget(runGraphSnapshot, target);
  }
  const bindings = (await dependencies.listEnabledTaskBindings(input.projectId))
    .filter(isEnabledTaskBinding)
    .filter((binding) => pinnedTarget === undefined || bindingDefinitionId(binding) === pinnedTarget.loopDefinitionId);
  const binding = bindings[0];
  if (!binding) throw configurationRequired("Task-scoped Loop binding is not configured");
  if (bindings.length > 1) throw validationError("Project has more than one enabled binding for the task SubLoop");

  let snapshotBinding = binding;
  if (pinnedTarget !== undefined) {
    const pinnedVersion = asPinnedLoopVersion(
      await dependencies.loadPinnedLoopVersion(pinnedTarget.loopVersionId),
    );
    if (
      !pinnedVersion
      || pinnedVersion.id !== pinnedTarget.loopVersionId
      || pinnedVersion.loopDefinitionId !== pinnedTarget.loopDefinitionId
      || pinnedVersion.status !== "published"
    ) throw validationError("Pinned task SubLoop version is unavailable");
    snapshotBinding = pinBindingVersion(binding, pinnedVersion);
  }
  const snapshots = resolveLoopTriggerSnapshots(snapshotBinding);
  if (snapshots.bindingSnapshot.projectId !== input.projectId) {
    throw validationError("Task Loop binding belongs to another Project");
  }
  const bindingState = requireRecord(binding, "Task Loop binding state is invalid");
  const bindingSnapshot = {
    ...snapshots.bindingSnapshot,
    createdByUserId: requiredText(bindingState.createdByUserId, "createdByUserId", 64),
  };
  const now = dependencies.now();
  if (!Number.isFinite(now.getTime())) throw validationError("Task child Loop time is invalid");
  const grants = await dependencies.snapshotBindingGrants({ bindingId: snapshots.bindingSnapshot.id, now });
  const identity = buildLoopTriggerIdentity({
    bindingId: snapshots.bindingSnapshot.id,
    triggerType: "child_loop",
    sourceEventId: input.parent.nodeRunId,
  });
  const childInputSnapshot = withScheduledTaskRunReference(input.inputSnapshot, scheduledTaskRunId);
  const result = await dependencies.createGraphLoopRun({
    id: identity.runId,
    triggerReceiptId: identity.triggerReceiptId,
    bindingId: snapshots.bindingSnapshot.id,
    triggerType: "child_loop",
    sourceEventId: input.parent.nodeRunId,
    projectId: input.projectId,
    loopVersionId: snapshots.bindingSnapshot.activeVersionId,
    inputSnapshot: childInputSnapshot,
    bindingSnapshot,
    policySnapshot: snapshots.policySnapshot,
    grantSnapshot: grantSnapshot(grants),
    ...(runGraphSnapshot === undefined ? {} : { runGraphSnapshot }),
    budgetSnapshot: snapshots.budgetSnapshot,
    occurredAt: now,
    correlationId: input.correlationId,
    actor: { type: "system", id: "task-loop-invoker" },
    parent: input.parent,
    ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
  });
  return { childLoopRunId: result.id };
}

function parseTarget(input: {
  targetLoopDefinitionId?: string;
  targetLoopVersionId?: string;
}): { loopDefinitionId: string; loopVersionId: string } | undefined {
  if (input.targetLoopDefinitionId === undefined && input.targetLoopVersionId === undefined) return undefined;
  if (input.targetLoopDefinitionId === undefined || input.targetLoopVersionId === undefined) {
    throw validationError("Task SubLoop target identity is incomplete");
  }
  return {
    loopDefinitionId: requiredText(input.targetLoopDefinitionId, "targetLoopDefinitionId", 96),
    loopVersionId: requiredText(input.targetLoopVersionId, "targetLoopVersionId", 96),
  };
}

function legacyParentSnapshot(value: unknown): undefined {
  if (value !== null && value !== undefined) {
    throw validationError("Snapshot runs require an explicit task SubLoop target");
  }
  return undefined;
}

function findPinnedTarget(
  snapshot: RunGraphSnapshot | RunGraphSnapshotV2,
  target: { loopDefinitionId: string; loopVersionId: string },
): (RunGraphSnapshot | RunGraphSnapshotV2)["loopVersions"][number] {
  const pinned = snapshot.loopVersions.find((version) => (
    version.loopDefinitionId === target.loopDefinitionId
    && version.loopVersionId === target.loopVersionId
    && version.scope === "task"
  ));
  if (!pinned) throw validationError("Task SubLoop target is outside the parent Run snapshot");
  return pinned;
}

function isV2RunGraphSnapshot(value: unknown): value is RunGraphSnapshotV2 {
  return isRecord(value) && value.schemaVersion === 2;
}

function asParentRun(value: unknown): {
  id: string;
  projectId: string;
  taskId: string | null;
  scheduledTaskRunId: string | null;
  runGraphSnapshot: unknown;
} | null {
  if (value === null) return null;
  const run = requireRecord(value, "Parent LoopRun state is invalid");
  return {
    id: requiredText(run.id, "parentRun.id", 96),
    projectId: requiredText(run.projectId, "parentRun.projectId", 64),
    taskId: run.taskId === null ? null : requiredText(run.taskId, "parentRun.taskId", 96),
    scheduledTaskRunId: run.scheduledTaskRunId === undefined || run.scheduledTaskRunId === null
      ? null
      : requiredText(run.scheduledTaskRunId, "parentRun.scheduledTaskRunId", 32),
    runGraphSnapshot: run.runGraphSnapshot,
  };
}

function withScheduledTaskRunReference(value: unknown, scheduledTaskRunId: string | null): unknown {
  if (scheduledTaskRunId === null) return value;
  if (isRecord(value)) return { ...value, scheduledTaskRunId };
  return { scheduledTaskRunId };
}

function asPinnedLoopVersion(value: unknown): {
  id: string;
  loopDefinitionId: string;
  status: string;
  maxStages: number;
  maxRepeatCount: number;
  platformMaxTransitions: number;
} | null {
  if (value === null) return null;
  const version = requireRecord(value, "Pinned task SubLoop version is invalid");
  return {
    id: requiredText(version.id, "pinnedVersion.id", 96),
    loopDefinitionId: requiredText(version.loopDefinitionId, "pinnedVersion.loopDefinitionId", 96),
    status: requiredText(version.status, "pinnedVersion.status", 32),
    maxStages: positiveInteger(version.maxStages, "pinnedVersion.maxStages"),
    maxRepeatCount: positiveInteger(version.maxRepeatCount, "pinnedVersion.maxRepeatCount"),
    platformMaxTransitions: positiveInteger(version.platformMaxTransitions, "pinnedVersion.platformMaxTransitions"),
  };
}

function pinBindingVersion(binding: unknown, version: NonNullable<ReturnType<typeof asPinnedLoopVersion>>): Record<string, unknown> {
  const state = requireRecord(binding, "Task Loop binding state is invalid");
  const parameterOverrides = state.parameterOverrides;
  return {
    ...state,
    activeVersionId: version.id,
    activeVersion: version,
    parameterOverrides: isRecord(parameterOverrides)
      ? { ...parameterOverrides, versionPolicy: "pinned" }
      : { versionPolicy: "pinned" },
  };
}

function isEnabledTaskBinding(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const definition = value.loopDefinition;
  return value.status === "enabled"
    && isRecord(definition)
    && definition.scope === "task"
    && value.bindingRole !== "task_development";
}

function bindingDefinitionId(value: unknown): string | null {
  if (!isRecord(value) || typeof value.loopDefinitionId !== "string") return null;
  return value.loopDefinitionId;
}

function grantSnapshot(grants: unknown[]): { automationGrantIds: string[]; grants: unknown[] } {
  const normalized = grants.map((grant) => {
    if (!isRecord(grant)) throw validationError("AutomationGrant snapshot is invalid");
    return grant;
  });
  return { automationGrantIds: normalized.map((grant) => requiredText(grant.id, "automationGrant id", 96)), grants: normalized };
}

function asTask(value: unknown): { id: string; projectId: string | null } | null {
  if (value === null) return null;
  const task = requireRecord(value, "Task state is invalid");
  return {
    id: requiredText(task.id, "task.id", 96),
    projectId: task.projectId === null ? null : requiredText(task.projectId, "task.projectId", 64),
  };
}

function validateParent(value: unknown): asserts value is { loopRunId: string; nodeRunId: string; attemptId: string } {
  const parent = requireRecord(value, "Parent Loop identity is invalid");
  requiredText(parent.loopRunId, "parent.loopRunId", 96);
  requiredText(parent.nodeRunId, "parent.nodeRunId", 96);
  requiredText(parent.attemptId, "parent.attemptId", 128);
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw validationError(message);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value !== value.trim()) {
    throw validationError(`${name} is invalid`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) throw validationError(`${name} is invalid`);
  return value as number;
}

function configurationRequired(message: string): Error {
  return Object.assign(new Error(message), { code: "configuration_required" });
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}
