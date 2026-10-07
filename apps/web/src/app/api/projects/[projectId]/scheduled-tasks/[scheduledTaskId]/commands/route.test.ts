import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  changeProjectScheduledTaskStatus,
  triggerProjectScheduledTaskRun,
} from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

import { POST } from "./route";

vi.mock("@humanthread/db", () => ({
  changeProjectScheduledTaskStatus: vi.fn(),
  triggerProjectScheduledTaskRun: vi.fn(),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn(),
}));

const scheduledTaskId = "a".repeat(32);
const runId = "b".repeat(32);
const context = {
  params: Promise.resolve({ projectId: "project_1", scheduledTaskId }),
};

function request(body: unknown) {
  return new Request(
    `http://localhost/api/projects/project_1/scheduled-tasks/${scheduledTaskId}/commands`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/projects/:projectId/scheduled-tasks/:scheduledTaskId/commands", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({
      userId: "user_1",
      authKind: "web_session",
      webSessionId: "c".repeat(32),
    });
    vi.mocked(changeProjectScheduledTaskStatus).mockResolvedValue({
      id: scheduledTaskId,
      status: "enabled",
      version: 2,
      nextRunAt: "2026-09-23T01:00:00.000Z",
    });
    vi.mocked(triggerProjectScheduledTaskRun).mockResolvedValue({
      runId,
      status: "preparing",
      duplicate: false,
    });
  });

  it.each([
    ["inactive"],
    ["enabled"],
  ])("starts run_now for a %s task with 201", async () => {
    const response = await POST(request({ command: "run_now", commandId: "cmd_run" }), context);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: { runId, status: "preparing", duplicate: false },
    });
    expect(triggerProjectScheduledTaskRun).toHaveBeenCalledWith({
      actorUserId: "user_1",
      projectId: "project_1",
      scheduledTaskId,
      commandId: "cmd_run",
      triggerSource: "manual",
    });
    expect(changeProjectScheduledTaskStatus).not.toHaveBeenCalled();
  });

  it("returns 409 with policy_denied when run_now targets a disabled task", async () => {
    vi.mocked(triggerProjectScheduledTaskRun).mockRejectedValue(
      Object.assign(new Error("Scheduled task is disabled"), { code: "policy_denied" }),
    );

    const response = await POST(request({ command: "run_now", commandId: "cmd_disabled" }), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "policy_denied",
      error: "Scheduled task is disabled",
    });
  });

  it("returns 409 with run_in_progress when another run is active", async () => {
    vi.mocked(triggerProjectScheduledTaskRun).mockRejectedValue(
      Object.assign(new Error("Scheduled task already has an active run"), { code: "run_in_progress" }),
    );

    const response = await POST(request({ command: "run_now", commandId: "cmd_active" }), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "run_in_progress",
      error: "Scheduled task already has an active run",
    });
  });

  it.each([
    ["enable", "enabled"],
    ["deactivate", "inactive"],
    ["disable", "disabled"],
    ["restore", "inactive"],
  ] as const)("applies the %s status command without creating a Loop Run", async (command, status) => {
    vi.mocked(changeProjectScheduledTaskStatus).mockResolvedValue({
      id: scheduledTaskId,
      status,
      version: 2,
      nextRunAt: null,
    });
    const body = { command, commandId: `cmd_${command}`, expectedVersion: 1 };

    const response = await POST(request(body), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: { id: scheduledTaskId, status, version: 2, nextRunAt: null },
    });
    expect(changeProjectScheduledTaskStatus).toHaveBeenCalledWith({
      actorUserId: "user_1",
      projectId: "project_1",
      scheduledTaskId,
      ...body,
    });
    expect(triggerProjectScheduledTaskRun).not.toHaveBeenCalled();
  });

  it("replays the same commandId with the original success result", async () => {
    const body = { command: "disable", commandId: "cmd_replay", expectedVersion: 1 };
    const result = {
      id: scheduledTaskId,
      status: "disabled",
      version: 2,
      nextRunAt: null,
    } as const;
    vi.mocked(changeProjectScheduledTaskStatus).mockResolvedValue(result);

    const first = await POST(request(body), context);
    const replay = await POST(request(body), context);

    expect(await first.json()).toEqual({ ok: true, result });
    expect(await replay.json()).toEqual({ ok: true, result });
    expect(changeProjectScheduledTaskStatus).toHaveBeenCalledTimes(2);
    expect(vi.mocked(changeProjectScheduledTaskStatus).mock.calls).toEqual([
      [expect.objectContaining({ commandId: "cmd_replay" })],
      [expect.objectContaining({ commandId: "cmd_replay" })],
    ]);
  });

  it("rejects malformed command bodies before command execution", async () => {
    const response = await POST(request({
      command: "run_now",
      commandId: "cmd_invalid",
      expectedVersion: 1,
    }), context);

    expect(response.status).toBe(400);
    expect(triggerProjectScheduledTaskRun).not.toHaveBeenCalled();
    expect(changeProjectScheduledTaskStatus).not.toHaveBeenCalled();
  });

  it("returns 401 when the workbench actor cannot be resolved", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValue(
      new Error("Workbench API authentication required"),
    );

    const response = await POST(request({ command: "enable", commandId: "cmd_enable", expectedVersion: 1 }), context);

    expect(response.status).toBe(401);
    expect(changeProjectScheduledTaskStatus).not.toHaveBeenCalled();
  });

  it("maps project write denial to 403", async () => {
    vi.mocked(changeProjectScheduledTaskStatus).mockRejectedValue(
      Object.assign(new Error("Project write access denied"), { code: "authorization_denied" }),
    );

    const response = await POST(request({ command: "enable", commandId: "cmd_enable", expectedVersion: 1 }), context);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "authorization_denied",
    });
  });

  it("maps a missing task to 404", async () => {
    vi.mocked(triggerProjectScheduledTaskRun).mockRejectedValue(
      Object.assign(new Error("Scheduled task not found"), { code: "not_found" }),
    );

    const response = await POST(request({ command: "run_now", commandId: "cmd_missing" }), context);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "not_found" });
  });
});
