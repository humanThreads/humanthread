import { beforeEach, describe, expect, it, vi } from "vitest";

import { loginDesktopSession } from "../../../../lib/desktop/desktop-login";
import { OPTIONS, POST } from "./route";

vi.mock("../../../../lib/desktop/desktop-login", () => ({
  loginDesktopSession: vi.fn(),
}));

const loginResult = {
  accessToken: "v1.access.signature",
  accessExpiresAt: "2026-07-27T08:15:00.000Z",
  refreshToken: "ht_desktop_refresh_1",
  sessionId: "desktop_session_1",
  user: {
    id: "user_1",
    email: "user@example.com",
    name: "User",
    avatarUrl: null,
  },
  device: {
    id: "device_1",
    status: "authorized" as const,
    deviceToken: "ht_device_1",
  },
};

describe("POST /api/desktop/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loginDesktopSession).mockResolvedValue(loginResult);
  });

  it("responds to the Tauri development preflight", async () => {
    const response = await OPTIONS(
      new Request("http://localhost:3000/api/desktop/session", {
        method: "OPTIONS",
        headers: { origin: "http://localhost:1420" },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:1420",
    );
  });

  it("creates a desktop human session and returns a structured response", async () => {
    const request = new Request("http://localhost:3000/api/desktop/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "tauri://localhost",
        "x-agent-device-token": "ht_device_existing",
      },
      body: JSON.stringify({
        email: "user@example.com",
        password: "correct-password",
        installationId: "install_1",
        deviceId: "device_1",
        deviceName: "MacBook",
        platform: "macos",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(await response.json()).toEqual({ ok: true, data: loginResult });
    expect(loginDesktopSession).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "correct-password",
      installationId: "install_1",
      deviceId: "device_1",
      deviceName: "MacBook",
      platform: "macos",
      currentDeviceToken: "ht_device_existing",
    });
  });

  it("returns a structured validation error", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/desktop/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "validation_failed",
      error: "Invalid desktop login request",
    });
  });
});
