import { describe, expect, it } from "vitest";
import {
  evaluateAcceptance,
  evaluateTaskAcceptance,
  resolveRequiredAcceptanceChecks,
} from "./acceptance";

describe("evaluateAcceptance", () => {
  it("requires every required check and ignores optional failures", () => {
    expect(evaluateAcceptance({ definitions: [{ id: "test", required: true }, { id: "lint", required: false }], results: [{ definitionId: "test", status: "passed" }, { definitionId: "lint", status: "failed" }], candidate: { summary: "done" } })).toEqual({ status: "pass", evidenceGaps: [] });
    expect(evaluateAcceptance({ definitions: [{ id: "test", required: true }], results: [], candidate: { summary: "done" } })).toEqual({ status: "inconclusive", evidenceGaps: ["test"] });
  });

  it("normalizes required checks and falls back to delivery for legacy policies", () => {
    expect(resolveRequiredAcceptanceChecks(null)).toEqual(["delivery"]);
    expect(resolveRequiredAcceptanceChecks({ requiredChecks: [] })).toEqual(["delivery"]);
    expect(resolveRequiredAcceptanceChecks({ requiredChecks: [" test ", "lint", "test"] })).toEqual([
      "test",
      "lint",
    ]);
    expect(() => resolveRequiredAcceptanceChecks({ requiredChecks: ["x".repeat(97)] }))
      .toThrowError(/invalid acceptance policy/u);
  });

  it("blocks readiness when any configured required check is malformed", () => {
    expect(evaluateTaskAcceptance({
      policy: { requiredChecks: ["test", "x".repeat(97)] },
      results: [{
        id: "evidence_test",
        checkKey: "test",
        status: "passed",
        summary: "Tests passed",
        source: "mcp",
        finishedAt: "2026-08-01T09:00:00.000Z",
      }],
    })).toMatchObject({
      ready: false,
      requiredChecks: ["test"],
      policyErrors: ["requiredChecks[1] is invalid"],
    });
  });

  it.each([
    { policy: [], error: "acceptance policy must be an object" },
    { policy: "security", error: "acceptance policy must be an object" },
    { policy: { requiredChecks: "security" }, error: "requiredChecks must be an array" },
  ])("blocks malformed policy containers: $error", ({ policy, error }) => {
    expect(evaluateTaskAcceptance({
      policy,
      results: [{
        id: "evidence_delivery",
        checkKey: "delivery",
        status: "passed",
        summary: "Delivery passed",
        source: "mcp",
        finishedAt: "2026-08-01T09:00:00.000Z",
      }],
    })).toMatchObject({ ready: false, policyErrors: [error] });
  });

  it("requires the latest evidence for every required check to pass", () => {
    expect(evaluateTaskAcceptance({
      policy: { requiredChecks: ["test", "lint"] },
      results: [
        {
          id: "evidence_test_old",
          checkKey: "test",
          status: "failed",
          summary: "Old failure",
          source: "automation",
          finishedAt: "2026-08-01T08:00:00.000Z",
        },
        {
          id: "evidence_test_new",
          checkKey: "test",
          status: "passed",
          summary: "Tests passed",
          source: "mcp",
          finishedAt: "2026-08-01T09:00:00.000Z",
        },
      ],
    })).toEqual({
      ready: false,
      requiredChecks: ["test", "lint"],
      missingChecks: ["lint"],
      blockingChecks: [],
      policyErrors: [],
      latestEvidence: [{
        id: "evidence_test_new",
        checkKey: "test",
        status: "passed",
        summary: "Tests passed",
        source: "mcp",
        finishedAt: "2026-08-01T09:00:00.000Z",
      }],
    });
  });

  it.each(["failed", "inconclusive", "skipped"] as const)(
    "keeps %s required evidence blocking",
    (status) => {
      expect(evaluateTaskAcceptance({
        policy: null,
        results: [{
          id: `evidence_${status}`,
          checkKey: "delivery",
          status,
          summary: `Delivery ${status}`,
          source: "user",
          finishedAt: "2026-08-01T09:00:00.000Z",
        }],
      })).toMatchObject({
        ready: false,
        requiredChecks: ["delivery"],
        missingChecks: [],
        blockingChecks: ["delivery"],
      });
    },
  );

  it("uses the evidence id as a deterministic tie breaker", () => {
    const readiness = evaluateTaskAcceptance({
      policy: null,
      results: [
        {
          id: "evidence_a",
          checkKey: "delivery",
          status: "failed",
          summary: "Failed",
          source: "automation",
          finishedAt: "2026-08-01T09:00:00.000Z",
        },
        {
          id: "evidence_b",
          checkKey: "delivery",
          status: "passed",
          summary: "Passed",
          source: "user",
          finishedAt: "2026-08-01T09:00:00.000Z",
        },
      ],
    });

    expect(readiness).toMatchObject({ ready: true, missingChecks: [], blockingChecks: [] });
    expect(readiness.latestEvidence[0]?.id).toBe("evidence_b");
  });
});
