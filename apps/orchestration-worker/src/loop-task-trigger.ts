import {
  createGraphLoopRun,
  prisma,
  readPublishedLoopVersionsForProject,
  snapshotBindingGrants,
  type CreateGraphLoopRunInput,
} from "@humanthread/db";
import {
  bindingMatchesTaskEvent,
  buildLoopTriggerIdentity,
  isLoopGraphEnabled,
  readLoopGraphFeatureFlags,
  resolvePublishedRunGraphSnapshot,
  resolveLoopTriggerSnapshots,
  type LoopGraphFeatureFlags,
  type PublishedSnapshotLoopVersionInput,
} from "@humanthread/orchestration-core";
import { emitMilestoneReleaseReadyEvent } from "./milestone-release-trigger";

export interface TaskTriggerEvent {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: string;
  payload: unknown;
}

interface LoopTaskTriggerDependencies {
  flags: LoopGraphFeatureFlags;
  now(): Date;
  loadTask(taskId: string): Promise<unknown>;
  listEnabledBindings(projectId: string): Promise<unknown[]>;
  readPublishedVersions(projectId: string): Promise<PublishedSnapshotLoopVersionInput[]>;
  snapshotBindingGrants(input: { bindingId: string; now: Date }): Promise<unknown[]>;
  createGraphLoopRun(input: CreateGraphLoopRunInput): ReturnType<typeof createGraphLoopRun>;
  emitMilestoneReleaseReady?(input: {
    projectId: string;
    milestoneId: string;
    taskEventId: string;
    correlationId: string;
    causationId?: string;
    occurredAt: Date;
  }): Promise<boolean>;
}

const defaultDependencies: LoopTaskTriggerDependencies = {
  flags: readLoopGraphFeatureFlags(process.env),
  now: () => new Date(),
  loadTask: (taskId) => prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, projectId: true, milestoneId: true },
  }),
  listEnabledBindings: (projectId) => prisma.projectLoopBinding.findMany({
    where: { projectId, status: "enabled" },
    select: {
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
  readPublishedVersions: (projectId) => readPublishedLoopVersionsForProject(projectId),
  snapshotBindingGrants: (input) => snapshotBindingGrants(input),
  createGraphLoopRun: (input) => createGraphLoopRun(input),
  emitMilestoneReleaseReady: (input) => emitMilestoneReleaseReadyEvent(input),
};

export async function handleTaskEventForLoopBindings(
  input: unknown,
  dependencies: LoopTaskTriggerDependencies = defaultDependencies,
): Promise<{ matched: number; triggered: number }> {
  const envelope = requireRecord(input, "Orchestration event envelope is invalid");
  if (requiredText(envelope.aggregateType, "aggregateType", 32) !== "task") {
    return { matched: 0, triggered: 0 };
  }
  const event = parseTaskTriggerEvent(envelope);

  const task = asTaskProject(await dependencies.loadTask(event.aggregateId));
  if (!task?.projectId || !isLoopGraphEnabled(dependencies.flags)) {
    return { matched: 0, triggered: 0 };
  }

  if (event.eventType === "task.completed" && task.milestoneId && dependencies.emitMilestoneReleaseReady) {
    await dependencies.emitMilestoneReleaseReady({
      projectId: task.projectId,
      milestoneId: task.milestoneId,
      taskEventId: event.id,
      correlationId: event.correlationId,
      ...(event.causationId === undefined ? {} : { causationId: event.causationId }),
      occurredAt: parseOccurredAt(event.occurredAt),
    });
  }

  const bindings = await dependencies.listEnabledBindings(task.projectId);
  const matching = bindings.filter((binding) => isProjectTaskDevelopmentBinding(binding)
    && bindingMatchesTaskEvent(binding, event.eventType));
  const occurredAt = parseOccurredAt(event.occurredAt);
  const publishedVersions = matching.length === 0
    ? []
    : await dependencies.readPublishedVersions(task.projectId);
  for (const binding of matching) {
    const snapshots = resolveLoopTriggerSnapshots(binding);
    const bindingState = requireRecord(binding, "Loop binding state is invalid");
    const bindingSnapshot = {
      ...snapshots.bindingSnapshot,
      createdByUserId: requiredText(bindingState.createdByUserId, "createdByUserId", 64),
    };
    if (snapshots.bindingSnapshot.projectId !== task.projectId) {
      throw validationError("Loop binding belongs to another Project");
    }
    const identity = buildLoopTriggerIdentity({
      bindingId: snapshots.bindingSnapshot.id,
      triggerType: "task_event",
      sourceEventId: event.id,
    });
    const grants = await dependencies.snapshotBindingGrants({
      bindingId: snapshots.bindingSnapshot.id,
      now: dependencies.now(),
    });
    const runGraphSnapshot = resolvePublishedRunGraphSnapshot({
      rootLoopVersionId: snapshots.bindingSnapshot.activeVersionId,
      versions: publishedVersions,
    });
    await dependencies.createGraphLoopRun({
      id: identity.runId,
      triggerReceiptId: identity.triggerReceiptId,
      bindingId: snapshots.bindingSnapshot.id,
      triggerType: "task_event",
      sourceEventId: event.id,
      projectId: task.projectId,
      taskId: event.aggregateId,
      loopVersionId: snapshots.bindingSnapshot.activeVersionId,
      inputSnapshot: event.payload,
      bindingSnapshot,
      policySnapshot: snapshots.policySnapshot,
      grantSnapshot: grantSnapshot(grants),
      runGraphSnapshot,
      budgetSnapshot: snapshots.budgetSnapshot,
      occurredAt,
      correlationId: event.correlationId,
      ...(event.causationId === undefined
        ? {}
        : { causationId: event.causationId }),
      actor: { type: "system", id: "loop-task-trigger" },
    });
  }

  return { matched: matching.length, triggered: matching.length };
}

function isProjectTaskDevelopmentBinding(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  const definition = binding.loopDefinition;
  return binding.bindingRole === "task_development"
    && definition !== null
    && typeof definition === "object"
    && !Array.isArray(definition)
    && (definition as Record<string, unknown>).scope === "project";
}

function grantSnapshot(grants: unknown[]): { automationGrantIds: string[]; grants: unknown[] } {
  const normalized = grants.map((grant) => {
    if (!grant || typeof grant !== "object" || Array.isArray(grant) || typeof Reflect.get(grant, "id") !== "string") {
      throw validationError("AutomationGrant snapshot is invalid");
    }
    return grant;
  });
  return {
    automationGrantIds: normalized.map((grant) => Reflect.get(grant, "id") as string),
    grants: normalized,
  };
}

function asTaskProject(value: unknown): { id: string; projectId: string | null; milestoneId: string | null } | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") throw validationError("Task trigger state is invalid");
  const task = value as Record<string, unknown>;
  if (
    typeof task.id !== "string"
    || !(task.projectId === null || typeof task.projectId === "string")
    || !(task.milestoneId === undefined || task.milestoneId === null || typeof task.milestoneId === "string")
  ) {
    throw validationError("Task trigger state is invalid");
  }
  return { id: task.id, projectId: task.projectId, milestoneId: task.milestoneId ?? null };
}

function parseOccurredAt(value: string): Date {
  const occurredAt = new Date(value);
  if (Number.isNaN(occurredAt.getTime())) throw validationError("Task event occurredAt is invalid");
  return occurredAt;
}

function parseTaskTriggerEvent(event: Record<string, unknown>): TaskTriggerEvent {
  const occurredAt = requiredText(event.occurredAt, "occurredAt", 64);
  parseOccurredAt(occurredAt);
  const causationId = event.causationId;
  if (causationId !== undefined) requiredText(causationId, "causationId", 128);
  return {
    id: requiredText(event.id, "event.id", 128),
    eventType: requiredText(event.eventType, "eventType", 96),
    aggregateType: "task",
    aggregateId: requiredText(event.aggregateId, "aggregateId", 96),
    correlationId: requiredText(event.correlationId, "correlationId", 128),
    ...(causationId === undefined ? {} : { causationId: causationId as string }),
    occurredAt,
    payload: event.payload,
  };
}

function requiredText(value: unknown, name: string, maxLength: number): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maxLength
    || value !== value.trim()
  ) throw validationError(`${name} is invalid`);
  return value;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw validationError(message);
  }
  return value as Record<string, unknown>;
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}
