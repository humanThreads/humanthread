import { NextResponse } from "next/server";
import { assertCanDispatchTaskAgent, prisma, retryFailedChildLoop } from "@humanthread/db";
import { loopApiError } from "../../../../lib/orchestration/loop-definition-contracts";
import { readLoopRunProjection } from "@/lib/orchestration/loop-read-model";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

type Context = { params: Promise<{ loopRunId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const [{ loopRunId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const result = await readLoopRunProjection({ userId: actor.userId, loopRunId });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const [{ loopRunId }, actor, body] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
      request.json() as Promise<Record<string, unknown>>,
    ]);
    if (body.command !== "retry_child") {
      return NextResponse.json({ ok: false, code: "validation_failed", error: "Invalid Loop command" }, { status: 400 });
    }
    const commandId = typeof body.commandId === "string" ? body.commandId.trim() : "";
    const targetNodeId = typeof body.targetNodeId === "string" ? body.targetNodeId.trim() : "";
    if (!commandId) {
      return NextResponse.json({ ok: false, code: "validation_failed", error: "Loop command id is required" }, { status: 400 });
    }
    const child = await prisma.loopRun.findUnique({
      where: { id: loopRunId },
      select: { id: true, taskId: true, parentLoopRunId: true },
    });
    if (!child?.taskId || !child.parentLoopRunId) {
      return NextResponse.json({ ok: false, code: "not_found", error: "Child LoopRun not found" }, { status: 404 });
    }
    await assertCanDispatchTaskAgent({ userId: actor.userId, taskId: child.taskId });
    const occurredAt = new Date();
    const result = await retryFailedChildLoop({
      childLoopRunId: child.id,
      commandId,
      ...(targetNodeId ? { targetNodeId } : {}),
      occurredAt,
      correlationId: `loop:${child.parentLoopRunId}`,
      actor: { type: "user", id: actor.userId },
    });
    return NextResponse.json({ ok: true, result }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
