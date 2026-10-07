import { describe, expect, it, vi } from "vitest";
import { OPTIONS, POST } from "./route";

vi.mock("../../../../../lib/agent/agent-auth", () => ({
  authenticateAgentRequest: vi.fn().mockResolvedValue({
    userId: "user_owner",
    teamId: "team_1",
  }),
}));

vi.mock("../../../../../lib/agent/agent-device-registration", () => ({
  registerAgentDevice: vi.fn().mockResolvedValue({
    userId: "user_owner",
    deviceId: "device_mac_1",
    status: "pending",
    workerId: "local-worker:device_mac_1",
    deviceToken: "device_token_123",
  }),
}));

describe("POST /api/agent/device/register", () => {
  it("responds to Tauri CORS preflight requests", async () => {
    const response = await OPTIONS(
      new Request("http://localhost:3000/api/agent/device/register", {
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

  it("registers a device and returns its current authorization status", async () => {
    const { authenticateAgentRequest } = await import("../../../../../lib/agent/agent-auth");
    const { registerAgentDevice } = await import("../../../../../lib/agent/agent-device-registration");

    const response = await POST(
      new Request("http://localhost:3000/api/agent/device/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token_123",
          origin: "tauri://localhost",
        },
        body: JSON.stringify({
          userId: "user_owner",
          deviceId: "device_mac_1",
          deviceName: "agent-macbook",
          platform: "macos",
          capabilitySnapshot: {
            providers: [{ name: "codex", version: "0.108.0" }],
            capabilities: ["workspace", "files", "commands"],
            loginStateCategories: ["provider_account"],
            maxConcurrency: 1,
          },
        }),
      }),
    );

    const body = (await response.json()) as {
      ok: boolean;
      userId: string;
      deviceId: string;
      status: string;
      workerId: string;
      deviceToken: string;
    };

    expect(body).toEqual({
      ok: true,
      userId: "user_owner",
      deviceId: "device_mac_1",
      status: "pending",
      workerId: "local-worker:device_mac_1",
      deviceToken: "device_token_123",
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(vi.mocked(authenticateAgentRequest)).toHaveBeenCalledWith({
      authorizationHeader: "Bearer token_123",
      userId: "user_owner",
    });
    expect(vi.mocked(registerAgentDevice)).toHaveBeenCalledWith({
      userId: "user_owner",
      deviceId: "device_mac_1",
      deviceName: "agent-macbook",
      platform: "macos",
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.108.0" }],
        capabilities: ["workspace", "files", "commands"],
        loginStateCategories: ["provider_account"],
        maxConcurrency: 1,
      },
    });
  });

  it("refreshes an authorized device using only its device token", async () => {
    const { authenticateAgentRequest } = await import("../../../../../lib/agent/agent-auth");
    const { registerAgentDevice } = await import("../../../../../lib/agent/agent-device-registration");
    vi.mocked(authenticateAgentRequest).mockClear();
    vi.mocked(registerAgentDevice).mockClear();

    const response = await POST(new Request("http://localhost:3000/api/agent/device/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-device-token": "device_token_123",
      },
      body: JSON.stringify({
        userId: "user_owner",
        deviceId: "device_mac_1",
        deviceName: "agent-macbook",
        platform: "macos",
        capabilitySnapshot: {
          providers: [{ name: "codex", version: "unknown" }],
          capabilities: ["workspace", "files", "commands"],
          loginStateCategories: [],
          maxConcurrency: 1,
        },
      }),
    }));

    expect(response.status).toBe(200);
    expect(authenticateAgentRequest).toHaveBeenCalledWith({
      authorizationHeader: null,
      userId: "user_owner",
      deviceId: "device_mac_1",
      deviceTokenHeader: "device_token_123",
      requireAuthorizedDevice: true,
      allowDeviceTokenOnly: true,
    });
    expect(registerAgentDevice).toHaveBeenCalledWith(expect.objectContaining({
      currentDeviceToken: "device_token_123",
    }));
  });

  it("uses the device proof when a legacy client also sends a stale bearer token", async () => {
    const { authenticateAgentRequest } = await import("../../../../../lib/agent/agent-auth");
    vi.mocked(authenticateAgentRequest).mockClear();

    const response = await POST(new Request("http://localhost:3000/api/agent/device/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer stale_token",
        "x-agent-device-token": "device_token_123",
      },
      body: JSON.stringify({
        userId: "user_owner",
        deviceId: "device_mac_1",
        deviceName: "agent-macbook",
        platform: "macos",
        capabilitySnapshot: {
          providers: [{ name: "codex", version: "unknown" }],
          capabilities: ["workspace", "files", "commands"],
          loginStateCategories: [],
          maxConcurrency: 1,
        },
      }),
    }));

    expect(response.status).toBe(200);
    expect(authenticateAgentRequest).toHaveBeenCalledWith({
      authorizationHeader: "Bearer stale_token",
      userId: "user_owner",
      deviceId: "device_mac_1",
      deviceTokenHeader: "device_token_123",
      requireAuthorizedDevice: true,
      allowDeviceTokenOnly: true,
    });
  });

  it("rejects credential-shaped capability material before authentication", async () => {
    const { authenticateAgentRequest } = await import("../../../../../lib/agent/agent-auth");
    const { registerAgentDevice } = await import("../../../../../lib/agent/agent-device-registration");
    vi.mocked(authenticateAgentRequest).mockClear();
    vi.mocked(registerAgentDevice).mockClear();

    const response = await POST(
      new Request("http://localhost:3000/api/agent/device/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token_123",
          origin: "tauri://localhost",
        },
        body: JSON.stringify({
          userId: "user_owner",
          deviceId: "device_mac_1",
          deviceName: "agent-macbook",
          platform: "macos",
          capabilitySnapshot: {
            providers: [{ name: "codex", version: "0.108.0", token: "raw" }],
            capabilities: ["workspace"],
            loginStateCategories: [],
            maxConcurrency: 1,
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(authenticateAgentRequest).not.toHaveBeenCalled();
    expect(registerAgentDevice).not.toHaveBeenCalled();
  });

  it("returns 400 when required fields are missing", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/agent/device/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token_123",
          origin: "tauri://localhost",
        },
        body: JSON.stringify({
          userId: "user_owner",
          deviceId: "device_mac_1",
        }),
      }),
    );

    const body = (await response.json()) as {
      ok: boolean;
      error: string;
    };

    expect(response.status).toBe(400);
    expect(response.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(body).toEqual({
      ok: false,
      error: "Missing required device registration fields",
    });
  });

  it("returns 401 when the agent token is invalid", async () => {
    const { authenticateAgentRequest } = await import("../../../../../lib/agent/agent-auth");
    vi.mocked(authenticateAgentRequest).mockRejectedValueOnce(
      new Error("Invalid agent authorization token"),
    );

    const response = await POST(
      new Request("http://localhost:3000/api/agent/device/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token_invalid",
          origin: "tauri://localhost",
        },
        body: JSON.stringify({
          userId: "user_owner",
          deviceId: "device_mac_1",
          deviceName: "agent-macbook",
          platform: "macos",
          capabilitySnapshot: {
            providers: [{ name: "codex", version: "0.108.0" }],
            capabilities: ["workspace"],
            loginStateCategories: [],
            maxConcurrency: 1,
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
});
