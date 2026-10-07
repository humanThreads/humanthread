import { describe, expect, it, vi } from "vitest";
import {
  checkAgentApiHealth,
  fetchAgentCurrentTask,
  loginAndBindAgentDevice,
  registerAgentDevice,
  reportAgentEvent,
  type FetchLike,
} from "./api";

describe("local agent api client", () => {
  it("checks web and database health before desktop validation", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        service: "humanthread-web",
        db: "connected",
      }),
    } as Response);

    const result = await checkAgentApiHealth(
      {
        apiBaseUrl: "http://127.0.0.1:3010/",
      },
      { fetch },
    );

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3010/api/health/db",
      {
        method: "GET",
        headers: {
          accept: "application/json",
        },
      },
    );
    expect(result).toEqual({
      ok: true,
      service: "humanthread-web",
      db: "connected",
    });
  });

  it("registers the local device and returns its current status", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        userId: "user_owner",
        deviceId: "device-agent-macbook",
        status: "pending",
        deviceToken: "device_token_123",
      }),
    } as Response);

    const result = await registerAgentDevice(
      {
        apiBaseUrl: "http://127.0.0.1:3000/",
        apiToken: "token_123",
        deviceToken: "device_token_123",
        body: {
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
      },
      { fetch },
    );

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/agent/device/register",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: "Bearer token_123",
          "x-agent-device-token": "device_token_123",
        },
        body: JSON.stringify({
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
        }),
      },
    );
    expect(result.status).toBe("pending");
  });

  it("logs in by user email and binds the local device without a manual API token", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        teamId: "team_1",
        userId: "user_owner",
        deviceId: "device-agent-macbook",
        status: "pending",
        deviceToken: "device_token_123",
      }),
    } as Response);

    const result = await loginAndBindAgentDevice(
      {
        apiBaseUrl: "http://localhost:3000/",
        deviceToken: "device_token_old",
        body: {
          email: "alice@example.com",
          password: "correct-password",
          bindingCode: "signed-binding-code",
          deviceId: "device-agent-macbook",
          deviceName: "agent-macbook",
          platform: "macos",
        },
      },
      { fetch },
    );

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/agent/login",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-agent-device-token": "device_token_old",
        },
        body: JSON.stringify({
          email: "alice@example.com",
          password: "correct-password",
          bindingCode: "signed-binding-code",
          deviceId: "device-agent-macbook",
          deviceName: "agent-macbook",
          platform: "macos",
        }),
      },
    );
    expect(result).toEqual({
      ok: true,
      teamId: "team_1",
      userId: "user_owner",
      deviceId: "device-agent-macbook",
      status: "pending",
      deviceToken: "device_token_123",
    });
  });

  it("submits login payloads without any stored device password state", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        teamId: "team_1",
        userId: "user_owner",
        deviceId: "device-agent-macbook",
        status: "authorized",
        deviceToken: "device_token_456",
      }),
    } as Response);

    await loginAndBindAgentDevice(
      {
        apiBaseUrl: "http://localhost:3000",
        body: {
          email: "alice@example.com",
          password: "correct-password",
          deviceId: "device-agent-macbook",
          deviceName: "agent-macbook",
          platform: "macos",
        },
      },
      { fetch },
    );

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/agent/login",
      expect.objectContaining({
        body: JSON.stringify({
          email: "alice@example.com",
          password: "correct-password",
          deviceId: "device-agent-macbook",
          deviceName: "agent-macbook",
          platform: "macos",
        }),
      }),
    );
  });

  it("binds the default global fetch to the global object during login requests", async () => {
    const originalFetch = globalThis.fetch;
    const globalFetch = vi.fn(function (
      this: typeof globalThis,
      input: RequestInfo | URL,
      init?: RequestInit,
    ) {
      expect(this).toBe(globalThis);
      expect(input).toBe("http://localhost:3000/api/agent/login");
      expect(init).toMatchObject({
        method: "POST",
      });

      return Promise.resolve({
        ok: true,
        json: async () => ({
          ok: true,
          teamId: "team_1",
          userId: "user_owner",
          deviceId: "device-agent-macbook",
          status: "authorized",
          deviceToken: "device_token_456",
        }),
      } as Response);
    }) as typeof fetch;

    vi.stubGlobal("fetch", globalFetch);

    try {
      const result = await loginAndBindAgentDevice({
        apiBaseUrl: "http://localhost:3000",
        body: {
          email: "alice@example.com",
          password: "correct-password",
          deviceId: "device-agent-macbook",
          deviceName: "agent-macbook",
          platform: "macos",
        },
      });

      expect(globalFetch).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("authorized");
    } finally {
      vi.unstubAllGlobals();

      if (originalFetch) {
        vi.stubGlobal("fetch", originalFetch);
      }
    }
  });

  it("requests the current task with team, user, and device query params", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue({
      ok: true,
      json: async () => ({
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
          workflowTitle: "实现任务工作台交互",
          status: "active",
          localPath: "/Users/alice/IdeaProjects/humanThread",
          command: "codex"
        }
      }),
    } as Response);

    const result = await fetchAgentCurrentTask(
      {
        apiBaseUrl: "http://127.0.0.1:3000/",
        teamId: "team_1",
        userId: "user_owner",
        deviceId: "device-agent-macbook",
        deviceToken: "device_token_123",
        apiToken: "token_123",
      },
      { fetch },
    );

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/agent/current-task?teamId=team_1&userId=user_owner&deviceId=device-agent-macbook",
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: "Bearer token_123",
          "x-agent-device-token": "device_token_123",
        },
      },
    );
    expect(result.task?.projectName).toBe("HumanThread");
    expect(result.queueLength).toBe(2);
  });

  it("posts a local task event with device metadata", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
      }),
    } as Response);

    await reportAgentEvent(
      {
        apiBaseUrl: "http://127.0.0.1:3000",
        apiToken: "token_123",
        deviceToken: "device_token_123",
        body: {
          taskId: "workflow_1:run_cli",
          actorUserId: "user_owner",
          eventType: "command_started",
          message: "已启动本地命令",
          payload: {
            command: "codex",
            cwd: "/Users/alice/IdeaProjects/humanThread",
          },
          localDevice: {
            id: "device-agent-macbook",
            name: "agent-macbook",
            platform: "macos",
          },
        },
      },
      { fetch },
    );

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/agent/events",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: "Bearer token_123",
          "x-agent-device-token": "device_token_123",
        },
        body: JSON.stringify({
          taskId: "workflow_1:run_cli",
          actorUserId: "user_owner",
          eventType: "command_started",
          message: "已启动本地命令",
          payload: {
            command: "codex",
            cwd: "/Users/alice/IdeaProjects/humanThread",
          },
          localDevice: {
            id: "device-agent-macbook",
            name: "agent-macbook",
            platform: "macos",
          },
        }),
      },
    );
  });

  it("throws the server error text when the event report fails", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue({
      ok: false,
      json: async () => ({
        ok: false,
        error: "Missing required agent event fields",
      }),
    } as Response);

    await expect(
      reportAgentEvent(
        {
          apiBaseUrl: "http://127.0.0.1:3000",
          apiToken: "",
          deviceToken: "device_token_123",
          body: {
            taskId: "workflow_1:run_cli",
            actorUserId: "user_owner",
            eventType: "local_opened",
            localDevice: {
              id: "device-1",
              name: "macbook",
              platform: "macos",
            },
          },
        },
        { fetch },
      ),
    ).rejects.toThrow("Missing required agent event fields");
  });
});
