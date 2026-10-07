import { createHash } from "node:crypto";
import type { OrchestrationActor, OrchestrationCommand } from "@humanthread/shared";
import {
  resolveRequiredAcceptanceChecks,
  transitionUserTask,
  type TaskAcceptanceMode,
  type TaskAcceptanceReadiness,
  type TaskStatusCategory,
  type TaskVisibility,
  type UserTaskCommand,
  type UserTaskSnapshot,
} from "@humanthread/orchestration-core";
import {
  assertCanChangeTaskStatus,
  assertCanCommentOnTask,
  assertCanEditTask,
  assertCanDispatchTaskAgent,
  assertCanGovernTask,
  assertCanManageTaskMembers,
  assertCanWriteProject,
  assertCanWriteSpace,
  executeTaskCommand,
  prisma,
  type TaskCommandActivity,
  type TaskCommandTx,
} from "@humanthread/db";
import { loadTaskAcceptanceReadiness } from "./task-acceptance-evidence";
import { TaskAcceptanceEvidenceError, UserTaskCommandError } from "./task-errors";
import { requireUserTaskWrites } from "./task-rollout";
import {
  allocateTaskFieldValueId,
  normalizeTaskFieldValues,
  type TaskFieldDefinitionRecord,
} from "./task-business-fields";

interface ActorRow {
  userId: string;
  teamId: string;
}

interface SpaceRow {
  id: string;
  type: "personal" | "company";
  ownerUserId: string | null;
  companyId: string | null;
}

interface ProjectRow {
  id: string;
  spaceId: string | null;
  shortCode: string | null;
}

interface AgentProfileRow {
  id: string;
  spaceId: string;
  status: string;
}

interface LoadedTask extends UserTaskSnapshot {
  spaceId: string;
  projectId: string | null;
  createdById: string;
  assigneeUserId: string | null;
  dispatchPolicy?: unknown;
}

type ExecutionInput<TResult> = {
  command: OrchestrationCommand<unknown> & { expectedVersion: number };
  taskId: string;
  eventType: string;
  eventPayload?: unknown;
  activity: TaskCommandActivity;
  persist(tx: TaskCommandTx): Promise<{ rows: number; result: TResult }>;
};

export interface UserTaskCommandDependencies {
  loadActor(input: { userId: string }): Promise<ActorRow | null>;
  loadSpace(input: { spaceId: string }): Promise<SpaceRow | null>;
  loadProject(input: { projectId: string }): Promise<ProjectRow | null>;
  loadProjectTaskFields?(input: { projectId: string }): Promise<TaskFieldDefinitionRecord[]>;
  loadAgentProfile(input: { agentProfileId: string }): Promise<AgentProfileRow | null>;
  loadProjectLoopBinding?(input: { projectId: string; bindingId: string; bindingType: "task" | "project" }): Promise<{ id: string; projectId: string; bindingRole: string | null; status: string } | null>;
  isSpaceMember(input: { spaceId: string; userId: string }): Promise<boolean>;
  loadTask(input: { taskId: string }): Promise<LoadedTask | null>;
  loadAcceptanceReadiness(input: { taskId: string }): Promise<TaskAcceptanceReadiness | null>;
  authorize(input: {
    actor: OrchestrationActor;
    action: "create" | "comment" | "edit_content" | "change_status" | "manage_members" | "dispatch_agent" | "govern";
    spaceId?: string;
    projectId?: string;
    taskId?: string;
  }): Promise<unknown>;
  execute<TResult>(input: ExecutionInput<TResult>): Promise<TResult>;
}

function requireUserActor(actor: OrchestrationActor): asserts actor is { type: "user"; id: string } {
  if (actor.type !== "user") {
    throw new UserTaskCommandError("authorization_denied", "command requires a human user");
  }
}

const defaultDependencies: UserTaskCommandDependencies = {
  loadActor: async ({ userId }) => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, teamId: true },
    });
    return user ? { userId: user.id, teamId: user.teamId } : null;
  },
  loadSpace: async ({ spaceId }) => prisma.space.findUnique({
    where: { id: spaceId },
    select: { id: true, type: true, ownerUserId: true, companyId: true },
  }) as Promise<SpaceRow | null>,
  loadProject: async ({ projectId }) => prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, spaceId: true, shortCode: true },
  }),
  loadProjectTaskFields: async ({ projectId }) => prisma.projectTaskFieldDefinition.findMany({
    where: { projectId, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, projectId: true, key: true, name: true, type: true, required: true, options: true, sortOrder: true, isActive: true },
  }) as Promise<TaskFieldDefinitionRecord[]>,
  loadAgentProfile: async ({ agentProfileId }) => prisma.agentProfile.findUnique({
    where: { id: agentProfileId },
    select: { id: true, spaceId: true, status: true },
  }),
  loadProjectLoopBinding: async ({ projectId, bindingId, bindingType }) => prisma.projectLoopBinding.findFirst({
    where: {
      id: bindingId,
      projectId,
      status: "enabled",
      bindingRole: bindingType === "task" ? "task_development" : "milestone_release",
    },
    select: { id: true, projectId: true, bindingRole: true, status: true },
  }),
  isSpaceMember: async ({ spaceId, userId }) => {
    const space = await prisma.space.findUnique({
      where: { id: spaceId },
      select: {
        type: true,
        ownerUserId: true,
        company: { select: { members: { where: { userId, status: "active" }, select: { id: true } } } },
      },
    });
    return Boolean(space && (
      space.type === "personal"
        ? space.ownerUserId === userId
        : Boolean(space.company?.members.length)
    ));
  },
  loadTask: async ({ taskId }) => {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        spaceId: true,
        projectId: true,
        createdById: true,
        assigneeUserId: true,
        dispatchPolicy: true,
        statusCategory: true,
        version: true,
        acceptanceMode: true,
        blockers: { where: { status: "active" }, take: 1, select: { id: true } },
      },
    });
    if (!task?.spaceId || !task.createdById || !task.statusCategory || !task.acceptanceMode) return null;
    return {
      id: task.id,
      spaceId: task.spaceId,
      projectId: task.projectId,
      createdById: task.createdById,
      assigneeUserId: task.assigneeUserId,
      dispatchPolicy: task.dispatchPolicy,
      status: task.statusCategory as TaskStatusCategory,
      version: task.version,
      acceptanceMode: task.acceptanceMode as TaskAcceptanceMode,
      isBlocked: task.blockers.length > 0,
    };
  },
  loadAcceptanceReadiness: ({ taskId }) => loadTaskAcceptanceReadiness({ taskId }),
  authorize: async (input) => {
    requireUserActor(input.actor);
    if (input.action === "create") {
      if (!input.spaceId) throw new UserTaskCommandError("validation_failed", "spaceId is required");
      await assertCanWriteSpace({ userId: input.actor.id, spaceId: input.spaceId });
      if (input.projectId) await assertCanWriteProject({ userId: input.actor.id, projectId: input.projectId });
      return;
    }
    if (!input.taskId) throw new UserTaskCommandError("validation_failed", "taskId is required");
    if (input.action === "edit_content") {
      await assertCanEditTask({ userId: input.actor.id, taskId: input.taskId });
      return;
    }
    if (input.action === "comment") {
      await assertCanCommentOnTask({ userId: input.actor.id, taskId: input.taskId });
      return;
    }
    if (input.action === "manage_members") {
      await assertCanManageTaskMembers({ userId: input.actor.id, taskId: input.taskId });
      return;
    }
    if (input.action === "dispatch_agent") {
      await assertCanDispatchTaskAgent({ userId: input.actor.id, taskId: input.taskId });
      return;
    }
    if (input.action === "govern") {
      await assertCanGovernTask({ userId: input.actor.id, taskId: input.taskId });
      return;
    }
    await assertCanChangeTaskStatus({ userId: input.actor.id, taskId: input.taskId });
  },
  execute: (input) => {
    requireUserTaskWrites();
    return executeTaskCommand(input);
  },
};

export const userTaskCommandDependencies = defaultDependencies;

function commandEnvelope(input: {
  actor: OrchestrationActor;
  commandId: string;
  correlationId: string;
  expectedVersion: number;
  payload: unknown;
}): OrchestrationCommand<unknown> & { expectedVersion: number } {
  return { ...input, issuedAt: new Date() };
}

function boundedId(prefix: string, parts: string[], maxLength = 96) {
  const readable = `${prefix}:${parts.join(":")}`;
  if (readable.length <= maxLength) return readable;
  const digest = createHash("sha256").update(parts.join("\0")).digest("hex");
  return `${prefix}:${digest}`;
}

export interface CreateUserTaskInput {
  actor: OrchestrationActor;
  commandId: string;
  correlationId: string;
  payload: {
    spaceId: string;
    title: string;
    contentMarkdown?: string;
    objective?: string;
    projectId?: string;
    milestoneId?: string;
    assigneeUserId?: string;
    preferredAgentProfileId?: string;
    executionMode?: "manual" | "agent" | "loop";
    scopePolicy?: Record<string, unknown>;
    acceptancePolicy?: Record<string, unknown>;
    budgetPolicy?: Record<string, unknown>;
    workflowInstanceId?: string;
    stepTemplateId?: string;
    visibility?: TaskVisibility;
    priority?: number;
    startAt?: Date;
    dueAt?: Date;
    recurrenceRule?: string | null;
    loopBinding?: { bindingId: string; bindingType: "task" | "project" } | null;
    acceptanceMode?: TaskAcceptanceMode;
    customFields?: Record<string, unknown>;
  };
}

export async function createUserTask(
  input: CreateUserTaskInput,
  dependencies: UserTaskCommandDependencies = defaultDependencies,
) {
  requireUserActor(input.actor);
  const title = input.payload.title.trim();
  if (!input.payload.spaceId.trim() || !title) {
    throw new UserTaskCommandError("validation_failed", "spaceId and title are required");
  }
  const [actor, space] = await Promise.all([
    dependencies.loadActor({ userId: input.actor.id }),
    dependencies.loadSpace({ spaceId: input.payload.spaceId }),
  ]);
  if (!actor || !space) throw new UserTaskCommandError("not_found", "actor or space not found");
  let project: ProjectRow | null = null;
  if (input.payload.projectId) {
    project = await dependencies.loadProject({ projectId: input.payload.projectId });
    if (!project) throw new UserTaskCommandError("not_found", "project not found");
    if (project.spaceId !== space.id) {
      throw new UserTaskCommandError("validation_failed", "project and space must match");
    }
  }
  if (input.payload.loopBinding !== undefined && input.payload.loopBinding !== null) {
    if (!input.payload.projectId || !dependencies.loadProjectLoopBinding) {
      throw new UserTaskCommandError("validation_failed", "定时任务 Loop 绑定必须关联项目");
    }
    const binding = await dependencies.loadProjectLoopBinding({ projectId: input.payload.projectId, ...input.payload.loopBinding });
    if (!binding) throw new UserTaskCommandError("validation_failed", "定时任务 Loop 必须是项目当前启用的 Loop");
  }
  await dependencies.authorize({
    actor: input.actor,
    action: "create",
    spaceId: space.id,
    ...(input.payload.projectId ? { projectId: input.payload.projectId } : {}),
  });
  if (input.payload.assigneeUserId && !await dependencies.isSpaceMember({
    spaceId: space.id,
    userId: input.payload.assigneeUserId,
  })) {
    throw new UserTaskCommandError("validation_failed", "task assignee must belong to the same Space");
  }
  const customFieldValues = project
    ? await normalizeTaskFieldValues({
        definitions: await (dependencies.loadProjectTaskFields?.({ projectId: project.id }) ?? []),
        values: input.payload.customFields,
        isSpaceMember: (userId) => dependencies.isSpaceMember({ spaceId: space.id, userId }),
      })
    : input.payload.customFields && Object.keys(input.payload.customFields).length > 0
      ? (() => { throw new UserTaskCommandError("validation_failed", "custom fields require a Project"); })()
      : [];

  const taskId = boundedId("task", [space.id, input.commandId]);
  const contentMarkdown = input.payload.contentMarkdown ?? "";
  const visibility = space.type === "personal"
    ? "private"
    : input.payload.visibility ?? (input.payload.projectId ? "project" : "company");
  const acceptanceMode = input.payload.acceptanceMode ?? "none";
  let acceptancePolicy = input.payload.acceptancePolicy;
  if (acceptanceMode === "automated" || acceptanceMode === "hybrid") {
    if (!input.payload.projectId) {
      throw new UserTaskCommandError("validation_failed", "automated acceptance requires a Project");
    }
    const configuredChecks = acceptancePolicy?.requiredChecks;
    if (!Array.isArray(configuredChecks) || configuredChecks.length === 0) {
      throw new UserTaskCommandError("validation_failed", "automated acceptance requires explicit checks");
    }
  }
  if (acceptancePolicy) {
    try {
      acceptancePolicy = {
        ...acceptancePolicy,
        requiredChecks: resolveRequiredAcceptanceChecks(acceptancePolicy),
      };
    } catch {
      throw new UserTaskCommandError("validation_failed", "Task acceptance policy is invalid");
    }
  }
  if (Boolean(input.payload.workflowInstanceId) !== Boolean(input.payload.stepTemplateId)) {
    throw new UserTaskCommandError("validation_failed", "Workflow linkage requires both workflowInstanceId and stepTemplateId");
  }
  return dependencies.execute({
    command: commandEnvelope({
      actor: input.actor,
      commandId: input.commandId,
      correlationId: input.correlationId,
      expectedVersion: 0,
      payload: { spaceId: space.id, projectId: input.payload.projectId ?? null },
    }),
    taskId,
    eventType: "task.created",
    eventPayload: { spaceId: space.id, projectId: input.payload.projectId ?? null },
    activity: {
      id: boundedId("activity", [input.commandId], 128),
      type: "created",
      actorType: "user",
      actorUserId: input.actor.id,
      message: "任务已创建",
    },
    persist: async (tx) => {
      let taskNumber: number | null = null;
      let shortId: string | null = null;
      if (project?.shortCode) {
        const sequence = await tx.project.update({
          where: { id: project.id },
          data: { nextTaskNumber: { increment: 1 } },
          select: { id: true, shortCode: true, nextTaskNumber: true },
        });
        if (sequence.shortCode) {
          taskNumber = sequence.nextTaskNumber - 1;
          shortId = `${sequence.shortCode}${taskNumber}`;
        }
      }
      const result = {
        taskId,
        taskNumber,
        shortId,
        statusCategory: "todo" as const,
        visibility: visibility as TaskVisibility,
        version: 1,
      };
      await tx.task.create({
        data: {
          id: taskId,
          teamId: actor.teamId,
          spaceId: space.id,
          createdById: input.actor.id,
          projectId: input.payload.projectId ?? null,
          taskNumber,
          shortId,
          ...(input.payload.workflowInstanceId ? { workflowInstanceId: input.payload.workflowInstanceId } : {}),
          ...(input.payload.stepTemplateId ? { stepTemplateId: input.payload.stepTemplateId } : {}),
          milestoneId: input.payload.milestoneId ?? null,
          title,
          description: contentMarkdown,
          contentMarkdown,
          status: "pending",
          statusCategory: "todo",
          visibility,
          executorType: "human",
          assigneeUserId: input.payload.assigneeUserId ?? null,
          queuePosition: 0,
          priority: input.payload.priority ?? 0,
          startAt: input.payload.startAt ?? null,
          dueAt: input.payload.dueAt ?? null,
          recurrenceRule: input.payload.recurrenceRule ?? null,
          ...(input.payload.loopBinding ? { dispatchPolicy: { recurringLoopBinding: input.payload.loopBinding } } : {}),
          acceptanceMode,
          objective: input.payload.objective ?? contentMarkdown,
          preferredAgentProfileId: input.payload.preferredAgentProfileId ?? null,
          executionMode: input.payload.executionMode ?? "manual",
          scopePolicy: input.payload.scopePolicy ?? null,
          acceptancePolicy: acceptancePolicy ?? null,
          budgetPolicy: input.payload.budgetPolicy ?? null,
          version: 1,
        },
      });
      if (customFieldValues.length > 0) {
        await tx.taskFieldValue.createMany({
          data: customFieldValues.map((field) => ({
            id: allocateTaskFieldValueId(taskId, field.definitionId),
            taskId,
            fieldDefinitionId: field.definitionId,
            ...field.data,
          })),
        });
      }
      if (input.payload.workflowInstanceId && input.payload.stepTemplateId) {
        await tx.taskWorkflowLink.create({
          data: {
            id: boundedId("workflow-link", [input.commandId]),
            taskId,
            workflowInstanceId: input.payload.workflowInstanceId,
            stepTemplateId: input.payload.stepTemplateId,
          },
        });
      }
      return { rows: 1, result };
    },
  });
}

export async function updateUserTaskContent(
  input: {
    actor: OrchestrationActor;
    commandId: string;
    correlationId: string;
    taskId: string;
    expectedVersion: number;
    contentMarkdown: string;
  },
  dependencies: UserTaskCommandDependencies = defaultDependencies,
) {
  requireUserActor(input.actor);
  await dependencies.authorize({ actor: input.actor, action: "edit_content", taskId: input.taskId });
  const result = { taskId: input.taskId, version: input.expectedVersion + 1 };
  return dependencies.execute({
    command: commandEnvelope({ ...input, payload: { contentLength: input.contentMarkdown.length } }),
    taskId: input.taskId,
    eventType: "task.content_updated",
    eventPayload: { contentLength: input.contentMarkdown.length },
    activity: {
      id: boundedId("activity", [input.commandId], 128),
      type: "content_updated",
      actorType: "user",
      actorUserId: input.actor.id,
      message: "任务内容已更新",
    },
    persist: async (tx) => {
      const updated = await tx.task.updateMany({
        where: { id: input.taskId, version: input.expectedVersion },
        data: {
          contentMarkdown: input.contentMarkdown,
          description: input.contentMarkdown,
          version: { increment: 1 },
        },
      });
      return { rows: updated.count, result };
    },
  });
}

const LEGACY_STATUS: Record<TaskStatusCategory, string> = {
  backlog: "pending",
  todo: "pending",
  in_progress: "active",
  in_review: "verifying",
  completed: "completed",
  cancelled: "cancelled",
};

export async function changeUserTaskStatus(
  input: {
    actor: OrchestrationActor;
    commandId: string;
    correlationId: string;
    taskId: string;
    expectedVersion: number;
    command: UserTaskCommand;
    reason?: string;
    activity?: {
      type: string;
      message?: string;
      payload?: unknown;
    };
  },
  dependencies: UserTaskCommandDependencies = defaultDependencies,
) {
  const task = await dependencies.loadTask({ taskId: input.taskId });
  if (!task) throw new UserTaskCommandError("not_found", "task not found");
  await dependencies.authorize({ actor: input.actor, action: "change_status", taskId: input.taskId });
  let acceptancePassed: boolean | undefined;
  if (input.command === "accept" && (task.acceptanceMode === "automated" || task.acceptanceMode === "hybrid")) {
    const readiness = await dependencies.loadAcceptanceReadiness({ taskId: input.taskId });
    if (!readiness?.ready) {
      throw new TaskAcceptanceEvidenceError(
        task.status,
        readiness?.missingChecks ?? ["delivery"],
        readiness?.blockingChecks ?? [],
      );
    }
    acceptancePassed = true;
  }
  const next = transitionUserTask({
    task,
    command: input.command,
    actorType: input.actor.type,
    ...(acceptancePassed === undefined ? {} : { acceptancePassed }),
  });
  const result = { taskId: input.taskId, statusCategory: next.status, version: input.expectedVersion + 1 };
  return dependencies.execute({
    command: commandEnvelope({ ...input, payload: { command: input.command } }),
    taskId: input.taskId,
    eventType: next.eventType,
    eventPayload: {
      from: task.status,
      to: next.status,
      ...(input.reason ? { reason: input.reason } : {}),
    },
    activity: {
      id: boundedId("activity", [input.commandId], 128),
      type: input.activity?.type ?? "status_changed",
      actorType: input.actor.type,
      ...(input.actor.type === "user" ? { actorUserId: input.actor.id } : {}),
      message: input.activity?.message ?? `任务状态更新为 ${next.status}`,
      payload: input.activity?.payload ?? {
          from: task.status,
          to: next.status,
          ...(input.reason ? { reason: input.reason } : {}),
        },
    },
    persist: async (tx) => {
      const updated = await tx.task.updateMany({
        where: { id: input.taskId, version: input.expectedVersion },
        data: {
          statusCategory: next.status,
          status: LEGACY_STATUS[next.status],
          version: { increment: 1 },
          ...(next.status === "completed" ? { completedAt: new Date() } : {}),
        },
      });
      return { rows: updated.count, result };
    },
  });
}

interface UserTaskMutationInput {
  actor: OrchestrationActor;
  commandId: string;
  correlationId: string;
  taskId: string;
  expectedVersion: number;
}

async function loadTaskForMutation(
  input: UserTaskMutationInput,
  action: Exclude<Parameters<UserTaskCommandDependencies["authorize"]>[0]["action"], "create">,
  dependencies: UserTaskCommandDependencies,
) {
  requireUserActor(input.actor);
  const task = await dependencies.loadTask({ taskId: input.taskId });
  if (!task) throw new UserTaskCommandError("not_found", "task not found");
  await dependencies.authorize({ actor: input.actor, action, taskId: input.taskId });
  return task;
}

async function requireSpaceMember(
  task: LoadedTask,
  userId: string,
  dependencies: UserTaskCommandDependencies,
) {
  if (!await dependencies.isSpaceMember({ spaceId: task.spaceId, userId })) {
    throw new UserTaskCommandError("validation_failed", "task collaborator must belong to the same Space");
  }
}

export async function assignUserTask(
  input: UserTaskMutationInput & { assigneeUserId: string },
  dependencies: UserTaskCommandDependencies = defaultDependencies,
) {
  const task = await loadTaskForMutation(input, "manage_members", dependencies);
  await requireSpaceMember(task, input.assigneeUserId, dependencies);
  const result = {
    taskId: input.taskId,
    assigneeUserId: input.assigneeUserId,
    version: input.expectedVersion + 1,
  };
  return dependencies.execute({
    command: commandEnvelope({ ...input, payload: { assigneeUserId: input.assigneeUserId } }),
    taskId: input.taskId,
    eventType: "task.assigned",
    eventPayload: { assigneeUserId: input.assigneeUserId },
    activity: {
      id: boundedId("activity", [input.commandId], 128),
      type: "assigned",
      actorType: "user",
      actorUserId: input.actor.id,
      message: "任务负责人已更新",
      payload: { assigneeUserId: input.assigneeUserId },
    },
    persist: async (tx) => {
      const updated = await tx.task.updateMany({
        where: { id: input.taskId, version: input.expectedVersion },
        data: { assigneeUserId: input.assigneeUserId, version: { increment: 1 } },
      });
      return { rows: updated.count, result };
    },
  });
}

export async function updateUserTaskFields(
  input: UserTaskMutationInput & { title?: string; contentMarkdown?: string; priority?: number; projectId?: string | null; customFields?: Record<string, unknown> },
  dependencies: UserTaskCommandDependencies = defaultDependencies,
) {
  const task = await loadTaskForMutation(input, "govern", dependencies);
  const title = input.title?.trim();
  if (input.title !== undefined && !title) {
    throw new UserTaskCommandError("validation_failed", "Task title is required");
  }
  if (input.title === undefined && input.contentMarkdown === undefined && input.priority === undefined && input.projectId === undefined && input.customFields === undefined) {
    throw new UserTaskCommandError("validation_failed", "at least one Task field is required");
  }
  if (input.priority !== undefined && (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 3)) {
    throw new UserTaskCommandError("validation_failed", "Task priority must be between 0 and 3");
  }
  if (input.projectId) {
    const project = await dependencies.loadProject({ projectId: input.projectId });
    if (!project || project.spaceId !== task.spaceId) {
      throw new UserTaskCommandError("validation_failed", "project and Task must belong to the same Space");
    }
  }
  const targetProjectId = input.projectId !== undefined ? input.projectId : task.projectId;
  const projectChanged = input.projectId !== undefined && input.projectId !== task.projectId;
  const normalizedCustomFields = input.customFields === undefined
    ? []
    : targetProjectId
      ? await normalizeTaskFieldValues({
          definitions: await (dependencies.loadProjectTaskFields?.({ projectId: targetProjectId }) ?? []),
          values: input.customFields,
          isSpaceMember: (userId) => dependencies.isSpaceMember({ spaceId: task.spaceId, userId }),
        })
      : (() => { throw new UserTaskCommandError("validation_failed", "custom fields require a Project"); })();
  const result = {
    taskId: input.taskId,
    ...(title ? { title } : {}),
    ...(input.contentMarkdown !== undefined ? { contentMarkdown: input.contentMarkdown } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    ...(input.customFields !== undefined ? { customFields: input.customFields } : {}),
    version: input.expectedVersion + 1,
  };
  return dependencies.execute({
    command: commandEnvelope({ ...input, payload: {
      ...(title ? { title } : {}),
      ...(input.contentMarkdown !== undefined ? { contentMarkdown: input.contentMarkdown } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.customFields !== undefined ? { customFields: input.customFields } : {}),
    } }),
    taskId: input.taskId,
    eventType: "task.fields_updated",
    eventPayload: result,
    activity: {
      id: boundedId("activity", [input.commandId], 128),
      type: "fields_updated",
      actorType: "user",
      actorUserId: input.actor.id,
      message: "任务属性已更新",
      payload: result,
    },
    persist: async (tx) => {
      const updated = await tx.task.updateMany({
        where: { id: input.taskId, version: input.expectedVersion },
        data: {
          ...(title ? { title } : {}),
          ...(input.contentMarkdown !== undefined ? { contentMarkdown: input.contentMarkdown, description: input.contentMarkdown } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
          version: { increment: 1 },
        },
      });
      if (input.customFields !== undefined || projectChanged) {
        await tx.taskFieldValue.deleteMany({ where: { taskId: input.taskId } });
        if (normalizedCustomFields.length > 0) {
          await tx.taskFieldValue.createMany({
            data: normalizedCustomFields.map((field) => ({
              id: allocateTaskFieldValueId(input.taskId, field.definitionId),
              taskId: input.taskId,
              fieldDefinitionId: field.definitionId,
              ...field.data,
            })),
          });
        }
      }
      return { rows: updated.count, result };
    },
  });
}

export async function updateUserTaskSchedule(
  input: UserTaskMutationInput & { startAt?: Date | null; dueAt?: Date | null; recurrenceRule?: string | null; loopBinding?: { bindingId: string; bindingType: "task" | "project" } | null },
  dependencies: UserTaskCommandDependencies = defaultDependencies,
) {
  const task = await loadTaskForMutation(input, "edit_content", dependencies);
  if (input.startAt === undefined && input.dueAt === undefined && input.recurrenceRule === undefined && input.loopBinding === undefined) {
    throw new UserTaskCommandError("validation_failed", "at least one Task schedule field is required");
  }
  if (input.startAt && input.dueAt && input.startAt > input.dueAt) {
    throw new UserTaskCommandError("validation_failed", "Task start date must not be after its due date");
  }
  const projectId = task.projectId;
  if (input.loopBinding !== undefined && input.loopBinding !== null) {
    if (!projectId || !dependencies.loadProjectLoopBinding) {
      throw new UserTaskCommandError("validation_failed", "定时任务 Loop 绑定必须关联项目");
    }
    const binding = await dependencies.loadProjectLoopBinding({ projectId, ...input.loopBinding });
    if (!binding) throw new UserTaskCommandError("validation_failed", "定时任务 Loop 必须是项目当前启用的 Loop");
  }
  const existingDispatchPolicy = input.loopBinding === undefined ? undefined : task.dispatchPolicy;
  const dispatchPolicy = input.loopBinding === undefined
    ? undefined
    : { ...(existingDispatchPolicy && typeof existingDispatchPolicy === "object" && !Array.isArray(existingDispatchPolicy) ? existingDispatchPolicy as Record<string, unknown> : {}), recurringLoopBinding: input.loopBinding };
  const result = {
    taskId: input.taskId,
    ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
    ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
    ...(input.recurrenceRule !== undefined ? { recurrenceRule: input.recurrenceRule } : {}),
    ...(input.loopBinding !== undefined ? { loopBinding: input.loopBinding } : {}),
    version: input.expectedVersion + 1,
  };
  return dependencies.execute({
    command: commandEnvelope({ ...input, payload: {
      ...(input.startAt !== undefined ? { startAt: input.startAt?.toISOString() ?? null } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt?.toISOString() ?? null } : {}),
      ...(input.recurrenceRule !== undefined ? { recurrenceRule: input.recurrenceRule } : {}),
      ...(input.loopBinding !== undefined ? { loopBinding: input.loopBinding } : {}),
    } }),
    taskId: input.taskId,
    eventType: "task.schedule_updated",
    eventPayload: result,
    activity: {
      id: boundedId("activity", [input.commandId], 128),
      type: "schedule_updated",
      actorType: "user",
      actorUserId: input.actor.id,
      message: "任务排期已更新",
      payload: result,
    },
    persist: async (tx) => {
      const updated = await tx.task.updateMany({
        where: { id: input.taskId, version: input.expectedVersion },
        data: {
          ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
          ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
          ...(input.recurrenceRule !== undefined ? { recurrenceRule: input.recurrenceRule } : {}),
          ...(dispatchPolicy !== undefined ? { dispatchPolicy } : {}),
          version: { increment: 1 },
        },
      });
      return { rows: updated.count, result };
    },
  });
}

export async function addUserTaskMember(
  input: UserTaskMutationInput & { userId: string; role: "participant" | "follower" },
  dependencies: UserTaskCommandDependencies = defaultDependencies,
) {
  const task = await loadTaskForMutation(input, "manage_members", dependencies);
  await requireSpaceMember(task, input.userId, dependencies);
  const result = {
    taskId: input.taskId,
    userId: input.userId,
    role: input.role,
    version: input.expectedVersion + 1,
  };
  return dependencies.execute({
    command: commandEnvelope({ ...input, payload: { userId: input.userId, role: input.role } }),
    taskId: input.taskId,
    eventType: "task.member_added",
    eventPayload: { userId: input.userId, role: input.role },
    activity: {
      id: boundedId("activity", [input.commandId], 128),
      type: "member_added",
      actorType: "user",
      actorUserId: input.actor.id,
      message: "任务协作者已更新",
      payload: { userId: input.userId, role: input.role },
    },
    persist: async (tx) => {
      const updated = await tx.task.updateMany({
        where: { id: input.taskId, version: input.expectedVersion },
        data: { version: { increment: 1 } },
      });
      if (updated.count === 1) {
        await tx.taskMember.upsert({
          where: { taskId_userId: { taskId: input.taskId, userId: input.userId } },
          create: {
            id: `member:${input.taskId}:${input.userId}`,
            taskId: input.taskId,
            userId: input.userId,
            role: input.role,
          },
          update: { role: input.role },
        });
      }
      return { rows: updated.count, result };
    },
  });
}

export async function removeUserTaskMember(
  input: UserTaskMutationInput & { userId: string },
  dependencies: UserTaskCommandDependencies = defaultDependencies,
) {
  await loadTaskForMutation(input, "manage_members", dependencies);
  const result = { taskId: input.taskId, userId: input.userId, version: input.expectedVersion + 1 };
  return dependencies.execute({
    command: commandEnvelope({ ...input, payload: { userId: input.userId } }),
    taskId: input.taskId,
    eventType: "task.member_removed",
    eventPayload: { userId: input.userId },
    activity: {
      id: boundedId("activity", [input.commandId], 128),
      type: "member_removed",
      actorType: "user",
      actorUserId: input.actor.id,
      message: "任务协作者已移除",
      payload: { userId: input.userId },
    },
    persist: async (tx) => {
      const updated = await tx.task.updateMany({
        where: { id: input.taskId, version: input.expectedVersion },
        data: { version: { increment: 1 } },
      });
      if (updated.count === 1) {
        await tx.taskMember.deleteMany({ where: { taskId: input.taskId, userId: input.userId } });
      }
      return { rows: updated.count, result };
    },
  });
}

export async function addUserTaskBlocker(
  input: UserTaskMutationInput & { reason: string; ownerUserId?: string },
  dependencies: UserTaskCommandDependencies = defaultDependencies,
) {
  const task = await loadTaskForMutation(input, "change_status", dependencies);
  const reason = input.reason.trim();
  if (!reason) throw new UserTaskCommandError("validation_failed", "blocker reason is required");
  if (input.ownerUserId) await requireSpaceMember(task, input.ownerUserId, dependencies);
  const blockerId = boundedId("blocker", [input.commandId]);
  const result = { taskId: input.taskId, blockerId, version: input.expectedVersion + 1 };
  return dependencies.execute({
    command: commandEnvelope({ ...input, payload: { reason, ownerUserId: input.ownerUserId ?? null } }),
    taskId: input.taskId,
    eventType: "task.blocker_added",
    eventPayload: { blockerId, reason, ownerUserId: input.ownerUserId ?? null },
    activity: {
      id: boundedId("activity", [input.commandId], 128),
      type: "blocker_added",
      actorType: "user",
      actorUserId: input.actor.id,
      message: reason,
      payload: { blockerId, ownerUserId: input.ownerUserId ?? null },
    },
    persist: async (tx) => {
      const updated = await tx.task.updateMany({
        where: { id: input.taskId, version: input.expectedVersion },
        data: { version: { increment: 1 } },
      });
      if (updated.count === 1) {
        await tx.taskBlocker.create({
          data: {
            id: blockerId,
            taskId: input.taskId,
            reason,
            status: "active",
            ownerUserId: input.ownerUserId ?? null,
            createdById: input.actor.id,
          },
        });
      }
      return { rows: updated.count, result };
    },
  });
}

export async function resolveUserTaskBlocker(
  input: UserTaskMutationInput & { blockerId: string },
  dependencies: UserTaskCommandDependencies = defaultDependencies,
) {
  await loadTaskForMutation(input, "change_status", dependencies);
  const result = {
    taskId: input.taskId,
    blockerId: input.blockerId,
    version: input.expectedVersion + 1,
  };
  return dependencies.execute({
    command: commandEnvelope({ ...input, payload: { blockerId: input.blockerId } }),
    taskId: input.taskId,
    eventType: "task.blocker_resolved",
    eventPayload: { blockerId: input.blockerId },
    activity: {
      id: boundedId("activity", [input.commandId], 128),
      type: "blocker_resolved",
      actorType: "user",
      actorUserId: input.actor.id,
      message: "任务阻塞已解除",
      payload: { blockerId: input.blockerId },
    },
    persist: async (tx) => {
      const blocker = await tx.taskBlocker.updateMany({
        where: { id: input.blockerId, taskId: input.taskId, status: "active" },
        data: {
          status: "resolved",
          resolvedById: input.actor.id,
          resolvedAt: new Date(),
        },
      });
      const updated = blocker.count === 1
        ? await tx.task.updateMany({
            where: { id: input.taskId, version: input.expectedVersion },
            data: { version: { increment: 1 } },
          })
        : { count: 0 };
      return { rows: updated.count, result };
    },
  });
}

export const submitUserTaskForReview = (
  input: UserTaskMutationInput,
  dependencies?: UserTaskCommandDependencies,
) => changeUserTaskStatus({ ...input, command: "submit_for_review" }, dependencies);

export const acceptUserTask = (
  input: UserTaskMutationInput,
  dependencies?: UserTaskCommandDependencies,
) => changeUserTaskStatus({ ...input, command: "accept" }, dependencies);

export function rejectUserTask(
  input: UserTaskMutationInput & { reason: string },
  dependencies?: UserTaskCommandDependencies,
) {
  const reason = input.reason.trim();
  if (!reason) throw new UserTaskCommandError("validation_failed", "rejection reason is required");
  return changeUserTaskStatus({ ...input, command: "reject", reason }, dependencies);
}

async function setUserTaskArchived(
  input: UserTaskMutationInput,
  archived: boolean,
  dependencies: UserTaskCommandDependencies,
) {
  await loadTaskForMutation(input, "govern", dependencies);
  const result = { taskId: input.taskId, archived, version: input.expectedVersion + 1 };
  return dependencies.execute({
    command: commandEnvelope({ ...input, payload: { archived } }),
    taskId: input.taskId,
    eventType: archived ? "task.archived" : "task.restored",
    eventPayload: { archived },
    activity: {
      id: boundedId("activity", [input.commandId], 128),
      type: archived ? "archived" : "restored",
      actorType: "user",
      actorUserId: input.actor.id,
      message: archived ? "任务已归档" : "任务已恢复",
    },
    persist: async (tx) => {
      const updated = await tx.task.updateMany({
        where: { id: input.taskId, version: input.expectedVersion },
        data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } },
      });
      return { rows: updated.count, result };
    },
  });
}

export const archiveUserTask = (
  input: UserTaskMutationInput,
  dependencies: UserTaskCommandDependencies = defaultDependencies,
) => setUserTaskArchived(input, true, dependencies);

export const restoreUserTask = (
  input: UserTaskMutationInput,
  dependencies: UserTaskCommandDependencies = defaultDependencies,
) => setUserTaskArchived(input, false, dependencies);

export async function dispatchUserTaskToAgent(
  input: UserTaskMutationInput & { agentProfileId: string },
  dependencies: UserTaskCommandDependencies = defaultDependencies,
) {
  const task = await loadTaskForMutation(input, "dispatch_agent", dependencies);
  const profile = await dependencies.loadAgentProfile({ agentProfileId: input.agentProfileId });
  if (!profile || profile.spaceId !== task.spaceId || profile.status !== "active") {
    throw new UserTaskCommandError("validation_failed", "Agent Profile must be active in the Task Space");
  }
  const dispatchId = boundedId("dispatch", [input.commandId]);
  const result = {
    taskId: input.taskId,
    version: input.expectedVersion + 1,
    executionRelationship: {
      type: "agent_dispatch_candidate" as const,
      id: dispatchId,
      agentProfileId: input.agentProfileId,
    },
  };
  return dependencies.execute({
    command: commandEnvelope({ ...input, payload: { dispatchId, agentProfileId: input.agentProfileId } }),
    taskId: input.taskId,
    eventType: "task.agent_dispatch_requested",
    eventPayload: { dispatchId, agentProfileId: input.agentProfileId },
    activity: {
      id: boundedId("activity", [input.commandId], 128),
      type: "agent_dispatch_requested",
      actorType: "user",
      actorUserId: input.actor.id,
      message: "已请求 Agent 执行",
      payload: { dispatchId, agentProfileId: input.agentProfileId },
    },
    persist: async (tx) => {
      const updated = await tx.task.updateMany({
        where: { id: input.taskId, version: input.expectedVersion },
        data: {
          executionMode: "agent",
          preferredAgentProfileId: input.agentProfileId,
          dispatchPolicy: { candidateDispatchId: dispatchId },
          version: { increment: 1 },
        },
      });
      return { rows: updated.count, result };
    },
  });
}

async function executeUserTaskRelationCommand<TResult>(input: {
  mutation: UserTaskMutationInput;
  dependencies: UserTaskCommandDependencies;
  action: "comment" | "edit_content";
  eventType: string;
  eventPayload: unknown;
  activityType: string;
  activityMessage: string;
  result: TResult;
  persistRelation(tx: TaskCommandTx, task: LoadedTask): Promise<boolean | void>;
}) {
  const task = await loadTaskForMutation(input.mutation, input.action, input.dependencies);
  return input.dependencies.execute({
    command: commandEnvelope({ ...input.mutation, payload: input.eventPayload }),
    taskId: input.mutation.taskId,
    eventType: input.eventType,
    eventPayload: input.eventPayload,
    activity: {
      id: boundedId("activity", [input.mutation.commandId], 128),
      type: input.activityType,
      actorType: "user",
      actorUserId: input.mutation.actor.id,
      message: input.activityMessage,
      payload: input.eventPayload,
    },
    persist: async (tx) => {
      const updated = await tx.task.updateMany({
        where: { id: input.mutation.taskId, version: input.mutation.expectedVersion },
        data: { version: { increment: 1 } },
      });
      if (updated.count === 1 && await input.persistRelation(tx, task) === false) {
        return { rows: 0, result: input.result };
      }
      return { rows: updated.count, result: input.result };
    },
  });
}

export async function addUserTaskComment(
  input: UserTaskMutationInput & { contentMarkdown: string },
  dependencies: UserTaskCommandDependencies = defaultDependencies,
) {
  const contentMarkdown = input.contentMarkdown.trim();
  if (!contentMarkdown) throw new UserTaskCommandError("validation_failed", "comment content is required");
  const commentId = boundedId("comment", [input.commandId]);
  return executeUserTaskRelationCommand({
    mutation: input,
    dependencies,
    action: "comment",
    eventType: "task.comment_added",
    eventPayload: { commentId, contentLength: contentMarkdown.length },
    activityType: "comment_added",
    activityMessage: "任务评论已添加",
    result: { taskId: input.taskId, commentId, version: input.expectedVersion + 1 },
    persistRelation: async (tx) => {
      await tx.taskComment.create({ data: {
        id: commentId,
        taskId: input.taskId,
        authorUserId: input.actor.id,
        contentMarkdown,
      } });
    },
  });
}

export async function createUserTaskReminder(
  input: UserTaskMutationInput & { remindAt: Date },
  dependencies: UserTaskCommandDependencies = defaultDependencies,
) {
  if (Number.isNaN(input.remindAt.getTime())) {
    throw new UserTaskCommandError("validation_failed", "valid reminder time is required");
  }
  const reminderId = boundedId("reminder", [input.commandId]);
  return executeUserTaskRelationCommand({
    mutation: input,
    dependencies,
    action: "comment",
    eventType: "task.reminder_created",
    eventPayload: { reminderId, remindAt: input.remindAt.toISOString() },
    activityType: "reminder_created",
    activityMessage: "任务提醒已创建",
    result: { taskId: input.taskId, reminderId, version: input.expectedVersion + 1 },
    persistRelation: async (tx) => {
      await tx.taskReminder.create({ data: {
        id: reminderId,
        taskId: input.taskId,
        recipientUserId: input.actor.id,
        remindAt: input.remindAt,
        channel: "in_app",
        status: "pending",
        idempotencyKey: `task-reminder:${input.commandId}`,
        createdById: input.actor.id,
      } });
    },
  });
}

export async function removeUserTaskReminder(
  input: UserTaskMutationInput & { reminderId: string },
  dependencies: UserTaskCommandDependencies = defaultDependencies,
) {
  return executeUserTaskRelationCommand({
    mutation: input,
    dependencies,
    action: "comment",
    eventType: "task.reminder_removed",
    eventPayload: { reminderId: input.reminderId },
    activityType: "reminder_removed",
    activityMessage: "任务提醒已移除",
    result: { taskId: input.taskId, reminderId: input.reminderId, version: input.expectedVersion + 1 },
    persistRelation: async (tx) => {
      const deleted = await tx.taskReminder.deleteMany({ where: {
        id: input.reminderId,
        taskId: input.taskId,
        recipientUserId: input.actor.id,
        status: { in: ["pending", "failed"] },
      } });
      return deleted.count === 1;
    },
  });
}

export async function addUserTaskLabel(
  input: UserTaskMutationInput & { labelId: string },
  dependencies: UserTaskCommandDependencies = defaultDependencies,
) {
  return executeUserTaskRelationCommand({
    mutation: input,
    dependencies,
    action: "edit_content",
    eventType: "task.label_added",
    eventPayload: { labelId: input.labelId },
    activityType: "label_added",
    activityMessage: "任务标签已添加",
    result: { taskId: input.taskId, labelId: input.labelId, version: input.expectedVersion + 1 },
    persistRelation: async (tx, task) => {
      const label = await tx.taskLabel.findUnique({ where: { id: input.labelId }, select: { id: true, spaceId: true } });
      if (!label || label.spaceId !== task.spaceId) {
        throw new UserTaskCommandError("validation_failed", "label must belong to the Task Space");
      }
      await tx.taskLabelAssignment.upsert({
        where: { taskId_labelId: { taskId: input.taskId, labelId: input.labelId } },
        create: {
          id: boundedId("label-assignment", [input.commandId]),
          taskId: input.taskId,
          labelId: input.labelId,
          assignedById: input.actor.id,
        },
        update: { assignedById: input.actor.id },
      });
    },
  });
}

export async function removeUserTaskLabel(
  input: UserTaskMutationInput & { labelId: string },
  dependencies: UserTaskCommandDependencies = defaultDependencies,
) {
  return executeUserTaskRelationCommand({
    mutation: input,
    dependencies,
    action: "edit_content",
    eventType: "task.label_removed",
    eventPayload: { labelId: input.labelId },
    activityType: "label_removed",
    activityMessage: "任务标签已移除",
    result: { taskId: input.taskId, labelId: input.labelId, version: input.expectedVersion + 1 },
    persistRelation: async (tx) => {
      const deleted = await tx.taskLabelAssignment.deleteMany({ where: { taskId: input.taskId, labelId: input.labelId } });
      return deleted.count === 1;
    },
  });
}
