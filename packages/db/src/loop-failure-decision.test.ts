import type { LoopFailureEnvelope, LoopNodeResult } from "@humanthread/shared";
import { describe, expect, it } from "vitest";

import { decideLoopFailure, effectiveMaxRetries } from "./loop-failure-decision";

const occurredAt = "2026-08-15T08:00:00.000Z";

function failure(
  code: string,
  categoryHint?: LoopFailureEnvelope["categoryHint"],
): LoopFailureEnvelope {
  return {
    status: "FAILED",
    code,
    ...(categoryHint === undefined ? {} : { categoryHint }),
    summary: code,
    evidence: [],
    retryHint: { recommended: false, reason: "test" },
    occurredAt,
  };
}

function result(
  failureValue: LoopFailureEnvelope,
  effectReceipts: unknown[] = [],
): LoopNodeResult {
  return {
    outcome: "failure",
    output: { errorCode: failureValue.code },
    artifactRefs: [],
    effectReceipts,
    failure: failureValue,
  };
}

describe("loop failure decision", () => {
  it("uses two retries by default and lets the Loop limit override it", () => {
    expect(effectiveMaxRetries({})).toBe(2);
    expect(effectiveMaxRetries({ loopMaxRetries: 4 })).toBe(4);
    expect(effectiveMaxRetries({ loopMaxRetries: 4, nodeMaxRetries: 1 })).toBe(1);
    expect(effectiveMaxRetries({ loopMaxRetries: 1, nodeMaxRetries: 4 })).toBe(1);
  });

  it("retries only an explicit transient failure while budget remains", () => {
    const decision = decideLoopFailure({
      result: result(failure("provider_timeout", "transient_technical")),
      attemptNo: 1,
    });

    expect(decision).toMatchObject({
      disposition: "retry_attempt",
      category: "transient_technical",
      code: "provider_timeout",
      maxRetries: 2,
      nextAttemptNo: 2,
    });
  });

  it("creates the final allowed retry but opens intervention after the budget is exhausted", () => {
    const retry = decideLoopFailure({
      result: result(failure("network_timeout")),
      attemptNo: 2,
      loopMaxRetries: 2,
    });
    const exhausted = decideLoopFailure({
      result: result(failure("network_timeout")),
      attemptNo: 3,
      loopMaxRetries: 2,
    });

    expect(retry).toMatchObject({ disposition: "retry_attempt", nextAttemptNo: 3 });
    expect(exhausted).toMatchObject({ disposition: "open_intervention", reasonCode: "retry_budget_exhausted" });
  });

  it("never retries when a non-repeatable effect receipt exists", () => {
    const decision = decideLoopFailure({
      result: result(failure("provider_protocol_error"), [{ effectKey: "effect_1", status: "succeeded" }]),
      attemptNo: 1,
    });

    expect(decision).toMatchObject({ disposition: "open_intervention", reasonCode: "non_repeatable_effect" });
  });

  it.each([
    ["MOBILE_SOURCE_UNAVAILABLE", "dependency_unavailable"],
    ["WORKSPACE_MISSING", "dependency_unavailable"],
    ["REQUIREMENT_UNCLEAR", "requirement_unclear"],
    ["PERMISSION_DENIED", "permission_or_policy"],
    ["unknown_code", "unknown"],
  ] as const)("opens intervention for %s", (code, category) => {
    const decision = decideLoopFailure({
      result: result(failure(code, category)),
      attemptNo: 1,
    });

    expect(decision).toMatchObject({ disposition: "open_intervention", category, code });
  });

  it("routes deterministic execution failures only through a valid non-self feedback edge", () => {
    const routed = decideLoopFailure({
      result: result(failure("TEST_FAILED", "deterministic_execution")),
      attemptNo: 1,
      feedbackRoute: { edgeId: "edge_rework", targetNodeId: "implement", currentNodeId: "review" },
    });
    const selfRoute = decideLoopFailure({
      result: result(failure("ASSERTION_FAILED", "deterministic_execution")),
      attemptNo: 1,
      feedbackRoute: { edgeId: "edge_self", targetNodeId: "review", currentNodeId: "review" },
    });

    expect(routed).toMatchObject({ disposition: "route_rework", edgeId: "edge_rework", targetNodeId: "implement" });
    expect(selfRoute).toMatchObject({ disposition: "open_intervention", reasonCode: "no_feedback_route" });
  });

  it.each([
    ["BUSINESS_REJECTED", "business_validation"],
    ["cancelled", "cancelled"],
  ] as const)("terminates %s without retry", (code, category) => {
    const decision = decideLoopFailure({ result: result(failure(code, category)), attemptNo: 1 });

    expect(decision).toMatchObject({ disposition: "terminate", category, code });
  });

  it("does not authorize retry from a transient category hint alone", () => {
    const decision = decideLoopFailure({
      result: result(failure("provider_bug", "transient_technical")),
      attemptNo: 1,
    });

    expect(decision).toMatchObject({ disposition: "open_intervention", reasonCode: "unrecognized_failure" });
  });
});
