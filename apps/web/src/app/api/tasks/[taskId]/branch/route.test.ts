import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assignTaskBranch } from "@/lib/tasks/task-branch-command";
import { POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }),
}));
vi.mock("@/lib/tasks/task-branch-command", () => ({ assignTaskBranch: vi.fn() }));

describe("POST /api/tasks/:taskId/branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("HUMANTHREAD_DEVELOPMENT_MODES", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("assigns a server-derived branch for the signed actor", async () => {
    vi.mocked(assignTaskBranch).mockResolvedValue({ taskId: "task_1", taskBranch: "2026-HT100023", version: 4 });
    const response = await POST(new Request("http://localhost/api/tasks/task_1/branch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "assign_branch_1", expectedVersion: 3, branch: "caller-value" }),
    }), { params: Promise.resolve({ taskId: "task_1" }) });

    expect(response.status).toBe(200);
    expect(assignTaskBranch).toHaveBeenCalledWith({
      actor: { type: "user", id: "user_session" },
      commandId: "assign_branch_1",
      correlationId: "task:task_1",
      taskId: "task_1",
      expectedVersion: 3,
    });
  });
});
