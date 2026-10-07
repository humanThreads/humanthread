import { createHash } from "node:crypto";
import {
  assertCanDispatchTaskAgent,
  assertCanWriteProject,
  executeIdempotentCommand,
  invalidateLoopRunAgentLeases,
  prisma,
  type OrchestrationEventsTx,
} from "@humanthread/db";
import type {
  DesktopApprovalDecisionRequest,
  DesktopLoopCommandRequest,
} from "@humanthread/workbench-client";
import type { OrchestrationCommand } from "@humanthread/shared";

import { buildActiveApprovalWhere } from "../orchestration/approval-visibility";
import { decideApproval } from "../orchestration/approval-commands";
import { transitionLoopCommand } from "../orchestration/loop-commands";
import { resolveDesktopReadContext } from "./desktop-read-models";

type AgentMutationResult = {
  resourceType: "approval" | "loop";
  id: string;
  status: string;
  version?: number;
};

type ApprovalRecord = {
  id: string;
  projectId: string;
  status: string;
  requestPayload: unknown;
  expiresAt: Date | null;
};

type LoopRecord = {
  id: string;
  status: string;
  version: number;
  budgetSnapshot: unknown;
  usageAggregate: unknown;
};

type AgentCommandTx = OrchestrationEventsTx & {
  approvalRequest: {
    findUnique(input: unknown): Promise<ApprovalRecord | null>;
    updateMany(input: unknown): Promise<{ count: number }>;
    count(input: unknown): Promise<number>;
  };
  loopRun: {
    findUnique(input: unknown): Promise<LoopRecord | null>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  agentRun: {
    findMany(input: unknown): Promise<Array<{ id: string; workerId: string | null; leaseGeneration: number }>>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  agentWorker: { updateMany(input: unknown): Promise<{ count: number }> };
};

type AgentCommandDb = {
  $transaction<T>(callback: (tx: AgentCommandTx) => Promise<T>): Promise<T>;
};

function receiptId(resourceType: "approval" | "loop", resourceId: string, commandId: string) {
  const digest = createHash("sha256")
    .update(`${resourceType}\0${resourceId}\0${commandId}`)
    .digest("hex");
  return `${resourceType}:${digest}`;
}

function command<T>(input: {
  resourceType: "approval" | "loop";
  resourceId: string;
  commandId: string;
  actorUserId: string;
  expectedVersion?: number;
  payload: T;
  issuedAt: Date;
}): OrchestrationCommand<T> {
  return {
    commandId: receiptId(input.resourceType, input.resourceId, input.commandId),
    correlationId: `${input.resourceType}:${input.resourceId}`,
    actor: { type: "user", id: input.actorUserId },
    ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
    payload: input.payload,
    issuedAt: input.issuedAt,
  };
}

export async function runDesktopApprovalCommand(input: DesktopApprovalDecisionRequest & {
  approvalId: string;
  actorUserId: string;
  db?: AgentCommandDb;
  now?: Date;
}): Promise<AgentMutationResult> {
  const db = input.db ?? (prisma as unknown as AgentCommandDb);
  const issuedAt = input.now ?? new Date();
  return executeIdempotentCommand({
    command: command({
      resourceType: "approval",
      resourceId: input.approvalId,
      commandId: input.commandId,
      actorUserId: input.actorUserId,
      payload: { decision: input.decision },
      issuedAt,
    }),
    aggregate: { type: "approval", id: input.approvalId },
    db,
    apply: async (tx) => {
      const result = await decideApproval({
        approvalId: input.approvalId,
        actorUserId: input.actorUserId,
        decision: input.decision,
        reason: input.reason,
        now: issuedAt,
      }, {
        load: (id) => tx.approvalRequest.findUnique({
          where: { id },
          select: { id: true, projectId: true, status: true, requestPayload: true, expiresAt: true },
        }),
        authorize: async () => undefined,
        updateMany: (args) => tx.approvalRequest.updateMany(args),
      });
      return {
        result: {
          resourceType: "approval" as const,
          id: result.approvalId,
          status: result.status,
        },
        events: [],
        // decideApproval already performs its conditional write on this transaction.
        persist: async () => 1,
      };
    },
  });
}

export async function runDesktopLoopCommand(input: DesktopLoopCommandRequest & {
  loopRunId: string;
  actorUserId: string;
  db?: AgentCommandDb;
  now?: Date;
}): Promise<AgentMutationResult> {
  const db = input.db ?? (prisma as unknown as AgentCommandDb);
  const issuedAt = input.now ?? new Date();
  return executeIdempotentCommand({
    command: command({
      resourceType: "loop",
      resourceId: input.loopRunId,
      commandId: input.commandId,
      actorUserId: input.actorUserId,
      expectedVersion: input.expectedVersion,
      payload: { command: input.command },
      issuedAt,
    }),
    aggregate: { type: "loop", id: input.loopRunId },
    db,
    apply: async (tx) => {
      const loop = await tx.loopRun.findUnique({
        where: { id: input.loopRunId },
        select: { id: true, status: true, version: true, budgetSnapshot: true, usageAggregate: true },
      });
      if (!loop) throw Object.assign(new Error("Loop not found"), { code: "not_found" });
      if (loop.version !== input.expectedVersion) {
        throw Object.assign(new Error("Loop version conflict"), { code: "version_conflict" });
      }
      const budget = loop.budgetSnapshot && typeof loop.budgetSnapshot === "object"
        ? loop.budgetSnapshot as Record<string, unknown>
        : {};
      const usage = loop.usageAggregate && typeof loop.usageAggregate === "object"
        ? loop.usageAggregate as Record<string, unknown>
        : {};
      const approvalPending = await tx.approvalRequest.count({
        where: { loopRunId: loop.id, ...buildActiveApprovalWhere(issuedAt) },
      }) > 0;
      const result = await transitionLoopCommand({
        command: input.command,
        loop,
        budgetRemaining: Number(usage.iterations ?? 0) < Number(
          budget.maxIterations ?? Number.POSITIVE_INFINITY,
        ),
        approvalPending,
      }, {
        persist: (next) => tx.loopRun.updateMany({
          where: { id: loop.id, version: loop.version },
          data: {
            status: next.status,
            version: next.version,
            ...(input.command === "start" ? { startedAt: issuedAt } : {}),
            ...(input.command === "cancel" ? {
              finishedAt: issuedAt,
              stopReason: "cancelled_by_user",
            } : {}),
          },
        }),
      });
      if (input.command === "pause" || input.command === "cancel") {
        await invalidateLoopRunAgentLeases({
          tx: tx as never,
          loopRunId: loop.id,
          reason: input.command,
          now: issuedAt,
        });
      }
      return {
        result: {
          resourceType: "loop" as const,
          id: result.id,
          status: result.status,
          version: result.version,
        },
        events: [],
        // transitionLoopCommand already performs its conditional write on this transaction.
        persist: async () => 1,
      };
    },
  });
}

interface DesktopAgentCommandDependencies {
  resolveDesktopReadContext: typeof resolveDesktopReadContext;
  findApprovalScope(approvalId: string): Promise<{ projectId: string; spaceId: string } | null>;
  findLoopScope(loopRunId: string): Promise<{ taskId: string; spaceId: string } | null>;
  assertCanWriteProject: typeof assertCanWriteProject;
  assertCanDispatchTaskAgent: typeof assertCanDispatchTaskAgent;
  runApprovalCommand: typeof runDesktopApprovalCommand;
  runLoopCommand: typeof runDesktopLoopCommand;
}

export function toTaskLoopScope(value: {
  taskId: string | null;
  task: { spaceId: string | null } | null;
} | null): { taskId: string; spaceId: string } | null {
  if (!value?.taskId || !value.task?.spaceId) return null;
  return { taskId: value.taskId, spaceId: value.task.spaceId };
}

const DEFAULT_DEPENDENCIES: DesktopAgentCommandDependencies = {
  resolveDesktopReadContext,
  findApprovalScope: (approvalId) => prisma.approvalRequest.findUnique({
    where: { id: approvalId },
    select: { projectId: true, project: { select: { spaceId: true } } },
  }).then((value) => value?.project.spaceId
    ? { projectId: value.projectId, spaceId: value.project.spaceId }
    : null),
  findLoopScope: (loopRunId) => prisma.loopRun.findUnique({
    where: { id: loopRunId },
    select: { taskId: true, task: { select: { spaceId: true } } },
  }).then(toTaskLoopScope),
  assertCanWriteProject: (input) => assertCanWriteProject(input),
  assertCanDispatchTaskAgent: (input) => assertCanDispatchTaskAgent(input),
  runApprovalCommand: runDesktopApprovalCommand,
  runLoopCommand: runDesktopLoopCommand,
};

function dependenciesWith(overrides: Partial<DesktopAgentCommandDependencies>) {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

export async function decideDesktopApproval(
  request: Request,
  approvalId: string,
  input: DesktopApprovalDecisionRequest,
  dependencyOverrides: Partial<DesktopAgentCommandDependencies> = {},
) {
  const dependencies = dependenciesWith(dependencyOverrides);
  const context = await dependencies.resolveDesktopReadContext(request);
  const scope = await dependencies.findApprovalScope(approvalId);
  if (!scope || scope.spaceId !== context.space.id) throw new Error("Approval not found");
  await dependencies.assertCanWriteProject({ userId: context.actor.userId, projectId: scope.projectId });
  return dependencies.runApprovalCommand({
    ...input,
    approvalId,
    actorUserId: context.actor.userId,
  });
}

export async function commandDesktopLoop(
  request: Request,
  loopRunId: string,
  input: DesktopLoopCommandRequest,
  dependencyOverrides: Partial<DesktopAgentCommandDependencies> = {},
) {
  const dependencies = dependenciesWith(dependencyOverrides);
  const context = await dependencies.resolveDesktopReadContext(request);
  const scope = await dependencies.findLoopScope(loopRunId);
  if (!scope || scope.spaceId !== context.space.id) throw new Error("Loop not found");
  await dependencies.assertCanDispatchTaskAgent({ userId: context.actor.userId, taskId: scope.taskId });
  return dependencies.runLoopCommand({
    ...input,
    loopRunId,
    actorUserId: context.actor.userId,
  });
}
