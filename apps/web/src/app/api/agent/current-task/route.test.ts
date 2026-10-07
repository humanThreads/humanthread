import { describe, expect, it, vi } from "vitest";
import { GET, OPTIONS } from "./route";

vi.mock("../../../../lib/agent/agent-current-task", () => ({
  getAgentCurrentTask: vi.fn().mockResolvedValue({
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
  }),
}));

vi.mock("../../../../lib/agent/agent-auth", () => ({
  authenticateAgentRequest: vi.fn().mockResolvedValue({
    userId: "user_owner",
    teamId: "team_1",
  }),
}));

describe("GET /api/agent/current-task", () => {
  it("responds to Tauri CORS preflight requests", async () => {
    const response = await OPTIONS(
      new Request("http://localhost:3000/api/agent/current-task", {
        method: "OPTIONS",
        headers: {
          origin: "tauri://localhost",
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization,x-agent-device-token",
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
    expect(response.headers.get("access-control-allow-headers")).toContain("authorization");
  });

  it("returns the local agent current task view", async () => {
    const { authenticateAgentRequest } = await import("../../../../lib/agent/agent-auth");
    const response = await GET(
      new Request("http://localhost:3000/api/agent/current-task?teamId=team_1&userId=user_owner&deviceId=device_mac_1", {
        headers: {
          authorization: "Bearer token_123",
          "x-agent-device-token": "device_token_123",
          origin: "tauri://localhost",
        },
      }),
    );
    const body = (await response.json()) as {
      ok: boolean;
      queueLength: number;
      task: { id: string; localPath?: string | null } | null;
    };

    expect(body).toMatchObject({
      ok: true,
      queueLength: 1,
      task: {
        id: "workflow_1:run_cli",
        localPath: "/Users/alice/IdeaProjects/humanThread",
      },
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(vi.mocked(authenticateAgentRequest)).toHaveBeenCalledWith({
      authorizationHeader: "Bearer token_123",
      userId: "user_owner",
      expectedTeamId: "team_1",
      deviceId: "device_mac_1",
      deviceTokenHeader: "device_token_123",
      requireAuthorizedDevice: true,
      allowDeviceTokenOnly: true,
    });
  });

  it("returns 401 when the agent token is missing", async () => {
    const { authenticateAgentRequest } = await import("../../../../lib/agent/agent-auth");
    vi.mocked(authenticateAgentRequest).mockRejectedValueOnce(
      new Error("Missing agent authorization token"),
    );

    const response = await GET(
      new Request(
        "http://localhost:3000/api/agent/current-task?teamId=team_1&userId=user_owner&deviceId=device_mac_1",
      ),
    );
    const body = (await response.json()) as {
      ok: boolean;
      error: string;
    };

    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(body).toEqual({
      ok: false,
      error: "Missing agent authorization token",
    });
  });

  it("returns 400 when deviceId is missing", async () => {
    const response = await GET(
      new Request("http://localhost:3000/api/agent/current-task?teamId=team_1&userId=user_owner"),
    );
    const body = (await response.json()) as {
      ok: boolean;
      error: string;
    };

    expect(response.status).toBe(400);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(body).toEqual({
      ok: false,
      error: "Missing agent device ID",
    });
  });
});
