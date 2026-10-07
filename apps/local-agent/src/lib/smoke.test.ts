import { describe, expect, it, vi } from "vitest";
import { runLocalAgentSmoke } from "./smoke";

describe("runLocalAgentSmoke", () => {
  it("returns pending status without fetching task or reporting events", async () => {
    const registerAgentDevice = vi.fn().mockResolvedValue({
      ok: true,
      userId: "user_owner",
      deviceId: "device_mac_1",
      status: "pending",
      deviceToken: "device_token_123",
    });
    const fetchAgentCurrentTask = vi.fn();
    const reportAgentEvent = vi.fn();

    const result = await runLocalAgentSmoke(
      {
        apiBaseUrl: "http://127.0.0.1:3000",
        teamId: "team_1",
        userId: "user_owner",
        userEmail: "",
        deviceId: "device_mac_1",
        deviceName: "agent-macbook",
        apiToken: "token_123",
        deviceToken: "",
        platform: "macos",
      },
      {
        registerAgentDevice,
        fetchAgentCurrentTask,
        reportAgentEvent,
      },
    );

    expect(fetchAgentCurrentTask).not.toHaveBeenCalled();
    expect(reportAgentEvent).not.toHaveBeenCalled();
    expect(result).toEqual({
      deviceStatus: "pending",
      deviceToken: "device_token_123",
      taskId: null,
      reportedEventTypes: [],
    });
  });

  it("loads the current task after authorization and reports a full local event chain", async () => {
    const registerAgentDevice = vi.fn().mockResolvedValue({
      ok: true,
      userId: "user_owner",
      deviceId: "device_mac_1",
      status: "authorized",
      deviceToken: "device_token_123",
    });
    const fetchAgentCurrentTask = vi.fn().mockResolvedValue({
      ok: true,
      teamId: "team_1",
      userId: "user_owner",
      queueLength: 0,
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
    });
    const reportAgentEvent = vi.fn().mockResolvedValue(undefined);

    const result = await runLocalAgentSmoke(
      {
        apiBaseUrl: "http://127.0.0.1:3000",
        teamId: "team_1",
        userId: "user_owner",
        userEmail: "",
        deviceId: "device_mac_1",
        deviceName: "agent-macbook",
        apiToken: "token_123",
        deviceToken: "",
        platform: "macos",
      },
      {
        registerAgentDevice,
        fetchAgentCurrentTask,
        reportAgentEvent,
      },
    );

    expect(fetchAgentCurrentTask).toHaveBeenCalledWith({
      apiBaseUrl: "http://127.0.0.1:3000",
      teamId: "team_1",
      userId: "user_owner",
      deviceId: "device_mac_1",
      deviceToken: "device_token_123",
      apiToken: "token_123",
    });
    expect(reportAgentEvent).toHaveBeenNthCalledWith(1, {
      apiBaseUrl: "http://127.0.0.1:3000",
      apiToken: "token_123",
      deviceToken: "device_token_123",
      body: {
        taskId: "workflow_1:run_cli",
        actorUserId: "user_owner",
        eventType: "local_opened",
        message: "local-agent smoke test",
        payload: {
          source: "local_agent_smoke",
          cwd: "/Users/alice/IdeaProjects/humanThread",
          command: "codex",
        },
        localDevice: {
          id: "device_mac_1",
          name: "agent-macbook",
          platform: "macos",
        },
      },
    });
    expect(reportAgentEvent).toHaveBeenNthCalledWith(2, {
      apiBaseUrl: "http://127.0.0.1:3000",
      apiToken: "token_123",
      deviceToken: "device_token_123",
      body: {
        taskId: "workflow_1:run_cli",
        actorUserId: "user_owner",
        eventType: "command_started",
        message: "local-agent smoke command started",
        payload: {
          source: "local_agent_smoke",
          cwd: "/Users/alice/IdeaProjects/humanThread",
          command: "codex",
          processId: 99901,
          shell: "smoke-shell",
        },
        localDevice: {
          id: "device_mac_1",
          name: "agent-macbook",
          platform: "macos",
        },
      },
    });
    expect(reportAgentEvent).toHaveBeenNthCalledWith(3, {
      apiBaseUrl: "http://127.0.0.1:3000",
      apiToken: "token_123",
      deviceToken: "device_token_123",
      body: {
        taskId: "workflow_1:run_cli",
        actorUserId: "user_owner",
        eventType: "command_exited",
        message: "本地命令执行结束，退出码 0。",
        payload: {
          projectId: "project_1",
          workflowInstanceId: "workflow_1",
          cwd: "/Users/alice/IdeaProjects/humanThread",
          command: "codex",
          processId: 99901,
          shell: "smoke-shell",
          status: "completed",
          exitCode: 0,
          signal: null,
        },
        localDevice: {
          id: "device_mac_1",
          name: "agent-macbook",
          platform: "macos",
        },
      },
    });
    expect(result).toEqual({
      deviceStatus: "authorized",
      deviceToken: "device_token_123",
      taskId: "workflow_1:run_cli",
      reportedEventTypes: [
        "local_opened",
        "command_started",
        "command_exited",
      ],
    });
  });

  it("skips event reporting when no current task is assigned", async () => {
    const registerAgentDevice = vi.fn().mockResolvedValue({
      ok: true,
      userId: "user_owner",
      deviceId: "device_mac_1",
      status: "authorized",
      deviceToken: "device_token_123",
    });
    const fetchAgentCurrentTask = vi.fn().mockResolvedValue({
      ok: true,
      teamId: "team_1",
      userId: "user_owner",
      queueLength: 0,
      task: null,
    });
    const reportAgentEvent = vi.fn();

    const result = await runLocalAgentSmoke(
      {
        apiBaseUrl: "http://127.0.0.1:3000",
        teamId: "team_1",
        userId: "user_owner",
        userEmail: "",
        deviceId: "device_mac_1",
        deviceName: "agent-macbook",
        apiToken: "token_123",
        deviceToken: "",
        platform: "macos",
      },
      {
        registerAgentDevice,
        fetchAgentCurrentTask,
        reportAgentEvent,
      },
    );

    expect(reportAgentEvent).not.toHaveBeenCalled();
    expect(result).toEqual({
      deviceStatus: "authorized",
      deviceToken: "device_token_123",
      taskId: null,
      reportedEventTypes: [],
    });
  });
});
