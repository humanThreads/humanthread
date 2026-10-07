import { describe, expect, it, vi } from "vitest";
import { createTaskStatusDefinition, deleteTaskStatusDefinition } from "@/lib/tasks/task-settings";
import { DELETE, POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }) }));
vi.mock("@/lib/tasks/task-settings", () => ({ createTaskStatusDefinition: vi.fn(), deleteTaskStatusDefinition: vi.fn() }));

describe("Task status definition API", () => {
  it("rejects a display state without a fixed category", async () => {
    const response = await POST(new Request("http://localhost/api/task-status-definitions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "status_1", spaceId: "space_1", key: "custom", name: "自定义", category: "custom", color: "#0969da", sortOrder: 1 }),
    }));
    expect(response.status).toBe(400);
    expect(createTaskStatusDefinition).not.toHaveBeenCalled();
  });

  it("creates and deletes through the signed administrator", async () => {
    vi.mocked(createTaskStatusDefinition).mockResolvedValue({ id: "status_1" } as never);
    vi.mocked(deleteTaskStatusDefinition).mockResolvedValue({ count: 1 });
    const create = await POST(new Request("http://localhost/api/task-status-definitions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "attacker", id: "status_1", spaceId: "space_1", key: "qa", name: "质量验收", category: "in_review", color: "#0969da", sortOrder: 1 }),
    }));
    expect(create.status).toBe(201);
    expect(createTaskStatusDefinition).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_session" }));
    expect((await DELETE(new Request("http://localhost/api/task-status-definitions", {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ spaceId: "space_1", definitionId: "status_1" }),
    }))).status).toBe(200);
  });
});
