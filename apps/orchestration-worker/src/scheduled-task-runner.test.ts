import { describe, expect, it, vi } from "vitest";
import {
  classifyScheduledTaskHealth,
  runDueProjectScheduledTasks,
  runScheduledTaskIteration,
} from "./scheduled-task-runner";

const baseTask = {
  id: "a".repeat(32), projectDigest: "b".repeat(32), status: "enabled",
  cronExpression: "0 * * * *", timezone: "Asia/Shanghai", version: 1,
  nextRunAt: new Date("2026-09-22T01:00:00.000Z"),
  pendingScheduledFor: null, lastScheduledFor: null,
};

const matchedWrite = { matched: true, alreadyAdvanced: false };

describe("runDueProjectScheduledTasks", () => {
  it("creates a normal due run with the scheduled trigger source", async () => {
    const createRun = vi.fn().mockResolvedValue({ runId: "c".repeat(32), status: "preparing", duplicate: false });
    const advance = vi.fn().mockResolvedValue(matchedWrite);
    const result = await runDueProjectScheduledTasks({
      now: new Date("2026-09-22T01:00:05.000Z"),
      limit: 100,
      dependencies: {
        listDueTasks: vi.fn().mockResolvedValue([baseTask]),
        hasActiveRun: vi.fn().mockResolvedValue(false),
        createRun,
        deferTask: vi.fn(),
        advanceTask: advance,
      },
    });
    expect(result.created).toBe(1);
    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({
      triggerSource: "scheduled",
      scheduledFor: new Date("2026-09-22T01:00:00.000Z"),
    }));
    expect(advance).toHaveBeenCalledOnce();
  });

  it("marks a stored pending slot as catch_up", async () => {
    const createRun = vi.fn().mockResolvedValue({ runId: "c".repeat(32), status: "preparing", duplicate: false });
    const result = await runDueProjectScheduledTasks({
      now: new Date("2026-09-22T02:30:00.000Z"),
      limit: 100,
      dependencies: {
        listDueTasks: vi.fn().mockResolvedValue([{
          ...baseTask,
          nextRunAt: new Date("2026-09-22T03:00:00.000Z"),
          pendingScheduledFor: new Date("2026-09-22T02:00:00.000Z"),
        }]),
        hasActiveRun: vi.fn().mockResolvedValue(false),
        createRun,
        deferTask: vi.fn(),
        advanceTask: vi.fn().mockResolvedValue(matchedWrite),
      },
    });
    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({
      triggerSource: "catch_up",
      scheduledFor: new Date("2026-09-22T02:00:00.000Z"),
    }));
  });

  it("stores one pending slot without creating another run when a run is active", async () => {
    const createRun = vi.fn();
    const deferTask = vi.fn().mockResolvedValue(matchedWrite);
    const result = await runDueProjectScheduledTasks({
      now: new Date("2026-09-22T02:30:00.000Z"),
      limit: 100,
      dependencies: {
        listDueTasks: vi.fn().mockResolvedValue([baseTask]),
        hasActiveRun: vi.fn().mockResolvedValue(true),
        createRun,
        deferTask,
        advanceTask: vi.fn(),
      },
    });
    expect(result.deferred).toBe(1);
    expect(createRun).not.toHaveBeenCalled();
    expect(deferTask).toHaveBeenCalledWith(expect.objectContaining({
      scheduledFor: new Date("2026-09-22T02:00:00.000Z"),
      nextRunAt: new Date("2026-09-22T03:00:00.000Z"),
      expectedNextRunAt: new Date("2026-09-22T01:00:00.000Z"),
      expectedPendingScheduledFor: null,
      expectedLastScheduledFor: null,
    }));
  });

  it("isolates a failing task and continues scanning the remaining due tasks", async () => {
    const failingTask = { ...baseTask, id: "a".repeat(32) };
    const healthyTask = { ...baseTask, id: "c".repeat(32) };
    const createRun = vi.fn()
      .mockRejectedValueOnce(new Error("target unavailable"))
      .mockResolvedValueOnce({ runId: "d".repeat(32), status: "preparing", duplicate: false });
    const advance = vi.fn().mockResolvedValue(matchedWrite);
    const result = await runDueProjectScheduledTasks({
      now: new Date("2026-09-22T01:00:05.000Z"),
      limit: 100,
      dependencies: {
        listDueTasks: vi.fn().mockResolvedValue([failingTask, healthyTask]),
        hasActiveRun: vi.fn().mockResolvedValue(false),
        createRun,
        deferTask: vi.fn(),
        advanceTask: advance,
      },
    });

    expect(result).toMatchObject({ scanned: 2, created: 1, deferred: 0, blocked: 0, failed: 1 });
    expect(createRun).toHaveBeenCalledTimes(2);
    expect(advance).toHaveBeenCalledOnce();
    expect(advance).toHaveBeenCalledWith(expect.objectContaining({ scheduledTaskId: "c".repeat(32) }));
  });

  it("reuses the same trigger source and slot key on repeated scans", async () => {
    const createRun = vi.fn().mockResolvedValue({ runId: "c".repeat(32), status: "preparing", duplicate: false });
    const dependencies = {
      listDueTasks: vi.fn().mockResolvedValue([baseTask]),
      hasActiveRun: vi.fn().mockResolvedValue(false),
      createRun,
      deferTask: vi.fn(),
      advanceTask: vi.fn().mockResolvedValue(matchedWrite),
    };
    const input = {
      now: new Date("2026-09-22T01:00:05.000Z"),
      limit: 100,
      dependencies,
    };

    await runDueProjectScheduledTasks(input);
    await runDueProjectScheduledTasks(input);

    expect(createRun).toHaveBeenCalledTimes(2);
    const first = createRun.mock.calls[0]?.[0];
    const second = createRun.mock.calls[1]?.[0];
    expect(first?.triggerSource).toBe("scheduled");
    expect(second?.triggerSource).toBe(first?.triggerSource);
    expect(second?.scheduledFor).toEqual(first?.scheduledFor);
    expect(second?.commandId).toBe(first?.commandId);
  });

  it("reuses one active automatic run across a deferred retry and advances once", async () => {
    let state = {
      nextRunAt: new Date("2026-09-22T01:00:00.000Z"),
      pendingScheduledFor: null as Date | null,
      lastScheduledFor: null as Date | null,
    };
    let active = false;
    let advanceFailures = 1;
    const runs = new Map<string, { runId: string; status: string; duplicate: boolean }>();
    const createRun = vi.fn(async (input: { scheduledTaskId: string; scheduledFor?: Date | string }) => {
      const scheduledFor = input.scheduledFor instanceof Date ? input.scheduledFor : new Date(String(input.scheduledFor));
      const key = `${input.scheduledTaskId}:${scheduledFor.toISOString()}`;
      const existing = runs.get(key);
      if (existing) return { ...existing, duplicate: true };
      const run = { runId: "c".repeat(32), status: "preparing", duplicate: false };
      runs.set(key, run);
      active = true;
      return run;
    });
    const advance = vi.fn(async (input: {
      scheduledFor: Date;
      nextRunAt: Date;
      expectedNextRunAt: Date | null;
      expectedPendingScheduledFor: Date | null;
      expectedLastScheduledFor: Date | null;
    }) => {
      if (advanceFailures > 0) {
        advanceFailures -= 1;
        throw new Error("transient write failure");
      }
      if (input.expectedNextRunAt?.getTime() !== state.nextRunAt.getTime()
        || input.expectedPendingScheduledFor?.getTime() !== state.pendingScheduledFor?.getTime()
        || input.expectedLastScheduledFor?.getTime() !== state.lastScheduledFor?.getTime()) {
        return { matched: false, alreadyAdvanced: false };
      }
      state = {
        nextRunAt: input.nextRunAt,
        pendingScheduledFor: null,
        lastScheduledFor: input.scheduledFor,
      };
      return matchedWrite;
    });
    const dependencies = {
      listDueTasks: vi.fn(async () => [{ ...baseTask, ...state }]),
      hasActiveRun: vi.fn(async () => active),
      createRun,
      deferTask: vi.fn(async (input: {
        scheduledFor: Date;
        nextRunAt: Date;
        expectedNextRunAt: Date | null;
        expectedPendingScheduledFor: Date | null;
        expectedLastScheduledFor: Date | null;
      }) => {
        if (input.expectedNextRunAt?.getTime() !== state.nextRunAt.getTime()
          || input.expectedPendingScheduledFor?.getTime() !== state.pendingScheduledFor?.getTime()
          || input.expectedLastScheduledFor?.getTime() !== state.lastScheduledFor?.getTime()) {
          return { matched: false, alreadyAdvanced: false };
        }
        state = {
          nextRunAt: input.nextRunAt,
          pendingScheduledFor: input.scheduledFor,
          lastScheduledFor: state.lastScheduledFor,
        };
        return matchedWrite;
      }),
      advanceTask: advance,
    };

    const first = await runDueProjectScheduledTasks({
      now: new Date("2026-09-22T01:00:05.000Z"), limit: 100, dependencies,
    });
    const second = await runDueProjectScheduledTasks({
      now: new Date("2026-09-22T01:00:30.000Z"), limit: 100, dependencies,
    });
    active = false;
    const third = await runDueProjectScheduledTasks({
      now: new Date("2026-09-22T01:00:45.000Z"), limit: 100, dependencies,
    });

    expect(first).toMatchObject({ scanned: 1, created: 0, deferred: 0, failed: 1 });
    expect(second).toMatchObject({ scanned: 1, created: 0, deferred: 1, failed: 0 });
    expect(third).toMatchObject({ scanned: 1, created: 0, deferred: 0, failed: 0 });
    expect(createRun).toHaveBeenCalledTimes(2);
    expect(createRun.mock.calls[0]?.[0]).toMatchObject({
      triggerSource: "scheduled", scheduledFor: new Date("2026-09-22T01:00:00.000Z"),
    });
    expect(createRun.mock.calls[1]?.[0]).toMatchObject({
      triggerSource: "catch_up", scheduledFor: new Date("2026-09-22T01:00:00.000Z"),
    });
    expect(runs).toHaveLength(1);
    expect(advance).toHaveBeenCalledTimes(2);
    expect(state).toEqual({
      nextRunAt: new Date("2026-09-22T02:00:00.000Z"),
      pendingScheduledFor: null,
      lastScheduledFor: new Date("2026-09-22T01:00:00.000Z"),
    });
  });

  it("observes and returns safe structured production projection errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runId = "d".repeat(32);
    const projectStatuses = vi.fn(async ({ dependencies }) => {
      dependencies.onProjectionError?.({ runId, errorCode: "unsupported_loop_run_status" });
      return { scanned: 1, terminalized: 0, errors: 1 };
    });

    const result = await runScheduledTaskIteration(new Date("2026-09-22T04:00:00.000Z"), {
      recoverPreparing: vi.fn().mockResolvedValue({ scanned: 0, recovered: 0, failed: 0, errors: 0 }),
      projectStatuses,
      runDue: vi.fn().mockResolvedValue({ scanned: 0, created: 0, deferred: 0, failed: 0 }),
      emitMetrics: vi.fn(),
    });

    expect(errorSpy).toHaveBeenCalledWith({
      event: "scheduled_task_projection_error",
      errorCode: "unsupported_loop_run_status",
      runId,
    });
    expect(result).toMatchObject({
      scheduled: { scanned: 0, created: 0, deferred: 0, blocked: 0, failed: 0 },
      projectionErrors: 1,
      health: "degraded",
    });
    errorSpy.mockRestore();
  });

  it("recovers durable preparing ledgers before the scheduler scan", async () => {
    const calls: string[] = [];
    const result = await runScheduledTaskIteration(new Date("2026-09-22T04:00:00.000Z"), {
      recoverPreparing: vi.fn(async () => {
        calls.push("recovery");
        return { scanned: 2, recovered: 1, failed: 1, errors: 0 };
      }),
      projectStatuses: vi.fn(async () => {
        calls.push("projection");
        return { scanned: 1, terminalized: 0, errors: 0 };
      }),
      runDue: vi.fn(async () => {
        calls.push("scan");
        return { scanned: 3, created: 1, deferred: 1, blocked: 1, failed: 0, failureCodes: { execution_target_invalid: 1 } };
      }),
      emitMetrics: vi.fn(),
    });

    expect(calls).toEqual(["recovery", "projection", "scan"]);
    expect(result).toMatchObject({
      recovery: { scanned: 2, recovered: 1, failed: 1, errors: 0 },
      scheduled: { scanned: 3, created: 1, deferred: 1, blocked: 1, failed: 0 },
      health: "target_resolution_failure",
    });
  });

  it("classifies disabled, database and healthy scheduler states explicitly", () => {
    expect(classifyScheduledTaskHealth({ enabled: false })).toBe("disabled");
    expect(classifyScheduledTaskHealth({ enabled: true, topLevelErrorCode: "P1001" })).toBe("database_error");
    expect(classifyScheduledTaskHealth({
      enabled: true,
      scheduled: { blocked: 1, failureCodes: { execution_target_unavailable: 1 } },
    })).toBe("target_resolution_failure");
    expect(classifyScheduledTaskHealth({
      enabled: true,
      scheduled: { blocked: 0, failureCodes: {} },
      projectionErrors: 0,
      recoveryErrors: 0,
    })).toBe("healthy_scan");
  });
});
