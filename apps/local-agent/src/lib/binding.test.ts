import { describe, expect, it } from "vitest";

import {
  AGENT_BINDING_STORAGE_KEY,
  AGENT_STATE_STORAGE_KEY,
  buildInstallationScopedDeviceId,
  buildAccountSessionKey,
  loadAgentState,
  resolveInstallationScopedDeviceName,
  resolveLoginDeviceId,
  saveAgentState,
  type StorageLike,
} from "./binding";

function createMemoryStorage(seed?: Record<string, string>): StorageLike & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(seed ?? {}));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const environmentDefaults = {
  fallbackDeviceName: "agent-macbook",
  now: () => "2026-07-28T08:00:00.000Z",
  createId: () => "install_1",
};

describe("local agent state", () => {
  it("assigns different stable IDs to same-name Desktop installations", () => {
    expect(buildInstallationScopedDeviceId({
      deviceName: "MacIntel",
      installationId: "install_alpha",
    })).toBe("device-macintel-install_alpha");
    expect(buildInstallationScopedDeviceId({
      deviceName: "MacIntel",
      installationId: "install_beta",
    })).toBe("device-macintel-install_beta");
  });

  it("assigns different display names to generic platform installations", () => {
    expect(resolveInstallationScopedDeviceName({
      deviceName: "MacIntel",
      installationId: "install_alpha",
    })).toBe("MacIntel - alpha");
    expect(resolveInstallationScopedDeviceName({
      deviceName: "MacIntel",
      installationId: "install_beta",
    })).toBe("MacIntel - beta");
    expect(resolveInstallationScopedDeviceName({
      deviceName: "Office Mac",
      installationId: "install_alpha",
    })).toBe("Office Mac");
  });

  it("keeps installation-scoped device IDs path-safe and within 64 characters", () => {
    const result = buildInstallationScopedDeviceId({
      deviceName: "MacIntel ".repeat(20),
      installationId: `install_${"x".repeat(100)}`,
    });

    expect(result).toMatch(/^[a-z0-9_-]+$/u);
    expect(result.length).toBeLessThanOrEqual(64);
  });

  it("migrates only the historical name-only default device ID", () => {
    expect(resolveLoginDeviceId({
      deviceName: "MacIntel",
      installationId: "install_alpha",
      existingDeviceId: "device-macintel",
    })).toBe("device-macintel-install_alpha");
    expect(resolveLoginDeviceId({
      deviceName: "MacIntel",
      installationId: "install_alpha",
      existingDeviceId: "device-office-mac",
    })).toBe("device-office-mac");
    expect(resolveLoginDeviceId({
      deviceName: "Office_Mac",
      installationId: "install_alpha",
      existingDeviceId: "device-office-mac",
    })).toBe("device-office_mac-install_alpha");
  });

  it("creates a default install profile and no active session when storage is empty", () => {
    const result = loadAgentState({ storage: createMemoryStorage(), ...environmentDefaults });

    expect(result.installProfile.installationId).toBe("install_1");
    expect(result.accountSessions).toEqual({});
    expect(result.activeSessionKey).toBeNull();
  });

  it("migrates legacy account metadata without restoring credentials or login", () => {
    const storage = createMemoryStorage({
      [AGENT_BINDING_STORAGE_KEY]: JSON.stringify({
        apiBaseUrl: "http://localhost:3000/",
        teamId: "team_2",
        userId: "user_reviewer",
        userEmail: " Alice@example.com ",
        deviceId: "device-agent-macbook",
        deviceName: "agent-macbook",
        deviceToken: "device_token_1",
        apiToken: "api_token_1",
      }),
    });

    const result = loadAgentState({ storage, ...environmentDefaults });
    const sessionKey = buildAccountSessionKey(
      "http://localhost:3000",
      "alice@example.com",
    );

    expect(result.activeSessionKey).toBeNull();
    expect(result.accountSessions[sessionKey]).toMatchObject({
      desktopSessionId: "",
      deviceId: "device-agent-macbook",
      deviceToken: "",
      apiToken: "",
    });
    expect(storage.getItem(AGENT_BINDING_STORAGE_KEY)).toBeNull();
  });

  it("scrubs credentials from a legacy v2 state and removes the old binding key", () => {
    const sessionKey = "http://localhost:3000::owner@example.com";
    const storage = createMemoryStorage({
      [AGENT_BINDING_STORAGE_KEY]: JSON.stringify({
        userEmail: "owner@example.com",
        deviceToken: "legacy_binding_device_token",
        apiToken: "legacy_binding_api_token",
      }),
      [AGENT_STATE_STORAGE_KEY]: JSON.stringify({
        version: 2,
        installProfile: {
          installationId: "install_1",
          defaultDeviceName: "agent-macbook",
          appearance: "light",
          lastSuccessfulRoute: "/dashboard",
          createdAt: "2026-07-28T08:00:00.000Z",
          lastUsedAt: "2026-07-28T08:00:00.000Z",
        },
        activeSessionKey: sessionKey,
        accountSessions: {
          [sessionKey]: {
            sessionKey,
            apiBaseUrl: "http://localhost:3000",
            email: "owner@example.com",
            desktopSessionId: "desktop_session_legacy",
            activeSpaceKey: "personal",
            teamId: "team_1",
            userId: "user_1",
            deviceId: "device_1",
            deviceName: "agent-macbook",
            deviceToken: "legacy_state_device_token",
            apiToken: "legacy_state_api_token",
            lastLoginAt: "2026-07-28T08:00:00.000Z",
            lastUsedAt: "2026-07-28T08:00:00.000Z",
          },
        },
      }),
    });

    const result = loadAgentState({ storage, ...environmentDefaults });

    expect(result.activeSessionKey).toBeNull();
    expect(result.accountSessions[sessionKey]).toMatchObject({
      desktopSessionId: "",
      deviceToken: "",
      apiToken: "",
    });
    expect(storage.getItem(AGENT_BINDING_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(AGENT_STATE_STORAGE_KEY)).not.toMatch(
      /desktop_session_legacy|legacy_state_device_token|legacy_state_api_token/u,
    );
  });

  it("removes credentials from incomplete binding and malformed v2 storage", () => {
    const storage = createMemoryStorage({
      [AGENT_BINDING_STORAGE_KEY]: JSON.stringify({
        deviceToken: "orphaned_binding_device_token",
        apiToken: "orphaned_binding_api_token",
      }),
      [AGENT_STATE_STORAGE_KEY]: "{\"deviceToken\":\"malformed_state_token\"",
    });

    const result = loadAgentState({ storage, ...environmentDefaults });

    expect(result.activeSessionKey).toBeNull();
    expect(result.accountSessions).toEqual({});
    expect(storage.getItem(AGENT_BINDING_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(AGENT_STATE_STORAGE_KEY)).not.toMatch(
      /malformed_state_token|orphaned_binding/u,
    );
  });

  it("replaces malformed v2 storage even when no legacy binding exists", () => {
    const storage = createMemoryStorage({
      [AGENT_STATE_STORAGE_KEY]: "{\"refreshToken\":\"orphaned_refresh_token\"",
    });

    const result = loadAgentState({ storage, ...environmentDefaults });

    expect(result.activeSessionKey).toBeNull();
    expect(storage.getItem(AGENT_STATE_STORAGE_KEY)).not.toContain(
      "orphaned_refresh_token",
    );
  });

  it("persists account metadata without authentication state or tokens", () => {
    const storage = createMemoryStorage();
    const state = loadAgentState({ storage, ...environmentDefaults });
    const sessionKey = "http://localhost:3000::owner@example.com";

    const runtimeState = saveAgentState({ storage, ...environmentDefaults }, {
      ...state,
      activeSessionKey: sessionKey,
      accountSessions: {
        [sessionKey]: {
          sessionKey,
          apiBaseUrl: "http://localhost:3000",
          email: "owner@example.com",
          desktopSessionId: "desktop_session_1",
          activeSpaceKey: "personal",
          teamId: "team_1",
          userId: "user_1",
          deviceId: "device_1",
          deviceName: "agent-macbook",
          deviceToken: "device_token_1",
          apiToken: "api_token_1",
          lastLoginAt: "2026-07-28T08:00:00.000Z",
          lastUsedAt: "2026-07-28T08:00:00.000Z",
        },
      },
    });

    expect(runtimeState.activeSessionKey).toBe(sessionKey);
    expect(runtimeState.accountSessions[sessionKey]?.deviceToken).toBe("device_token_1");
    const persisted = JSON.parse(storage.getItem(AGENT_STATE_STORAGE_KEY) ?? "null");
    expect(persisted.activeSessionKey).toBeNull();
    expect(persisted.accountSessions[sessionKey]).not.toHaveProperty("desktopSessionId");
    expect(persisted.accountSessions[sessionKey]).not.toHaveProperty("deviceToken");
    expect(persisted.accountSessions[sessionKey]).not.toHaveProperty("apiToken");

    const restarted = loadAgentState({ storage, ...environmentDefaults });
    expect(restarted.activeSessionKey).toBeNull();
    expect(restarted.accountSessions[sessionKey]?.desktopSessionId).toBe("");
    expect(restarted.accountSessions[sessionKey]?.deviceToken).toBe("");
    expect(restarted.accountSessions[sessionKey]?.apiToken).toBe("");
  });

  it("treats existing account metadata as an installation that completed the first-run wizard", () => {
    const storage = createMemoryStorage({
      [AGENT_STATE_STORAGE_KEY]: JSON.stringify({
        version: 2,
        installProfile: {
          installationId: "install_legacy",
          defaultDeviceName: "Legacy Mac",
          appearance: "light",
          lastSuccessfulRoute: "/dashboard",
          createdAt: "2026-07-28T08:00:00.000Z",
          lastUsedAt: "2026-07-28T08:00:00.000Z",
        },
        activeSessionKey: null,
        accountSessions: {
          "http://localhost:3000::owner@example.com": {
            apiBaseUrl: "http://localhost:3000",
            email: "owner@example.com",
            activeSpaceKey: "personal",
            teamId: "team_1",
            userId: "user_1",
            deviceId: "device_1",
            deviceName: "Legacy Mac",
            lastLoginAt: "2026-07-28T08:00:00.000Z",
            lastUsedAt: "2026-07-28T08:00:00.000Z",
          },
        },
      }),
    });

    const result = loadAgentState({ storage, ...environmentDefaults });

    expect(result.installProfile.onboardingSkipped).toBe(true);
    expect(result.installProfile.onboardingCompletedAt).toBeNull();
  });
});
