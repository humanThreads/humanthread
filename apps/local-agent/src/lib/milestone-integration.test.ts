import { describe, expect, it, vi } from "vitest";
import { integrateMilestoneIntoStaging } from "./milestone-integration";

const commit = (letter: string) => letter.repeat(40);
const snapshot = {
  projectId: "project_1", milestoneId: "milestone_1", milestoneVersion: 1, triggerType: "manual" as const,
  stagingBranch: "staging", tasks: [{ taskId: "task_1", taskNumber: 1, branch: "2026-HT1", headCommit: commit("a"), taskDocument: { documentId: "doc_1", version: 1 }, knowledgeRefs: [{ path: "docs/k.md", commit: commit("a") }], testReportRef: "report_1", requirements: [{ requirementId: "req_1", status: "passed" as const }] }],
  stagingBaseCommit: commit("e"), productionBaseCommit: commit("f"), createdAt: "2026-08-03T08:00:00.000Z",
};

function deps(overrides: Record<string, unknown> = {}) {
  return {
    run: vi.fn(async (_command: string, args: string[]) => args[0] === "rev-parse" ? { stdout: commit("e"), stderr: "" } : { stdout: "", stderr: "" }),
    worktreePath: "/tmp/release",
    runAffectedTests: vi.fn().mockResolvedValue({ passed: true, evidenceRefs: ["affected"] }),
    runFullBusinessTests: vi.fn().mockResolvedValue({ passed: true, evidenceRefs: ["full"] }),
    runHealthCheck: vi.fn().mockImplementation(async ({ integrationCommit }) => ({ status: "passed", evidenceRefs: ["health"], integrationCommit, fingerprint: `staging:${integrationCommit}:health` })),
    ...overrides,
  };
}

describe("milestone staging integration", () => {
  it("requires a passing health check after Git integration", async () => {
    const dependencies = deps();
    await expect(integrateMilestoneIntoStaging(snapshot, dependencies as never)).resolves.toMatchObject({ outcome: "staging_accepted" });
    expect(dependencies.runHealthCheck).toHaveBeenCalledWith({ cwd: "/tmp/release", integrationCommit: commit("e") });
  });

  it("does not accept a failed health check", async () => {
    const dependencies = deps({ runHealthCheck: vi.fn().mockResolvedValue({ status: "failed", evidenceRefs: ["health"], integrationCommit: commit("e"), fingerprint: `staging:${commit("e")}:health` }) });
    await expect(integrateMilestoneIntoStaging(snapshot, dependencies as never)).resolves.toMatchObject({ outcome: "staging_rejected" });
  });
});
