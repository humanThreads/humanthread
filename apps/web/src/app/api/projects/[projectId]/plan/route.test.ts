import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { submitProjectPlan } from "@/lib/orchestration/project-commands";
import { POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }),
}));
vi.mock("@/lib/orchestration/project-commands", () => ({ submitProjectPlan: vi.fn() }));

describe("POST /api/projects/:projectId/plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the signed session actor and ignores a body userId", async () => {
    vi.mocked(submitProjectPlan).mockResolvedValue({ projectId: "project_1", status: "planned", version: 2 });
    const request = new Request("http://localhost/api/projects/project_1/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "forged",
        commandId: "cmd_1",
        expectedVersion: 1,
        objective: "Ship",
        stages: [{ key: "delivery", name: "Delivery", milestones: [{ name: "MVP" }] }],
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ projectId: "project_1" }) });

    expect(response.status).toBe(200);
    expect(resolveWorkbenchApiActor).toHaveBeenCalledWith(request);
    expect(submitProjectPlan).toHaveBeenCalledWith(expect.objectContaining({
      actor: { type: "user", id: "user_session" },
    }));
  });

  it("maps version conflicts to 409", async () => {
    vi.mocked(submitProjectPlan).mockRejectedValue(Object.assign(new Error("stale"), { code: "version_conflict" }));
    const response = await POST(new Request("http://localhost/api/projects/project_1/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "cmd_1", expectedVersion: 1, objective: "Ship", stages: [] }),
    }), { params: Promise.resolve({ projectId: "project_1" }) });
    expect(response.status).toBe(409);
  });
});
