import { describe, expect, it, vi } from "vitest";
import { createTaskLabelDefinition, createTaskStatusDefinition, deleteTaskLabelDefinition, deleteTaskStatusDefinition, listTaskLabelDefinitions } from "./task-settings";

function db(role = "admin") {
  return {
    space: { findUnique: vi.fn().mockResolvedValue({ id: "space_1", type: "company", ownerUserId: null, status: "active", company: { members: [{ role, status: "active" }] } }) },
    project: { findUnique: vi.fn().mockResolvedValue({ id: "project_1", spaceId: "space_1" }) },
    taskLabel: {
      findMany: vi.fn().mockResolvedValue([{ id: "label_1" }]),
      create: vi.fn().mockResolvedValue({ id: "label_1" }),
      count: vi.fn().mockResolvedValue(0),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    taskStatusDefinition: {
      create: vi.fn().mockResolvedValue({ id: "status_1" }),
      count: vi.fn().mockResolvedValue(0),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe("Task Space settings", () => {
  it("allows only company owner/admin to create label definitions", async () => {
    await expect(createTaskLabelDefinition({ userId: "user_1", spaceId: "space_1", id: "label_1", name: "安全", color: "#cf222e", db: db("member") as never }))
      .rejects.toMatchObject({ code: "task_access_denied" });
    await expect(createTaskLabelDefinition({ userId: "user_1", spaceId: "space_1", id: "label_1", name: "安全", color: "#cf222e", db: db() as never }))
      .resolves.toMatchObject({ id: "label_1" });
  });

  it("allows an active company member to read definitions", async () => {
    await expect(listTaskLabelDefinitions({ userId: "user_1", spaceId: "space_1", db: db("member") as never }))
      .resolves.toEqual([{ id: "label_1" }]);
  });

  it("allows only company owner/admin to delete label definitions", async () => {
    await expect(deleteTaskLabelDefinition({ userId: "user_1", spaceId: "space_1", labelId: "label_1", db: db("member") as never }))
      .rejects.toMatchObject({ code: "task_access_denied" });
    await expect(deleteTaskLabelDefinition({ userId: "user_1", spaceId: "space_1", labelId: "label_1", db: db() as never }))
      .resolves.toMatchObject({ count: 1 });
  });

  it("requires a fixed category and matching Project Space", async () => {
    await expect(createTaskStatusDefinition({
      userId: "user_1", spaceId: "space_1", projectId: "project_1", id: "status_1", key: "qa",
      name: "质量验收", category: "custom" as never, color: "#0969da", sortOrder: 3, db: db() as never,
    })).rejects.toMatchObject({ code: "validation_failed" });
    const mismatch = db();
    mismatch.project.findUnique.mockResolvedValue({ id: "project_1", spaceId: "space_other" });
    await expect(createTaskStatusDefinition({
      userId: "user_1", spaceId: "space_1", projectId: "project_1", id: "status_1", key: "qa",
      name: "质量验收", category: "in_review", color: "#0969da", sortOrder: 3, db: mismatch as never,
    })).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects deleting labels or statuses still in use", async () => {
    const dependencies = db();
    dependencies.taskLabel.count.mockResolvedValue(1);
    dependencies.taskStatusDefinition.count.mockResolvedValue(1);
    await expect(deleteTaskLabelDefinition({ userId: "user_1", spaceId: "space_1", labelId: "label_1", db: dependencies as never }))
      .rejects.toMatchObject({ code: "version_conflict" });
    await expect(deleteTaskStatusDefinition({ userId: "user_1", spaceId: "space_1", definitionId: "status_1", db: dependencies as never }))
      .rejects.toMatchObject({ code: "version_conflict" });
  });
});
