import { describe, expect, it, vi } from "vitest";
import { assignTaskBranch } from "./task-branch-command";

describe("assignTaskBranch", () => {
  it("assigns the deterministic branch with Task version locking", async () => {
    const loadTask = vi.fn().mockResolvedValue({
      id: "task_1",
      spaceId: "space_1",
      projectId: "project_1",
      createdById: "user_1",
      assigneeUserId: "user_1",
      version: 3,
      createdAt: new Date("2026-08-03T00:00:00.000Z"),
      shortId: "HT100023",
      taskBranch: null,
      developmentTemplateKey: "branch-development",
    });
    const authorize = vi.fn().mockResolvedValue(undefined);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const execute = vi.fn(async (input) => (await input.persist({ task: { updateMany } })).result);

    await expect(assignTaskBranch({
      actor: { type: "user", id: "user_1" },
      commandId: "assign_branch_1",
      correlationId: "task_1",
      taskId: "task_1",
      expectedVersion: 3,
    }, {
      loadTask,
      authorize,
      execute,
    })).resolves.toEqual({ taskId: "task_1", taskBranch: "2026-HT100023", version: 4 });

    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ action: "edit_content", taskId: "task_1" }));
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "task_1", version: 3, taskBranch: null },
      data: expect.objectContaining({ taskBranch: "2026-HT100023", version: { increment: 1 } }),
    });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "task.branch_assigned",
      eventPayload: expect.objectContaining({
        taskId: "task_1",
        branch: "2026-HT100023",
        year: 2026,
        shortId: "HT100023",
        assignedByActor: "user_1",
      }),
    }));
  });

  it("returns an existing branch without changing it", async () => {
    const execute = vi.fn();
    await expect(assignTaskBranch({
      actor: { type: "user", id: "user_1" },
      commandId: "assign_branch_2",
      correlationId: "task_1",
      taskId: "task_1",
      expectedVersion: 99,
    }, {
      loadTask: vi.fn().mockResolvedValue({
        id: "task_1", spaceId: "space_1", projectId: "project_1", createdById: "user_1", assigneeUserId: "user_1",
        version: 4, createdAt: new Date("2026-08-03T00:00:00.000Z"), shortId: "HT100023", taskBranch: "2026-HT100023",
        developmentTemplateKey: "branch-development",
      }),
      authorize: vi.fn().mockResolvedValue(undefined),
      execute,
    })).resolves.toEqual({ taskId: "task_1", taskBranch: "2026-HT100023", version: 4 });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects Tasks outside the branch-development mode", async () => {
    await expect(assignTaskBranch({
      actor: { type: "user", id: "user_1" }, commandId: "assign_branch_3", correlationId: "task_1", taskId: "task_1", expectedVersion: 1,
    }, {
      loadTask: vi.fn().mockResolvedValue({
        id: "task_1", spaceId: "space_1", projectId: "project_1", createdById: "user_1", assigneeUserId: "user_1",
        version: 1, createdAt: new Date("2026-08-03T00:00:00.000Z"), shortId: "HT100023", taskBranch: null,
        developmentTemplateKey: null,
      }),
      authorize: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn(),
    })).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("accepts a custom development template whose kind is branch-development", async () => {
    const execute = vi.fn(async (input) => ({ taskId: input.taskId, taskBranch: "2026-HT100023", version: 2 }));
    await expect(assignTaskBranch({
      actor: { type: "user", id: "user_1" }, commandId: "assign_branch_custom", correlationId: "task_1", taskId: "task_1", expectedVersion: 1,
    }, {
      loadTask: vi.fn().mockResolvedValue({
        id: "task_1", spaceId: "space_1", projectId: "project_1", createdById: "user_1", assigneeUserId: "user_1",
        version: 1, createdAt: new Date("2026-08-03T00:00:00.000Z"), shortId: "HT100023", taskBranch: null,
        developmentTemplateKey: "space_space_1_custom", developmentTemplateKind: "branch-development",
      }),
      authorize: vi.fn().mockResolvedValue(undefined),
      execute,
    })).resolves.toEqual({ taskId: "task_1", taskBranch: "2026-HT100023", version: 2 });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("bounds the durable activity ID for a maximum-length command ID", async () => {
    const execute = vi.fn(async (input) => ({ taskId: input.taskId, taskBranch: "2026-HT100023", version: 2 }));
    await assignTaskBranch({
      actor: { type: "user", id: "user_1" }, commandId: "c".repeat(128), correlationId: "task_1", taskId: "task_1", expectedVersion: 1,
    }, {
      loadTask: vi.fn().mockResolvedValue({
        id: "task_1", spaceId: "space_1", projectId: "project_1", createdById: "user_1", assigneeUserId: "user_1",
        version: 1, createdAt: new Date("2026-08-03T00:00:00.000Z"), shortId: "HT100023", taskBranch: null,
        developmentTemplateKey: "branch-development",
      }),
      authorize: vi.fn().mockResolvedValue(undefined),
      execute,
    });
    expect(execute.mock.calls[0]?.[0].activity.id.length).toBeLessThanOrEqual(128);
  });
});
