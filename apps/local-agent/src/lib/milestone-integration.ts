import {
  evaluateStagingAcceptance,
  stagingEvidenceFingerprint,
  type StagingEvidence,
  type StagingAcceptanceResult,
} from "../../../../packages/orchestration-core/src/index";
import type { MilestoneReleaseSnapshot } from "@humanthread/shared";
import {
  integrateMilestoneBranches,
  type GitIntegrationDependencies,
  type MilestoneIntegrationResult,
} from "./git-integration";

export type MilestoneIntegrationOutcome =
  | { outcome: "staging_accepted"; integrationCommit: string; acceptance: StagingAcceptanceResult; git: Extract<MilestoneIntegrationResult, { outcome: "pushed" }> }
  | { outcome: "staging_rejected"; integrationCommit: string; acceptance: StagingAcceptanceResult; git: Extract<MilestoneIntegrationResult, { outcome: "pushed" }> }
  | Exclude<MilestoneIntegrationResult, { outcome: "pushed" }>;

export interface MilestoneIntegrationDependencies extends GitIntegrationDependencies {
  runHealthCheck(input: { cwd: string; integrationCommit: string }): Promise<StagingEvidence>;
}

export async function integrateMilestoneIntoStaging(
  snapshot: MilestoneReleaseSnapshot,
  dependencies: MilestoneIntegrationDependencies,
): Promise<MilestoneIntegrationOutcome> {
  const git = await integrateMilestoneBranches(snapshot, dependencies);
  if (git.outcome !== "pushed") return git;
  const affectedByTask = new Map(git.affectedEvidence.map((evidence) => [evidence.taskId, evidence]));
  const evidenceForTask = (task: MilestoneReleaseSnapshot["tasks"][number]): StagingEvidence => {
    const refs = affectedByTask.get(task.taskId)?.evidenceRefs ?? [];
    const reportedFingerprint = affectedByTask.get(task.taskId)?.fingerprint;
    return {
      status: "passed",
      evidenceRefs: refs,
      integrationCommit: git.candidateCommit,
      fingerprint: reportedFingerprint ?? stagingEvidenceFingerprint({ integrationCommit: git.candidateCommit, evidenceRefs: refs }),
    };
  };
  const fullBusinessTests: StagingEvidence = {
    status: "passed",
    evidenceRefs: git.fullBusinessEvidenceRefs,
    integrationCommit: git.candidateCommit,
    fingerprint: git.fullBusinessEvidenceFingerprint ?? stagingEvidenceFingerprint({ integrationCommit: git.candidateCommit, evidenceRefs: git.fullBusinessEvidenceRefs }),
  };
  const acceptance = evaluateStagingAcceptance({
    integrationCommit: git.candidateCommit,
    tasks: snapshot.tasks.map((task) => ({
      taskId: task.taskId,
      requirements: task.requirements ?? [],
      affectedTests: evidenceForTask(task),
    })),
    fullBusinessTests,
    healthCheck: await dependencies.runHealthCheck({ cwd: dependencies.worktreePath, integrationCommit: git.candidateCommit }),
  });
  return acceptance.ready
    ? { outcome: "staging_accepted", integrationCommit: git.candidateCommit, acceptance, git }
    : { outcome: "staging_rejected", integrationCommit: git.candidateCommit, acceptance, git };
}
