import type { AgentDeviceRegisterResponse } from "@humanthread/shared";
import { describe, expect, it } from "vitest";

import type { RegisterAgentDeviceInput } from "../agent/agent-device-registration";
import type { DesktopSessionRecord } from "./desktop-session-store";
import { loginDesktopSession, refreshDesktopSession } from "./desktop-login";
import { verifyDesktopAccessToken } from "./desktop-token";

const now = new Date("2026-07-27T08:00:00.000Z");
const secret = "desktop-session-secret-for-tests";

function sessionRecord(input: {
  refreshTokenHash: string;
  version: number;
  lastUsedAt: Date;
}): DesktopSessionRecord {
  return {
    id: "desktop_session_1",
    userId: "user_1",
    installationId: "install_1",
    deviceId: "device_1",
    refreshTokenHash: input.refreshTokenHash,
    status: "active",
    expiresAt: new Date("2026-08-26T08:00:00.000Z"),
    lastUsedAt: input.lastUsedAt,
    revokedAt: null,
    createdAt: now,
    updatedAt: input.lastUsedAt,
    version: input.version,
  };
}

describe("desktop login", () => {
  it("returns separate human-session and Agent-device credentials", async () => {
    let registeredUserId = "";
    let registerInput: RegisterAgentDeviceInput | undefined;
    let persistedRefreshToken = "";
    const result = await loginDesktopSession(
      {
        email: "user@example.com",
        password: "correct-password",
        installationId: "install_1",
        deviceId: "device_1",
        deviceName: "MacBook",
        platform: "macos",
        now,
      },
      {
        authenticateUser: async () => ({ id: "user_1", email: "user@example.com" }),
        loadUserProfile: async () => ({
          id: "user_1",
          email: "user@example.com",
          name: "User",
          avatarUrl: "/uploads/avatars/user_1/avatar.png",
        }),
        registerDevice: async (input): Promise<AgentDeviceRegisterResponse> => {
          registeredUserId = input.userId;
          registerInput = input;
          return {
            userId: input.userId,
            deviceId: "device_1",
            status: "authorized",
            deviceToken: "ht_device_1",
          };
        },
        createRefreshToken: () => "ht_desktop_refresh_1",
        createSession: async (input) => {
          persistedRefreshToken = input.refreshToken;
          return sessionRecord({
            refreshTokenHash: "a".repeat(64),
            version: 1,
            lastUsedAt: now,
          });
        },
        accessTokenSecret: secret,
      },
    );

    expect(registeredUserId).toBe("user_1");
    expect(registerInput).toMatchObject({
      authorizeDevice: true,
      allowAuthorizedDeviceTokenRotation: true,
    });
    expect(persistedRefreshToken).toBe("ht_desktop_refresh_1");
    expect(result).toMatchObject({
      refreshToken: "ht_desktop_refresh_1",
      sessionId: "desktop_session_1",
      user: {
        id: "user_1",
        avatarUrl: "/uploads/avatars/user_1/avatar.png",
      },
      device: {
        id: "device_1",
        status: "authorized",
        deviceToken: "ht_device_1",
      },
    });
    expect(result.accessToken).not.toBe(result.device.deviceToken);
    expect(
      verifyDesktopAccessToken({ token: result.accessToken, now, secret }),
    ).toMatchObject({ userId: "user_1", sessionId: "desktop_session_1" });
  });
});

describe("desktop refresh", () => {
  it("rotates the opaque refresh credential and issues a new access token", async () => {
    let rotation:
      | { sessionId: string; currentRefreshToken: string; nextRefreshToken: string }
      | undefined;
    const result = await refreshDesktopSession(
      {
        sessionId: "desktop_session_1",
        refreshToken: "ht_desktop_refresh_1",
        now,
      },
      {
        createRefreshToken: () => "ht_desktop_refresh_2",
        rotateSession: async (input) => {
          rotation = input;
          return sessionRecord({
            refreshTokenHash: "b".repeat(64),
            version: 2,
            lastUsedAt: input.now ?? now,
          });
        },
        accessTokenSecret: secret,
      },
    );

    expect(rotation).toEqual({
      sessionId: "desktop_session_1",
      currentRefreshToken: "ht_desktop_refresh_1",
      nextRefreshToken: "ht_desktop_refresh_2",
      now,
    });
    expect(result).toMatchObject({
      refreshToken: "ht_desktop_refresh_2",
      sessionId: "desktop_session_1",
    });
    expect(
      verifyDesktopAccessToken({ token: result.accessToken, now, secret }),
    ).toMatchObject({ userId: "user_1", sessionId: "desktop_session_1" });
  });
});
