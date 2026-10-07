import { describe, expect, it, vi } from "vitest";
import { createWorkerIteration } from "./runtime";

describe("createWorkerIteration", () => {
  it("always publishes outbox and recovers expired runs while dispatch is disabled", async () => {
    const publishOutbox = vi.fn().mockResolvedValue(undefined);
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const recover = vi.fn().mockResolvedValue(undefined);

    const iteration = createWorkerIteration({
      flags: { dispatch: false, loop: false, taskReminders: false, scheduledTasks: false },
      publishOutbox,
      dispatch,
      scheduleLoops: vi.fn().mockResolvedValue(undefined),
      scheduleScheduledTasks: vi.fn().mockResolvedValue(undefined),
      recover,
      deliverTaskReminders: vi.fn().mockResolvedValue(undefined),
    });

    await iteration();

    expect(publishOutbox).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
    expect(recover).toHaveBeenCalledOnce();
  });

  it("dispatches when the rollout flag is enabled", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const iteration = createWorkerIteration({
      flags: { dispatch: true, loop: false, taskReminders: false, scheduledTasks: false },
      publishOutbox: vi.fn().mockResolvedValue(undefined),
      dispatch,
      scheduleLoops: vi.fn().mockResolvedValue(undefined),
      scheduleScheduledTasks: vi.fn().mockResolvedValue(undefined),
      recover: vi.fn().mockResolvedValue(undefined),
      deliverTaskReminders: vi.fn().mockResolvedValue(undefined),
    });

    await iteration();

    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("delivers Task reminders after outbox publication only when enabled", async () => {
    const calls: string[] = [];
    const deliverTaskReminders = vi.fn(async () => { calls.push("reminders"); });
    const iteration = createWorkerIteration({
      flags: { dispatch: false, loop: false, taskReminders: true, scheduledTasks: false },
      publishOutbox: vi.fn(async () => { calls.push("outbox"); }),
      deliverTaskReminders,
      dispatch: vi.fn(),
      scheduleScheduledTasks: vi.fn(),
      scheduleLoops: vi.fn(),
      recover: vi.fn(async () => { calls.push("recover"); }),
    });
    await iteration();
    expect(calls).toEqual(["outbox", "reminders", "recover"]);
    expect(deliverTaskReminders).toHaveBeenCalledOnce();
  });

  it("publishes outbox before Loop scheduling", async () => {
    const calls: string[] = [];
    const iteration = createWorkerIteration({
      flags: { dispatch: false, loop: true, taskReminders: false, scheduledTasks: false },
      publishOutbox: vi.fn(async () => { calls.push("outbox"); }),
      deliverTaskReminders: vi.fn(),
      dispatch: vi.fn(),
      scheduleScheduledTasks: vi.fn(),
      scheduleLoops: vi.fn(async () => { calls.push("loop"); }),
      recover: vi.fn(async () => { calls.push("recover"); }),
    });

    await iteration();

    expect(calls).toEqual(["outbox", "loop", "recover"]);
  });

  it("defaults HUMANTHREAD_TASK_REMINDERS to disabled", async () => {
    const { readWorkerFlags } = await import("./runtime");
    expect(readWorkerFlags({})).toMatchObject({ taskReminders: false, scheduledTasks: false });
    expect(readWorkerFlags({ HUMANTHREAD_TASK_REMINDERS: "true" })).toMatchObject({ taskReminders: true, scheduledTasks: false });
  });

  it("defaults HUMANTHREAD_ORCHESTRATION_SCHEDULED_TASKS to disabled", async () => {
    const { readWorkerFlags } = await import("./runtime");
    expect(readWorkerFlags({})).toMatchObject({ scheduledTasks: false });
    expect(readWorkerFlags({ HUMANTHREAD_ORCHESTRATION_SCHEDULED_TASKS: "true" })).toMatchObject({ scheduledTasks: true });
  });

  it("runs scheduled task dispatch before graph Loop scheduling when enabled", async () => {
    const calls: string[] = [];
    const iteration = createWorkerIteration({
      flags: { dispatch: false, loop: true, taskReminders: false, scheduledTasks: true },
      publishOutbox: vi.fn(async () => { calls.push("outbox"); }),
      deliverTaskReminders: vi.fn(),
      dispatch: vi.fn(),
      scheduleScheduledTasks: vi.fn(async () => { calls.push("scheduled"); }),
      scheduleLoops: vi.fn(async () => { calls.push("loop"); }),
      recover: vi.fn(),
    });
    await iteration();
    expect(calls).toEqual(["outbox", "scheduled", "loop"]);
  });
});
