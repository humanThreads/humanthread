export type StagingEvidenceStatus = "passed" | "failed" | "inconclusive" | "skipped";

export type StagingEvidence = {
  status: StagingEvidenceStatus;
  evidenceRefs: string[];
  fingerprint: string;
  integrationCommit: string;
};

export type StagingAcceptanceInput = {
  integrationCommit: string;
  tasks: Array<{
    taskId: string;
    requirements: Array<{ requirementId: string; status: "passed" | "failed" | "inconclusive" | "skipped" }>;
    affectedTests: StagingEvidence | null;
  }>;
  fullBusinessTests: StagingEvidence;
  healthCheck: StagingEvidence;
};

export type StagingAcceptanceResult = {
  ready: boolean;
  blockingReasons: string[];
  evidenceRefs: string[];
};

export function stagingEvidenceFingerprint(input: { integrationCommit: string; evidenceRefs: string[] }): string {
  return `staging:${input.integrationCommit}:${[...input.evidenceRefs].sort().join(",")}`;
}

export function evaluateStagingAcceptance(input: StagingAcceptanceInput): StagingAcceptanceResult {
  const reasons: string[] = [];
  const evidenceRefs: string[] = [];
  for (const task of input.tasks) {
    for (const requirement of task.requirements) {
      if (requirement.status !== "passed") reasons.push(`task_requirement_failed:${task.taskId}:${requirement.requirementId}`);
    }
    const affected = task.affectedTests;
    if (!affected) {
      reasons.push(`affected_tests_missing:${task.taskId}`);
      continue;
    }
    if (affected.evidenceRefs.length === 0) reasons.push(`affected_tests_evidence_missing:${task.taskId}`);
    evidenceRefs.push(...affected.evidenceRefs);
    if (affected.status !== "passed") reasons.push(`affected_tests_not_passed:${task.taskId}`);
    if (affected.integrationCommit !== input.integrationCommit || affected.fingerprint !== stagingEvidenceFingerprint(affected)) {
      reasons.push("affected_tests_not_bound_to_integration");
    }
  }
  for (const [name, evidence] of [["full_business_tests", input.fullBusinessTests], ["health_check", input.healthCheck]] as const) {
    evidenceRefs.push(...evidence.evidenceRefs);
    if (evidence.evidenceRefs.length === 0) reasons.push(`${name}_evidence_missing`);
    if (evidence.status !== "passed") reasons.push(`${name}_not_passed`);
    if (evidence.integrationCommit !== input.integrationCommit || evidence.fingerprint !== stagingEvidenceFingerprint(evidence)) {
      reasons.push(`${name}_not_bound_to_integration`);
    }
  }
  return { ready: reasons.length === 0, blockingReasons: [...new Set(reasons)], evidenceRefs: [...new Set(evidenceRefs)] };
}
