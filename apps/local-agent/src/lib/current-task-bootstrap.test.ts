import { AGENT_BUILD_VERSION } from "./build-version";
import { describe, expect, it, vi } from "vitest";
import { loadAgentTaskSnapshot } from "./current-task-bootstrap";

describe("loadAgentTaskSnapshot", () => {
  it("returns pending without network calls when no active session exists", async () => {
    const registerAgentDevice = vi.fn();
    const fetchAgentCurrentTask = vi.fn();

    const result = await loadAgentTaskSnapshot(
      {
        activeBinding: null,
        platform: "macos",
      },
      {
        registerAgentDevice,
        fetchAgentCurrentTask,
      },
    );

    expect(registerAgentDevice).not.toHaveBeenCalled();
    expect(fetchAgentCurrentTask).not.toHaveBeenCalled();
    expect(result).toEqual({
      deviceStatus: "pending",
      taskResponse: null,
      activeBinding: null,
    });
  });

  it("refreshes worker capabilities before loading a task with a device token", async () => {
    const registerAgentDevice = vi.fn().mockResolvedValue({
      ok: true,
      userId: "user_owner",
      deviceId: "device-agent-macbook",
      workerId: "local-worker:device-agent-macbook",
      status: "authorized",
      deviceToken: "device_token_123",
    });
    const fetchAgentCurrentTask = vi.fn().mockResolvedValue({
      ok: true,
      teamId: "team_1",
      userId: "user_owner",
      queueLength: 1,
      task: {
        id: "workflow_1:run_cli",
        title: "运行 Claude/Codex",
        projectId: "project_1",
        projectName: "HumanThread",
        workflowInstanceId: "workflow_1",
        workflowTitle: "实现任务工作台交互",
        status: "active",
        localPath: "/Users/alice/IdeaProjects/humanThread",
        command: "codex",
      },
    });

    const result = await loadAgentTaskSnapshot(
      {
        activeBinding: {
          sessionKey: "http://localhost:3000::alice@example.com",
          apiBaseUrl: "http://localhost:3000",
          teamId: "team_1",
          userId: "user_owner",
          userEmail: "alice@example.com",
          deviceId: "device-agent-macbook",
          deviceName: "agent-macbook",
          deviceToken: "device_token_123",
          apiToken: "",
          pollIntervalMs: 10000,
          commandTemplate: "{command}",
        },
        platform: "macos",
      },
      {
        registerAgentDevice,
        fetchAgentCurrentTask,
      },
    );

    expect(registerAgentDevice).toHaveBeenCalledWith({
      apiBaseUrl: "http://localhost:3000",
      apiToken: "",
      deviceToken: "device_token_123",
      body: {
        agentVersion: AGENT_BUILD_VERSION,
        userId: "user_owner",
        deviceId: "device-agent-macbook",
        deviceName: "agent-macbook",
        platform: "macos",
        capabilitySnapshot: {
          providers: [{ name: "codex", version: "unknown" }],
          capabilities: ["workspace", "files", "commands"],
          loginStateCategories: [],
          maxConcurrency: 1,
        },
      },
    });
    expect(fetchAgentCurrentTask).toHaveBeenCalledWith({
      apiBaseUrl: "http://localhost:3000",
      teamId: "team_1",
      userId: "user_owner",
      deviceId: "device-agent-macbook",
      deviceToken: "device_token_123",
      apiToken: "",
    });
    expect(result.deviceStatus).toBe("authorized");
    expect(result.activeBinding?.deviceToken).toBe("device_token_123");
    expect(result.taskResponse?.task?.id).toBe("workflow_1:run_cli");
  });
});
