import { describe, expect, it, vi } from "vitest";
import {
  heartbeatLocalAgentWorker,
  registerAgentDevice,
} from "./agent-device-registration";
import { hashAgentToken } from "./agent-auth";

describe("registerAgentDevice", () => {
  it("persists device capabilities without mutating Worker liveness or capacity", async () => {
    const upsertDevice = vi.fn().mockResolvedValue({
      id: "device_mac_1",
      userId: "user_owner",
      status: "pending",
      deviceTokenHash: hashAgentToken("device_token_456"),
    });
    const capabilitySnapshot = {
      providers: [{ name: "codex", version: "0.108.0" }],
      capabilities: ["workspace", "files", "commands"] as Array<
        "workspace" | "files" | "commands"
      >,
      loginStateCategories: ["provider_account"] as Array<"provider_account">,
      maxConcurrency: 1,
    };
    const result = await registerAgentDevice(
      {
        userId: "user_owner",
        deviceId: "device_mac_1",
        deviceName: "agent-macbook",
        platform: "macos",
        capabilitySnapshot,
        now: new Date("2026-07-30T08:00:00.000Z"),
      },
      {
        loadUser: vi.fn().mockResolvedValue({ id: "user_owner", status: "active" }),
        loadDevice: vi.fn().mockResolvedValue(null),
        upsertDevice,
        createDeviceToken: vi.fn().mockReturnValue("device_token_456"),
      },
    );

    expect(upsertDevice).toHaveBeenCalledWith(expect.objectContaining({
      capabilitySnapshot,
    }));
    expect(result).not.toHaveProperty("workerId");
  });

  it("reuses the current device token when the existing device is already known", async () => {
    const loadUser = vi.fn().mockResolvedValue({
      id: "user_owner",
      status: "active",
    });
    const loadDevice = vi.fn().mockResolvedValue({
      id: "device_mac_1",
      userId: "user_owner",
      status: "authorized",
      deviceTokenHash: hashAgentToken("device_token_existing"),
    });
    const upsertDevice = vi.fn().mockResolvedValue({
      id: "device_mac_1",
      userId: "user_owner",
      status: "authorized",
      deviceTokenHash: hashAgentToken("device_token_existing"),
    });

    const result = await registerAgentDevice(
      {
        userId: "user_owner",
        deviceId: "device_mac_1",
        deviceName: "agent-macbook",
        platform: "macos",
        currentDeviceToken: "device_token_existing",
        now: new Date("2026-05-19T02:00:00.000Z"),
      },
      {
        loadUser,
        loadDevice,
        upsertDevice,
        createDeviceToken: vi.fn().mockReturnValue("device_token_new"),
      },
    );

    expect(upsertDevice).toHaveBeenCalledWith({
      id: "device_mac_1",
      userId: "user_owner",
      name: "agent-macbook",
      platform: "macos",
      now: new Date("2026-05-19T02:00:00.000Z"),
      status: "authorized",
      deviceTokenHash: hashAgentToken("device_token_existing"),
    });
    expect(result).toEqual({
      userId: "user_owner",
      deviceId: "device_mac_1",
      status: "authorized",
      deviceToken: "device_token_existing",
    });
  });

  it("returns the current status for an existing device", async () => {
    const loadUser = vi.fn().mockResolvedValue({
      id: "user_owner",
      status: "active",
    });
    const loadDevice = vi.fn().mockResolvedValue({
      id: "device_mac_1",
      userId: "user_owner",
      status: "authorized",
      deviceTokenHash: hashAgentToken("device_token_123"),
    });
    const upsertDevice = vi.fn().mockResolvedValue({
      id: "device_mac_1",
      userId: "user_owner",
      status: "authorized",
      deviceTokenHash: hashAgentToken("device_token_123"),
    });

    const result = await registerAgentDevice(
      {
        userId: "user_owner",
        deviceId: "device_mac_1",
        deviceName: "agent-macbook",
        platform: "macos",
        now: new Date("2026-05-19T02:00:00.000Z"),
      },
      {
        loadUser,
        loadDevice,
        upsertDevice,
        createDeviceToken: vi.fn().mockReturnValue("device_token_123"),
      },
    );

    expect(loadUser).toHaveBeenCalledWith({
      userId: "user_owner",
    });
    expect(loadDevice).toHaveBeenCalledWith({
      deviceId: "device_mac_1",
    });
    expect(upsertDevice).toHaveBeenCalledWith({
      id: "device_mac_1",
      userId: "user_owner",
      name: "agent-macbook",
      platform: "macos",
      now: new Date("2026-05-19T02:00:00.000Z"),
      status: "authorized",
      deviceTokenHash: hashAgentToken("device_token_123"),
    });
    expect(result).toEqual({
      userId: "user_owner",
      deviceId: "device_mac_1",
      status: "authorized",
      deviceToken: "device_token_123",
    });
  });

  it("registers a new device as pending by default", async () => {
    const result = await registerAgentDevice(
      {
        userId: "user_owner",
        deviceId: "device_mac_1",
        deviceName: "agent-macbook",
        platform: "macos",
      },
      {
        loadUser: vi.fn().mockResolvedValue({
          id: "user_owner",
          status: "active",
        }),
        loadDevice: vi.fn().mockResolvedValue(null),
        upsertDevice: vi.fn().mockResolvedValue({
          id: "device_mac_1",
          userId: "user_owner",
          status: "pending",
          deviceTokenHash: hashAgentToken("device_token_456"),
        }),
        createDeviceToken: vi.fn().mockReturnValue("device_token_456"),
      },
    );

    expect(result).toEqual({
      userId: "user_owner",
      deviceId: "device_mac_1",
      status: "pending",
      deviceToken: "device_token_456",
    });
  });

  it("authorizes a pending device when a trusted binding code was verified", async () => {
    const now = new Date("2026-05-19T02:00:00.000Z");
    const upsertDevice = vi.fn().mockResolvedValue({
      id: "device_mac_1",
      userId: "user_owner",
      status: "authorized",
      deviceTokenHash: hashAgentToken("device_token_456"),
    });
    const result = await registerAgentDevice(
      {
        userId: "user_owner",
        deviceId: "device_mac_1",
        deviceName: "agent-macbook",
        platform: "macos",
        authorizeDevice: true,
        now,
      },
      {
        loadUser: vi.fn().mockResolvedValue({
          id: "user_owner",
          status: "active",
        }),
        loadDevice: vi.fn().mockResolvedValue(null),
        upsertDevice,
        createDeviceToken: vi.fn().mockReturnValue("device_token_456"),
      },
    );

    expect(upsertDevice).toHaveBeenCalledWith({
      id: "device_mac_1",
      userId: "user_owner",
      name: "agent-macbook",
      platform: "macos",
      now,
      status: "authorized",
      deviceTokenHash: hashAgentToken("device_token_456"),
      authorizedAt: now,
      revokedAt: null,
    });
    expect(result.status).toBe("authorized");
  });

  it("re-authorizes a revoked device and rotates its token after trusted login", async () => {
    const now = new Date("2026-05-19T02:00:00.000Z");
    const upsertDevice = vi.fn().mockResolvedValue({
      id: "device_mac_1",
      userId: "user_owner",
      status: "authorized",
      deviceTokenHash: hashAgentToken("device_token_new"),
    });

    const result = await registerAgentDevice(
      {
        userId: "user_owner",
        deviceId: "device_mac_1",
        deviceName: "agent-macbook",
        platform: "macos",
        currentDeviceToken: "device_token_stale",
        authorizeDevice: true,
        allowAuthorizedDeviceTokenRotation: true,
        now,
      },
      {
        loadUser: vi.fn().mockResolvedValue({
          id: "user_owner",
          status: "active",
        }),
        loadDevice: vi.fn().mockResolvedValue({
          id: "device_mac_1",
          userId: "user_owner",
          status: "revoked",
          deviceTokenHash: hashAgentToken("device_token_old"),
        }),
        upsertDevice,
        createDeviceToken: vi.fn().mockReturnValue("device_token_new"),
      },
    );

    expect(upsertDevice).toHaveBeenCalledWith(expect.objectContaining({
      status: "authorized",
      deviceTokenHash: hashAgentToken("device_token_new"),
      authorizedAt: now,
      revokedAt: null,
    }));
    expect(result).toEqual({
      userId: "user_owner",
      deviceId: "device_mac_1",
      status: "authorized",
      deviceToken: "device_token_new",
    });
  });

  it("keeps a revoked device revoked during token-only registration", async () => {
    const result = await registerAgentDevice(
      {
        userId: "user_owner",
        deviceId: "device_mac_1",
        deviceName: "agent-macbook",
        platform: "macos",
      },
      {
        loadUser: vi.fn().mockResolvedValue({
          id: "user_owner",
          status: "active",
        }),
        loadDevice: vi.fn().mockResolvedValue({
          id: "device_mac_1",
          userId: "user_owner",
          status: "revoked",
          deviceTokenHash: hashAgentToken("device_token_old"),
        }),
        upsertDevice: vi.fn().mockResolvedValue({
          id: "device_mac_1",
          userId: "user_owner",
          status: "revoked",
          deviceTokenHash: hashAgentToken("device_token_new"),
        }),
        createDeviceToken: vi.fn().mockReturnValue("device_token_new"),
      },
    );

    expect(result.status).toBe("revoked");
  });

  it("rejects registration when the agent user is unavailable", async () => {
    await expect(
      registerAgentDevice(
        {
          userId: "user_owner",
          deviceId: "device_mac_1",
          deviceName: "agent-macbook",
          platform: "macos",
        },
        {
          loadUser: vi.fn().mockResolvedValue(null),
          loadDevice: vi.fn(),
          upsertDevice: vi.fn(),
          createDeviceToken: vi.fn(),
        },
      ),
    ).rejects.toThrow("Agent user is unavailable");
  });

  it("rejects registration when the device belongs to a different user", async () => {
    await expect(
      registerAgentDevice(
        {
          userId: "user_owner",
          deviceId: "device_mac_1",
          deviceName: "agent-macbook",
          platform: "macos",
        },
        {
          loadUser: vi.fn().mockResolvedValue({
            id: "user_owner",
            status: "active",
          }),
          loadDevice: vi.fn().mockResolvedValue({
            id: "device_mac_1",
            userId: "user_other",
            status: "authorized",
            deviceTokenHash: hashAgentToken("device_token_123"),
          }),
          upsertDevice: vi.fn(),
          createDeviceToken: vi.fn(),
        },
      ),
    ).rejects.toThrow("Local device belongs to a different user");
  });

  it("rejects authorized device token rotation when that path is disabled", async () => {
    await expect(
      registerAgentDevice(
        {
          userId: "user_owner",
          deviceId: "device_mac_1",
          deviceName: "agent-macbook",
          platform: "macos",
          allowAuthorizedDeviceTokenRotation: false,
        },
        {
          loadUser: vi.fn().mockResolvedValue({
            id: "user_owner",
            status: "active",
          }),
          loadDevice: vi.fn().mockResolvedValue({
            id: "device_mac_1",
            userId: "user_owner",
            status: "authorized",
            deviceTokenHash: hashAgentToken("device_token_existing"),
          }),
          upsertDevice: vi.fn(),
          createDeviceToken: vi.fn(),
        },
      ),
    ).rejects.toThrow("Current device token is required for authorized device binding");
  });
});

describe("heartbeatLocalAgentWorker", () => {
  const capabilitySnapshot = {
    providers: [{ name: "codex" as const, version: "0.108.0" }],
    capabilities: ["workspace", "commands"] as Array<"workspace" | "commands">,
    loginStateCategories: ["provider_account"] as Array<"provider_account">,
    maxConcurrency: 1,
  };

  it("marks an authorized device Worker online and preserves its active Space", async () => {
    const persist = vi.fn().mockResolvedValue({ workerId: "local-worker:device_mac_1" });

    await expect(heartbeatLocalAgentWorker({
      userId: "user_owner",
      deviceId: "device_mac_1",
      workerId: "local-worker:device_mac_1",
      agentVersion: "Agent v0.1.2 · e16bff4c",
      capabilitySnapshot,
      now: new Date("2026-08-06T12:00:00.000Z"),
    }, {
      loadDevice: vi.fn().mockResolvedValue({
        id: "device_mac_1",
        userId: "user_owner",
        name: "agent-macbook",
        status: "authorized",
      }),
      resolveWorkerSpace: vi.fn().mockResolvedValue({
        id: "space_company",
        status: "active",
      }),
      persist,
    })).resolves.toEqual({ workerId: "local-worker:device_mac_1" });

    expect(persist).toHaveBeenCalledWith({
      workerId: "local-worker:device_mac_1",
      userId: "user_owner",
      deviceId: "device_mac_1",
      deviceName: "agent-macbook",
      spaceId: "space_company",
      capabilities: ["workspace", "commands", "codex"],
      maxConcurrentRuns: 1,
      agentVersion: "Agent v0.1.2 · e16bff4c",
      capabilitySnapshot,
      now: new Date("2026-08-06T12:00:00.000Z"),
    });
  });

  it("rejects a claim heartbeat from a device that is not authorized for the actor", async () => {
    const persist = vi.fn();

    await expect(heartbeatLocalAgentWorker({
      userId: "user_owner",
      deviceId: "device_mac_1",
      workerId: "local-worker:device_mac_1",
      capabilitySnapshot,
      now: new Date("2026-08-06T12:00:00.000Z"),
    }, {
      loadDevice: vi.fn().mockResolvedValue({
        id: "device_mac_1",
        userId: "user_other",
        name: "other-macbook",
        status: "authorized",
      }),
      resolveWorkerSpace: vi.fn(),
      persist,
    })).rejects.toMatchObject({ code: "stale_lease" });

    expect(persist).not.toHaveBeenCalled();
  });
});
