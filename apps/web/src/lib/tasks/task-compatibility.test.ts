import { describe, expect, it, vi } from "vitest";
import { syncLegacyUserTaskProjection } from "./task-compatibility";

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    rollout: { reads: true, writes: true },
    loadTask: vi.fn().mockResolvedValue({ statusCategory: "todo", acceptanceMode: "none", version: 3 }),
    changeStatus: vi.fn().mockResolvedValue({ version: 4 }),
    addBlocker: vi.fn().mockResolvedValue({ version: 4 }),
    ...overrides,
  };
}

describe("legacy user Task compatibility", () => {
  it("does not dual-write while the rollout write flag is off", async () => {
    const deps = dependencies({ rollout: { reads: true, writes: false } });
    await expect(syncLegacyUserTaskProjection({ taskId: "task_1", actorUserId: "user_1", legacyStatus: "active" }, deps)).resolves.toEqual({ synced: false, reason: "writes_disabled" });
    expect(deps.loadTask).not.toHaveBeenCalled();
  });

  it("maps legacy start, block and controlled completion into user Task commands", async () => {
    const started = dependencies();
    await syncLegacyUserTaskProjection({ taskId: "task_1", actorUserId: "user_1", legacyStatus: "active" }, started);
    expect(started.changeStatus).toHaveBeenCalledWith(expect.objectContaining({ command: "start", expectedVersion: 3 }));

    const blocked = dependencies({ loadTask: vi.fn().mockResolvedValue({ statusCategory: "in_progress", acceptanceMode: "none", version: 4 }) });
    await syncLegacyUserTaskProjection({ taskId: "task_1", actorUserId: "user_1", legacyStatus: "blocked", reason: "等待审批" }, blocked);
    expect(blocked.addBlocker).toHaveBeenCalledWith(expect.objectContaining({ reason: "等待审批", expectedVersion: 4 }));

    const controlled = dependencies({ loadTask: vi.fn().mockResolvedValue({ statusCategory: "in_progress", acceptanceMode: "human", version: 5 }) });
    await syncLegacyUserTaskProjection({ taskId: "task_1", actorUserId: "user_1", legacyStatus: "completed" }, controlled);
    expect(controlled.changeStatus).toHaveBeenCalledWith(expect.objectContaining({ command: "submit_for_review", expectedVersion: 5 }));
  });
});
