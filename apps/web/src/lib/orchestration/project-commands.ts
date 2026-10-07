import type { OrchestrationActor } from "@humanthread/shared";
import type { Prisma } from "@prisma/client";
import { assertCanWriteProject, executeIdempotentCommand, prisma } from "../../../../../packages/db/src/index";
import { createEventEnvelope } from "../../../../../packages/orchestration-core/src/contracts";
import { resolveRequiredAcceptanceChecks } from "../../../../../packages/orchestration-core/src/acceptance";
import { OrchestrationValidationError, transitionProject } from "../../../../../packages/orchestration-core/src/project";
import {
  createUserTask as createUserTaskCommand,
  type CreateUserTaskInput,
} from "../tasks/task-commands";

type ProjectSnapshot = { id: string; status: "draft" | "planned" | "active" | "paused" | "completed" | "cancelled" | "archived"; version: number };
type CommandInput = {
  projectId: string;
  actor: OrchestrationActor;
  commandId: string;
  correlationId: string;
  expectedVersion: number;
};

interface ProjectCommandDependencies {
  authorize(input: { userId: string; projectId: string }): Promise<unknown>;
  loadProject(projectId: string): Promise<ProjectSnapshot | null>;
  listMilestones(projectId: string): Promise<Array<{ id: string; status: string }>>;
  execute(input: {
    commandId: string;
    correlationId: string;
    actor: OrchestrationActor;
    projectId: string;
    expectedVersion: number;
    eventType: string;
    result: { projectId: string; status: string; version: number };
    payload?: unknown;
    /** Terminal transitions stamp `completedAt` instead of clearing it. */
    completedAt?: Date | null;
  }): Promise<{ projectId: string; status: string; version: number }>;
}

function toProjectSnapshot(project: { id: string; orchestrationStatus: string | null; version: number }): ProjectSnapshot {
  return {
    id: project.id,
    status: (project.orchestrationStatus ?? "draft") as ProjectSnapshot["status"],
    version: project.version,
  };
}

const defaultDependencies: ProjectCommandDependencies = {
  authorize: ({ userId, projectId }) => assertCanWriteProject({ userId, projectId }),
  loadProject: async (projectId) => {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, orchestrationStatus: true, version: true },
    });
    return project ? toProjectSnapshot(project) : null;
  },
  listMilestones: (projectId) => prisma.milestone.findMany({
    where: { projectId },
    select: { id: true, status: true },
  }),
  execute: async (input) => executeIdempotentCommand({
    command: {
      commandId: input.commandId,
      correlationId: input.correlationId,
      actor: input.actor,
      expectedVersion: input.expectedVersion,
      payload: input.payload ?? {},
      issuedAt: new Date(),
    },
    aggregate: { type: "project", id: input.projectId },
    db: {
      // The whole transaction delegate is forwarded deliberately: hand-picking
      // models silently broke lifecycle commands when the event appender later
      // needed `orchestrationAggregateSequence`.
      $transaction: (callback) => prisma.$transaction(async (tx) => callback(tx as never)),
    },
    apply: async (tx) => {
      const event = createEventEnvelope({
        id: `event:${input.commandId}:${input.eventType}`,
        eventType: input.eventType,
        aggregate: { type: "project", id: input.projectId, version: input.result.version },
        sequence: input.result.version,
        correlationId: input.correlationId,
        commandId: input.commandId,
        actor: input.actor,
        occurredAt: new Date(),
        payload: input.payload ?? {},
      });
      return {
        result: input.result,
        events: [event],
        persist: async () => {
          const transaction = tx as unknown as {
            project: typeof prisma.project;
            projectStage: typeof prisma.projectStage;
            milestone: typeof prisma.milestone;
          };
          const updated = await transaction.project.updateMany({
            where: { id: input.projectId, version: input.expectedVersion },
            data: {
              orchestrationStatus: input.result.status,
              version: input.result.version,
              ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
              ...(input.payload && typeof input.payload === "object" && "objective" in input.payload
                ? { objective: String(input.payload.objective) }
                : {}),
            },
          });
          if (updated.count !== 1) return 0;

          const payload = input.payload as { stages?: Array<{ key: string; name: string; milestones: Array<{ name: string }> }> } | undefined;
          for (const [stageIndex, stage] of (payload?.stages ?? []).entries()) {
            const stageId = `stage:${input.projectId}:${stage.key}`;
            await transaction.projectStage.create({
              data: {
                id: stageId,
                projectId: input.projectId,
                key: stage.key,
                name: stage.name,
                status: stageIndex === 0 ? "active" : "planned",
                sortOrder: stageIndex,
                entryCriteria: {},
                exitCriteria: {},
              },
            });
            for (const [milestoneIndex, milestone] of stage.milestones.entries()) {
              await transaction.milestone.create({
                data: {
                  id: `milestone:${input.projectId}:${stage.key}:${milestoneIndex}`,
                  projectId: input.projectId,
                  stageId,
                  name: milestone.name,
                  status: stageIndex === 0 ? "active" : "planned",
                  requiredCheckPolicy: {} as Prisma.InputJsonObject,
                },
              });
            }
          }
          return 1;
        },
      };
    },
  }),
};

function assertUserActor(actor: OrchestrationActor): asserts actor is { type: "user"; id: string } {
  if (actor.type !== "user") throw new OrchestrationValidationError("project command requires user actor", "unknown", "authorize");
}

async function loadAuthorizedProject(input: CommandInput, dependencies: ProjectCommandDependencies): Promise<ProjectSnapshot> {
  assertUserActor(input.actor);
  await dependencies.authorize({ userId: input.actor.id, projectId: input.projectId });
  const project = await dependencies.loadProject(input.projectId);
  if (!project) throw Object.assign(new Error("Project not found"), { code: "not_found" });
  if (project.version !== input.expectedVersion) throw Object.assign(new Error("Project version conflict"), { code: "version_conflict" });
  return project;
}

export async function submitProjectPlan(input: CommandInput & {
  payload: { objective: string; stages: Array<{ key: string; name: string; milestones: Array<{ name: string }> }> };
}, dependencies: ProjectCommandDependencies = defaultDependencies) {
  const project = await loadAuthorizedProject(input, dependencies);
  const milestoneCount = input.payload.stages.reduce((count, stage) => count + stage.milestones.length, 0);
  const next = transitionProject({
    project,
    command: "submit_plan",
    context: {
      objective: input.payload.objective,
      stageCount: input.payload.stages.length,
      milestoneCount,
      planApproved: true,
    },
  });
  return dependencies.execute({
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    projectId: input.projectId,
    expectedVersion: input.expectedVersion,
    eventType: "project.plan_submitted",
    result: { projectId: input.projectId, status: next.status, version: next.version },
    payload: input.payload,
  });
}

export async function activateProject(input: CommandInput, dependencies: ProjectCommandDependencies = defaultDependencies) {
  const project = await loadAuthorizedProject(input, dependencies);
  const milestones = await dependencies.listMilestones(input.projectId);
  if (milestones.length === 0) throw new OrchestrationValidationError("project plan has no milestone", project.status, "activate");
  const next = transitionProject({ project, command: "activate", context: { repositoryPolicyValid: true } });
  return dependencies.execute({
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    projectId: input.projectId,
    expectedVersion: input.expectedVersion,
    eventType: "project.activated",
    result: { projectId: input.projectId, status: next.status, version: next.version },
  });
}

async function transitionSimpleProject(command: "pause" | "resume", input: CommandInput, dependencies: ProjectCommandDependencies) {
  const project = await loadAuthorizedProject(input, dependencies);
  const next = transitionProject({ project, command });
  return dependencies.execute({
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    projectId: input.projectId,
    expectedVersion: input.expectedVersion,
    eventType: `project.${command}d`,
    result: { projectId: input.projectId, status: next.status, version: next.version },
  });
}

export const pauseProject = (input: CommandInput, dependencies: ProjectCommandDependencies = defaultDependencies) => transitionSimpleProject("pause", input, dependencies);
export const resumeProject = (input: CommandInput, dependencies: ProjectCommandDependencies = defaultDependencies) => transitionSimpleProject("resume", input, dependencies);

export async function completeProject(input: CommandInput & {
  /**
   * Closing a project whose milestones are still open is a real scenario (the
   * work moved elsewhere, or the remainder is no longer in scope). Forcing is
   * allowed but must be deliberate: it requires a written reason that is
   * recorded on the `project.completed` event.
   */
  force?: boolean;
  reason?: string;
}, dependencies: ProjectCommandDependencies = defaultDependencies) {
  const project = await loadAuthorizedProject(input, dependencies);
  const milestones = await dependencies.listMilestones(input.projectId);
  // Cancelled scope is resolved scope: a milestone deliberately dropped must
  // not be reported as outstanding work when the project closes.
  const isResolved = (status: string) => status === "completed" || status === "cancelled";
  const requiredMilestonesComplete = milestones.every((milestone) => isResolved(milestone.status));
  const force = input.force === true;
  const reason = (input.reason ?? "").trim();
  if (force && !reason) {
    throw new OrchestrationValidationError("forced completion requires a reason", project.status, "complete");
  }
  const openMilestones = milestones.filter((milestone) => !isResolved(milestone.status)).length;
  if (!force && openMilestones > 0) {
    throw new OrchestrationValidationError(
      `${openMilestones} milestone(s) are still open; force completion requires a reason`,
      project.status,
      "complete",
    );
  }
  const next = transitionProject({
    project,
    command: "complete",
    context: { requiredMilestonesComplete: requiredMilestonesComplete || force },
  });
  return dependencies.execute({
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    projectId: input.projectId,
    expectedVersion: input.expectedVersion,
    eventType: "project.completed",
    result: { projectId: input.projectId, status: next.status, version: next.version },
    payload: {
      forced: force,
      openMilestoneCount: openMilestones,
      ...(reason ? { reason } : {}),
    },
    completedAt: new Date(),
  });
}

export async function archiveProject(input: CommandInput, dependencies: ProjectCommandDependencies = defaultDependencies) {
  const project = await loadAuthorizedProject(input, dependencies);
  const next = transitionProject({ project, command: "archive" });
  return dependencies.execute({
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    projectId: input.projectId,
    expectedVersion: input.expectedVersion,
    eventType: "project.archived",
    result: { projectId: input.projectId, status: next.status, version: next.version },
  });
}

export interface CreateProjectTaskInput {
  projectId: string;
  actor: OrchestrationActor;
  commandId: string;
  correlationId: string;
  payload: {
    title: string;
    objective: string;
    milestoneId?: string;
    preferredAgentProfileId?: string;
    workflowInstanceId?: string;
    stepTemplateId?: string;
    allowedPaths: string[];
    requiredChecks: string[];
    maxAttempts: number;
    timeoutMinutes: number;
  };
}

interface CreateTaskDependencies {
  loadProject(input: { projectId: string }): Promise<{ id: string; spaceId: string | null } | null>;
  createUserTask(input: CreateUserTaskInput): Promise<unknown>;
}

const defaultCreateTaskDependencies: CreateTaskDependencies = {
  loadProject: ({ projectId }) => prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, spaceId: true },
  }),
  createUserTask: (input) => createUserTaskCommand(input),
};

export async function createTask(input: CreateProjectTaskInput, dependencies: CreateTaskDependencies = defaultCreateTaskDependencies) {
  assertUserActor(input.actor);
  if (!input.payload.title.trim() || !input.payload.objective.trim() || input.payload.allowedPaths.length === 0 || input.payload.requiredChecks.length === 0 || input.payload.maxAttempts < 1 || input.payload.timeoutMinutes < 1) {
    throw new OrchestrationValidationError("task dispatch input is invalid", "draft", "create_task");
  }
  if (Boolean(input.payload.workflowInstanceId) !== Boolean(input.payload.stepTemplateId)) {
    throw new OrchestrationValidationError("task Workflow linkage is incomplete", "draft", "create_task");
  }
  let requiredChecks: string[];
  try {
    requiredChecks = resolveRequiredAcceptanceChecks({ requiredChecks: input.payload.requiredChecks });
  } catch {
    throw new OrchestrationValidationError("task acceptance checks are invalid", "draft", "create_task");
  }
  const project = await dependencies.loadProject({ projectId: input.projectId });
  if (!project?.spaceId) {
    throw new OrchestrationValidationError("project has no migrated Space", "draft", "create_task");
  }
  return dependencies.createUserTask({
    actor: input.actor,
    commandId: input.commandId,
    correlationId: input.correlationId,
    payload: {
      spaceId: project.spaceId,
      projectId: project.id,
      title: input.payload.title,
      contentMarkdown: input.payload.objective,
      objective: input.payload.objective,
      visibility: "project",
      executionMode: "agent",
      acceptanceMode: "automated",
      ...(input.payload.milestoneId ? { milestoneId: input.payload.milestoneId } : {}),
      ...(input.payload.preferredAgentProfileId ? { preferredAgentProfileId: input.payload.preferredAgentProfileId } : {}),
      ...(input.payload.workflowInstanceId ? { workflowInstanceId: input.payload.workflowInstanceId } : {}),
      ...(input.payload.stepTemplateId ? { stepTemplateId: input.payload.stepTemplateId } : {}),
      scopePolicy: { allowedPaths: input.payload.allowedPaths },
      acceptancePolicy: { requiredChecks },
      budgetPolicy: {
        maxAttempts: input.payload.maxAttempts,
        timeoutMinutes: input.payload.timeoutMinutes,
      },
    },
  });
}
