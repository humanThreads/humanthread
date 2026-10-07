import { describe, expect, it, vi } from "vitest";

import { buildReleasePlanSnapshot, handleReleasePlanLoopEvent, releasePlanSnapshotKey, type ReleasePlanLoopEventDependencies } from "./release-plans";

describe("release plan duplicate protection", () => {
  it("uses a stable task snapshot key independent of order and duplicates", () => {
    expect(releasePlanSnapshotKey(["task_b", "task_a", "task_a"])).toBe(releasePlanSnapshotKey(["task_a", "task_b"]));
  });
});

describe("release plan task snapshots", () => {
  it("preserves each selected task branch for project-level release execution", () => {
    expect(buildReleasePlanSnapshot([{
      id: "task_1",
      title: "发布任务",
      taskBranch: "2026-HUMANTHR1100008",
      milestoneId: "milestone_1",
      milestone: { stageId: "stage_1" },
    }])).toEqual([{
      taskId: "task_1",
      title: "发布任务",
      taskBranch: "2026-HUMANTHR1100008",
      milestoneId: "milestone_1",
      stageId: "stage_1",
    }]);
  });
});

function dependencies(status: string, releasePlan: { id: string; status: string } | null = { id: "plan_1", status: "running" }) {
  const complete = vi.fn().mockResolvedValue(undefined);
  const fail = vi.fn().mockResolvedValue(undefined);
  const value: ReleasePlanLoopEventDependencies = {
    loadRun: vi.fn().mockResolvedValue(releasePlan ? { id: "run_1", status, releasePlan } : { id: "run_1", status, releasePlan: null }),
    complete,
    fail,
  };
  return { value, complete, fail };
}

describe("release plan Loop event reconciliation", () => {
  it.each(["completed", "succeeded"])("completes a plan for a %s Loop", async (status) => {
    const fixture = dependencies(status);

    await expect(handleReleasePlanLoopEvent({ eventType: "loop.node.completed", payload: { loopRunId: "run_1" } }, fixture.value)).resolves.toBe(true);
    expect(fixture.complete).toHaveBeenCalledWith({ planId: "plan_1", loopRunId: "run_1" });
    expect(fixture.fail).not.toHaveBeenCalled();
  });

  it.each(["failed", "exhausted", "cancelled", "canceled"])("fails a plan for a %s Loop", async (status) => {
    const fixture = dependencies(status);

    await expect(handleReleasePlanLoopEvent({ eventType: "loop.node.failed", payload: { loopRunId: "run_1" } }, fixture.value)).resolves.toBe(true);
    expect(fixture.fail).toHaveBeenCalledWith({ planId: "plan_1", reason: `Release Loop ${status}` });
    expect(fixture.complete).not.toHaveBeenCalled();
  });

  it("uses the event aggregate id when the payload omits loopRunId", async () => {
    const fixture = dependencies("completed");

    await expect(handleReleasePlanLoopEvent({ eventType: "loop.node.completed", aggregateId: "run_1" }, fixture.value)).resolves.toBe(true);
    expect(fixture.value.loadRun).toHaveBeenCalledWith("run_1");
  });

  it("uses the standard event envelope aggregate.id", async () => {
    const fixture = dependencies("completed");

    await expect(handleReleasePlanLoopEvent({ eventType: "loop.node.completed", aggregate: { type: "loop_node", id: "run_1" } }, fixture.value)).resolves.toBe(true);
    expect(fixture.value.loadRun).toHaveBeenCalledWith("run_1");
  });

  it("ignores non-terminal events and events without a linked release plan", async () => {
    const running = dependencies("running");
    const unlinked = dependencies("completed", null);

    await expect(handleReleasePlanLoopEvent({ payload: { loopRunId: "run_1" } }, running.value)).resolves.toBe(false);
    await expect(handleReleasePlanLoopEvent({ payload: { loopRunId: "run_1" } }, unlinked.value)).resolves.toBe(false);
    expect(running.complete).not.toHaveBeenCalled();
    expect(unlinked.complete).not.toHaveBeenCalled();
  });
});
