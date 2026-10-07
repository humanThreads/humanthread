import { describe, expect, it } from "vitest";
import { evaluateStagingAcceptance, stagingEvidenceFingerprint } from "./staging-acceptance";

const integrationCommit = "a".repeat(40);
const evidence = (refs: string[], status: "passed" | "failed" | "inconclusive" | "skipped" = "passed") => ({
  status,
  evidenceRefs: refs,
  fingerprint: stagingEvidenceFingerprint({ integrationCommit, evidenceRefs: refs }),
  integrationCommit,
});

const base = {
  integrationCommit,
  tasks: [{
    taskId: "task_1",
    requirements: [{ requirementId: "req_1", status: "passed" as const }],
    affectedTests: evidence(["affected_1"]),
  }],
  fullBusinessTests: evidence(["full_1"]),
  healthCheck: evidence(["health_1"]),
};

describe("staging acceptance", () => {
  it("accepts complete evidence bound to the final integration commit", () => {
    expect(evaluateStagingAcceptance(base)).toMatchObject({ ready: true, blockingReasons: [], evidenceRefs: ["affected_1", "full_1", "health_1"] });
  });

  it.each([
    ["task requirement failed", { tasks: [{ ...base.tasks[0], requirements: [{ requirementId: "req_1", status: "failed" as const }] }] }],
    ["affected tests were not rerun", { tasks: [{ ...base.tasks[0], affectedTests: null }] }],
    ["full business tests failed", { fullBusinessTests: evidence(["full_1"], "failed") }],
    ["health check is inconclusive", { healthCheck: evidence(["health_1"], "inconclusive") }],
  ] as const)("rejects when %s", (_name, change) => {
    expect(evaluateStagingAcceptance({ ...base, ...change } as never)).toMatchObject({ ready: false });
  });

  it("rejects evidence from another integration commit or with a skipped required check", () => {
    expect(evaluateStagingAcceptance({
      ...base,
      tasks: [{ ...base.tasks[0], affectedTests: { ...evidence(["affected_1"]), integrationCommit: "b".repeat(40) } }],
    })).toMatchObject({ ready: false, blockingReasons: ["affected_tests_not_bound_to_integration"] });
    expect(evaluateStagingAcceptance({ ...base, healthCheck: evidence(["health_1"], "skipped") })).toMatchObject({ ready: false });
  });
});
