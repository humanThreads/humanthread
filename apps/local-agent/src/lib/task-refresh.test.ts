import { describe, expect, it, vi } from "vitest";
import { refreshLocalAgentTaskState } from "./task-refresh";

describe("refreshLocalAgentTaskState", () => {
  it("writes rotated device token back into the active session", async () => {
    const loadAgentTaskSnapshot = vi.fn().mockResolvedValue({
      deviceStatus: "authorized",
      activeBinding: {
        sessionKey: "http://localhost:3000::alice@example.com",
        apiBaseUrl: "http://localhost:3000",
        teamId: "team_2",
        userId: "user_reviewer",
        userEmail: "alice@example.com",
        deviceId: "device-agent-macbook",
        deviceName: "agent-macbook",
        deviceToken: "device_token_2",
        apiToken: "",
        pollIntervalMs: 10000,
        commandTemplate: "{command}",
      },
      taskResponse: {
        ok: true,
        teamId: "team_2",
        userId: "user_reviewer",
        queueLength: 0,
        task: null,
      },
    });

    const result = await refreshLocalAgentTaskState(
      {
        state: {
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
        environment: {
          storage: {
            getItem() {
              return null;
            },
            setItem() {},
          },
          fallbackDeviceName: "agent-macbook",
          now: () => "2026-05-26T01:00:00.000Z",
          createId: () => "install_1",
        },
        platform: "macos",
      },
      {
        loadAgentTaskSnapshot,
      },
    );

    expect(result.activeBinding?.deviceToken).toBe("device_token_2");
    expect(
      result.state.accountSessions["http://localhost:3000::alice@example.com"]
        ?.deviceToken,
    ).toBe("device_token_2");
  });

  it("returns the same state when no active session exists", async () => {
    const loadAgentTaskSnapshot = vi.fn().mockResolvedValue({
      deviceStatus: "pending",
      activeBinding: null,
      taskResponse: null,
    });

    const state = {
      installProfile: {
        installationId: "install_1",
        defaultDeviceName: "agent-macbook",
        appearance: "light" as const,
        lastSuccessfulRoute: "/dashboard",
        onboardingSkipped: false,
        onboardingCompletedAt: null,
        createdAt: "2026-05-25T00:00:00.000Z",
        lastUsedAt: "2026-05-25T00:00:00.000Z",
      },
      activeSessionKey: null,
      accountSessions: {},
    };

    const result = await refreshLocalAgentTaskState(
      {
        state,
        environment: {
          storage: {
            getItem() {
              return null;
            },
            setItem() {},
          },
          fallbackDeviceName: "agent-macbook",
          now: () => "2026-05-26T01:00:00.000Z",
          createId: () => "install_1",
        },
        platform: "macos",
      },
      {
        loadAgentTaskSnapshot,
      },
    );

    expect(result).toEqual({
      state,
      activeBinding: null,
      deviceStatus: "pending",
      taskResponse: null,
    });
  });
});
