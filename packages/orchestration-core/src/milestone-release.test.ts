import { describe, expect, it } from "vitest";
import { evaluateMilestoneReleaseReadiness } from "./milestone-release";

const task = {
  taskId: "task_1",
  statusCategory: "completed",
  taskBranch: "2026-HT100001",
  remoteHeadCommit: "a".repeat(40),
  taskDocument: { documentId: "doc_1", version: 2 },
  knowledgeRefs: [{ path: "docs/knowledge/task.md", commit: "a".repeat(40) }],
  testReport: { ref: "report_1", status: "passed" as const },
  activeBlockerCount: 0,
};

describe("milestone release readiness", () => {
  it("is ready when every non-cancelled Task has fixed release evidence", () => {
    expect(evaluateMilestoneReleaseReadiness({ tasks: [task], blockers: 0 })).toEqual({
      ready: true,
      includedTaskIds: ["task_1"],
    });
  });

  it("does not block a milestone on cancelled Tasks", () => {
    expect(evaluateMilestoneReleaseReadiness({
      tasks: [task, { ...task, taskId: "task_cancelled", statusCategory: "cancelled" }],
      blockers: 0,
    })).toMatchObject({ ready: true, includedTaskIds: ["task_1"] });
  });

  it("rejects a milestone with no releasable Tasks", () => {
    expect(evaluateMilestoneReleaseReadiness({
      tasks: [{ ...task, statusCategory: "cancelled" }],
      blockers: 0,
    })).toEqual({ ready: false, includedTaskIds: [], reason: "milestone_has_no_releasable_tasks" });
  });

  it.each([
    ["milestone_has_incomplete_tasks", { statusCategory: "in_progress" }],
    ["task_branch_missing", { taskBranch: null }],
    ["task_branch_head_missing", { remoteHeadCommit: null }],
    ["task_document_missing", { taskDocument: null }],
    ["task_knowledge_missing", { knowledgeRefs: [] }],
    ["task_test_report_missing_or_failed", { testReport: { ref: "report_1", status: "failed" as const } }],
    ["task_requirement_missing_or_failed", { testReport: { ref: "report_1", status: "passed" as const, requirements: [{ requirementId: "req_1", status: "failed" as const }] } }],
  ] as const)("blocks release when %s", (reason, change) => {
    expect(evaluateMilestoneReleaseReadiness({ tasks: [{ ...task, ...change }], blockers: 0 }))
      .toMatchObject({ ready: false, reason });
  });
});
