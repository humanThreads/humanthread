import { describe, expect, it, vi } from "vitest";
import { triggerMilestoneTaskLoops } from "./milestone-batch-loop";

const task = (overrides: Partial<Parameters<typeof triggerMilestoneTaskLoops>[0]["tasks"][number]> = {}) => ({
  id: "task_1",
  statusCategory: "todo",
  archivedAt: null,
  hasLoopBinding: true,
  ...overrides,
});

describe("milestone batch Loop trigger", () => {
  it("returns one successful result for every eligible task", async () => {
    const trigger = vi.fn().mockResolvedValue({ id: "run_1" });
    await expect(triggerMilestoneTaskLoops({
      milestoneId: "milestone_1",
      commandId: "cmd_1",
      tasks: [task(), task({ id: "task_2" })],
      trigger,
    })).resolves.toEqual({
      milestoneId: "milestone_1",
      total: 2,
      started: 2,
      skipped: 0,
      failed: 0,
      results: [
        { taskId: "task_1", status: "started", loopRunId: "run_1" },
        { taskId: "task_2", status: "started", loopRunId: "run_1" },
      ],
    });
    expect(trigger).toHaveBeenCalledTimes(2);
  });

  it("keeps successful results when one task fails and reports a Chinese reason for skips", async () => {
    const trigger = vi.fn()
      .mockResolvedValueOnce({ id: "run_1" })
      .mockRejectedValueOnce(new Error("permission denied"));
    await expect(triggerMilestoneTaskLoops({
      milestoneId: "milestone_1",
      commandId: "cmd_1",
      tasks: [task(), task({ id: "task_2" }), task({ id: "task_3", statusCategory: "completed" })],
      trigger,
    })).resolves.toMatchObject({
      started: 1, failed: 1, skipped: 1,
      results: [
        { taskId: "task_1", status: "started" },
        { taskId: "task_2", status: "failed", reason: "permission denied" },
        { taskId: "task_3", status: "skipped", reason: "任务已完成" },
      ],
    });
  });

  it("does not invoke the trigger for an empty or ineligible task set", async () => {
    const trigger = vi.fn();
    await expect(triggerMilestoneTaskLoops({ milestoneId: "milestone_1", commandId: "cmd_1", tasks: [task({ archivedAt: new Date() }), task({ id: "task_2", hasLoopBinding: false })], trigger }))
      .resolves.toMatchObject({ total: 2, started: 0, skipped: 2, failed: 0 });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("uses a stable task command id so retrying the same batch is idempotent", async () => {
    const trigger = vi.fn().mockResolvedValue({ id: "run_1" });
    await triggerMilestoneTaskLoops({ milestoneId: "milestone_1", commandId: "cmd_1", tasks: [task()], trigger });
    await triggerMilestoneTaskLoops({ milestoneId: "milestone_1", commandId: "cmd_1", tasks: [task()], trigger });
    expect(trigger.mock.calls[0]?.[0].commandId).toBe(trigger.mock.calls[1]?.[0].commandId);
  });
});
