import { beforeEach, describe, expect, it, vi } from "vitest";
import { commandProjectRoadmap } from "@/lib/orchestration/project-roadmap-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@/lib/orchestration/project-roadmap-commands", () => ({ commandProjectRoadmap: vi.fn() }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "manager_1" }) }));

describe("POST /api/projects/:projectId/roadmap", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the signed actor and returns the next Project version", async () => {
    vi.mocked(commandProjectRoadmap).mockResolvedValue({ projectId: "project_1", version: 5 });
    const request = new Request("http://localhost/api/projects/project_1/roadmap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: "forged", commandId: "command_1", expectedVersion: 4, action: { type: "stage.create", name: "发布" } }) });
    const response = await POST(request, { params: Promise.resolve({ projectId: "project_1" }) });
    expect(response.status).toBe(200);
    expect(commandProjectRoadmap).toHaveBeenCalledWith(expect.objectContaining({ actor: { type: "user", id: "manager_1" } }));
    await expect(response.json()).resolves.toEqual({ ok: true, result: { projectId: "project_1", version: 5 } });
  });

  it("maps optimistic conflicts and redacts unexpected errors", async () => {
    vi.mocked(commandProjectRoadmap).mockRejectedValueOnce(Object.assign(new Error("stale"), { code: "version_conflict" }));
    const body = JSON.stringify({ commandId: "command_1", expectedVersion: 4, action: { type: "stage.create", name: "发布" } });
    const conflict = await POST(new Request("http://localhost/api/projects/project_1/roadmap", { method: "POST", headers: { "content-type": "application/json" }, body }), { params: Promise.resolve({ projectId: "project_1" }) });
    expect(conflict.status).toBe(409);
    vi.mocked(commandProjectRoadmap).mockRejectedValueOnce(new Error("database password leaked"));
    const failure = await POST(new Request("http://localhost/api/projects/project_1/roadmap", { method: "POST", headers: { "content-type": "application/json" }, body }), { params: Promise.resolve({ projectId: "project_1" }) });
    expect(failure.status).toBe(500);
    await expect(failure.json()).resolves.toEqual({ ok: false, code: "internal_error", error: "Project roadmap update failed" });
  });

  it("rejects an unknown action before resolving the actor", async () => {
    const response = await POST(new Request("http://localhost/api/projects/project_1/roadmap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "command_1", expectedVersion: 4, action: { type: "project.erase" } }) }), { params: Promise.resolve({ projectId: "project_1" }) });
    expect(response.status).toBe(400);
    expect(resolveWorkbenchApiActor).not.toHaveBeenCalled();
    expect(commandProjectRoadmap).not.toHaveBeenCalled();
  });

  it("rejects an action whose required fields are missing", async () => {
    const response = await POST(new Request("http://localhost/api/projects/project_1/roadmap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "command_1", expectedVersion: 4, action: { type: "milestone.update", name: "缺少节点身份" } }) }), { params: Promise.resolve({ projectId: "project_1" }) });
    expect(response.status).toBe(400);
    expect(commandProjectRoadmap).not.toHaveBeenCalled();
  });
});
