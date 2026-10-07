import { describe, expect, it, vi } from "vitest";

import {
  buildCommandExitNotification,
  buildLifecycleFailureNotice,
  createTraySelfCheckRunner,
  isTrayDeviceAuthorized,
} from "./native-lifecycle";

const accountSession = {
  sessionKey: "https://ht.example.com::owner@example.com",
  apiBaseUrl: "https://ht.example.com",
  email: "owner@example.com",
  desktopSessionId: "desktop_session_1",
  activeSpaceKey: "personal",
  teamId: "team_1",
  userId: "user_1",
  deviceId: "device_1",
  deviceName: "Alice MacBook",
  deviceToken: "legacy-token-must-not-be-used",
  apiToken: "",
  lastLoginAt: "2026-07-28T00:00:00.000Z",
  lastUsedAt: "2026-07-28T00:00:00.000Z",
};

describe("desktop native lifecycle", () => {
  it("uses and rotates the current process device credential during tray self-check", async () => {
    const runSelfCheck = vi.fn(async () => ({
      health: { ok: true } as never,
      deviceStatus: "authorized" as const,
      nextDeviceToken: "rotated-device-token",
      taskSummary: { queueLength: 2, taskId: "task_1", taskTitle: "Release" },
    }));
    const updateCredentials = vi.fn();
    const runner = createTraySelfCheckRunner({
      accountSession,
      generation: 7,
      credentials: {
        deviceToken: "secure-device-token",
        apiToken: "api-secret",
      },
      platform: "macos",
      runSelfCheck,
      updateCredentials,
    });

    await expect(runner()).resolves.toEqual({
      tone: "success",
      text: "桌面自检通过 · 设备已授权 · 队列 2",
    });
    expect(runSelfCheck).toHaveBeenCalledWith(expect.objectContaining({
      binding: expect.objectContaining({ deviceToken: "secure-device-token" }),
      platform: "macos",
    }));
    expect(updateCredentials).toHaveBeenCalledWith(
      {
        deviceToken: "rotated-device-token",
        apiToken: "api-secret",
      },
      7,
    );
  });

  it("requires login credentials before tray self-check", async () => {
    const runner = createTraySelfCheckRunner({
      accountSession,
      generation: 7,
      credentials: null,
      platform: "macos",
      runSelfCheck: vi.fn(),
      updateCredentials: vi.fn(),
    });

    await expect(runner()).rejects.toThrow("请重新登录");
  });

  it("projects command exit notifications without command or local path data", () => {
    const notification = buildCommandExitNotification({
      taskId: "task_1",
      projectId: "project_1",
      workflowInstanceId: "workflow_1",
      cwd: "/Users/alice/private/project",
      command: "deploy --token super-secret",
      processId: 42,
      shell: "sh -lc",
      status: "interrupted",
      exitCode: 1,
      signal: null,
    }, "Release HumanThread");

    expect(notification).toMatchObject({
      id: "command:task_1:42",
      kind: "command_failed",
      body: "Release HumanThread · 退出码 1",
      route: "/tasks/task_1",
    });
    expect(JSON.stringify(notification)).not.toMatch(/alice|deploy|token|super-secret/u);
  });

  it("projects bounded native capability failures without losing the fallback", () => {
    expect(buildLifecycleFailureNotice(new Error("Tray capability denied"), "托盘不可用"))
      .toEqual({ tone: "warning", text: "Tray capability denied" });
    expect(buildLifecycleFailureNotice({ secret: "token" }, "托盘不可用"))
      .toEqual({ tone: "warning", text: "托盘不可用" });
  });

  it("reports tray authorization only when the device and server capability agree", () => {
    expect(isTrayDeviceAuthorized("device_1", true)).toBe(true);
    expect(isTrayDeviceAuthorized("device_1", false)).toBe(false);
    expect(isTrayDeviceAuthorized("", true)).toBe(false);
  });
});
