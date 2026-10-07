import { NextResponse } from "next/server";
import { assertCanDispatchTaskAgent, assertCanWriteProject, handleReleasePlanLoopEvent, invalidateLoopRunAgentLeases, prisma, restartLoopRunFromNode } from "@humanthread/db";
import { transitionLoopCommand } from "@/lib/orchestration/loop-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { buildActiveApprovalWhere } from "../../../../../lib/orchestration/approval-visibility";

const COMMANDS = new Set(["start", "pause", "resume", "cancel", "restart_from_node"] as const);

export async function POST(request: Request, context: { params: Promise<{ loopRunId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { loopRunId } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const command = typeof body.command === "string" ? body.command : "";
    if (!COMMANDS.has(command as "start")) return NextResponse.json({ ok: false, error: "Invalid Loop command" }, { status: 400 });
    const loop = await prisma.loopRun.findUnique({
      where: { id: loopRunId },
      select: { id: true, projectId: true, taskId: true, status: true, version: true, budgetSnapshot: true, usageAggregate: true },
    });
    if (!loop) return NextResponse.json({ ok: false, error: "Loop not found" }, { status: 404 });
    if (!loop.projectId) return NextResponse.json({ ok: false, error: "Loop Project is unavailable" }, { status: 400 });
    if (loop.taskId) await assertCanDispatchTaskAgent({ userId: actor.userId, taskId: loop.taskId });
    else await assertCanWriteProject({ userId: actor.userId, projectId: loop.projectId });

    if (command === "restart_from_node") {
      const targetNodeKey = typeof body.targetNodeKey === "string" ? body.targetNodeKey.trim() : "";
      if (!targetNodeKey) return NextResponse.json({ ok: false, error: "请选择要重跑的节点" }, { status: 400 });
      const commandId = typeof body.commandId === "string" && body.commandId.trim()
        ? body.commandId.trim()
        : `loop-restart:${loopRunId}:${Date.now()}`;
      const result = await restartLoopRunFromNode({
        loopRunId,
        targetNodeKey,
        reason: typeof body.reason === "string" ? body.reason : "",
        actorUserId: actor.userId,
        commandId,
        occurredAt: new Date(),
      });
      return NextResponse.json({ ok: true, result });
    }

    const budget = loop.budgetSnapshot && typeof loop.budgetSnapshot === "object" ? loop.budgetSnapshot as Record<string, unknown> : {};
    const usage = loop.usageAggregate && typeof loop.usageAggregate === "object" ? loop.usageAggregate as Record<string, unknown> : {};
    const approvalPending = await prisma.approvalRequest.count({ where: { loopRunId: loop.id, ...buildActiveApprovalWhere(new Date()) } }) > 0;
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
    if (command === "cancel") await handleReleasePlanLoopEvent({ loopRunId: loop.id });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Loop operation failed";
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const status = message === "Workbench API authentication required" ? 401 : message.includes("access denied") ? 403 : code === "version_conflict" || code === "budget_exhausted" || code === "policy_denied" ? 409 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
