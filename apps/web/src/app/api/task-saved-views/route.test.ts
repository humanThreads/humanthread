import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteTaskSavedView, listTaskSavedViews, saveTaskView, updateTaskSavedView } from "@/lib/tasks/task-read-model";
import { DELETE, GET, OPTIONS, PATCH, POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }) }));
vi.mock("@/lib/tasks/task-read-model", () => ({
  deleteTaskSavedView: vi.fn(), listTaskSavedViews: vi.fn(), saveTaskView: vi.fn(), updateTaskSavedView: vi.fn(),
}));

describe("private Task saved view API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("always scopes saved views to the signed user", async () => {
    vi.mocked(listTaskSavedViews).mockResolvedValue([]);
    await GET(new Request("http://localhost/api/task-saved-views?userId=attacker"));
    expect(listTaskSavedViews).toHaveBeenCalledWith({ userId: "user_session" });

    vi.mocked(saveTaskView).mockResolvedValue({ id: "view_1" } as never);
    const response = await POST(new Request("http://localhost/api/task-saved-views", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "attacker", id: "view_1", name: "我的任务", relation: "assigned", view: "list" }),
    }));
    expect(response.status).toBe(201);
    expect(saveTaskView).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_session" }));
  });

  it("updates and deletes only the signed user's view", async () => {
    vi.mocked(updateTaskSavedView).mockResolvedValue({ count: 1 });
    vi.mocked(deleteTaskSavedView).mockResolvedValue({ count: 1 });
    await PATCH(new Request("http://localhost/api/task-saved-views", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId: "view_1", name: "本周", view: "board" }),
    }));
    await DELETE(new Request("http://localhost/api/task-saved-views", {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ viewId: "view_1" }),
    }));
    expect(updateTaskSavedView).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_session", viewId: "view_1" }));
    expect(deleteTaskSavedView).toHaveBeenCalledWith({ userId: "user_session", viewId: "view_1" });
  });

  it("allows desktop origins to read and save private views", async () => {
    const origin = "http://localhost:1420";
    vi.mocked(listTaskSavedViews).mockResolvedValue([]);

    const preflight = OPTIONS(new Request("http://localhost/api/task-saved-views", {
      method: "OPTIONS",
      headers: { origin },
    }));
    const response = await GET(new Request("http://localhost/api/task-saved-views", {
      headers: { origin },
    }));

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
  });
});
