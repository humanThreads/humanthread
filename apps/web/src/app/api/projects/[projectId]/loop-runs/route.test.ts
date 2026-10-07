import { beforeEach, describe, expect, it, vi } from "vitest";
import { triggerProjectLoop } from "@/lib/orchestration/loop-trigger-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@/lib/orchestration/loop-trigger-commands", () => ({ triggerProjectLoop: vi.fn() }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const context = { params: Promise.resolve({ projectId: "project_1" }) };

describe("POST /api/projects/:projectId/loop-runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_session", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  });

  it("triggers a manual Run for the signed actor", async () => {
    vi.mocked(triggerProjectLoop).mockResolvedValue({ id: "loop_run_1", engineKind: "graph_v1" });
    const response = await POST(new Request("http://localhost/api/projects/project_1/loop-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "manual_1", bindingId: "binding_1", payload: { objective: "Ship" } }),
    }), context);

    expect(response.status).toBe(201);
    expect(triggerProjectLoop).toHaveBeenCalledWith({
      actorUserId: "user_session",
      projectId: "project_1",
      commandId: "manual_1",
      bindingId: "binding_1",
      payload: { objective: "Ship" },
    });
  });

  it("rejects caller-controlled transition and actor fields", async () => {
    const response = await POST(new Request("http://localhost/api/projects/project_1/loop-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "manual_1",
        bindingId: "binding_1",
        payload: {},
        userId: "forged",
        selectedEdgeId: "forged",
      }),
    }), context);

    expect(response.status).toBe(400);
    expect(triggerProjectLoop).not.toHaveBeenCalled();
  });

  it("returns policy denials as forbidden", async () => {
    vi.mocked(triggerProjectLoop).mockRejectedValue(Object.assign(
      new Error("Graph Loop rollout is not enabled"),
      { code: "policy_denied" },
    ));

    const response = await POST(new Request("http://localhost/api/projects/project_1/loop-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "manual_1", bindingId: "binding_1", payload: {} }),
    }), context);

    expect(response.status).toBe(403);
  });

  it("authenticates before parsing the request body", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValue(new Error("Workbench API authentication required"));

    const response = await POST(new Request("http://localhost/api/projects/project_1/loop-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    }), context);

    expect(response.status).toBe(401);
    expect(triggerProjectLoop).not.toHaveBeenCalled();
  });
});
