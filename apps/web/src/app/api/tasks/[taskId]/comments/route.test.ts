import { expect, it, vi } from "vitest";
import { addUserTaskComment } from "@/lib/tasks/task-commands";
import { POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }) }));
vi.mock("@/lib/tasks/task-commands", () => ({ addUserTaskComment: vi.fn() }));

it("adds a Markdown comment as the signed user", async () => {
  vi.mocked(addUserTaskComment).mockResolvedValue({ commentId: "comment_1", version: 2 } as never);
  const response = await POST(new Request("http://localhost/api/tasks/task_1/comments", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:1420" },
    body: JSON.stringify({ commandId: "cmd_1", expectedVersion: 1, contentMarkdown: "**完成**", userId: "attacker" }),
  }), { params: Promise.resolve({ taskId: "task_1" }) });
  expect(response.status).toBe(201);
  expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:1420");
  expect(addUserTaskComment).toHaveBeenCalledWith(expect.objectContaining({
    actor: { type: "user", id: "user_session" }, commandId: "cmd_1", contentMarkdown: "**完成**",
  }));
});
