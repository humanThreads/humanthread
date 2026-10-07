import { describe, expect, it, vi } from "vitest";
import {
  addTaskDependencyRecord,
  updateProjectGovernance,
} from "./project-orchestration";

describe("project orchestration repositories", () => {
  it("rejects a stale project version", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });

    await expect(updateProjectGovernance({
      tx: { project: { updateMany } },
      projectId: "project_1",
      expectedVersion: 2,
      data: { status: "active" },
    })).rejects.toMatchObject({ code: "version_conflict" });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "project_1", version: 2 },
      data: { status: "active", version: { increment: 1 } },
    });
  });

  it("rejects a dependency cycle before persistence", async () => {
    const create = vi.fn();
    const findMany = vi.fn().mockResolvedValue([
      { predecessorTaskId: "task_a", successorTaskId: "task_b", type: "blocks" },
    ]);

    await expect(addTaskDependencyRecord({
      tx: { taskDependency: { findMany, create } },
      dependency: {
        id: "dep_2",
        projectId: "project_1",
        predecessorTaskId: "task_b",
        successorTaskId: "task_a",
        type: "blocks",
        createdByActor: "user:user_1",
      },
    })).rejects.toMatchObject({ code: "validation_failed" });

    expect(create).not.toHaveBeenCalled();
  });
});
