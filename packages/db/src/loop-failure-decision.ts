import type {
  FailureCategory,
  LoopFailureEnvelope,
  LoopNodeResult,
} from "@humanthread/shared";

export type FailureDisposition = "retry_attempt" | "route_rework" | "open_intervention" | "terminate";

type FailureDecisionBase<D extends FailureDisposition = FailureDisposition> = {
  disposition: D;
  category: FailureCategory;
  code: string;
  reasonCode: string;
  attemptNo: number;
  maxRetries: number;
};

export type FailureDecision =
  | (FailureDecisionBase<"retry_attempt"> & {
      disposition: "retry_attempt";
      nextAttemptNo: number;
      retryAfterMs?: number;
    })
  | (FailureDecisionBase<"route_rework"> & {
      disposition: "route_rework";
      edgeId: string;
      targetNodeId: string;
    })
  | FailureDecisionBase<"open_intervention" | "terminate">;

export type FailureFeedbackRoute = {
  edgeId: string;
  targetNodeId: string;
  currentNodeId: string;
};

export type DecideLoopFailureInput = {
  result: Pick<LoopNodeResult, "output" | "effectReceipts" | "failure" | "outcome">;
  attemptNo: number;
  loopMaxRetries?: number;
  nodeMaxRetries?: number;
  feedbackRoute?: FailureFeedbackRoute | null;
  failure?: LoopFailureEnvelope;
};

const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRIES = 20;

const TRANSIENT_FAILURE_CODES = new Set([
  "provider_protocol_error",
  "provider_timeout",
  "timeout",
  "network_timeout",
  "network_unavailable",
  "service_unavailable",
  "rate_limited",
  "connection_reset",
]);

const DEPENDENCY_CODES = new Set([
  "MOBILE_SOURCE_UNAVAILABLE",
  "WORKSPACE_MISSING",
  "DEVICE_UNAVAILABLE",
  "CREDENTIAL_MISSING",
  "MISSING_DEPENDENCY",
]);

function retryLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_RETRIES;
  if (!Number.isInteger(value)) return 0;
  return Math.max(0, Math.min(MAX_RETRIES, value));
}

export function effectiveMaxRetries(input: {
  loopMaxRetries?: number;
  nodeMaxRetries?: number;
}): number {
  const loopLimit = retryLimit(input.loopMaxRetries);
  return input.nodeMaxRetries === undefined
    ? loopLimit
    : Math.min(loopLimit, retryLimit(input.nodeMaxRetries));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function failureCode(input: DecideLoopFailureInput, failure: LoopFailureEnvelope | undefined): string {
  if (failure?.code) return failure.code;
  const output = asRecord(input.result.output);
  const candidate = output?.errorCode ?? output?.issueType;
  return typeof candidate === "string" && candidate.trim() ? candidate : "unknown_failure";
}

function inferredCategory(code: string): FailureCategory {
  const upper = code.toUpperCase();
  const lower = code.toLowerCase();
  if (DEPENDENCY_CODES.has(upper) || /missing_(?:source|dependency)|source_unavailable/u.test(upper)) {
    return "dependency_unavailable";
  }
  if (/clarif|unclear|ambiguous|question/u.test(lower)) return "requirement_unclear";
  if (/permission|policy|forbidden|unauthori[sz]ed|access_denied/u.test(lower)) return "permission_or_policy";
  if (/cancel/u.test(lower)) return "cancelled";
  if (/business|reject|rejected/u.test(lower)) return "business_validation";
  if (/test|assert|parse|validation|deterministic/u.test(lower)) return "deterministic_execution";
  if (TRANSIENT_FAILURE_CODES.has(lower)) return "transient_technical";
  return "unknown";
}

function hasNonRepeatableEffectReceipt(receipts: readonly unknown[]): boolean {
  return receipts.some((receipt) => {
    const record = asRecord(receipt);
    if (!record) return true;
    return record.status !== "failed";
  });
}

function baseDecision<D extends FailureDisposition>(
  disposition: D,
  category: FailureCategory,
  code: string,
  reasonCode: string,
  attemptNo: number,
  maxRetries: number,
): FailureDecisionBase<D> {
  return { disposition, category, code, reasonCode, attemptNo, maxRetries };
}

export function decideLoopFailure(input: DecideLoopFailureInput): FailureDecision {
  const failure = input.failure ?? input.result.failure;
  const code = failureCode(input, failure);
  const category = failure?.categoryHint ?? inferredCategory(code);
  const maxRetries = effectiveMaxRetries({
    ...(input.loopMaxRetries === undefined ? {} : { loopMaxRetries: input.loopMaxRetries }),
    ...(input.nodeMaxRetries === undefined ? {} : { nodeMaxRetries: input.nodeMaxRetries }),
  });
  const attemptNo = Number.isInteger(input.attemptNo) && input.attemptNo > 0 ? input.attemptNo : 1;

  if (category === "transient_technical" && TRANSIENT_FAILURE_CODES.has(code.toLowerCase())) {
    if (hasNonRepeatableEffectReceipt(input.result.effectReceipts)) {
      return baseDecision("open_intervention", category, code, "non_repeatable_effect", attemptNo, maxRetries);
    }
    if (attemptNo <= maxRetries) {
      const retryAfterMs = failure?.retryHint?.retryAfterMs;
      return {
        ...baseDecision("retry_attempt", category, code, "transient_failure", attemptNo, maxRetries),
        nextAttemptNo: attemptNo + 1,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      };
    }
    return baseDecision("open_intervention", category, code, "retry_budget_exhausted", attemptNo, maxRetries);
  }

  if (category === "deterministic_execution") {
    const route = input.feedbackRoute;
    if (route && route.targetNodeId !== route.currentNodeId && route.edgeId.trim() && route.targetNodeId.trim()) {
      return {
        ...baseDecision("route_rework", category, code, "deterministic_failure_feedback", attemptNo, maxRetries),
        edgeId: route.edgeId,
        targetNodeId: route.targetNodeId,
      };
    }
    return baseDecision("open_intervention", category, code, "no_feedback_route", attemptNo, maxRetries);
  }

  if (category === "business_validation") {
    return baseDecision("terminate", category, code, "business_rejected", attemptNo, maxRetries);
  }
  if (category === "cancelled") {
    return baseDecision("terminate", category, code, "cancelled", attemptNo, maxRetries);
  }
  if (category === "dependency_unavailable") {
    return baseDecision("open_intervention", category, code, "dependency_unavailable", attemptNo, maxRetries);
  }
  if (category === "requirement_unclear") {
    return baseDecision("open_intervention", category, code, "requirement_unclear", attemptNo, maxRetries);
  }
  if (category === "permission_or_policy") {
    return baseDecision("open_intervention", category, code, "permission_or_policy", attemptNo, maxRetries);
  }
  return baseDecision("open_intervention", category, code, "unrecognized_failure", attemptNo, maxRetries);
}
