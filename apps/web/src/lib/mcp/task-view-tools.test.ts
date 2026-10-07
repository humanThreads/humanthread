import { describe, expect, it, vi } from "vitest";
import { dispatchMcpTaskViewTool } from "./task-view-tools";

describe("MCP Task saved view tools", () => {
  it("creates a saved view with normalized query fields and a discoverable ID", async () => {
    const saveTaskView = vi.fn().mockResolvedValue({ id: "view:created", name: "逾期发布" });
    const result = await dispatchMcpTaskViewTool({
      tool: "create_task_saved_view",
      actorUserId: "user_1",
      arguments: { name: "逾期发布", query: { relation: "overdue", priority: [2], view: "list" } },
    }, { saveTaskView });

    expect(saveTaskView).toHaveBeenCalledWith(expect.objectContaining({ id: expect.stringMatching(/^view:/u), name: "逾期发布", query: expect.objectContaining({ relation: "overdue", priority: [2] }) }));
    expect(result).toEqual({ view: { id: "view:created", name: "逾期发布" }, keyGuide: { viewId: "view.id" } });
  });

  it("lists and deletes views using the returned view ID", async () => {
    const listTaskSavedViews = vi.fn().mockResolvedValue([{ id: "view_1", name: "本周" }]);
    const deleteTaskSavedView = vi.fn().mockResolvedValue({ count: 1 });
    const listed = await dispatchMcpTaskViewTool({ tool: "list_task_saved_views", actorUserId: "user_1", arguments: {} }, { listTaskSavedViews });
    const deleted = await dispatchMcpTaskViewTool({ tool: "delete_task_saved_view", actorUserId: "user_1", arguments: { viewId: "view_1" } }, { deleteTaskSavedView });

    expect(listed).toEqual({ views: [{ id: "view_1", name: "本周" }], keyGuide: { viewId: "views[].id" } });
    expect(deleteTaskSavedView).toHaveBeenCalledWith({ userId: "user_1", viewId: "view_1" });
    expect(deleted).toEqual({ result: { count: 1 }, keyGuide: { viewId: "request.viewId" } });
  });
});
