import { describe, expect, it } from "vitest";

import {
  desktopBootstrapResponseSchema,
  desktopLoginResponseSchema,
  desktopRefreshResponseSchema,
} from "./session";

describe("desktop session contracts", () => {
  it("parses separate human-session and Agent-device credentials", () => {
    const result = desktopLoginResponseSchema.parse({
      ok: true,
      data: {
        accessToken: "desktop_access_1",
        accessExpiresAt: "2026-07-27T10:15:00.000Z",
        refreshToken: "desktop_refresh_1",
        sessionId: "desktop_session_1",
        user: {
          id: "user_1",
          email: "user@example.com",
          name: "User",
          avatarUrl: "/uploads/avatars/user_1/avatar.png",
        },
        device: {
          id: "device_1",
          status: "authorized",
          deviceToken: "device_token_1",
        },
      },
    });

    expect(result.data.sessionId).toBe("desktop_session_1");
    expect(result.data.user.avatarUrl).toBe("/uploads/avatars/user_1/avatar.png");
    expect(result.data.device.deviceToken).toBe("device_token_1");
  });

  it("rejects invalid refresh expiry timestamps", () => {
    expect(() =>
      desktopRefreshResponseSchema.parse({
        ok: true,
        data: {
          accessToken: "desktop_access_2",
          accessExpiresAt: "tomorrow",
          refreshToken: "desktop_refresh_2",
          sessionId: "desktop_session_1",
        },
      }),
    ).toThrow();
  });

  it("validates bootstrap Space and capability identity", () => {
    const result = desktopBootstrapResponseSchema.parse({
      ok: true,
      data: {
        spaces: [{ key: "personal", kind: "personal", name: "Personal" }],
        activeSpaceKey: "personal",
        currentTask: null,
        capabilities: { nativeExecution: true },
      },
    });

    expect(result.data.spaces[0]?.key).toBe("personal");
    expect(result.data.capabilities.nativeExecution).toBe(true);
  });
});
