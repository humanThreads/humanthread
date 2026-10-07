import { describe, expect, it, vi } from "vitest";

import { reportDesktopNativeEvent } from "./native-events";

describe("desktop native event reporting", () => {
  it("reports the authenticated device with current process credentials", async () => {
    const reportAgentEvent = vi.fn().mockResolvedValue(undefined);
    await reportDesktopNativeEvent({
      session: {
        apiBaseUrl: "https://example.com",
        userId: "user_1",
        deviceId: "device_1",
        deviceName: "Owner Mac",
      },
      credentials: { deviceToken: "device_secret", apiToken: "api_secret" },
      platform: "macos",
      event: {
        taskId: "task_1",
        eventType: "command_started",
        message: "已启动 Codex",
        payload: { command: "codex" },
      },
    }, { reportAgentEvent });

    expect(reportAgentEvent).toHaveBeenCalledWith({
      apiBaseUrl: "https://example.com",
      apiToken: "api_secret",
      deviceToken: "device_secret",
      body: {
        taskId: "task_1",
        actorUserId: "user_1",
        eventType: "command_started",
        message: "已启动 Codex",
        payload: { command: "codex" },
        localDevice: { id: "device_1", name: "Owner Mac", platform: "macos" },
      },
    });
  });

  it("refuses event reporting when the process is signed out", async () => {
    await expect(reportDesktopNativeEvent({
      session: {
        apiBaseUrl: "https://example.com",
        userId: "user_1",
        deviceId: "device_1",
        deviceName: "Owner Mac",
      },
      credentials: null,
      platform: "macos",
      event: {
        taskId: "task_1",
        eventType: "local_opened",
        message: "打开目录",
        payload: {},
      },
    })).rejects.toThrow("请重新登录");
  });
});
