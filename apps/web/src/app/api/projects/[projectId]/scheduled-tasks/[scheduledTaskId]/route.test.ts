import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateProjectScheduledTask } from "@humanthread/db";
import { readProjectScheduledTaskDetail } from "@/lib/orchestration/scheduled-task-read-model";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

import { GET, PATCH } from "./route";

vi.mock("@humanthread/db", () => ({
  updateProjectScheduledTask: vi.fn(),
}));

vi.mock("@/lib/orchestration/scheduled-task-read-model", () => ({
  readProjectScheduledTaskDetail: vi.fn(),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn(),
}));

const scheduledTaskId = "a".repeat(32);
const runId = "b".repeat(32);
const context = {
  params: Promise.resolve({ projectId: "project_1", scheduledTaskId }),
};
const detailModel = {
  task: {
    id: scheduledTaskId,
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
  },
  loopOptions: [],
  targetOptions: [],
  canEdit: true,
  runs: [{ id: runId, status: "succeeded" }],
  selectedRun: { id: runId, status: "succeeded", contentSnapshot: "# 历史正文" },
  loopRun: null,
  report: {},
};

function request(method: "GET" | "PATCH", body?: unknown, query = "") {
  return new Request(`http://localhost/api/projects/project_1/scheduled-tasks/${scheduledTaskId}${query}`, {
    method,
    ...(body === undefined ? {} : {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
}

describe("/api/projects/:projectId/scheduled-tasks/:scheduledTaskId", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({
      userId: "user_1",
      authKind: "web_session",
      webSessionId: "c".repeat(32),
    });
    vi.mocked(readProjectScheduledTaskDetail).mockResolvedValue(detailModel as never);
    vi.mocked(updateProjectScheduledTask).mockResolvedValue({
      id: scheduledTaskId,
      status: "enabled",
      version: 3,
      nextRunAt: "2026-09-23T01:00:00.000Z",
    });
  });

  it("returns an authorized task detail without leaking snapshots into recent runs", async () => {
    const response = await GET(request("GET"), context);

    expect(response.status).toBe(200);
    expect(readProjectScheduledTaskDetail).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
      scheduledTaskId,
    });
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      result: { task: { id: scheduledTaskId }, selectedRun: { id: runId } },
    });
    expect(body.result.selectedRun.contentSnapshot).toBe("# 历史正文");
    expect(body.result.runs[0]).not.toHaveProperty("contentSnapshot");
  });

  it("selects an exact run requested by query string", async () => {
    const response = await GET(request("GET", undefined, `?run=${runId}`), context);

    expect(response.status).toBe(200);
    expect(readProjectScheduledTaskDetail).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
      scheduledTaskId,
      runId,
    });
  });

  it("rejects an invalid run query before loading the detail model", async () => {
    const response = await GET(request("GET", undefined, "?run=not-a-run-id"), context);

    expect(response.status).toBe(400);
    expect(readProjectScheduledTaskDetail).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "validation_failed" });
  });

  it("returns 404 when the task is unavailable in the project", async () => {
    vi.mocked(readProjectScheduledTaskDetail).mockResolvedValue(null);

    const response = await GET(request("GET"), context);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "not_found" });
  });

  it("maps project read denial to 403", async () => {
    vi.mocked(readProjectScheduledTaskDetail).mockRejectedValue(
      Object.assign(new Error("Project access denied"), { code: "authorization_denied" }),
    );

    const response = await GET(request("GET"), context);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "authorization_denied",
    });
  });

  it("updates a task with optimistic concurrency", async () => {
    const body = {
      commandId: "cmd_update",
      expectedVersion: 2,
      name: "巡检（更新）",
      cronExpression: "0 10 * * *",
    };

    const response = await PATCH(request("PATCH", body), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: {
        id: scheduledTaskId,
        status: "enabled",
        version: 3,
        nextRunAt: "2026-09-23T01:00:00.000Z",
      },
    });
    expect(updateProjectScheduledTask).toHaveBeenCalledWith({
      actorUserId: "user_1",
      projectId: "project_1",
      scheduledTaskId,
      ...body,
    });
  });

  it("rejects unknown update fields before command execution", async () => {
    const response = await PATCH(request("PATCH", {
      commandId: "cmd_update",
      expectedVersion: 2,
      status: "disabled",
    }), context);

    expect(response.status).toBe(400);
    expect(updateProjectScheduledTask).not.toHaveBeenCalled();
  });

  it("returns 401 when the workbench actor cannot be resolved", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValue(
      new Error("Workbench API authentication required"),
    );

    const response = await PATCH(request("PATCH", {
      commandId: "cmd_update",
      expectedVersion: 2,
      name: "巡检（更新）",
    }), context);

    expect(response.status).toBe(401);
    expect(updateProjectScheduledTask).not.toHaveBeenCalled();
  });
});
