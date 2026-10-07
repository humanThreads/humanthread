import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateUserTaskContent } from "@/lib/tasks/task-commands";
import { getTaskDetailView } from "@/lib/tasks/task-read-model";
import { GET, PATCH } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }),
}));
vi.mock("@/lib/tasks/task-commands", () => ({ updateUserTaskContent: vi.fn() }));
vi.mock("@/lib/tasks/task-read-model", () => ({ getTaskDetailView: vi.fn() }));

const context = { params: Promise.resolve({ taskId: "task_1" }) };

describe("/api/tasks/:taskId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hides an inaccessible Task as 404", async () => {
    vi.mocked(getTaskDetailView).mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api/tasks/task_1"), context);
    expect(response.status).toBe(404);
  });

  it("preserves Markdown and requires expectedVersion for PATCH", async () => {
    const invalid = await PATCH(new Request("http://localhost/api/tasks/task_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentMarkdown: "# 验收" }),
    }), context);
    expect(invalid.status).toBe(400);

    vi.mocked(updateUserTaskContent).mockResolvedValue({ taskId: "task_1", version: 2 } as never);
    const request = new Request("http://localhost/api/tasks/task_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "user_attacker",
        commandId: "command_content",
        expectedVersion: 1,
        contentMarkdown: "# 验收\n\n- [ ] 安全检查",
      }),
    });
    const response = await PATCH(request, context);
    expect(response.status).toBe(200);
    expect(updateUserTaskContent).toHaveBeenCalledWith(expect.objectContaining({
      actor: { type: "user", id: "user_session" },
      contentMarkdown: "# 验收\n\n- [ ] 安全检查",
      expectedVersion: 1,
    }));
  });

  it("maps optimistic conflicts to 409", async () => {
    vi.mocked(updateUserTaskContent).mockRejectedValue(Object.assign(new Error("stale"), { code: "version_conflict" }));
    const response = await PATCH(new Request("http://localhost/api/tasks/task_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "command_1", expectedVersion: 1, contentMarkdown: "updated" }),
    }), context);
    expect(response.status).toBe(409);
  });
});
