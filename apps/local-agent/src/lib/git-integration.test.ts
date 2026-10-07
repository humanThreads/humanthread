import { describe, expect, it, vi } from "vitest";
import { integrateMilestoneBranches } from "./git-integration";

const commit = (letter: string) => letter.repeat(40);
const snapshot = {
  projectId: "project_1",
  milestoneId: "milestone_1",
  milestoneVersion: 4,
  triggerType: "manual" as const,
  stagingBranch: "staging",
  tasks: [
    {
      taskId: "task_2",
      taskNumber: 100002,
      branch: "2026-HT100002",
      headCommit: commit("b"),
      taskDocument: { documentId: "doc_2", version: 1 },
      knowledgeRefs: [{ path: "docs/knowledge/two.md", commit: commit("b") }],
      testReportRef: "report_2",
    },
    {
      taskId: "task_1",
      taskNumber: 100001,
      branch: "2026-HT100001",
      headCommit: commit("a"),
      taskDocument: { documentId: "doc_1", version: 2 },
      knowledgeRefs: [{ path: "docs/knowledge/one.md", commit: commit("a") }],
      testReportRef: "report_1",
    },
  ],
  stagingBaseCommit: commit("e"),
  productionBaseCommit: commit("f"),
  createdAt: "2026-08-03T08:00:00.000Z",
};

function dependencies(overrides: Record<string, unknown> = {}) {
  const run = vi.fn(async (_command: string, args: string[]) => {
    if (args[0] === "rev-parse") {
      if (args[1] === "--show-toplevel") return { stdout: "/some/other/path\nHEAD\n", stderr: "" };
      return { stdout: commit("e") + "\n", stderr: "" };
    }
    if (args[0] === "diff") return { stdout: "", stderr: "" };
    if (args[0] === "status") return { stdout: "", stderr: "" };
    if (args[0] === "show") return { stdout: "", stderr: "" };
    return { stdout: "", stderr: "" };
  });
  return {
    run,
    worktreePath: "/work/project/.humanthread/worktrees/release-1",
    runAffectedTests: vi.fn().mockResolvedValue({ passed: true, evidenceRefs: ["artifact_affected"] }),
    runFullBusinessTests: vi.fn().mockResolvedValue({ passed: true, evidenceRefs: ["artifact_full"] }),
    ...overrides,
  };
}

describe("milestone Git integration", () => {
  it("fetches, merges exact task SHAs in Task-number order, tests, and pushes staging", async () => {
    const deps = dependencies();

    await expect(integrateMilestoneBranches(snapshot, deps as never)).resolves.toMatchObject({
      outcome: "pushed",
      stagingBranch: "staging",
      candidateCommit: commit("e"),
      taskOrder: ["task_1", "task_2"],
      pushReceipt: { status: "succeeded", remoteHeadCommit: commit("e") },
    });
    expect(deps.run.mock.calls.map(([, args]) => args)).toEqual([
      ["fetch", "--prune", "origin"],
      ["rev-parse", "--verify", "--end-of-options", "origin/staging"],
      ["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"],
      ["worktree", "add", deps.worktreePath, "origin/staging"],
      ["merge", "--no-edit", commit("a")],
      ["merge", "--no-edit", commit("b")],
      ["rev-parse", "--verify", "HEAD"],
      ["rev-parse", "--verify", "--end-of-options", "origin/staging"],
      ["push", "origin", "HEAD:staging"],
    ]);
    expect(deps.runFullBusinessTests).toHaveBeenCalledOnce();
  });

  it("reuses an already-bound staging worktree instead of adding it again", async () => {
    const worktreePath = "/work/project/.humanthread/worktrees/release-1";
    const deps = dependencies({
      run: vi.fn(async (_command: string, args: string[]) => {
        if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
          return { stdout: `${worktreePath}\nstaging\n`, stderr: "" };
        }
        if (args[0] === "rev-parse") return { stdout: `${commit("e")}\n`, stderr: "" };
        return { stdout: "", stderr: "" };
      }),
    });

    await expect(integrateMilestoneBranches(snapshot, deps as never)).resolves.toMatchObject({ outcome: "pushed" });
    expect(deps.run.mock.calls.map(([, args]) => args)).not.toContainEqual([
      "worktree",
      "add",
      worktreePath,
      "origin/staging",
    ]);
  });

  it("returns conflict context and never pushes after a merge conflict", async () => {
    const deps = dependencies({
      run: vi.fn(async (_command: string, args: string[]) => {
        if (args[0] === "merge") throw Object.assign(new Error("conflict"), { code: "git_conflict" });
        if (args[0] === "diff") return { stdout: "src/app.ts\n", stderr: "" };
        if (args[0] === "rev-parse") return { stdout: commit("e") + "\n", stderr: "" };
        return { stdout: "", stderr: "" };
      }),
    });

    await expect(integrateMilestoneBranches(snapshot, deps as never)).resolves.toMatchObject({
      outcome: "conflict",
      conflict: {
        paths: ["src/app.ts"],
        involvedTaskIds: ["task_1"],
        taskDocumentRefs: [{ documentId: "doc_1", version: 2 }],
        knowledgeRefs: ["docs/knowledge/one.md"],
        testReportRefs: ["report_1"],
      },
    });
    expect(deps.run.mock.calls.some(([, args]) => args[0] === "push")).toBe(false);
    expect(deps.runFullBusinessTests).not.toHaveBeenCalled();
  });

  it("does not push after affected or full business tests fail", async () => {
    const deps = dependencies({
      runAffectedTests: vi.fn().mockResolvedValue({ passed: false, evidenceRefs: ["artifact_failed"] }),
    });
    await expect(integrateMilestoneBranches(snapshot, deps as never)).resolves.toMatchObject({ outcome: "tests_failed" });
    expect(deps.run.mock.calls.some(([, args]) => args[0] === "push")).toBe(false);
    expect(deps.runFullBusinessTests).not.toHaveBeenCalled();
  });

  it("does not push when the staging remote advances before integration", async () => {
    const deps = dependencies({
      run: vi.fn(async (_command: string, args: string[]) => {
        if (args[0] === "rev-parse") return { stdout: commit("d") + "\n", stderr: "" };
        return { stdout: "", stderr: "" };
      }),
    });
    await expect(integrateMilestoneBranches(snapshot, deps as never)).resolves.toEqual({ outcome: "remote_advanced", stagingBranch: "staging", remoteHeadCommit: commit("d") });
    expect(deps.run.mock.calls.some(([, args]) => args[0] === "push")).toBe(false);
  });

  it("requires reconciliation when push outcome is unknown", async () => {
    const deps = dependencies({
      run: vi.fn(async (_command: string, args: string[]) => {
        if (args[0] === "push") throw Object.assign(new Error("network timeout"), { code: "push_unknown" });
        if (args[0] === "rev-parse") return { stdout: commit("e") + "\n", stderr: "" };
        return { stdout: "", stderr: "" };
      }),
    });
    await expect(integrateMilestoneBranches(snapshot, deps as never)).resolves.toMatchObject({ outcome: "reconciliation_required", reason: "git_push_result_unknown", remoteHeadCommit: commit("e") });
  });

  it("does not push when full business tests fail after affected tests pass", async () => {
    const deps = dependencies({
      runFullBusinessTests: vi.fn().mockResolvedValue({ passed: false, evidenceRefs: ["artifact_full_failed"] }),
    });
    await expect(integrateMilestoneBranches(snapshot, deps as never)).resolves.toMatchObject({ outcome: "tests_failed", evidenceRefs: ["artifact_affected", "artifact_affected", "artifact_full_failed"] });
    expect(deps.run.mock.calls.some(([, args]) => args[0] === "push")).toBe(false);
  });
});
