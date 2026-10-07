import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { createUserTask } from "@/lib/tasks/task-commands";
import { getTaskCollection } from "@/lib/tasks/task-read-model";
import { GET, POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }),
}));
vi.mock("@/lib/tasks/task-commands", () => ({ createUserTask: vi.fn() }));
vi.mock("@/lib/tasks/task-read-model", () => ({ getTaskCollection: vi.fn() }));

describe("/api/tasks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses collection filters for the signed actor", async () => {
    vi.mocked(getTaskCollection).mockResolvedValue({ listRows: [], boardGroups: [], total: 0 } as never);
    const request = new Request("http://localhost/api/tasks?spaceId=space_1&relation=assigned&view=board&status=todo,in_progress");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(getTaskCollection).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user_session",
      spaceId: "space_1",
      query: expect.objectContaining({ relation: "assigned", view: "board", status: ["todo", "in_progress"] }),
    }));
  });

  it("creates a title-only Task and ignores a forged userId", async () => {
    vi.mocked(createUserTask).mockResolvedValue({ taskId: "task_1", statusCategory: "todo", version: 1 } as never);
    const request = new Request("http://localhost/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "user_attacker",
        commandId: "command_1",
        spaceId: "space_1",
        title: "整理发布清单",
      }),
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(resolveWorkbenchApiActor).toHaveBeenCalledWith(request);
    expect(createUserTask).toHaveBeenCalledWith(expect.objectContaining({
      actor: { type: "user", id: "user_session" },
      commandId: "command_1",
      payload: expect.objectContaining({ spaceId: "space_1", title: "整理发布清单" }),
    }));
  });

  it("forwards bounded required checks when creating an automated Task", async () => {
    vi.mocked(createUserTask).mockResolvedValue({ taskId: "task_automated", statusCategory: "todo", version: 1 } as never);
    const response = await POST(new Request("http://localhost/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "command_automated",
        spaceId: "space_1",
        projectId: "project_1",
        title: "自动发布",
        acceptanceMode: "automated",
        requiredChecks: ["test", "typecheck"],
      }),
    }));

    expect(response.status).toBe(201);
    expect(createUserTask).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        acceptanceMode: "automated",
        acceptancePolicy: { requiredChecks: ["test", "typecheck"] },
      }),
    }));
  });

  it("rejects automated Task creation without a Project", async () => {
    vi.mocked(createUserTask).mockResolvedValue({ taskId: "task_invalid", statusCategory: "todo", version: 1 } as never);
    const response = await POST(new Request("http://localhost/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "command_automated_without_project",
        spaceId: "space_1",
        title: "自动发布",
        acceptanceMode: "automated",
        requiredChecks: ["delivery"],
      }),
    }));

    expect(response.status).toBe(400);
    expect(createUserTask).not.toHaveBeenCalled();
  });

  it("returns 401 when no Workbench session exists", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValueOnce(new Error("Workbench API authentication required"));
    expect((await GET(new Request("http://localhost/api/tasks"))).status).toBe(401);
  });
});
