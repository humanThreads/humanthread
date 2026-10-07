import { describe, expect, it, vi } from "vitest";
import { addUserTaskLabel, removeUserTaskLabel } from "@/lib/tasks/task-commands";
import { DELETE, POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }) }));
vi.mock("@/lib/tasks/task-commands", () => ({ addUserTaskLabel: vi.fn(), removeUserTaskLabel: vi.fn() }));

const context = { params: Promise.resolve({ taskId: "task_1" }) };

describe("Task label assignment API", () => {
  it("adds and removes labels through Task commands", async () => {
    vi.mocked(addUserTaskLabel).mockResolvedValue({ labelId: "label_1", version: 2 } as never);
    vi.mocked(removeUserTaskLabel).mockResolvedValue({ labelId: "label_1", version: 3 } as never);
    const addResponse = await POST(new Request("http://localhost/api/tasks/task_1/labels", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:1420" },
      body: JSON.stringify({ commandId: "cmd_1", expectedVersion: 1, labelId: "label_1" }),
    }), context);
    expect(addResponse.status).toBe(201);
    expect(addResponse.headers.get("access-control-allow-origin")).toBe("http://localhost:1420");
    expect((await DELETE(new Request("http://localhost/api/tasks/task_1/labels", {
      method: "DELETE", headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "cmd_2", expectedVersion: 2, labelId: "label_1" }),
    }), context)).status).toBe(200);
  });
});
