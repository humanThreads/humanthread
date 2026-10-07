import { describe, expect, it } from "vitest";
import {
  computeReadyTaskIds,
  transitionProject,
  transitionTask,
  validateTaskBreakdownProposal,
  validateTaskDependency,
} from "./project";

describe("project and task orchestration state", () => {
  it("lets a project that never went through plan submission still be completed", () => {
    // Real projects accumulate milestones and Loop runs before anyone submits a
    // formal plan, so `draft` cannot be treated as "not yet startable" forever.
    // Closing them must not require a ceremonial plan submission first.
    expect(transitionProject({
      project: { id: "p1", status: "draft", version: 7 },
      command: "complete",
      context: { requiredMilestonesComplete: true },
    })).toMatchObject({ status: "completed", version: 8 });

    expect(transitionProject({
      project: { id: "p1", status: "planned", version: 3 },
      command: "complete",
      context: { requiredMilestonesComplete: true },
    })).toMatchObject({ status: "completed", version: 4 });
  });

  it("still refuses to complete a project whose required milestones are open", () => {
    expect(() => transitionProject({
      project: { id: "p1", status: "active", version: 2 },
      command: "complete",
      context: { requiredMilestonesComplete: false },
    })).toThrowError(/required milestones are incomplete/u);
  });

  it("requires a complete plan before project activation", () => {
    expect(() => transitionProject({
      project: { id: "p1", status: "draft", version: 1 },
      command: "submit_plan",
      context: { objective: "Ship", stageCount: 1, milestoneCount: 1 },
    })).toThrowError(/validation_failed/);

    expect(transitionProject({
      project: { id: "p1", status: "draft", version: 1 },
      command: "submit_plan",
      context: { objective: "Ship", stageCount: 1, milestoneCount: 1, planApproved: true },
    })).toMatchObject({ status: "planned", version: 2 });
  });

  it("does not make a task ready until every blocking predecessor completes", () => {
    expect(computeReadyTaskIds({
      project: { id: "p1", status: "active" },
      stages: [{ id: "s1", status: "active" }],
      milestones: [{ id: "m1", stageId: "s1", status: "active" }],
      tasks: [
        { id: "a", milestoneId: "m1", status: "completed", priority: 1 },
        { id: "b", milestoneId: "m1", status: "ready", priority: 1 },
        { id: "c", milestoneId: "m1", status: "ready", priority: 0 },
      ],
      dependencies: [{ predecessorTaskId: "a", successorTaskId: "b", type: "blocks" }],
      locks: [],
      approvals: [],
    })).toEqual(["c", "b"]);
  });

  it("rejects dependency cycles and scope-expanding child tasks", () => {
    expect(validateTaskDependency({
      predecessorTaskId: "b",
      successorTaskId: "a",
      existingDependencies: [{ predecessorTaskId: "a", successorTaskId: "b", type: "blocks" }],
    })).toEqual({ ok: false, code: "validation_failed", reason: "dependency_cycle" });

    expect(validateTaskBreakdownProposal({
      parent: { allowedPaths: ["apps/web/**"], allowedTools: ["test"], maxAttempts: 4, remainingBudget: 10 },
      children: [{ allowedPaths: ["packages/db/**"], allowedTools: ["test"], maxAttempts: 1, budget: 1 }],
    })).toEqual({ ok: false, approvalType: "scope_change" });
  });

  it("rejects invalid task transitions", () => {
    expect(() => transitionTask({ task: { id: "t1", status: "completed", version: 3 }, command: "start" }))
      .toThrowError(/validation_failed/);
    expect(transitionTask({ task: { id: "t1", status: "ready", version: 3 }, command: "start" }))
      .toMatchObject({ status: "in_progress", version: 4 });
  });
});
