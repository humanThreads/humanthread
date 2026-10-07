import { describe, expect, it } from "vitest";

import { evaluateTaskDevelopmentEvidence } from "./task-development-evidence";

const commitA = "a".repeat(40);
const commitB = "b".repeat(40);

function validEvidence() {
  return {
    taskId: "task_1",
    branch: "2026-HT100023",
    requiredRequirementIds: ["requirement_login"],
    requiredCheckNames: ["unit-tests", "typecheck"],
    knowledgeRefs: [{ path: "docs/knowledge/login.md", commit: commitA }],
    pushReceipt: {
      status: "succeeded" as const,
      branch: "2026-HT100023",
      remoteHeadCommit: commitA,
    },
    report: {
      taskId: "task_1",
      branch: "2026-HT100023",
      commit: commitA,
      status: "passed" as const,
      requirements: [{
        requirementId: "requirement_login",
        status: "passed" as const,
        evidenceRefs: ["artifact_requirement_login"],
      }],
      checks: [
        { name: "unit-tests", status: "passed" as const, evidenceRefs: ["artifact_unit_tests"] },
        { name: "typecheck", status: "passed" as const, evidenceRefs: ["artifact_typecheck"] },
      ],
    },
  };
}

describe("evaluateTaskDevelopmentEvidence", () => {
  it("passes when every persisted Task development fact agrees", () => {
    expect(evaluateTaskDevelopmentEvidence(validEvidence())).toEqual({
      outcome: "pass",
      reasonCode: "all_required_evidence_passed",
    });
  });

  it("requests rework when the report commit differs from the remote branch head", () => {
    expect(evaluateTaskDevelopmentEvidence({
      ...validEvidence(),
      report: { ...validEvidence().report, commit: commitB },
    })).toEqual({ outcome: "rework", reasonCode: "test_report_commit_mismatch" });
  });

  it("requests rework when a required acceptance requirement is missing", () => {
    expect(evaluateTaskDevelopmentEvidence({
      ...validEvidence(),
      requiredRequirementIds: ["requirement_login", "requirement_timeout"],
    })).toEqual({ outcome: "rework", reasonCode: "required_requirement_missing" });
  });

  it("requests rework when a required check is skipped", () => {
    const evidence = validEvidence();
    expect(evaluateTaskDevelopmentEvidence({
      ...evidence,
      report: {
        ...evidence.report,
        checks: evidence.report.checks.map((check) => (
          check.name === "typecheck" ? { ...check, status: "skipped" as const } : check
        )),
      },
    })).toEqual({ outcome: "rework", reasonCode: "required_check_not_passed" });
  });

  it("requests rework when repository knowledge references are missing", () => {
    expect(evaluateTaskDevelopmentEvidence({
      ...validEvidence(),
      knowledgeRefs: [],
    })).toEqual({ outcome: "rework", reasonCode: "knowledge_refs_missing" });
  });

  it("requests rework when knowledge references point at another branch head", () => {
    expect(evaluateTaskDevelopmentEvidence({
      ...validEvidence(),
      knowledgeRefs: [{ path: "docs/knowledge/login.md", commit: commitB }],
    })).toEqual({ outcome: "rework", reasonCode: "knowledge_ref_commit_mismatch" });
  });

  it("does not pass an unknown remote push result", () => {
    expect(evaluateTaskDevelopmentEvidence({
      ...validEvidence(),
      pushReceipt: {
        status: "unknown",
        branch: "2026-HT100023",
        remoteHeadCommit: null,
      },
    })).toEqual({ outcome: "rework", reasonCode: "push_receipt_unknown" });
  });

  it("rejects evidence bound to another Task or branch", () => {
    expect(evaluateTaskDevelopmentEvidence({
      ...validEvidence(),
      report: { ...validEvidence().report, taskId: "task_other" },
    })).toEqual({ outcome: "reject", reasonCode: "evidence_identity_mismatch" });
  });
});
