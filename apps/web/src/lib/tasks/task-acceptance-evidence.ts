import { createHash } from "node:crypto";
import type { OrchestrationActor, OrchestrationCommand } from "@humanthread/shared";
import {
  evaluateTaskAcceptance,
  resolveRequiredAcceptanceChecks,
  type TaskAcceptanceEvidenceResult,
  type TaskAcceptanceEvidenceStatus,
  type TaskAcceptanceReadiness,
} from "@humanthread/orchestration-core";
import {
  assertCanGovernTask,
  executeTaskCommand,
  prisma,
  type TaskCommandActivity,
  type TaskCommandTx,
} from "@humanthread/db";
import { UserTaskCommandError } from "./task-errors";

export type TaskAcceptanceEvidenceSource = "user" | "mcp";

interface AcceptanceTaskContext {
  task: {
    id: string;
    projectId: string | null;
    acceptancePolicy: unknown;
  };
  results: Array<TaskAcceptanceEvidenceResult & { definitionProjectId: string }>;
}

type EvidenceExecutionInput<TResult> = {
  command: OrchestrationCommand<unknown> & { expectedVersion: number };
  taskId: string;
  eventType: string;
  eventPayload?: unknown;
  activity: TaskCommandActivity;
  persist(tx: TaskCommandTx): Promise<{ rows: number; result: TResult }>;
};

export interface TaskAcceptanceEvidenceDependencies {
  loadContext(input: { taskId: string }): Promise<AcceptanceTaskContext | null>;
  authorize(input: { userId: string; taskId: string }): Promise<unknown>;
  execute<TResult>(input: EvidenceExecutionInput<TResult>): Promise<TResult>;
}

function evidenceSource(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "unknown";
  const source = (value as { source?: unknown }).source;
  return typeof source === "string" ? source : "unknown";
}

const defaultDependencies: TaskAcceptanceEvidenceDependencies = {
  loadContext: async ({ taskId }) => {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        projectId: true,
        acceptancePolicy: true,
        checkDefinitions: {
          where: { type: "acceptance" },
          select: {
            projectId: true,
            name: true,
            configuration: true,
            results: {
              where: { taskId },
              select: {
                id: true,
                status: true,
                summary: true,
                evidence: true,
                finishedAt: true,
              },
            },
          },
        },
      },
    });
    if (!task) return null;
    const results = task.checkDefinitions.flatMap((definition) => {
      const configuredKey = definition.configuration
        && typeof definition.configuration === "object"
        && !Array.isArray(definition.configuration)
        ? (definition.configuration as { acceptanceCheckKey?: unknown }).acceptanceCheckKey
        : undefined;
      const checkKey = typeof configuredKey === "string" ? configuredKey : definition.name;
      return definition.results.map((result) => ({
        id: result.id,
        definitionProjectId: definition.projectId,
        checkKey,
        status: result.status as TaskAcceptanceEvidenceStatus,
        summary: result.summary,
        source: evidenceSource(result.evidence),
        finishedAt: result.finishedAt,
      }));
    });
    return {
      task: {
        id: task.id,
        projectId: task.projectId,
        acceptancePolicy: task.acceptancePolicy,
      },
      results,
    };
  },
  authorize: ({ userId, taskId }) => assertCanGovernTask({ userId, taskId, hideDenied: true }),
  execute: (input) => executeTaskCommand(input),
};

function boundedId(prefix: string, parts: string[], maxLength: number) {
  const readable = `${prefix}:${parts.join(":")}`;
  if (readable.length <= maxLength) return readable;
  return `${prefix}:${createHash("sha256").update(parts.join("\0")).digest("hex")}`;
}

function requireUserActor(actor: OrchestrationActor): asserts actor is { type: "user"; id: string } {
  if (actor.type !== "user") {
    throw new UserTaskCommandError("authorization_denied", "acceptance evidence requires a human user");
  }
}

export interface SubmitTaskAcceptanceEvidenceInput {
  actor: OrchestrationActor;
  source: TaskAcceptanceEvidenceSource;
  commandId: string;
  correlationId: string;
  taskId: string;
  expectedVersion: number;
  checkKey: string;
  status: TaskAcceptanceEvidenceStatus;
  summary: string;
  evidenceMarkdown?: string;
  startedAt?: Date;
  finishedAt?: Date;
}

export interface RecordAutomatedTaskAcceptanceEvidenceInput {
  systemActorId: string;
  agentRunId: string;
  commandId: string;
  correlationId: string;
  taskId: string;
  expectedVersion: number;
  checkKey: string;
  status: TaskAcceptanceEvidenceStatus;
  summary: string;
  evidence: Record<string, unknown>;
  startedAt?: Date;
  finishedAt?: Date;
}

export async function loadTaskAcceptanceReadiness(
  input: { taskId: string },
  dependencies: Pick<TaskAcceptanceEvidenceDependencies, "loadContext"> = defaultDependencies,
): Promise<TaskAcceptanceReadiness | null> {
  const context = await dependencies.loadContext(input);
  return context ? evaluateTaskAcceptance({
    policy: context.task.acceptancePolicy,
    results: context.results.filter((result) => result.definitionProjectId === context.task.projectId),
  }) : null;
}

export async function submitTaskAcceptanceEvidence(
  input: SubmitTaskAcceptanceEvidenceInput,
  dependencies: TaskAcceptanceEvidenceDependencies = defaultDependencies,
) {
  requireUserActor(input.actor);
  const checkKey = input.checkKey.trim();
  const summary = input.summary.trim();
  const evidenceMarkdown = input.evidenceMarkdown?.trim();
  if (!checkKey || checkKey.length > 96 || !summary || summary.length > 2_000) {
    throw new UserTaskCommandError("validation_failed", "acceptance evidence check and summary are invalid");
  }
  if (evidenceMarkdown && evidenceMarkdown.length > 10_000) {
    throw new UserTaskCommandError("validation_failed", "acceptance evidence details are too long");
  }
  await dependencies.authorize({ userId: input.actor.id, taskId: input.taskId });
  const context = await dependencies.loadContext({ taskId: input.taskId });
  if (!context) throw new UserTaskCommandError("not_found", "task not found");
  if (!context.task.projectId) {
    throw new UserTaskCommandError("validation_failed", "acceptance evidence requires a Project Task");
  }
  let requiredChecks: string[];
  try {
    requiredChecks = resolveRequiredAcceptanceChecks(context.task.acceptancePolicy);
  } catch {
    throw new UserTaskCommandError("validation_failed", "Task acceptance policy is invalid");
  }
  if (!requiredChecks.includes(checkKey)) {
    throw new UserTaskCommandError("validation_failed", `acceptance check is not required: ${checkKey}`);
  }
  const finishedAt = input.finishedAt ?? new Date();
  const startedAt = input.startedAt ?? finishedAt;
  if (startedAt.getTime() > finishedAt.getTime()) {
    throw new UserTaskCommandError("validation_failed", "acceptance evidence start must not follow finish");
  }
  const definitionId = boundedId("acceptance-check", [input.taskId, context.task.projectId, checkKey], 128);
  const evidenceId = boundedId("acceptance-evidence", [input.commandId], 128);
  const provenance = {
    source: input.source,
    actorType: input.actor.type,
    actorId: input.actor.id,
    commandId: input.commandId,
    ...(evidenceMarkdown ? { evidenceMarkdown } : {}),
  };
  const readiness = evaluateTaskAcceptance({
    policy: context.task.acceptancePolicy,
    results: [...context.results
      .filter((result) => result.definitionProjectId === context.task.projectId), {
      id: evidenceId,
      definitionProjectId: context.task.projectId,
      checkKey,
      status: input.status,
      summary,
      source: input.source,
      finishedAt,
    }],
  });
  const result = {
    taskId: input.taskId,
    evidenceId,
    checkKey,
    status: input.status,
    readiness,
    version: input.expectedVersion + 1,
  };
  const issuedAt = new Date();
  return dependencies.execute({
    command: {
      actor: input.actor,
      commandId: input.commandId,
      correlationId: input.correlationId,
      expectedVersion: input.expectedVersion,
      issuedAt,
      payload: { checkKey, status: input.status },
    },
    taskId: input.taskId,
    eventType: "task.acceptance_evidence_submitted",
    eventPayload: { evidenceId, checkKey, status: input.status, source: input.source },
    activity: {
      id: boundedId("activity", [input.commandId], 128),
      type: "acceptance_evidence_submitted",
      actorType: input.actor.type,
      actorUserId: input.actor.id,
      message: `已提交验收证据：${checkKey}`,
      payload: { evidenceId, checkKey, status: input.status, source: input.source, summary },
    },
    persist: async (tx) => {
      await tx.checkDefinition.upsert({
        where: { id: definitionId },
        create: {
          id: definitionId,
          projectId: context.task.projectId,
          taskId: input.taskId,
          milestoneId: null,
          type: "acceptance",
          name: checkKey,
          required: true,
          configuration: { acceptanceCheckKey: checkKey },
          timeoutSeconds: null,
        },
        update: {
          required: true,
          configuration: { acceptanceCheckKey: checkKey },
        },
      });
      await tx.checkResult.create({
        data: {
          id: evidenceId,
          checkDefinitionId: definitionId,
          taskId: input.taskId,
          agentRunId: null,
          status: input.status,
          summary,
          artifactId: null,
          evidence: provenance,
          startedAt,
          finishedAt,
        },
      });
      const updated = await tx.task.updateMany({
        where: { id: input.taskId, version: input.expectedVersion },
        data: { version: { increment: 1 } },
      });
      return { rows: updated.count, result };
    },
  });
}

export async function recordAutomatedTaskAcceptanceEvidence(
  input: RecordAutomatedTaskAcceptanceEvidenceInput,
  dependencies: Pick<TaskAcceptanceEvidenceDependencies, "loadContext" | "execute"> = defaultDependencies,
) {
  const systemActorId = input.systemActorId.trim();
  const agentRunId = input.agentRunId.trim();
  const checkKey = input.checkKey.trim();
  const summary = input.summary.trim();
  if (
    !systemActorId
    || systemActorId.length > 191
    || !agentRunId
    || agentRunId.length > 96
    || !checkKey
    || checkKey.length > 96
    || !summary
    || summary.length > 2_000
  ) throw new UserTaskCommandError("validation_failed", "automated acceptance evidence is invalid");
  if (JSON.stringify(input.evidence).length > 32_000) {
    throw new UserTaskCommandError("validation_failed", "automated acceptance evidence is too large");
  }
  const context = await dependencies.loadContext({ taskId: input.taskId });
  if (!context) throw new UserTaskCommandError("not_found", "task not found");
  if (!context.task.projectId) {
    throw new UserTaskCommandError("validation_failed", "automated evidence requires a Project Task");
  }
  let requiredChecks: string[];
  try {
    requiredChecks = resolveRequiredAcceptanceChecks(context.task.acceptancePolicy);
  } catch {
    throw new UserTaskCommandError("validation_failed", "Task acceptance policy is invalid");
  }
  if (!requiredChecks.includes(checkKey)) {
    throw new UserTaskCommandError("validation_failed", `acceptance check is not required: ${checkKey}`);
  }
  const finishedAt = input.finishedAt ?? new Date();
  const startedAt = input.startedAt ?? finishedAt;
  if (startedAt.getTime() > finishedAt.getTime()) {
    throw new UserTaskCommandError("validation_failed", "acceptance evidence start must not follow finish");
  }
  const definitionId = boundedId("acceptance-check", [input.taskId, context.task.projectId, checkKey], 128);
  const evidenceId = boundedId("acceptance-evidence", [input.commandId], 128);
  const readiness = evaluateTaskAcceptance({
    policy: context.task.acceptancePolicy,
    results: [...context.results
      .filter((result) => result.definitionProjectId === context.task.projectId), {
      id: evidenceId,
      definitionProjectId: context.task.projectId,
      checkKey,
      status: input.status,
      summary,
      source: "automation",
      finishedAt,
    }],
  });
  const result = {
    taskId: input.taskId,
    evidenceId,
    checkKey,
    status: input.status,
    readiness,
    version: input.expectedVersion + 1,
  };
  const actor = { type: "system" as const, id: systemActorId };
  return dependencies.execute({
    command: {
      actor,
      commandId: input.commandId,
      correlationId: input.correlationId,
      expectedVersion: input.expectedVersion,
      issuedAt: finishedAt,
      payload: { checkKey, status: input.status },
    },
    taskId: input.taskId,
    eventType: "task.acceptance_evidence_recorded",
    eventPayload: { evidenceId, checkKey, status: input.status, source: "automation" },
    activity: {
      id: boundedId("activity", [input.commandId], 128),
      type: "acceptance_evidence_recorded",
      actorType: "system",
      message: `已记录自动验收证据：${checkKey}`,
      payload: { evidenceId, checkKey, status: input.status, source: "automation", summary },
    },
    persist: async (tx) => {
      await tx.checkDefinition.upsert({
        where: { id: definitionId },
        create: {
          id: definitionId,
          projectId: context.task.projectId,
          taskId: input.taskId,
          milestoneId: null,
          type: "acceptance",
          name: checkKey,
          required: true,
          configuration: { acceptanceCheckKey: checkKey },
          timeoutSeconds: null,
        },
        update: { required: true, configuration: { acceptanceCheckKey: checkKey } },
      });
      await tx.checkResult.create({
        data: {
          id: evidenceId,
          checkDefinitionId: definitionId,
          taskId: input.taskId,
          agentRunId,
          status: input.status,
          summary,
          artifactId: null,
          evidence: {
            source: "automation",
            actorType: "system",
            actorId: systemActorId,
            commandId: input.commandId,
            ...input.evidence,
          },
          startedAt,
          finishedAt,
        },
      });
      const updated = await tx.task.updateMany({
        where: { id: input.taskId, version: input.expectedVersion },
        data: { version: { increment: 1 } },
      });
      return { rows: updated.count, result };
    },
  });
}
