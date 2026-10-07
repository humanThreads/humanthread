import { createHash } from "node:crypto";

export type MilestoneBatchTask = {
  id: string;
  statusCategory: string | null;
  archivedAt: Date | string | null;
  hasLoopBinding: boolean;
};

export type MilestoneBatchResult =
  | { taskId: string; status: "started"; loopRunId: string }
  | { taskId: string; status: "skipped"; reason: string }
  | { taskId: string; status: "failed"; reason: string };

export type MilestoneBatchSummary = {
  milestoneId: string;
  total: number;
  started: number;
  skipped: number;
  failed: number;
  results: MilestoneBatchResult[];
};

type TriggerResult = { id: string };

export async function triggerMilestoneTaskLoops(input: {
  milestoneId: string;
  commandId: string;
  tasks: MilestoneBatchTask[];
  trigger(input: { taskId: string; commandId: string; source: "milestone_batch" }): Promise<TriggerResult>;
}): Promise<MilestoneBatchSummary> {
  const results: MilestoneBatchResult[] = [];
  for (const task of input.tasks) {
    const reason = milestoneTaskSkipReason(task);
    if (reason) {
      results.push({ taskId: task.id, status: "skipped", reason });
      continue;
    }
    try {
      const run = await input.trigger({
        taskId: task.id,
        commandId: stableTaskCommandId(input.milestoneId, input.commandId, task.id),
        source: "milestone_batch",
      });
      results.push({ taskId: task.id, status: "started", loopRunId: run.id });
    } catch (error) {
      results.push({ taskId: task.id, status: "failed", reason: error instanceof Error ? error.message : "任务 Loop 启动失败" });
    }
  }
  return {
    milestoneId: input.milestoneId,
    total: input.tasks.length,
    started: results.filter((result) => result.status === "started").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  };
}

export function stableTaskCommandId(milestoneId: string, batchCommandId: string, taskId: string) {
  return "milestone-batch:" + createHash("md5").update([milestoneId, batchCommandId, taskId].join("\0")).digest("hex");
}

export function milestoneTaskSkipReason(task: MilestoneBatchTask): string | null {
  if (task.archivedAt) return "任务已归档";
  if (["completed", "cancelled", "canceled"].includes(task.statusCategory ?? "")) {
    return task.statusCategory === "completed" ? "任务已完成" : "任务已取消";
  }
  if (!task.hasLoopBinding) return "未绑定可运行的 Loop";
  return null;
}
