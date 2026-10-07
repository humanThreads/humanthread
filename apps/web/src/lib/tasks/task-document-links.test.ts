import { describe, expect, it, vi } from "vitest";
import { linkTaskDocument, listLinkableDocuments, unlinkTaskDocument } from "./task-document-links";

describe("task document links", () => {
  it("searches documents only inside the task access scope", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "doc_1", title: "计划", path: "需求文档/计划.md", version: 2 }]);
    await expect(listLinkableDocuments({ userId: "user_1", taskId: "task_1", query: "计划", db: { assertCanReadTask: vi.fn(), task: { findUnique: vi.fn().mockResolvedValue({ projectId: "project_1", spaceId: "space_1" }) }, document: { findMany } } })).resolves.toEqual([{ id: "doc_1", title: "计划", path: "需求文档/计划.md", version: 2 }]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ spaceId: "space_1" }) }));
  });

  it("links and unlinks with actor identity and records activity", async () => {
    const create = vi.fn().mockResolvedValue({ id: "link_1" });
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const activityCreate = vi.fn().mockResolvedValue(undefined);
    await linkTaskDocument({ userId: "user_1", taskId: "task_1", documentId: "doc_1", db: { assertCanEditTask: vi.fn(), task: { findUnique: vi.fn().mockResolvedValue({ id: "task_1", projectId: "project_1", spaceId: "space_1" }) }, document: { findUnique: vi.fn().mockResolvedValue({ id: "doc_1", spaceId: "space_1" }) }, taskDocumentLink: { create }, taskActivity: { create: activityCreate } } });
    await unlinkTaskDocument({ userId: "user_1", taskId: "task_1", documentId: "doc_1", db: { assertCanEditTask: vi.fn(), task: { findUnique: vi.fn().mockResolvedValue({ id: "task_1", projectId: "project_1", spaceId: "space_1" }) }, taskDocumentLink: { deleteMany }, taskActivity: { create: activityCreate } } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ taskId: "task_1", documentId: "doc_1", linkedById: "user_1" }) }));
    expect(deleteMany).toHaveBeenCalledWith({ where: { taskId: "task_1", documentId: "doc_1" } });
    expect(activityCreate).toHaveBeenCalledTimes(2);
  });
});
