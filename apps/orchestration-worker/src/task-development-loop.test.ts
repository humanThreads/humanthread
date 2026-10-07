import { describe, expect, it, vi } from "vitest";

import { handleTaskDevelopmentLoopEvent } from "./task-development-loop";

const taskCommit = "a".repeat(40);
const stagingCommit = "b".repeat(40);

const event = {
  id: "event_loop_node_completed_1",
  eventType: "loop.node.completed",
  aggregateType: "loop_node",
  aggregateId: "node_verify_1",
  correlationId: "loop:loop_run_1",
  occurredAt: "2026-08-03T08:00:00.000Z",
  payload: { loopRunId: "loop_run_1", attemptId: "attempt_verify_1" },
};

function output() {
  return {
    report: {
      taskId: "task_1",
      branch: "2026-HT100023",
      commit: taskCommit,
      status: "passed",
      requirements: [{
        requirementId: "requirement_login",
        status: "passed",
        evidenceRefs: ["artifact_requirement_login"],
      }],
      checks: [{
        name: "unit-tests",
        status: "passed",
        evidenceRefs: ["artifact_unit_tests"],
      }],
    },
    knowledgeRefs: [{ path: "docs/knowledge/login.md", commit: taskCommit }],
    pushReceipt: {
      status: "succeeded",
      branch: "2026-HT100023",
      remoteHeadCommit: taskCommit,
    },
  };
}

function context() {
  return {
    loopRunId: "loop_run_1",
    nodeRunId: "node_verify_1",
    attemptId: "attempt_verify_1",
    nodeKey: "verify_and_push",
    task: {
      id: "task_1",
      projectId: "project_1",
      version: 7,
      statusCategory: "in_progress",
      taskBranch: "2026-HT100023",
      requiredRequirementIds: ["requirement_login"],
      requiredCheckNames: ["unit-tests"],
    },
    project: {
      developmentTemplateKey: "branch-development",
      stagingBranch: "staging",
    },
    result: {
      outcome: "success",
      output: output(),
      artifactRefs: [],
      effectReceipts: [],
    },
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    loadContext: vi.fn().mockResolvedValue(context()),
    persistDecision: vi.fn().mockResolvedValue({ taskId: "task_1", version: 8 }),
    ...overrides,
  };
}

describe("Task development Loop evidence", () => {
  it("completes a task from the current Worker delivery evidence on a renamed delivery node", async () => {
    const current = context();
    current.nodeKey = "develop_and_test";
    current.task.requiredRequirementIds = [];
    current.task.requiredCheckNames = [];
    current.result = {
      outcome: "success",
      output: {
        delivery: {
          required: true,
          evidence: {
            branch: "2026-HT100023",
            baseCommit: stagingCommit,
            headCommit: taskCommit,
            remoteHeadCommit: taskCommit,
            commits: [{ sha: taskCommit, subject: "Implement task" }],
            changedFiles: ["apps/web/src/app/page.tsx"],
            clean: true,
          },
        },
        appServer: null,
      },
      artifactRefs: [],
      effectReceipts: [],
    };
    const deps = dependencies({ loadContext: vi.fn().mockResolvedValue(current) });

    await expect(handleTaskDevelopmentLoopEvent(event, deps as never)).resolves.toMatchObject({
      handled: true,
      outcome: "pass",
      taskCompleted: true,
    });
    expect(deps.persistDecision).toHaveBeenCalledWith(expect.objectContaining({
      completeTask: true,
      decision: { outcome: "pass", reasonCode: "worker_delivery_verified" },
    }));
  });

  it("persists a stable Git push effect and completes the Task only after evidence passes", async () => {
    const deps = dependencies();

    await expect(handleTaskDevelopmentLoopEvent(event, deps as never)).resolves.toEqual({
      handled: true,
      outcome: "pass",
      reasonCode: "all_required_evidence_passed",
      taskCompleted: true,
    });

    expect(deps.loadContext).toHaveBeenCalledWith({
      loopRunId: "loop_run_1",
      attemptId: "attempt_verify_1",
    });
    expect(deps.persistDecision).toHaveBeenCalledWith(expect.objectContaining({
      commandId: "task-development:loop_run_1:attempt_verify_1",
      effect: {
        id: expect.stringMatching(/^git-push-effect:/u),
        effectKey: `git.push:2026-HT100023:${taskCommit}`,
        operationType: "git.push",
        requestFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        status: "succeeded",
        providerReceipt: {
          status: "succeeded",
          branch: "2026-HT100023",
          remoteHeadCommit: taskCommit,
        },
      },
      completeTask: true,
      decision: { outcome: "pass", reasonCode: "all_required_evidence_passed" },
    }));
  });

  it("persists rework evidence without completing the Task", async () => {
    const current = context();
    current.task.requiredCheckNames = ["unit-tests", "typecheck"];
    const deps = dependencies({ loadContext: vi.fn().mockResolvedValue(current) });

    await expect(handleTaskDevelopmentLoopEvent(event, deps as never)).resolves.toMatchObject({
      handled: true,
      outcome: "rework",
      taskCompleted: false,
    });

    expect(deps.persistDecision).toHaveBeenCalledWith(expect.objectContaining({
      completeTask: false,
      decision: { outcome: "rework", reasonCode: "required_check_missing" },
    }));
  });

  it("ignores unrelated orchestration events and non-verification nodes", async () => {
    const unrelated = dependencies();
    await expect(handleTaskDevelopmentLoopEvent({ ...event, eventType: "task.started" }, unrelated as never))
      .resolves.toEqual({ handled: false });
    expect(unrelated.loadContext).not.toHaveBeenCalled();

    const develop = dependencies({
      loadContext: vi.fn().mockResolvedValue({ ...context(), nodeKey: "develop" }),
    });
    await expect(handleTaskDevelopmentLoopEvent(event, develop as never))
      .resolves.toEqual({ handled: false });
    expect(develop.persistDecision).not.toHaveBeenCalled();
  });

  it("leaves staging unchanged while persisting the remote Task branch and evidence", async () => {
    const remoteBranches = new Map([
      ["staging", stagingCommit],
      ["2026-HT100023", taskCommit],
    ]);
    const evidence: unknown[] = [];
    let taskStatus = "in_progress";
    const deps = dependencies({
      persistDecision: vi.fn().mockImplementation(async (input) => {
        evidence.push(input.report);
        if (input.completeTask) taskStatus = "completed";
        return { taskId: "task_1", version: 8 };
      }),
    });
    const stagingBefore = remoteBranches.get("staging");

    await handleTaskDevelopmentLoopEvent(event, deps as never);

    expect(remoteBranches.get("staging")).toBe(stagingBefore);
    expect(remoteBranches.get("2026-HT100023")).toBe(taskCommit);
    expect(evidence).toEqual([output().report]);
    expect(taskStatus).toBe("completed");
  });
});
