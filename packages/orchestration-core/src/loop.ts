export type LoopDecision = { type: "complete" | "revise" | "resume" | "wait_approval" | "pause" | "exhaust" | "fail"; reason: string };

export function decideLoop(input: { evaluation?: "pass" | "fail" | "inconclusive"; retryable?: boolean; budgetRemaining?: boolean; checkpointAvailable?: boolean; runStatus?: string; approvalPending?: boolean; paused?: boolean }): LoopDecision {
  if (input.paused) return { type: "pause", reason: "user_paused" };
  if (input.approvalPending) return { type: "wait_approval", reason: "approval_pending" };
  if (input.budgetRemaining === false) return { type: "exhaust", reason: "budget_exhausted" };
  if (input.evaluation === "pass") return { type: "complete", reason: "acceptance_passed" };
  if (input.runStatus === "orphaned" && input.checkpointAvailable) return { type: "resume", reason: "checkpoint_available" };
  if (input.evaluation === "fail" && input.retryable && input.budgetRemaining) return { type: "revise", reason: "retryable_failure" };
  if (input.evaluation === "inconclusive") return { type: "pause", reason: "evidence_inconclusive" };
  return { type: "fail", reason: "continuation_denied" };
}
