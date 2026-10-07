export type MilestoneReleaseTaskFact = {
  taskId: string;
  statusCategory: string;
  taskBranch: string | null;
  remoteHeadCommit: string | null;
  taskDocument: { documentId: string; version: number } | null;
  knowledgeRefs: Array<{ path: string; commit: string }>;
  testReport: {
    ref: string;
    status: "passed" | "failed" | "unknown";
    requirements?: Array<{ requirementId: string; status: "passed" | "failed" | "inconclusive" | "skipped" }>;
  } | null;
  activeBlockerCount: number;
};

export type MilestoneReleaseReadiness = {
  ready: boolean;
  includedTaskIds: string[];
  reason?: string;
};

export function evaluateMilestoneReleaseReadiness(input: {
  tasks: MilestoneReleaseTaskFact[];
  blockers: number;
}): MilestoneReleaseReadiness {
  if (!Array.isArray(input.tasks) || input.tasks.length === 0) {
    return { ready: false, includedTaskIds: [], reason: "milestone_has_no_releasable_tasks" };
  }
  if (!Number.isInteger(input.blockers) || input.blockers < 0 || input.blockers > 100_000) {
    return { ready: false, includedTaskIds: [], reason: "milestone_blocker_count_invalid" };
  }
  if (input.blockers > 0 || input.tasks.some((task) => task.activeBlockerCount > 0)) {
    return { ready: false, includedTaskIds: [], reason: "milestone_has_active_blockers" };
  }
  const releasable = input.tasks.filter((task) => task.statusCategory !== "cancelled");
  if (releasable.length === 0) {
    return { ready: false, includedTaskIds: [], reason: "milestone_has_no_releasable_tasks" };
  }
  for (const task of releasable) {
    if (task.statusCategory !== "completed") {
      return { ready: false, includedTaskIds: [], reason: "milestone_has_incomplete_tasks" };
    }
    if (!task.taskBranch) {
      return { ready: false, includedTaskIds: [], reason: "task_branch_missing" };
    }
    if (!task.remoteHeadCommit) {
      return { ready: false, includedTaskIds: [], reason: "task_branch_head_missing" };
    }
    if (!task.taskDocument) {
      return { ready: false, includedTaskIds: [], reason: "task_document_missing" };
    }
    if (task.knowledgeRefs.length === 0) {
      return { ready: false, includedTaskIds: [], reason: "task_knowledge_missing" };
    }
    if (!task.testReport || task.testReport.status !== "passed") {
      return { ready: false, includedTaskIds: [], reason: "task_test_report_missing_or_failed" };
    }
    if (task.testReport.requirements?.some((requirement) => requirement.status !== "passed")) {
      return { ready: false, includedTaskIds: [], reason: "task_requirement_missing_or_failed" };
    }
  }
  return {
    ready: true,
    includedTaskIds: releasable.map((task) => task.taskId),
  };
}
