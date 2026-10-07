import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  completeProject: vi.fn(),
  archiveProject: vi.fn(),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: mocks.actor,
}));

vi.mock("@/lib/orchestration/project-commands", () => ({
  completeProject: mocks.completeProject,
  archiveProject: mocks.archiveProject,
}));

import { POST } from "./route";

const context = { params: Promise.resolve({ projectId: "project_1" }) };

function request(body: unknown) {
  return new Request("http://localhost/api/projects/project_1/lifecycle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST project lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.mockResolvedValue({ userId: "user_1" });
    mocks.completeProject.mockResolvedValue({ projectId: "project_1", status: "completed", version: 8 });
    mocks.archiveProject.mockResolvedValue({ projectId: "project_1", status: "archived", version: 9 });
  });

  it("completes a project through the orchestration command", async () => {
    const response = await POST(request({
      command: "complete",
      commandId: "cmd_1",
      expectedVersion: 7,
      force: true,
      reason: "范围已调整，剩余里程碑转入后续项目",
    }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: { status: "completed" },
    });
    expect(mocks.completeProject).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project_1",
      expectedVersion: 7,
      force: true,
      reason: "范围已调整，剩余里程碑转入后续项目",
      actor: { type: "user", id: "user_1" },
    }));
  });

  it("archives a completed project", async () => {
    const response = await POST(request({
      command: "archive",
      commandId: "cmd_2",
      expectedVersion: 8,
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.archiveProject).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project_1",
      expectedVersion: 8,
    }));
    expect(mocks.completeProject).not.toHaveBeenCalled();
  });

  it("rejects an unsupported lifecycle command", async () => {
    const response = await POST(request({ command: "delete", commandId: "cmd_3", expectedVersion: 1 }), context);

    expect(response.status).toBe(400);
    expect(mocks.completeProject).not.toHaveBeenCalled();
    expect(mocks.archiveProject).not.toHaveBeenCalled();
  });

  it("reports a version conflict instead of blaming the request", async () => {
    mocks.completeProject.mockRejectedValue(Object.assign(new Error("Project version conflict"), { code: "version_conflict" }));

    const response = await POST(request({
      command: "complete",
      commandId: "cmd_4",
      expectedVersion: 1,
    }), context);

    expect(response.status).toBe(409);
  });

  it("rejects an unauthenticated caller before running the command", async () => {
    mocks.actor.mockRejectedValue(new Error("Workbench API authentication required"));

    const response = await POST(request({
      command: "complete",
      commandId: "cmd_5",
      expectedVersion: 1,
    }), context);

    expect(response.status).toBe(401);
    expect(mocks.completeProject).not.toHaveBeenCalled();
  });
});
