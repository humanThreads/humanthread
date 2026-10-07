import { describe, expect, it, vi } from "vitest";
import { authenticateAgentRequest, hashAgentToken } from "./agent-auth";

describe("authenticateAgentRequest", () => {
  it("authenticates an authorized device with only the device token", async () => {
    const loadUserAuth = vi.fn().mockResolvedValue({
      id: "user_owner",
      teamId: "team_1",
      status: "active",
      agentApiTokenHash: null,
    });
    const loadDeviceAuth = vi.fn().mockResolvedValue({
      id: "device_mac_1",
      userId: "user_owner",
      status: "authorized",
      deviceTokenHash: hashAgentToken("device_token_123"),
    });

    const result = await authenticateAgentRequest(
      {
        authorizationHeader: null,
        userId: "user_owner",
        expectedTeamId: "team_1",
        deviceId: "device_mac_1",
        deviceTokenHeader: "device_token_123",
        requireAuthorizedDevice: true,
        allowDeviceTokenOnly: true,
      },
      {
        loadUserAuth,
        loadDeviceAuth,
      },
    );

    expect(loadUserAuth).toHaveBeenCalledWith({
      userId: "user_owner",
    });
    expect(loadDeviceAuth).toHaveBeenCalledWith({
      deviceId: "device_mac_1",
    });
    expect(result).toEqual({
      userId: "user_owner",
      teamId: "team_1",
      deviceId: "device_mac_1",
    });
  });

  it("authenticates a bearer token for the expected agent user and device", async () => {
    const result = await authenticateAgentRequest(
      {
        authorizationHeader: "Bearer token_123",
        userId: "user_owner",
        expectedTeamId: "team_1",
        deviceId: "device_mac_1",
        deviceTokenHeader: "device_token_123",
        requireAuthorizedDevice: true,
      },
      {
        loadUserAuth: vi.fn().mockResolvedValue({
          id: "user_owner",
          teamId: "team_1",
          status: "active",
          agentApiTokenHash: hashAgentToken("token_123"),
        }),
        loadDeviceAuth: vi.fn().mockResolvedValue({
          id: "device_mac_1",
          userId: "user_owner",
          status: "authorized",
          deviceTokenHash: hashAgentToken("device_token_123"),
        }),
      },
    );

    expect(result).toEqual({
      userId: "user_owner",
      teamId: "team_1",
      deviceId: "device_mac_1",
    });
  });

  it("accepts a valid device token when a stale bearer token is also present", async () => {
    const result = await authenticateAgentRequest(
      {
        authorizationHeader: "Bearer stale_token",
        userId: "user_owner",
        expectedTeamId: "team_1",
        deviceId: "device_mac_1",
        deviceTokenHeader: "device_token_123",
        requireAuthorizedDevice: true,
        allowDeviceTokenOnly: true,
      },
      {
        loadUserAuth: vi.fn().mockResolvedValue({
          id: "user_owner",
          teamId: "team_1",
          status: "active",
          agentApiTokenHash: hashAgentToken("current_token"),
        }),
        loadDeviceAuth: vi.fn().mockResolvedValue({
          id: "device_mac_1",
          userId: "user_owner",
          status: "authorized",
          deviceTokenHash: hashAgentToken("device_token_123"),
        }),
      },
    );

    expect(result).toEqual({
      userId: "user_owner",
      teamId: "team_1",
      deviceId: "device_mac_1",
    });
  });

  it("rejects an authorized-device request when the device token is missing", async () => {
    await expect(
      authenticateAgentRequest(
        {
          authorizationHeader: "Bearer token_123",
          userId: "user_owner",
          deviceId: "device_mac_1",
          requireAuthorizedDevice: true,
        },
        {
          loadUserAuth: vi.fn().mockResolvedValue({
            id: "user_owner",
            teamId: "team_1",
            status: "active",
            agentApiTokenHash: hashAgentToken("token_123"),
          }),
          loadDeviceAuth: vi.fn().mockResolvedValue({
            id: "device_mac_1",
            userId: "user_owner",
            status: "authorized",
            deviceTokenHash: hashAgentToken("device_token_123"),
          }),
        },
      ),
    ).rejects.toThrow("Missing agent device token");
  });

  it("rejects a request when the bearer token is missing", async () => {
    await expect(
      authenticateAgentRequest(
        {
          authorizationHeader: null,
          userId: "user_owner",
          expectedTeamId: "team_1",
        },
        {
          loadUserAuth: vi.fn(),
          loadDeviceAuth: vi.fn(),
        },
      ),
    ).rejects.toThrow("Missing agent authorization token");
  });

  it("rejects a request when the token does not match the stored hash", async () => {
    await expect(
      authenticateAgentRequest(
        {
          authorizationHeader: "Bearer token_wrong",
          userId: "user_owner",
          expectedTeamId: "team_1",
        },
        {
          loadUserAuth: vi.fn().mockResolvedValue({
            id: "user_owner",
            teamId: "team_1",
            status: "active",
            agentApiTokenHash: hashAgentToken("token_123"),
          }),
          loadDeviceAuth: vi.fn(),
        },
      ),
    ).rejects.toThrow("Invalid agent authorization token");
  });

  it("rejects an authorized-device request when the device does not exist", async () => {
    await expect(
      authenticateAgentRequest(
        {
          authorizationHeader: "Bearer token_123",
          userId: "user_owner",
          deviceId: "device_missing",
          requireAuthorizedDevice: true,
        },
        {
          loadUserAuth: vi.fn().mockResolvedValue({
            id: "user_owner",
            teamId: "team_1",
            status: "active",
            agentApiTokenHash: hashAgentToken("token_123"),
          }),
          loadDeviceAuth: vi.fn().mockResolvedValue(null),
        },
      ),
    ).rejects.toThrow("Agent device is unavailable");
  });

  it("rejects an authorized-device request when the device belongs to a different user", async () => {
    await expect(
      authenticateAgentRequest(
        {
          authorizationHeader: "Bearer token_123",
          userId: "user_owner",
          deviceId: "device_mac_1",
          requireAuthorizedDevice: true,
        },
        {
          loadUserAuth: vi.fn().mockResolvedValue({
            id: "user_owner",
            teamId: "team_1",
            status: "active",
            agentApiTokenHash: hashAgentToken("token_123"),
          }),
          loadDeviceAuth: vi.fn().mockResolvedValue({
            id: "device_mac_1",
            userId: "user_other",
            status: "authorized",
          }),
        },
      ),
    ).rejects.toThrow("Agent device is unavailable");
  });

  it("rejects an authorized-device request when the device is not authorized", async () => {
    await expect(
      authenticateAgentRequest(
        {
          authorizationHeader: "Bearer token_123",
          userId: "user_owner",
          deviceId: "device_mac_1",
          requireAuthorizedDevice: true,
        },
        {
          loadUserAuth: vi.fn().mockResolvedValue({
            id: "user_owner",
            teamId: "team_1",
            status: "active",
            agentApiTokenHash: hashAgentToken("token_123"),
          }),
          loadDeviceAuth: vi.fn().mockResolvedValue({
            id: "device_mac_1",
            userId: "user_owner",
            status: "pending",
            deviceTokenHash: hashAgentToken("device_token_123"),
          }),
        },
      ),
    ).rejects.toThrow("Agent device is not authorized");
  });

  it("rejects an authorized-device request when the device token is invalid", async () => {
    await expect(
      authenticateAgentRequest(
        {
          authorizationHeader: "Bearer token_123",
          userId: "user_owner",
          deviceId: "device_mac_1",
          deviceTokenHeader: "device_token_wrong",
          requireAuthorizedDevice: true,
        },
        {
          loadUserAuth: vi.fn().mockResolvedValue({
            id: "user_owner",
            teamId: "team_1",
            status: "active",
            agentApiTokenHash: hashAgentToken("token_123"),
          }),
          loadDeviceAuth: vi.fn().mockResolvedValue({
            id: "device_mac_1",
            userId: "user_owner",
            status: "authorized",
            deviceTokenHash: hashAgentToken("device_token_123"),
          }),
        },
      ),
    ).rejects.toThrow("Invalid agent device token");
  });

  it("allows authentication without an explicit team check", async () => {
    const result = await authenticateAgentRequest(
      {
        authorizationHeader: "Bearer token_123",
        userId: "user_owner",
      },
      {
        loadUserAuth: vi.fn().mockResolvedValue({
          id: "user_owner",
          teamId: "team_1",
          status: "active",
          agentApiTokenHash: hashAgentToken("token_123"),
        }),
        loadDeviceAuth: vi.fn(),
      },
    );

    expect(result).toEqual({
      userId: "user_owner",
      teamId: "team_1",
    });
  });
});
