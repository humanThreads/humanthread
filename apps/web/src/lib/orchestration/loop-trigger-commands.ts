import { createHash } from "node:crypto";
import {
  assertCanDispatchTaskAgent,
  assertCanWriteProject,
  createGraphLoopRun,
  prisma,
  readPublishedLoopVersionsForProject,
  snapshotBindingGrants,
  type CreateGraphLoopRunInput,
} from "@humanthread/db";
import {
  buildLoopTriggerIdentity,
  isLoopGraphEnabled,
  readLoopGraphFeatureFlags,
  resolveLoopExecutionSnapshot,
  resolvePublishedRunGraphSnapshot,
  resolveLoopTriggerSnapshots,
  type LoopExecutionTarget,
  type LoopGraphFeatureFlags,
  type SnapshotLoopVersionInput,
  type SnapshotLoopVersionInputV2,
} from "@humanthread/orchestration-core";
import { projectLoopGroupConfigSchema } from "@humanthread/shared";
import { assignTaskBranch } from "../tasks/task-branch-command";

type PublishedSnapshotLoopVersionInput = SnapshotLoopVersionInput | SnapshotLoopVersionInputV2;

type TaskLoopExecutionTarget =
  | { type: "local_agent"; agentProfileId: string }
  | { type: "linux_worker_pool"; workerPoolId: string };

interface LoopTriggerCommandDependencies {
  flags: LoopGraphFeatureFlags;
  now(): Date;
  assertCanWriteProject(input: { userId: string; projectId: string }): Promise<unknown>;
  readEnabledBinding(bindingId: string, projectId: string): Promise<unknown>;
  readPublishedVersions(projectId: string): Promise<PublishedSnapshotLoopVersionInput[]>;
  snapshotBindingGrants(input: { bindingId: string; now: Date }): Promise<unknown[]>;
  createGraphLoopRun(input: CreateGraphLoopRunInput): ReturnType<typeof createGraphLoopRun>;
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
} as const;

const defaultDependencies: LoopTriggerCommandDependencies = {
  flags: readLoopGraphFeatureFlags(process.env),
  now: () => new Date(),
  assertCanWriteProject: (input) => assertCanWriteProject(input),
  readEnabledBinding: (bindingId, projectId) => prisma.projectLoopBinding.findFirst({
    where: { id: bindingId, projectId, status: "enabled" },
    select: loopTriggerBindingSelect,
  }),
  readPublishedVersions: (projectId) => readPublishedLoopVersionsForProject(projectId),
  snapshotBindingGrants: (input) => snapshotBindingGrants(input),
  createGraphLoopRun: (input) => createGraphLoopRun(input),
};

interface TaskLoopTriggerCommandDependencies {
  flags: LoopGraphFeatureFlags;
  now(): Date;
  assertCanDispatchTask(input: { userId: string; taskId: string }): Promise<unknown>;
  readTask(taskId: string): Promise<{
    id: string;
    projectId: string | null;
    version: number;
    createdAt: Date;
    taskNumber: number | null;
    shortId: string | null;
    taskBranch: string | null;
    developmentTemplateKey: string | null;
    developmentTemplateKind: string | null;
    productionBranch: string | null;
    stagingBranch: string | null;
    loopGroupConfig?: unknown;
  } | null>;
  assignTaskBranch(input: {
    actor: { type: "user"; id: string };
    commandId: string;
    correlationId: string;
    taskId: string;
    expectedVersion: number;
  }): Promise<{ taskId: string; taskBranch: string; version: number }>;
  readEnabledTaskBinding(projectId: string, bindingId?: string): Promise<unknown>;
  resolveExecutionTarget(input: {
    projectId: string;
    target: TaskLoopExecutionTarget;
  }): Promise<LoopExecutionTarget>;
  readPublishedVersions(projectId: string): Promise<PublishedSnapshotLoopVersionInput[]>;
  snapshotBindingGrants(input: { bindingId: string; now: Date }): Promise<unknown[]>;
  createGraphLoopRun(input: CreateGraphLoopRunInput): ReturnType<typeof createGraphLoopRun>;
}

const taskLoopDependencies: TaskLoopTriggerCommandDependencies = {
  flags: readLoopGraphFeatureFlags(process.env),
  now: () => new Date(),
  assertCanDispatchTask: (input) => assertCanDispatchTaskAgent(input),
  readTask: async (taskId) => {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        projectId: true,
        version: true,
        createdAt: true,
        taskNumber: true,
        shortId: true,
        taskBranch: true,
        project: {
          select: {
            developmentTemplateKey: true,
            developmentTemplate: { select: { kind: true } },
            productionBranch: true,
            stagingBranch: true,
            loopGroupConfig: true,
          },
        },
      },
    });
    return task ? {
      id: task.id,
      projectId: task.projectId,
      version: task.version,
      createdAt: task.createdAt,
      taskNumber: task.taskNumber,
      shortId: task.shortId,
      taskBranch: task.taskBranch,
      developmentTemplateKey: task.project?.developmentTemplateKey ?? null,
      developmentTemplateKind: task.project?.developmentTemplate?.kind ?? null,
      productionBranch: task.project?.productionBranch ?? null,
      stagingBranch: task.project?.stagingBranch ?? null,
      loopGroupConfig: task.project?.loopGroupConfig ?? null,
    } : null;
  },
  assignTaskBranch: (input) => assignTaskBranch(input),
  readEnabledTaskBinding: (projectId, bindingId) => prisma.projectLoopBinding.findFirst({
    where: {
      projectId,
      ...(bindingId ? { id: bindingId } : { bindingRole: "task_development" }),
      status: "enabled",
      loopDefinition: { scope: "project" },
    },
    select: loopTriggerBindingSelect,
  }),
  resolveExecutionTarget: async ({ projectId, target }) => {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { spaceId: true, ownerType: true, ownerUserId: true, companyId: true },
    });
    if (!project?.spaceId) throw validationError("Project execution resource is unavailable");
    if (target.type === "local_agent") {
      const profile = await prisma.agentProfile.findFirst({
        where: { id: target.agentProfileId, spaceId: project.spaceId, status: "active" },
        select: { id: true, name: true, provider: true },
      });
      if (!profile || (profile.provider !== "codex" && profile.provider !== "claude")) {
        throw validationError("Selected Local Agent is unavailable");
      }
      return { type: "local_agent", agentProfileId: profile.id, profileDisplayName: profile.name, provider: profile.provider };
    }
    const scope = project.ownerType === "personal" && project.ownerUserId && !project.companyId
      ? { ownerUserId: project.ownerUserId, companyId: null }
      : project.ownerType === "company" && project.companyId && !project.ownerUserId
        ? { ownerUserId: null, companyId: project.companyId }
        : null;
    if (!scope) throw validationError("Project Worker resource scope is invalid");
    const pool = await prisma.workerPool.findFirst({
      where: { id: target.workerPoolId, ...scope, status: "active", revokedAt: null },
      select: {
        id: true,
        displayName: true,
        maxConcurrentRuns: true,
        sessions: {
          where: { status: "active", revokedAt: null, expiresAt: { gt: new Date() } },
          select: {
            requestedConcurrency: true,
            lastSeenAt: true,
            linuxRuns: {
              where: { status: { in: ["claimed", "starting", "running", "waiting_approval"] } },
              select: { id: true },
            },
          },
        },
      },
    });
    if (!pool) throw validationError("Selected Linux Worker Pool is unavailable");
    const freshSessions = pool.sessions.filter((session) => (
      session.lastSeenAt !== null && session.lastSeenAt.getTime() >= Date.now() - 60_000
    ));
    const capacity = Math.min(pool.maxConcurrentRuns, freshSessions.reduce((total, session) => total + session.requestedConcurrency, 0));
    const currentRuns = freshSessions.reduce((total, session) => total + session.linuxRuns.length, 0);
    if (capacity <= currentRuns) throw validationError("Selected Linux Worker Pool has no available capacity");
    return { type: "linux_worker_pool", workerPoolId: pool.id, poolDisplayName: pool.displayName };
  },
  readPublishedVersions: (projectId) => readPublishedLoopVersionsForProject(projectId),
  snapshotBindingGrants: (input) => snapshotBindingGrants(input),
  createGraphLoopRun: (input) => createGraphLoopRun(input),
};

export async function triggerProjectLoop(input: {
  actorUserId: string;
  projectId: string;
  bindingId: string;
  commandId: string;
  payload: Record<string, unknown>;
}, dependencies: LoopTriggerCommandDependencies = defaultDependencies) {
  await dependencies.assertCanWriteProject({ userId: input.actorUserId, projectId: input.projectId });
  if (!isLoopGraphEnabled(dependencies.flags)) {
    throw policyDenied("Graph Loop rollout is not enabled");
  }

  const binding = await dependencies.readEnabledBinding(input.bindingId, input.projectId);
  if (!binding) throw notFound("Enabled Loop binding not found");
  const snapshots = resolveLoopTriggerSnapshots(binding);
  const bindingState = binding as { createdByUserId?: unknown; loopDefinition?: { scope?: unknown } };
  if (bindingState.loopDefinition?.scope !== "project") {
    throw policyDenied("Task-scoped Loop bindings must be started from a Task");
  }
  const createdByUserId = typeof bindingState.createdByUserId === "string"
    ? bindingState.createdByUserId.trim()
    : "";
  if (!createdByUserId) {
    throw Object.assign(new Error("Loop binding creator is invalid"), { code: "validation_failed" });
  }
  const bindingSnapshot = { ...snapshots.bindingSnapshot, createdByUserId };
  if (
    snapshots.bindingSnapshot.projectId !== input.projectId
    || snapshots.bindingSnapshot.id !== input.bindingId
  ) {
    throw notFound("Enabled Loop binding not found");
  }
  if (
    snapshots.bindingSnapshot.status !== "enabled"
    || !snapshots.policySnapshot.triggerPolicy.manual
  ) {
    throw policyDenied("Manual Loop triggering is not enabled for this binding");
  }
  const occurredAt = dependencies.now();
  const grants = await dependencies.snapshotBindingGrants({
    bindingId: snapshots.bindingSnapshot.id,
    now: occurredAt,
  });
  const runGraphSnapshot = resolvePublishedRunGraphSnapshot({
    rootLoopVersionId: snapshots.bindingSnapshot.activeVersionId,
    versions: await dependencies.readPublishedVersions(input.projectId),
  });

  const identity = buildLoopTriggerIdentity({
    bindingId: snapshots.bindingSnapshot.id,
    triggerType: "manual",
    sourceEventId: input.commandId,
  });
  return dependencies.createGraphLoopRun({
    id: identity.runId,
    triggerReceiptId: identity.triggerReceiptId,
    bindingId: snapshots.bindingSnapshot.id,
    triggerType: "manual",
    sourceEventId: input.commandId,
    commandId: input.commandId,
    projectId: input.projectId,
    loopVersionId: snapshots.bindingSnapshot.activeVersionId,
    inputSnapshot: input.payload,
    bindingSnapshot,
    policySnapshot: snapshots.policySnapshot,
    grantSnapshot: grantSnapshot(grants),
    runGraphSnapshot,
    budgetSnapshot: snapshots.budgetSnapshot,
    occurredAt,
    correlationId: `project:${input.projectId}`,
    actor: { type: "user", id: input.actorUserId },
  });
}

export async function triggerTaskLoop(input: {
  actorUserId: string;
  taskId: string;
  commandId: string;
  bindingId?: string;
  payload: Record<string, unknown>;
  executionTarget?: TaskLoopExecutionTarget;
}, dependencies: TaskLoopTriggerCommandDependencies = taskLoopDependencies) {
  await dependencies.assertCanDispatchTask({ userId: input.actorUserId, taskId: input.taskId });
  const task = await dependencies.readTask(input.taskId);
  if (!task?.projectId) throw notFound("Task project not found");
  if (!task.shortId || !Number.isInteger(task.taskNumber)) {
    throw validationError("Task has no platform task number");
  }
  if (!isLoopGraphEnabled(dependencies.flags)) {
    throw policyDenied("Graph Loop rollout is not enabled");
  }
  const binding = await dependencies.readEnabledTaskBinding(task.projectId, input.bindingId);
  if (!binding) throw notFound("Task development Loop is not configured");
  const snapshots = resolveLoopTriggerSnapshots(binding);
  const bindingState = binding as {
    createdByUserId?: unknown;
    bindingRole?: unknown;
    activeVersionId?: unknown;
    loopDefinition?: { scope?: unknown };
  };
  if (bindingState.loopDefinition?.scope !== "project" || bindingState.bindingRole === "milestone_release") {
    throw validationError("Task execution must start from the Project task-development Loop");
  }
  const parsedLoopGroup = projectLoopGroupConfigSchema.safeParse(task.loopGroupConfig);
  if (input.bindingId) {
    const activeVersionId = typeof bindingState.activeVersionId === "string" ? bindingState.activeVersionId : "";
    if (
      !activeVersionId
      || (parsedLoopGroup.success
        ? !parsedLoopGroup.data.projectLoopVersionIds.includes(activeVersionId)
        : bindingState.bindingRole !== "task_development")
    ) {
      throw validationError("Selected Project task Loop is not in the saved Loop group");
    }
  } else if (bindingState.bindingRole !== "task_development") {
    throw validationError("Task execution must start from the Project task-development Loop");
  }
  const createdByUserId = typeof bindingState.createdByUserId === "string" ? bindingState.createdByUserId.trim() : "";
  if (!createdByUserId) throw validationError("Task development Loop binding creator is invalid");
  const bindingSnapshot = { ...snapshots.bindingSnapshot, createdByUserId };
  const occurredAt = dependencies.now();
  const fallbackProfileId = bindingSnapshot.allowedAgentProfileIds.length === 1
    && bindingSnapshot.allowedProviders.length === 1
    ? bindingSnapshot.allowedAgentProfileIds[0]
    : null;
  if (!input.executionTarget && !fallbackProfileId) throw validationError("Execution target is required");
  const executionTarget = await dependencies.resolveExecutionTarget({
    projectId: task.projectId,
    target: input.executionTarget ?? { type: "local_agent", agentProfileId: fallbackProfileId! },
  });
  const executionSnapshot = resolveLoopExecutionSnapshot({
    target: executionTarget,
    bindingSnapshot,
    resolvedAt: occurredAt,
  });
  const grants = await dependencies.snapshotBindingGrants({ bindingId: snapshots.bindingSnapshot.id, now: occurredAt });
  const runGraphSnapshot = resolvePublishedRunGraphSnapshot({
    rootLoopVersionId: snapshots.bindingSnapshot.activeVersionId,
    versions: await dependencies.readPublishedVersions(task.projectId),
  });
  const identity = buildLoopTriggerIdentity({ bindingId: snapshots.bindingSnapshot.id, triggerType: "task_event", sourceEventId: input.commandId });
  const usesBranchDevelopment = task.developmentTemplateKind === "branch-development"
    || (!task.developmentTemplateKind && task.developmentTemplateKey === "branch-development");
  const branchAssignment = task.taskBranch
    ? { taskBranch: task.taskBranch }
    : usesBranchDevelopment
      ? await dependencies.assignTaskBranch({
        actor: { type: "user", id: input.actorUserId },
        commandId: taskBranchCommandId(input.commandId),
        correlationId: `task:${input.taskId}`,
        taskId: input.taskId,
        expectedVersion: task.version,
      })
      : { taskBranch: null };
  const inputSnapshot = {
    ...input.payload,
    taskId: task.id,
    projectId: task.projectId,
    taskNumber: task.taskNumber,
    shortId: task.shortId,
    taskBranch: branchAssignment.taskBranch,
    taskCreatedAt: task.createdAt.toISOString(),
    productionBranch: task.productionBranch,
    stagingBranch: task.stagingBranch,
  };
  return dependencies.createGraphLoopRun({
    id: identity.runId,
    triggerReceiptId: identity.triggerReceiptId,
    bindingId: snapshots.bindingSnapshot.id,
    triggerType: "task_event",
    sourceEventId: input.commandId,
    commandId: input.commandId,
    projectId: task.projectId,
    taskId: input.taskId,
    loopVersionId: snapshots.bindingSnapshot.activeVersionId,
    inputSnapshot,
    bindingSnapshot,
    executionSnapshot,
    policySnapshot: snapshots.policySnapshot,
    grantSnapshot: grantSnapshot(grants),
    runGraphSnapshot,
    budgetSnapshot: snapshots.budgetSnapshot,
    occurredAt,
    correlationId: `task:${input.taskId}`,
    actor: { type: "user", id: input.actorUserId },
  });
}

function taskBranchCommandId(commandId: string): string {
  return createHash("md5").update(`task-branch\0${commandId}`).digest("hex");
}

function grantSnapshot(grants: unknown[]): { automationGrantIds: string[]; grants: unknown[] } {
  const normalized = grants.map((grant) => {
    if (!grant || typeof grant !== "object" || Array.isArray(grant) || typeof Reflect.get(grant, "id") !== "string") {
      throw Object.assign(new Error("AutomationGrant snapshot is invalid"), { code: "validation_failed" });
    }
    return grant;
  });
  return {
    automationGrantIds: normalized.map((grant) => Reflect.get(grant, "id") as string),
    grants: normalized,
  };
}

function policyDenied(message: string): Error {
  return Object.assign(new Error(message), { code: "policy_denied" });
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: "not_found" });
}
