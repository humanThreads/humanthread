import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLegacyTaskUsageSnapshot,
  getUserTaskRollout,
  requireUserTaskReads,
  requireUserTaskWrites,
  recordLegacyTaskUsage,
  resetLegacyTaskUsage,
} from "./task-rollout";

beforeEach(() => resetLegacyTaskUsage());

describe("user Task rollout", () => {
  it("defaults reads and writes off and prevents writes from preceding reads", () => {
    expect(getUserTaskRollout({})).toEqual({ reads: false, writes: false });
    expect(getUserTaskRollout({ HUMANTHREAD_USER_TASKS_READS: "true" })).toEqual({ reads: true, writes: false });
    expect(() => getUserTaskRollout({ HUMANTHREAD_USER_TASKS_WRITES: "true" })).toThrow("User Task writes require reads");
    expect(getUserTaskRollout({ HUMANTHREAD_USER_TASKS_READS: "true", HUMANTHREAD_USER_TASKS_WRITES: "true" })).toEqual({ reads: true, writes: true });
  });

  it("guards production read and write entry points independently", () => {
    expect(() => requireUserTaskReads({})).toThrowError(expect.objectContaining({
      code: "user_tasks_reads_disabled",
    }));
    expect(() => requireUserTaskWrites({ HUMANTHREAD_USER_TASKS_READS: "true" })).toThrowError(
      expect.objectContaining({ code: "user_tasks_writes_disabled" }),
    );
    expect(() => requireUserTaskReads({ HUMANTHREAD_USER_TASKS_READS: "true" })).not.toThrow();
    expect(() => requireUserTaskWrites({
      HUMANTHREAD_USER_TASKS_READS: "true",
      HUMANTHREAD_USER_TASKS_WRITES: "true",
    })).not.toThrow();
  });

  it("records observable legacy read and write usage without task content", () => {
    const log = vi.fn();
    recordLegacyTaskUsage({ kind: "read", surface: "workbench-task-center", taskId: "task_1", log });
    recordLegacyTaskUsage({ kind: "write", surface: "legacy-start", taskId: "task_1", log });
    expect(getLegacyTaskUsageSnapshot()).toEqual({ reads: 1, writes: 1, surfaces: { "workbench-task-center": 1, "legacy-start": 1 } });
    expect(log).toHaveBeenCalledWith("user_task_legacy_usage", expect.objectContaining({ kind: "write", surface: "legacy-start", taskId: "task_1" }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("contentMarkdown");
  });
});
