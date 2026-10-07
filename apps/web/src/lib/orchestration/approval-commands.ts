import type { LoopApprovalDecision } from "./loop-approval-commands";

type ApprovalDecisionInput = {
  approvalId: string;
  actorUserId: string;
  decision: LoopApprovalDecision;
  reason: string;
  selectedEdgeId?: string;
  now: Date;
};

type ApprovalRecord = {
  id: string;
  projectId: string;
  type?: string;
  status: string;
  requestPayload: unknown;
  expiresAt: Date | null;
};

export type ApprovalDecisionResult = {
  approvalId: string;
  status: string;
  [key: string]: unknown;
};

type ApprovalDependencies = {
  load(id: string): Promise<ApprovalRecord | null>;
  authorize(input: { userId: string; projectId: string }): Promise<unknown>;
  updateMany(args: unknown): Promise<{ count: number }>;
  decideLoopApproval?(input: ApprovalDecisionInput): Promise<ApprovalDecisionResult>;
};

export async function decideApproval(
  input: ApprovalDecisionInput,
  dependencies: ApprovalDependencies,
): Promise<ApprovalDecisionResult> {
  const approval = await dependencies.load(input.approvalId);
  if (!approval) throw Object.assign(new Error("Approval not found"), { code: "not_found" });
  if (approval.type === "loop_human_gate" || approval.type === "loop_runtime_safety") {
    if (!dependencies.decideLoopApproval) {
      throw Object.assign(new Error("Loop approval handler is required"), { code: "validation_failed" });
    }
    return dependencies.decideLoopApproval(input);
  }
  if (input.decision === "changes_requested") {
    throw Object.assign(new Error("This approval does not support changes_requested"), { code: "validation_failed" });
  }
  await dependencies.authorize({ userId: input.actorUserId, projectId: approval.projectId });
  if (approval.status === "pending" && approval.expiresAt && approval.expiresAt <= input.now) {
    await dependencies.updateMany({
      where: { id: approval.id, status: "pending" },
      data: { status: "expired", decidedAt: input.now, decisionReason: "审批已过期" },
    });
    throw Object.assign(new Error("Approval already decided or expired"), { code: "version_conflict" });
  }
  if (approval.status !== "pending") {
    throw Object.assign(new Error("Approval already decided or expired"), { code: "version_conflict" });
  }
  if (input.decision === "rejected" && !input.reason.trim()) {
    throw Object.assign(new Error("Rejection reason is required"), { code: "validation_failed" });
  }
  const payload = approval.requestPayload && typeof approval.requestPayload === "object"
    ? approval.requestPayload as Record<string, unknown>
    : {};
  const grant = input.decision === "approved"
    ? {
        approvalId: approval.id,
        actionFingerprint: String(payload.actionFingerprint ?? ""),
        expiresAt: new Date(input.now.getTime() + 3_600_000).toISOString(),
      }
    : null;
  const result = await dependencies.updateMany({
    where: { id: input.approvalId, status: "pending" },
    data: {
      status: input.decision,
      decidedByUserId: input.actorUserId,
      decisionReason: input.reason,
      decidedAt: input.now,
      grantPayload: grant,
    },
  });
  if (result.count !== 1) {
    throw Object.assign(new Error("Approval decision conflict"), { code: "version_conflict" });
  }
  return { approvalId: approval.id, status: input.decision, ...(grant ? { grant } : {}) };
}
