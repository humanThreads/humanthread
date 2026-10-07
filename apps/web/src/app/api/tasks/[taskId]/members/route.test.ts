import { beforeEach, describe, expect, it, vi } from "vitest";
import { addUserTaskMember, removeUserTaskMember } from "@/lib/tasks/task-commands";
import { DELETE, POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }) }));
vi.mock("@/lib/tasks/task-commands", () => ({ addUserTaskMember: vi.fn(), removeUserTaskMember: vi.fn() }));

const context = { params: Promise.resolve({ taskId: "task_1" }) };

describe("Task member API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds only participant or follower roles", async () => {
    expect((await POST(new Request("http://localhost/api/tasks/task_1/members", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "cmd_1", expectedVersion: 1, userId: "user_2", role: "owner" }),
    }), context)).status).toBe(400);

    vi.mocked(addUserTaskMember).mockResolvedValue({ taskId: "task_1", userId: "user_2", role: "participant", version: 2 } as never);
    const response = await POST(new Request("http://localhost/api/tasks/task_1/members", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:1420" },
      body: JSON.stringify({ commandId: "cmd_2", expectedVersion: 1, userId: "user_2", role: "participant" }),
    }), context);
    expect(response.status).toBe(201);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:1420");
    expect(addUserTaskMember).toHaveBeenCalledWith(expect.objectContaining({ actor: { type: "user", id: "user_session" } }));
  });

  it("removes a member through a versioned command", async () => {
    vi.mocked(removeUserTaskMember).mockResolvedValue({ taskId: "task_1", userId: "user_2", version: 2 } as never);
    const response = await DELETE(new Request("http://localhost/api/tasks/task_1/members", {
      method: "DELETE", headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "cmd_3", expectedVersion: 1, userId: "user_2" }),
    }), context);
    expect(response.status).toBe(200);
  });
});
