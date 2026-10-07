import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLegacyTaskUsageSnapshot, resetLegacyTaskUsage } from "../tasks/task-rollout";
import { getWorkbenchTaskDetail } from "./workbench-task-detail";

describe("workbench task detail", () => {
  beforeEach(() => {
    resetLegacyTaskUsage();
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("uses the shared space-aware project access filter", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);

    await getWorkbenchTaskDetail({
      taskId: "task_1",
      userId: "user_1",
      db: { task: { findFirst } },
    });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "task_1",
          project: expect.objectContaining({
            OR: expect.arrayContaining([
              {
                space: {
                  type: "personal",
                  status: "active",
                  ownerUserId: "user_1",
                },
              },
            ]),
          }),
        },
      }),
    );
    expect(getLegacyTaskUsageSnapshot()).toMatchObject({
      reads: 1,
      surfaces: { "workbench-task-detail": 1 },
    });
  });
});
