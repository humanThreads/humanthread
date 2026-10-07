import { describe, expect, it, vi } from "vitest";
import { loginAndPersistAgentSession } from "./login-binding";
import type { BindingEnvironment } from "./binding";

function createEnvironment(): BindingEnvironment {
  return {
    storage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    fallbackDeviceName: "agent-macbook",
    now: () => "2026-05-26T00:00:00.000Z",
    createId: () => "install_1",
  };
}

describe("loginAndPersistAgentSession", () => {
  it("distinguishes the generic MacIntel name by installation", async () => {
    const loginAndBindAgentDevice = vi.fn().mockResolvedValue({
      ok: true,
      teamId: "team_1",
      userId: "user_owner",
      deviceId: "device-macintel-install_alpha",
      status: "authorized",
      deviceToken: "device_token_1",
    });

    const result = await loginAndPersistAgentSession(
      {
        email: "alice@example.com",
        password: "correct-password",
        apiBaseUrl: "http://localhost:3000",
        environment: createEnvironment(),
        platform: "macos",
        seedState: {
          installProfile: {
            installationId: "install_alpha",
            defaultDeviceName: "MacIntel",
      appearance: "light",
      lastSuccessfulRoute: "/dashboard",
      onboardingSkipped: false,
      onboardingCompletedAt: null,
            createdAt: "2026-05-25T00:00:00.000Z",
            lastUsedAt: "2026-05-25T00:00:00.000Z",
          },
          activeSessionKey: null,
          accountSessions: {},
        },
      },
      { loginAndBindAgentDevice },
    );

    expect(loginAndBindAgentDevice).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        deviceName: "MacIntel - alpha",
      }),
    }));
    expect(result.activeBinding?.deviceName).toBe("MacIntel - alpha");
  });

  it("migrates the historical default device ID for the same installation", async () => {
    const loginAndBindAgentDevice = vi.fn().mockResolvedValue({
      ok: true,
      teamId: "team_1",
      userId: "user_owner",
      deviceId: "device-agent-macbook-install_1",
      status: "authorized",
      deviceToken: "device_token_2",
    });

    const result = await loginAndPersistAgentSession(
      {
        email: "alice@example.com",
        password: " correct-password ",
        apiBaseUrl: "http://localhost:3000/",
        environment: createEnvironment(),
        platform: "macos",
        seedState: {
          installProfile: {
            installationId: "install_1",
            defaultDeviceName: "agent-macbook",
      appearance: "light",
      lastSuccessfulRoute: "/dashboard",
      onboardingSkipped: false,
      onboardingCompletedAt: null,
            createdAt: "2026-05-25T00:00:00.000Z",
            lastUsedAt: "2026-05-25T00:00:00.000Z",
          },
          activeSessionKey: "http://localhost:3000::alice@example.com",
          accountSessions: {
            "http://localhost:3000::alice@example.com": {
              sessionKey: "http://localhost:3000::alice@example.com",
              apiBaseUrl: "http://localhost:3000",
              email: "alice@example.com",
              desktopSessionId: "",
              activeSpaceKey: "personal",
              teamId: "team_1",
              userId: "user_owner",
              deviceId: "device-agent-macbook",
              deviceName: "agent-macbook",
              deviceToken: "device_token_1",
              apiToken: "",
              lastLoginAt: "2026-05-25T00:00:00.000Z",
              lastUsedAt: "2026-05-25T00:00:00.000Z",
            },
          },
        },
      },
      {
        loginAndBindAgentDevice,
      },
    );

    expect(loginAndBindAgentDevice).toHaveBeenCalledWith({
      apiBaseUrl: "http://localhost:3000",
      deviceToken: "device_token_1",
      body: {
        email: "alice@example.com",
        password: "correct-password",
        deviceId: "device-agent-macbook-install_1",
        deviceName: "agent-macbook",
        platform: "macos",
      },
    });
    expect(result.activeBinding?.deviceId).toBe("device-agent-macbook-install_1");
    expect(result.activeBinding?.deviceToken).toBe("device_token_2");
    expect(result.state.activeSessionKey).toBe(
      "http://localhost:3000::alice@example.com",
    );
  });

  it("preserves a custom stored device ID", async () => {
    const loginAndBindAgentDevice = vi.fn().mockResolvedValue({
      ok: true,
      teamId: "team_1",
      userId: "user_owner",
      deviceId: "device-office-mac",
      status: "authorized",
      deviceToken: "device_token_2",
    });
    const sessionKey = "http://localhost:3000::alice@example.com";

    await loginAndPersistAgentSession(
      {
        email: "alice@example.com",
        password: "correct-password",
        apiBaseUrl: "http://localhost:3000",
        environment: createEnvironment(),
        platform: "macos",
        seedState: {
          installProfile: {
            installationId: "install_1",
            defaultDeviceName: "agent-macbook",
      appearance: "light",
      lastSuccessfulRoute: "/dashboard",
      onboardingSkipped: false,
      onboardingCompletedAt: null,
            createdAt: "2026-05-25T00:00:00.000Z",
            lastUsedAt: "2026-05-25T00:00:00.000Z",
          },
          activeSessionKey: sessionKey,
          accountSessions: {
            [sessionKey]: {
              sessionKey,
              apiBaseUrl: "http://localhost:3000",
              email: "alice@example.com",
              desktopSessionId: "",
              activeSpaceKey: "personal",
              teamId: "team_1",
              userId: "user_owner",
              deviceId: "device-office-mac",
              deviceName: "agent-macbook",
              deviceToken: "device_token_1",
              apiToken: "",
              lastLoginAt: "2026-05-25T00:00:00.000Z",
              lastUsedAt: "2026-05-25T00:00:00.000Z",
            },
          },
        },
      },
      { loginAndBindAgentDevice },
    );

    expect(loginAndBindAgentDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ deviceId: "device-office-mac" }),
      }),
    );
  });

  it("creates a new session for a different email", async () => {
    const loginAndBindAgentDevice = vi.fn().mockResolvedValue({
      ok: true,
      teamId: "team_9",
      userId: "user_new",
      deviceId: "device-agent-macbook-user-new",
      status: "authorized",
      deviceToken: "device_token_new",
    });

    const result = await loginAndPersistAgentSession(
      {
        email: "newuser@example.com",
        password: " correct-password ",
        apiBaseUrl: "http://localhost:3000",
        environment: createEnvironment(),
        platform: "macos",
      },
      {
        loginAndBindAgentDevice,
      },
    );

    expect(result.state.activeSessionKey).toBe(
      "http://localhost:3000::newuser@example.com",
    );
    expect(result.activeBinding?.userEmail).toBe("newuser@example.com");
    expect(result.activeBinding?.deviceId).toBe("device-agent-macbook-user-new");
  });

  it("rejects login when the email is missing", async () => {
    await expect(
      loginAndPersistAgentSession({
        email: " ",
        password: "correct-password",
        apiBaseUrl: "http://localhost:3000",
        environment: createEnvironment(),
        platform: "macos",
      }),
    ).rejects.toThrow("请填写登录邮箱。");
  });

  it("rejects login when the password is missing", async () => {
    await expect(
      loginAndPersistAgentSession({
        email: "alice@example.com",
        password: " ",
        apiBaseUrl: "http://localhost:3000",
        environment: createEnvironment(),
        platform: "macos",
      }),
    ).rejects.toThrow("请填写登录密码。");
  });
});
