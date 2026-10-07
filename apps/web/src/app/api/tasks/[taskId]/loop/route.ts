import { NextResponse } from "next/server";
import { assertCanDispatchTaskAgent, invalidateLoopRunAgentLeases, prisma } from "@humanthread/db";
import { transitionLoopCommand } from "@/lib/orchestration/loop-commands";
import { triggerTaskLoop } from "@/lib/orchestration/loop-trigger-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { parseLoopExecutionTarget, type LoopExecutionTarget } from "../../../../../lib/orchestration/execution-target";
import { buildActiveApprovalWhere } from "../../../../../lib/orchestration/approval-visibility";

const COMMANDS = new Set(["start", "pause", "resume", "cancel"] as const);

type TaskLoopExecutionTarget = LoopExecutionTarget;

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { taskId } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const command = typeof body.command === "string" ? body.command : "";
    if (!COMMANDS.has(command as "start")) return NextResponse.json({ ok: false, error: "Invalid Loop command" }, { status: 400 });
    if (command === "start") {
      const commandId = typeof body.commandId === "string" && body.commandId.trim().length > 0
        ? body.commandId.trim()
        : `task-loop:${taskId}:start:${Date.now()}`;
      const executionTarget = parseLoopExecutionTarget(body.executionTarget);
      if (!executionTarget) {
        return NextResponse.json({ ok: false, error: "Execution target is required" }, { status: 400 });
      }
      const bindingId = typeof body.bindingId === "string" && body.bindingId.trim().length > 0
        ? body.bindingId.trim()
        : undefined;
      // A task may have an older run waiting on an intervention or holding a
      // live Worker lease. Retrying must supersede it before creating a new
      // run, otherwise both runs can compete for the same task worktree.
      await cancelSupersededTaskLoopRuns({ taskId, now: new Date() });
      const result = await triggerTaskLoopWithBindingRetry({
        actorUserId: actor.userId,
        taskId,
        commandId,
        executionTarget,
        ...(bindingId ? { bindingId } : {}),
      });
      return NextResponse.json({ ok: true, result }, { status: 201 });
    }
    const loop = await prisma.loopRun.findFirst({
      where: { taskId, ...(typeof body.loopRunId === "string" ? { id: body.loopRunId } : {}) },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, version: true, budgetSnapshot: true, usageAggregate: true },
    });
    if (!loop) return NextResponse.json({ ok: false, error: "Loop not found" }, { status: 404 });
    await assertCanDispatchTaskAgent({ userId: actor.userId, taskId });
    const budget = loop.budgetSnapshot && typeof loop.budgetSnapshot === "object" ? loop.budgetSnapshot as Record<string, unknown> : {};
    const usage = loop.usageAggregate && typeof loop.usageAggregate === "object" ? loop.usageAggregate as Record<string, unknown> : {};
    const approvalPending = await prisma.approvalRequest.count({
      where: { loopRunId: loop.id, ...buildActiveApprovalWhere(new Date()) },
    }) > 0;
    const issuedAt = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const transitioned = await transitionLoopCommand({
        command: command as "start" | "pause" | "resume" | "cancel",
        loop,
        budgetRemaining: Number(usage.iterations ?? 0) < Number(budget.maxIterations ?? Number.POSITIVE_INFINITY),
        approvalPending,
      }, {
        persist: (next) => tx.loopRun.updateMany({
          where: { id: loop.id, version: loop.version },
          data: {
            status: next.status,
            version: next.version,
            ...(command === "start" ? { startedAt: issuedAt } : {}),
            ...(command === "cancel" ? { finishedAt: issuedAt, stopReason: "cancelled_by_user" } : {}),
          },
        }),
      });
      if (command === "pause" || command === "cancel") {
        await invalidateLoopRunAgentLeases({ tx, loopRunId: loop.id, reason: command, now: issuedAt });
      }
      return transitioned;
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Loop operation failed";
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const status = message === "Workbench API authentication required" ? 401 : message.includes("access denied") ? 403 : code === "version_conflict" || code === "budget_exhausted" || code === "policy_denied" ? 409 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

const ACTIVE_LOOP_RUN_STATUSES = ["created", "running", "paused", "waiting", "waiting_approval"] as const;

async function cancelSupersededTaskLoopRuns(input: { taskId: string; now: Date }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const runs = await tx.loopRun.findMany({
      where: { taskId: input.taskId, status: { in: [...ACTIVE_LOOP_RUN_STATUSES] } },
      select: { id: true },
    });
    for (const run of runs) {
      await tx.loopRun.updateMany({
        where: { id: run.id, status: { in: [...ACTIVE_LOOP_RUN_STATUSES] } },
        data: { status: "cancelled", finishedAt: input.now, stopReason: "superseded_by_restart", version: { increment: 1 } },
      });
      await invalidateLoopRunAgentLeases({ tx, loopRunId: run.id, reason: "cancel", now: input.now });
    }
  });
}

async function triggerTaskLoopWithBindingRetry(input: {
  actorUserId: string;
  taskId: string;
  commandId: string;
  executionTarget: TaskLoopExecutionTarget;
  bindingId?: string;
}) {
  try {
    return await triggerTaskLoop({ ...input, payload: {} });
  } catch (error) {
    if (!isBindingCreationConflict(error)) throw error;
    return triggerTaskLoop({ ...input, payload: {} });
  }
}

function isBindingCreationConflict(error: unknown): boolean {
  return error instanceof Error
    && error.message === "Loop binding changed before Run creation"
    && "code" in error
    && error.code === "validation_failed";
}
