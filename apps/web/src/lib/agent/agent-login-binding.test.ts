import { describe, expect, it, vi } from "vitest";
import { loginAndRegisterAgentDevice } from "./agent-login-binding";

describe("loginAndRegisterAgentDevice", () => {
  it("authenticates by email and password then authorizes the local device", async () => {
    const loadUserForLogin = vi.fn().mockResolvedValue({
      id: "user_owner",
      teamId: "team_1",
      email: "alice@example.com",
      status: "active",
      passwordHash: "pbkdf2$hash",
    });
    const registerAgentDevice = vi.fn().mockResolvedValue({
      userId: "user_owner",
      deviceId: "device-agent-macbook",
      status: "authorized",
      deviceToken: "device_token_123",
    });
    const verifyPassword = vi.fn().mockReturnValue(true);

    const result = await loginAndRegisterAgentDevice(
      {
        email: "  alice@example.com ",
        password: "correct-password",
        deviceId: "device-agent-macbook",
        deviceName: "agent-macbook",
        platform: "macos",
        currentDeviceToken: "device_token_old",
      },
      {
        loadUserForLogin,
        registerAgentDevice,
        verifyPassword,
      },
    );

    expect(loadUserForLogin).toHaveBeenCalledWith({
      email: "alice@example.com",
    });
    expect(verifyPassword).toHaveBeenCalledWith({
      password: "correct-password",
      passwordHash: "pbkdf2$hash",
    });
    expect(registerAgentDevice).toHaveBeenCalledWith({
      userId: "user_owner",
      deviceId: "device-agent-macbook",
      deviceName: "agent-macbook",
      platform: "macos",
      currentDeviceToken: "device_token_old",
      allowAuthorizedDeviceTokenRotation: true,
      authorizeDevice: true,
    });
    expect(result).toEqual({
      teamId: "team_1",
      userId: "user_owner",
      deviceId: "device-agent-macbook",
      status: "authorized",
      deviceToken: "device_token_123",
    });
  });

  it("registers a local device for an active user resolved by user ID", async () => {
    const loadUserForLogin = vi.fn().mockResolvedValue({
      id: "user_owner",
      teamId: "team_1",
      email: null,
      status: "active",
    });
    const registerAgentDevice = vi.fn().mockResolvedValue({
      userId: "user_owner",
      deviceId: "device-agent-macbook",
      status: "authorized",
      deviceToken: "device_token_123",
    });

    const result = await loginAndRegisterAgentDevice(
      {
        userId: " user_owner ",
        deviceId: "device-agent-macbook",
        deviceName: "agent-macbook",
        platform: "macos",
      },
      {
        loadUserForLogin,
        registerAgentDevice,
      },
    );

    expect(loadUserForLogin).toHaveBeenCalledWith({
      userId: "user_owner",
    });
    expect(registerAgentDevice).toHaveBeenCalledWith({
      userId: "user_owner",
      deviceId: "device-agent-macbook",
      deviceName: "agent-macbook",
      platform: "macos",
      allowAuthorizedDeviceTokenRotation: false,
    });
    expect(result.status).toBe("authorized");
    expect(result.teamId).toBe("team_1");
  });

  it("authorizes a local device when a valid workbench binding code is provided", async () => {
    const loadUserForLogin = vi.fn().mockResolvedValue({
      id: "user_owner",
      teamId: "team_1",
      email: "alice@example.com",
      status: "active",
    });
    const registerAgentDevice = vi.fn().mockResolvedValue({
      userId: "user_owner",
      deviceId: "device-agent-macbook",
      status: "authorized",
      deviceToken: "device_token_123",
    });

    const result = await loginAndRegisterAgentDevice(
      {
        bindingCode: "signed-binding-code",
        deviceId: "device-agent-macbook",
        deviceName: "agent-macbook",
        platform: "macos",
      },
      {
        loadUserForLogin,
        registerAgentDevice,
        verifyAgentBindingCode: vi.fn().mockReturnValue({
          userId: "user_owner",
          teamId: "team_1",
        }),
      },
    );

    expect(loadUserForLogin).toHaveBeenCalledWith({
      userId: "user_owner",
    });
    expect(registerAgentDevice).toHaveBeenCalledWith({
      userId: "user_owner",
      deviceId: "device-agent-macbook",
      deviceName: "agent-macbook",
      platform: "macos",
      allowAuthorizedDeviceTokenRotation: true,
      authorizeDevice: true,
    });
    expect(result.status).toBe("authorized");
  });

  it("rejects a binding code that belongs to a different user", async () => {
    await expect(
      loginAndRegisterAgentDevice(
        {
          userId: "user_owner",
          bindingCode: "signed-binding-code",
          deviceId: "device-agent-macbook",
          deviceName: "agent-macbook",
          platform: "macos",
        },
        {
          loadUserForLogin: vi.fn(),
          registerAgentDevice: vi.fn(),
          verifyAgentBindingCode: vi.fn().mockReturnValue({
            userId: "user_peer",
            teamId: "team_1",
          }),
        },
      ),
    ).rejects.toThrow("Agent binding code does not match the requested user");
  });

  it("rejects login binding when no user identifier is provided", async () => {
    await expect(
      loginAndRegisterAgentDevice(
        {
          deviceId: "device-agent-macbook",
          deviceName: "agent-macbook",
          platform: "macos",
        },
        {
          loadUserForLogin: vi.fn(),
          registerAgentDevice: vi.fn(),
        },
      ),
    ).rejects.toThrow("User email, user ID, or binding code is required");
  });

  it("rejects login binding for inactive or missing users", async () => {
    await expect(
      loginAndRegisterAgentDevice(
        {
          email: "alice@example.com",
          password: "correct-password",
          deviceId: "device-agent-macbook",
          deviceName: "agent-macbook",
          platform: "macos",
        },
        {
          loadUserForLogin: vi.fn().mockResolvedValue({
            id: "user_owner",
            teamId: "team_1",
            email: "alice@example.com",
            status: "disabled",
            passwordHash: "pbkdf2$hash",
          }),
          registerAgentDevice: vi.fn(),
        },
      ),
    ).rejects.toThrow("Agent login user is unavailable");
  });

  it("rejects password login when the password is invalid", async () => {
    const registerAgentDevice = vi.fn();

    await expect(
      loginAndRegisterAgentDevice(
        {
          email: "alice@example.com",
          password: "wrong-password",
          deviceId: "device-agent-macbook",
          deviceName: "agent-macbook",
          platform: "macos",
        },
        {
          loadUserForLogin: vi.fn().mockResolvedValue({
            id: "user_owner",
            teamId: "team_1",
            email: "alice@example.com",
            status: "active",
            passwordHash: "pbkdf2$hash",
          }),
          registerAgentDevice,
          verifyPassword: vi.fn().mockReturnValue(false),
        },
      ),
    ).rejects.toThrow("Agent login credentials are invalid");

    expect(registerAgentDevice).not.toHaveBeenCalled();
  });
});
