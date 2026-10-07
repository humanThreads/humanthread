import { describe, expect, it, vi } from "vitest";
import { OPTIONS, POST } from "./route";

vi.mock("../../../../lib/agent/agent-events", () => ({
  reportAgentTaskEvent: vi.fn().mockResolvedValue({
    event: {
      id: "workflow_1:run_cli:command_started:1",
      taskId: "workflow_1:run_cli",
      workflowInstanceId: "workflow_1",
      type: "command_started",
      actorType: "human",
      actorUserId: "user_owner",
      message: "已在本地启动命令",
      payload: {
        command: "codex",
        cwd: "/Users/alice/IdeaProjects/humanThread",
        shell: "sh -lc",
        processId: 4242,
        deviceId: "device_mac_1",
      },
      createdAt: new Date("2026-05-19T01:00:00.000Z"),
    },
    localDevice: {
      id: "device_mac_1",
      name: "agent-macbook",
      platform: "macos",
    },
  }),
}));

vi.mock("../../../../lib/agent/agent-auth", () => ({
  authenticateAgentRequest: vi.fn().mockResolvedValue({
    userId: "user_owner",
    teamId: "team_1",
  }),
}));

describe("POST /api/agent/events", () => {
  it("responds to Tauri CORS preflight requests", async () => {
    const response = await OPTIONS(
      new Request("http://localhost:3000/api/agent/events", {
        method: "OPTIONS",
        headers: {
          origin: "tauri://localhost",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type,authorization,x-agent-device-token",
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toContain("authorization");
  });

  it("records a local agent event", async () => {
    const { authenticateAgentRequest } = await import("../../../../lib/agent/agent-auth");
    const response = await POST(
      new Request("http://localhost:3000/api/agent/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token_123",
          "x-agent-device-token": "device_token_123",
          origin: "tauri://localhost",
        },
        body: JSON.stringify({
          taskId: "workflow_1:run_cli",
          actorUserId: "user_owner",
          eventType: "command_started",
          message: "已在本地启动命令",
          localDevice: {
            id: "device_mac_1",
            name: "agent-macbook",
            platform: "macos",
          },
          payload: {
            command: "codex",
            cwd: "/Users/alice/IdeaProjects/humanThread",
            shell: "sh -lc",
            processId: 4242,
          },
        }),
      }),
    );

    const body = (await response.json()) as {
      ok: boolean;
      event: { type: string; actorUserId?: string; payload?: { deviceId?: string } };
      localDevice: { id: string };
    };

    expect(body).toMatchObject({
      ok: true,
      event: {
        type: "command_started",
        actorUserId: "user_owner",
        payload: {
          deviceId: "device_mac_1",
        },
      },
      localDevice: {
        id: "device_mac_1",
      },
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(vi.mocked(authenticateAgentRequest)).toHaveBeenCalledWith({
      authorizationHeader: "Bearer token_123",
      userId: "user_owner",
      deviceId: "device_mac_1",
      deviceTokenHeader: "device_token_123",
      requireAuthorizedDevice: true,
      allowDeviceTokenOnly: true,
    });
  });

  it("returns 401 when the agent token is invalid", async () => {
    const { authenticateAgentRequest } = await import("../../../../lib/agent/agent-auth");
    vi.mocked(authenticateAgentRequest).mockRejectedValueOnce(
      new Error("Invalid agent authorization token"),
    );

    const response = await POST(
      new Request("http://localhost:3000/api/agent/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token_invalid",
          origin: "tauri://localhost",
        },
        body: JSON.stringify({
          taskId: "workflow_1:run_cli",
          actorUserId: "user_owner",
          eventType: "command_started",
          localDevice: {
            id: "device_mac_1",
            name: "agent-macbook",
            platform: "macos",
          },
        }),
      }),
    );
    const body = (await response.json()) as {
      ok: boolean;
      error: string;
    };

    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(body).toEqual({
      ok: false,
      error: "Invalid agent authorization token",
    });
  });

  it("returns 400 when required fields are missing", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/agent/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token_123",
          origin: "tauri://localhost",
        },
        body: JSON.stringify({
          taskId: "workflow_1:run_cli",
          eventType: "command_started",
        }),
      }),
    );

    const body = (await response.json()) as {
      ok: boolean;
      error: string;
    };

    expect(response.status).toBe(400);
    expect(response.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(body).toMatchObject({
      ok: false,
      error: "Missing required agent event fields",
    });
  });
});
