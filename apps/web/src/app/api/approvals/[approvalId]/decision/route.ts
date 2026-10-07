import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { decideApproval } from "@/lib/orchestration/approval-commands";
import { applyLoopApprovalDecision } from "@/lib/orchestration/loop-approval-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { assertCanWriteProject, prisma } from "@humanthread/db";

export async function POST(request: Request, context: { params: Promise<{ approvalId: string }> }) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const { approvalId } = await context.params;
    if (body.decision !== "approved" && body.decision !== "changes_requested" && body.decision !== "rejected") return NextResponse.json({ ok: false, error: "Invalid approval decision" }, { status: 400 });
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (body.decision !== "approved" && !reason) return NextResponse.json({ ok: false, error: "Approval feedback reason is required" }, { status: 400 });
    const selectedEdgeId = typeof body.selectedEdgeId === "string" ? body.selectedEdgeId.trim() : undefined;
    const actor = await resolveWorkbenchApiActor(request);
    const result = await decideApproval({ approvalId, actorUserId: actor.userId, decision: body.decision, reason, ...(selectedEdgeId === undefined ? {} : { selectedEdgeId }), now: new Date() }, { load: (id) => prisma.approvalRequest.findUnique({ where: { id }, select: { id: true, projectId: true, type: true, status: true, requestPayload: true, expiresAt: true } }), authorize: ({ userId, projectId }) => assertCanWriteProject({ userId, projectId }), updateMany: (args) => prisma.approvalRequest.updateMany(args as Prisma.ApprovalRequestUpdateManyArgs), decideLoopApproval: (decision) => applyLoopApprovalDecision(decision) });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Approval failed";
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    return NextResponse.json({ ok: false, error: message }, { status: code === "version_conflict" ? 409 : code === "not_found" ? 404 : message.includes("access denied") ? 403 : 400 });
  }
}
