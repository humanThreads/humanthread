import { describe, expect, it, vi } from "vitest";

import {
  getOrchestrationRollout,
  recordLoopFailureDecision,
  selectRolledOutFailureDecision,
} from "./orchestration-rollout";

const legacy = { disposition: "retry_attempt" as const, reasonCode: "legacy_retry" };
const intervention = {
  disposition: "open_intervention" as const,
  category: "dependency_unavailable",
  code: "MOBILE_SOURCE_UNAVAILABLE",
  reasonCode: "dependency_unavailable",
  attemptNo: 1,
  maxRetries: 2,
};

describe("orchestration failure rollout", () => {
  it("defaults rollout flags off and parses explicit true values", () => {
    expect(getOrchestrationRollout({})).toEqual({
      shadowClassification: false,
      enforceFailureDecision: false,
      enforceMobileSourceIntervention: false,
    });
    expect(getOrchestrationRollout({
      HUMANTHREAD_LOOP_FAILURE_SHADOW: "true",
      HUMANTHREAD_LOOP_FAILURE_ENFORCED: "TRUE",
      HUMANTHREAD_LOOP_MOBILE_SOURCE_INTERVENTION: " true ",
    })).toEqual({
      shadowClassification: true,
      enforceFailureDecision: true,
      enforceMobileSourceIntervention: true,
    });
  });

  it("records the classified decision in shadow mode without applying it", () => {
    expect(selectRolledOutFailureDecision({
      legacyDecision: legacy,
      classifiedDecision: intervention,
      rollout: { shadowClassification: true, enforceFailureDecision: false, enforceMobileSourceIntervention: false },
    })).toEqual({ appliedDecision: legacy, proposedDecision: intervention, shadow: true });
  });

  it("does not enforce mobile source intervention through the broad enforcement flag", () => {
    expect(selectRolledOutFailureDecision({
      legacyDecision: legacy,
      classifiedDecision: intervention,
      rollout: { shadowClassification: true, enforceFailureDecision: true, enforceMobileSourceIntervention: false },
    }).appliedDecision).toBe(legacy);
    expect(selectRolledOutFailureDecision({
      legacyDecision: legacy,
      classifiedDecision: intervention,
      rollout: { shadowClassification: true, enforceFailureDecision: false, enforceMobileSourceIntervention: true },
    }).appliedDecision).toBe(intervention);
  });

  it("logs bounded decision facts without evidence or message bodies", () => {
    const log = vi.fn();
    recordLoopFailureDecision({
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      attemptId: "attempt_1",
      interactionId: "interaction_1",
      commandId: "command_1",
      failureFingerprint: "sha256:failure",
      category: "dependency_unavailable",
      code: "MOBILE_SOURCE_UNAVAILABLE",
      proposedDisposition: "open_intervention",
      appliedDisposition: "retry_attempt",
      duplicateSuppressed: false,
      log,
    });
    expect(log).toHaveBeenCalledWith("loop_failure_decision", expect.objectContaining({
      code: "MOBILE_SOURCE_UNAVAILABLE",
      appliedDisposition: "retry_attempt",
      duplicateSuppressed: false,
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("evidence");
    expect(JSON.stringify(log.mock.calls)).not.toContain("message");
  });
});
