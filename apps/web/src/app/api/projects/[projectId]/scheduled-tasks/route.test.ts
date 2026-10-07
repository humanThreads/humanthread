import { beforeEach, describe, expect, it, vi } from "vitest";

import { createProjectScheduledTask } from "@humanthread/db";
import { readProjectScheduledTaskList } from "@/lib/orchestration/scheduled-task-read-model";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

import { GET, POST } from "./route";

vi.mock("@humanthread/db", () => ({
  createProjectScheduledTask: vi.fn(),
}));

vi.mock("@/lib/orchestration/scheduled-task-read-model", () => ({
  readProjectScheduledTaskList: vi.fn(),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn(),
}));

const context = { params: Promise.resolve({ projectId: "project_1" }) };
const createBody = {
  commandId: "cmd_1",
  name: "每日巡检",
  description: "",
  loopBindingId: "binding_1",
  cronExpression: "0 9 * * *",
  timezone: "Asia/Shanghai",
  contentMode: "platform",
  contentMarkdown: "# 检查",
  executionTarget: { type: "linux_worker_pool", workerPoolId: "b".repeat(32) },
};
const listModel = {
  tasks: [{
    id: "a".repeat(32),
    name: "每日巡检",
    description: "",
    status: "enabled",
    version: 2,
    cronExpression: "0 9 * * *",
    timezone: "Asia/Shanghai",
    contentMode: "platform",
    contentMarkdown: "# 当前正文",
    loopBinding: null,
    executionTarget: null,
    nextRunAt: null,
    pendingScheduledFor: null,
    lastScheduledFor: null,
    updatedAt: null,
    activeRun: null,
  }],
  loopOptions: [],
  targetOptions: [],
  canEdit: true,
};

function request(method: "GET" | "POST", body?: unknown, query = "") {
  return new Request(`http://localhost/api/projects/project_1/scheduled-tasks${query}`, {
    method,
    ...(body === undefined ? {} : {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
}

describe("/api/projects/:projectId/scheduled-tasks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({
      userId: "user_1",
      authKind: "web_session",
      webSessionId: "c".repeat(32),
    });
    vi.mocked(readProjectScheduledTaskList).mockResolvedValue(listModel as never);
    vi.mocked(createProjectScheduledTask).mockResolvedValue({
      id: "a".repeat(32),
      status: "inactive",
      version: 1,
      nextRunAt: null,
    });
  });

  it("lists project scheduled tasks with an optional status filter", async () => {
    const response = await GET(request("GET", undefined, "?status=disabled"), context);

    expect(response.status).toBe(200);
    expect(readProjectScheduledTaskList).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
      status: "disabled",
    });
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, result: { canEdit: true } });
    expect(body.result.tasks[0]).not.toHaveProperty("contentSnapshot");
  });

  it("rejects an invalid status filter before reading tasks", async () => {
    const response = await GET(request("GET", undefined, "?status=running"), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "validation_failed",
    });
    expect(readProjectScheduledTaskList).not.toHaveBeenCalled();
  });

  it("creates an inactive scheduled task", async () => {
    const response = await POST(request("POST", createBody), context);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: { id: "a".repeat(32), status: "inactive", version: 1 },
    });
    expect(createProjectScheduledTask).toHaveBeenCalledWith({
      actorUserId: "user_1",
      projectId: "project_1",
      ...createBody,
    });
  });

  it("rejects unknown create fields before command execution", async () => {
    const response = await POST(request("POST", { ...createBody, status: "enabled" }), context);

    expect(response.status).toBe(400);
    expect(createProjectScheduledTask).not.toHaveBeenCalled();
  });

  it("returns 401 when the workbench actor cannot be resolved", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValue(
      new Error("Workbench API authentication required"),
    );

    const response = await POST(request("POST", createBody), context);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "authentication_required",
    });
    expect(createProjectScheduledTask).not.toHaveBeenCalled();
  });

  it("maps project write denial to 403", async () => {
    vi.mocked(createProjectScheduledTask).mockRejectedValue(
      Object.assign(new Error("Project write access denied"), { code: "authorization_denied" }),
    );

    const response = await POST(request("POST", createBody), context);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "authorization_denied",
    });
  });
});
