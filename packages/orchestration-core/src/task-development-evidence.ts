type EvidenceStatus = "passed" | "failed" | "inconclusive" | "skipped";

export interface TaskDevelopmentEvidenceInput {
  taskId: string;
  branch: string;
  requiredRequirementIds: string[];
  requiredCheckNames: string[];
  knowledgeRefs: Array<{ path: string; commit: string }>;
  pushReceipt: {
    status: "succeeded" | "failed" | "unknown";
    branch: string;
    remoteHeadCommit: string | null;
  };
  report: {
    taskId: string;
    branch: string;
    commit: string;
    status: "passed" | "failed";
    requirements: Array<{
      requirementId: string;
      status: EvidenceStatus;
      evidenceRefs: string[];
    }>;
    checks: Array<{
      name: string;
      status: EvidenceStatus;
      evidenceRefs: string[];
    }>;
  };
}

export type TaskDevelopmentEvidenceDecision = {
  outcome: "pass" | "rework" | "reject";
  reasonCode: string;
};

export function evaluateTaskDevelopmentEvidence(
  input: TaskDevelopmentEvidenceInput,
): TaskDevelopmentEvidenceDecision {
  if (
    input.report.taskId !== input.taskId
    || input.report.branch !== input.branch
    || input.pushReceipt.branch !== input.branch
  ) return { outcome: "reject", reasonCode: "evidence_identity_mismatch" };

  if (input.pushReceipt.status === "failed") {
    return { outcome: "reject", reasonCode: "task_branch_push_failed" };
  }
  if (input.pushReceipt.status !== "succeeded" || input.pushReceipt.remoteHeadCommit === null) {
    return { outcome: "rework", reasonCode: "push_receipt_unknown" };
  }
  if (input.knowledgeRefs.length === 0) {
    return { outcome: "rework", reasonCode: "knowledge_refs_missing" };
  }
  if (input.report.status !== "passed") {
    return { outcome: "rework", reasonCode: "test_report_not_passed" };
  }
  if (input.report.commit !== input.pushReceipt.remoteHeadCommit) {
    return { outcome: "rework", reasonCode: "test_report_commit_mismatch" };
  }
  if (input.knowledgeRefs.some((reference) => reference.commit !== input.report.commit)) {
    return { outcome: "rework", reasonCode: "knowledge_ref_commit_mismatch" };
  }
  if (input.requiredRequirementIds.length === 0) {
    return { outcome: "rework", reasonCode: "required_requirements_missing" };
  }
  for (const requirementId of new Set(input.requiredRequirementIds)) {
    const result = input.report.requirements.find((requirement) => requirement.requirementId === requirementId);
    if (!result) return { outcome: "rework", reasonCode: "required_requirement_missing" };
    if (result.status !== "passed" || result.evidenceRefs.length === 0) {
      return { outcome: "rework", reasonCode: "required_requirement_not_passed" };
    }
  }
  if (input.requiredCheckNames.length === 0) {
    return { outcome: "rework", reasonCode: "required_checks_missing" };
  }
  for (const checkName of new Set(input.requiredCheckNames)) {
    const result = input.report.checks.find((check) => check.name === checkName);
    if (!result) return { outcome: "rework", reasonCode: "required_check_missing" };
    if (result.status !== "passed" || result.evidenceRefs.length === 0) {
      return { outcome: "rework", reasonCode: "required_check_not_passed" };
    }
  }
  return { outcome: "pass", reasonCode: "all_required_evidence_passed" };
}
