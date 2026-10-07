import { describe, expect, it, vi } from "vitest";
import { createTaskLabelDefinition, deleteTaskLabelDefinition } from "@/lib/tasks/task-settings";
import { DELETE, POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }) }));
vi.mock("@/lib/tasks/task-settings", () => ({ createTaskLabelDefinition: vi.fn(), deleteTaskLabelDefinition: vi.fn() }));

describe("Task label definition API", () => {
  it("mutates definitions as the signed administrator", async () => {
    vi.mocked(createTaskLabelDefinition).mockResolvedValue({ id: "label_1" } as never);
    const response = await POST(new Request("http://localhost/api/task-labels", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "attacker", id: "label_1", spaceId: "space_1", name: "安全", color: "#cf222e" }),
    }));
    expect(response.status).toBe(201);
    expect(createTaskLabelDefinition).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_session" }));
  });

  it("maps in-use deletion to 409", async () => {
    vi.mocked(deleteTaskLabelDefinition).mockRejectedValue(Object.assign(new Error("in use"), { code: "version_conflict" }));
    const response = await DELETE(new Request("http://localhost/api/task-labels", {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ spaceId: "space_1", labelId: "label_1" }),
    }));
    expect(response.status).toBe(409);
  });
});
