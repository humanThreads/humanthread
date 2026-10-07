import { describe, expect, it, vi } from "vitest";

import { runDueKnowledgeSchedules } from "./knowledge-schedule-runner";

describe("runDueKnowledgeSchedules", () => {
  it("creates one deterministic scheduled generation task for a due policy", async () => {
    const createTask = vi.fn(async () => ({
      jobId: "a".repeat(32),
      taskId: "b".repeat(32),
      projectDigest: "c".repeat(32),
      mode: "scheduled_update" as const,
      duplicate: false,
    }));
    const result = await runDueKnowledgeSchedules({
      now: new Date("2026-09-20T18:15:00.000Z"),
      templateVersionId: "d".repeat(32),
      dependencies: {
        listPolicies: vi.fn(async () => [{
          projectDigest: "c".repeat(32),
          projectId: "project_1",
          scheduleRule: "15 2 * * *",
          scheduleTimezone: "Asia/Shanghai",
        }]),
        createTask,
      },
    });

    expect(result).toEqual({ created: 1, skipped: 0 });
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project_1",
      actorUserId: "system",
      mode: "scheduled_update",
      templateVersionId: "d".repeat(32),
    }));
  });

  it("does nothing when scheduling is not configured", async () => {
    await expect(runDueKnowledgeSchedules({
      now: new Date(),
      dependencies: { listPolicies: vi.fn(), createTask: vi.fn() },
    })).resolves.toEqual({ created: 0, skipped: 0 });
  });
});
