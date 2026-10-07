import { describe, expect, it, vi } from "vitest";
import { runDesktopSelfCheck } from "./desktop-self-check";
import { createDefaultAgentBinding } from "./binding";

describe("runDesktopSelfCheck", () => {
  it("returns health, device status, and current task summary when all checks succeed", async () => {
    const binding = {
      ...createDefaultAgentBinding({
        fallbackDeviceName: "agent-macbook",
      }),
      apiToken: "token_123",
      deviceToken: "device_token_old",
    };
    const checkHealth = vi.fn().mockResolvedValue({
      ok: true,
      service: "humanthread-web",
      db: "connected",
    });
    const loadAgentTaskSnapshot = vi.fn().mockResolvedValue({
      deviceStatus: "authorized",
      deviceToken: "device_token_new",
      taskResponse: {
        ok: true,
        teamId: "team_1",
        userId: "user_owner",
        queueLength: 2,
        task: {
          id: "workflow_1:run_cli",
          title: "运行 Claude/Codex",
          projectId: "project_1",
          projectName: "HumanThread",
          workflowInstanceId: "workflow_1",
          workflowTitle: "工作台手工验证",
          status: "active",
          localPath: "/Users/alice/IdeaProjects/humanThread",
          command: "codex",
        },
      },
    });

    const result = await runDesktopSelfCheck(
      {
        binding,
        platform: "macos",
      },
      {
        checkHealth,
        loadAgentTaskSnapshot,
      },
    );

    expect(checkHealth).toHaveBeenCalledWith({
      apiBaseUrl: "http://localhost:3000",
    });
    expect(loadAgentTaskSnapshot).toHaveBeenCalledWith({
      apiBaseUrl: "http://localhost:3000",
      teamId: "team_1",
      userId: "user_owner",
      deviceId: "device-agent-macbook",
      deviceName: "agent-macbook",
      deviceToken: "device_token_old",
      apiToken: "token_123",
      platform: "macos",
    });
    expect(result).toEqual({
      health: {
        ok: true,
        service: "humanthread-web",
        db: "connected",
      },
      deviceStatus: "authorized",
      nextDeviceToken: "device_token_new",
      taskSummary: {
        queueLength: 2,
        taskId: "workflow_1:run_cli",
        taskTitle: "运行 Claude/Codex",
      },
    });
  });

  it("returns no task summary when the device is not authorized yet", async () => {
    const binding = {
      ...createDefaultAgentBinding({
        fallbackDeviceName: "agent-macbook",
      }),
      apiToken: "token_123",
    };
    const checkHealth = vi.fn().mockResolvedValue({
      ok: true,
      service: "humanthread-web",
      db: "connected",
    });
    const loadAgentTaskSnapshot = vi.fn().mockResolvedValue({
      deviceStatus: "pending",
      deviceToken: "device_token_123",
      taskResponse: null,
    });

    const result = await runDesktopSelfCheck(
      {
        binding,
        platform: "macos",
      },
      {
        checkHealth,
        loadAgentTaskSnapshot,
      },
    );

    expect(result.taskSummary).toBeNull();
    expect(result.deviceStatus).toBe("pending");
  });
});
