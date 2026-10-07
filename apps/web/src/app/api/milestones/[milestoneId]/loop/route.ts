import { NextResponse } from "next/server";
import { prisma } from "@humanthread/db";
import { triggerTaskLoop } from "@/lib/orchestration/loop-trigger-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { parseLoopExecutionTarget } from "../../../../../lib/orchestration/execution-target";
import { triggerMilestoneTaskLoops } from "../../../../../lib/orchestration/milestone-batch-loop";

export async function POST(request: Request, context: { params: Promise<{ milestoneId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { milestoneId } = await context.params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const commandId = typeof body.commandId === "string" && body.commandId.trim() ? body.commandId.trim() : `milestone-loop:${milestoneId}:${Date.now()}`;
    const executionTarget = parseLoopExecutionTarget(body.executionTarget);
    if (!executionTarget) {
      return NextResponse.json({ ok: false, error: "请选择执行目标" }, { status: 400 });
    }
    const milestone = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      select: {
        id: true, projectId: true, version: true,
        tasks: { select: { id: true, statusCategory: true, archivedAt: true, projectId: true } },
      },
    });
    if (!milestone) return NextResponse.json({ ok: false, error: "里程碑不存在" }, { status: 404 });
    const binding = await prisma.projectLoopBinding.findFirst({
      where: { projectId: milestone.projectId, bindingRole: "task_development", status: "enabled", loopDefinition: { scope: "project" } },
      select: { id: true },
    });
    const summary = await triggerMilestoneTaskLoops({
      milestoneId,
      commandId,
      tasks: milestone.tasks.map((task) => ({ ...task, hasLoopBinding: Boolean(binding) })),
      trigger: async ({ taskId, commandId: taskCommandId, source }) => triggerTaskLoop({
        actorUserId: actor.userId, taskId, commandId: taskCommandId, executionTarget, payload: { source, milestoneId },
      }),
    });
    return NextResponse.json({ ok: true, result: summary }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "里程碑 Loop 启动失败";
    const status = message === "Workbench API authentication required" ? 401 : message.includes("access denied") ? 403 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
