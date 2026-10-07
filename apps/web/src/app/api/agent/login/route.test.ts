import { describe, expect, it, vi } from "vitest";
import { OPTIONS, POST } from "./route";

vi.mock("../../../../lib/agent/agent-login-binding", () => ({
  loginAndRegisterAgentDevice: vi.fn().mockResolvedValue({
    teamId: "team_1",
    userId: "user_owner",
    deviceId: "device-agent-macbook",
    status: "pending",
    deviceToken: "device_token_123",
  }),
}));

describe("POST /api/agent/login", () => {
  it("responds to Tauri CORS preflight requests", async () => {
    const response = await OPTIONS(
      new Request("http://localhost:3000/api/agent/login", {
        method: "OPTIONS",
        headers: {
          origin: "tauri://localhost",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type,x-agent-device-token",
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "x-agent-device-token",
    );
  });

  it("binds a local device by user email without a manual API token", async () => {
    const { loginAndRegisterAgentDevice } = await import("../../../../lib/agent/agent-login-binding");

    const response = await POST(
      new Request("http://localhost:3000/api/agent/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-agent-device-token": "device_token_old",
          origin: "tauri://localhost",
        },
        body: JSON.stringify({
          email: "alice@example.com",
          password: "correct-password",
          bindingCode: "signed-binding-code",
          deviceId: "device-agent-macbook",
          deviceName: "agent-macbook",
          platform: "macos",
        }),
      }),
    );

    const body = (await response.json()) as {
      ok: boolean;
      teamId: string;
      userId: string;
      deviceId: string;
      status: string;
      deviceToken: string;
    };

    expect(body).toEqual({
      ok: true,
      teamId: "team_1",
      userId: "user_owner",
      deviceId: "device-agent-macbook",
      status: "pending",
      deviceToken: "device_token_123",
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(vi.mocked(loginAndRegisterAgentDevice)).toHaveBeenCalledWith({
      email: "alice@example.com",
      password: "correct-password",
      bindingCode: "signed-binding-code",
      deviceId: "device-agent-macbook",
      deviceName: "agent-macbook",
      platform: "macos",
      currentDeviceToken: "device_token_old",
    });
  });

  it("returns 400 when device fields are missing", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/agent/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "tauri://localhost",
        },
        body: JSON.stringify({
          email: "alice@example.com",
          deviceName: "agent-macbook",
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
      error: "Missing required agent login fields",
    });
  });

  it("returns 401 when the user cannot login", async () => {
    const { loginAndRegisterAgentDevice } = await import("../../../../lib/agent/agent-login-binding");
    vi.mocked(loginAndRegisterAgentDevice).mockRejectedValueOnce(
      new Error("Agent login user is unavailable"),
    );

    const response = await POST(
      new Request("http://localhost:3000/api/agent/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "tauri://localhost",
        },
        body: JSON.stringify({
          email: "alice@example.com",
          deviceId: "device-agent-macbook",
          deviceName: "agent-macbook",
          platform: "macos",
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
      error: "Agent login user is unavailable",
    });
  });
});
