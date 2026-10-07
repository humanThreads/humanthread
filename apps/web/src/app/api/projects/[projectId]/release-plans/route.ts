import { NextResponse } from "next/server";
import { z } from "zod";
import { assertCanReadProject, attachReleasePlanLoopRun, createReleasePlan, copyReleasePlan, failReleasePlan, handleReleasePlanLoopEvent, listReleasePlans, prepareReleasePlan, prisma, releasePlanReference, retryReleasePlan } from "@humanthread/db";
import { triggerProjectLoop } from "@/lib/orchestration/loop-trigger-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

const commandId = z.string().trim().min(1).max(96);
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), commandId, name: z.string().trim().min(1).max(191), taskIds: z.array(z.string().trim().min(1)).min(1) }).strict(),
  z.object({ action: z.literal("start"), commandId, planId: z.string().trim().min(1).max(96) }).strict(),
  z.object({ action: z.literal("copy"), commandId, planId: z.string().trim().min(1).max(96), name: z.string().trim().max(191).optional() }).strict(),
  z.object({ action: z.literal("retry"), commandId, planId: z.string().trim().min(1).max(96), name: z.string().trim().max(191).optional() }).strict(),
]);

function errorResponse(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "internal_error";
  const message = error instanceof Error ? error.message : "Release plan request failed";
  const status = code === "not_found" ? 404 : code === "validation_failed" ? 400 : message.includes("access denied") ? 403 : 500;
  return NextResponse.json({ ok: false, code, error: message }, { status });
}

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const actor = await resolveWorkbenchApiActor(_request);
    await assertCanReadProject({ userId: actor.userId, projectId });
    return NextResponse.json({ ok: true, plans: await listReleasePlans(projectId) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const actor = await resolveWorkbenchApiActor(request);
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ ok: false, code: "validation_failed", error: "Invalid release plan command" }, { status: 400 });
    if (parsed.data.action === "create") return NextResponse.json({ ok: true, plan: await createReleasePlan({ actorUserId: actor.userId, projectId, ...parsed.data }) });
    if (parsed.data.action === "copy") return NextResponse.json({ ok: true, plan: await copyReleasePlan({ actorUserId: actor.userId, projectId, planId: parsed.data.planId, commandId: parsed.data.commandId, ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }) }) });
    if (parsed.data.action === "retry") return NextResponse.json({ ok: true, plan: await retryReleasePlan({ actorUserId: actor.userId, projectId, planId: parsed.data.planId, commandId: parsed.data.commandId, ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }) }) });
    const plan = await prisma.releasePlan.findFirst({ where: { id: parsed.data.planId, projectId: releasePlanReference("project", projectId) }, select: { id: true, name: true, selectedSnapshot: true } });
    if (!plan) throw Object.assign(new Error("Release plan not found"), { code: "not_found" });
    const binding = await prisma.projectLoopBinding.findFirst({ where: { projectId, bindingRole: "milestone_release", status: "enabled" }, select: { id: true } });
    if (!binding) throw Object.assign(new Error("Project release Loop is not configured"), { code: "validation_failed" });
    await prepareReleasePlan({ actorUserId: actor.userId, projectId, planId: plan.id });
    let run: Awaited<ReturnType<typeof triggerProjectLoop>> | null = null;
    try {
      run = await triggerProjectLoop({ actorUserId: actor.userId, projectId, bindingId: binding.id, commandId: parsed.data.commandId, payload: { releasePlanId: plan.id, releasePlanName: plan.name, selectedTasks: plan.selectedSnapshot } });
      await attachReleasePlanLoopRun({ actorUserId: actor.userId, projectId, planId: plan.id, loopRunId: run.id });
      // The worker may finish a very short release Loop before the association
      // is written. Reconcile once after linking so that completion is never
      // lost to that intentional two-command boundary.
      await handleReleasePlanLoopEvent({ loopRunId: run.id });
    } catch (error) {
      // A run can be created before linking it to the plan. If linking or the
      // post-link reconciliation fails, leave durable failure evidence instead
      // of an indefinitely running plan that no worker event can find.
      await failReleasePlan({ planId: plan.id, reason: error instanceof Error ? error.message : "Release Loop could not be started" });
      throw error;
    }
    const updated = await prisma.releasePlan.findUnique({ where: { id: plan.id } });
    return NextResponse.json({ ok: true, plan: updated, loopRunId: run.id });
  } catch (error) { return errorResponse(error); }
}
