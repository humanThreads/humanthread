import { describe, expect, it } from "vitest";
import {
  agentDeviceRegisterRequestSchema,
  agentWorkerCapabilitySnapshotSchema,
  buildLocalAgentWorkerId,
  deviceAgentRuntimeProfileSchema,
  projectDeviceWorkspaceSchema,
} from "./index";

const capabilitySnapshot = () => ({
  providers: [{ name: "codex", version: "0.108.0" }],
  capabilities: ["workspace", "files", "commands", "browser", "desktop_apps"],
  loginStateCategories: ["browser_profile"],
  maxConcurrency: 1,
});

describe("agent worker capability contracts", () => {
  it("derives a namespaced worker ID within the database limit", () => {
    expect(buildLocalAgentWorkerId("device_1")).toBe("local-worker:device_1");
    expect(buildLocalAgentWorkerId("d".repeat(64))).toHaveLength(77);
    expect(() => buildLocalAgentWorkerId("d".repeat(65))).toThrow(/device ID/iu);
  });

  it("accepts provider versions and bounded capability categories", () => {
    expect(agentWorkerCapabilitySnapshotSchema.parse(capabilitySnapshot())).toEqual(
      capabilitySnapshot(),
    );

    expect(agentDeviceRegisterRequestSchema.parse({
      userId: "user_1",
      deviceId: "device_1",
      deviceName: "MacBook",
      platform: "macos",
      capabilitySnapshot: capabilitySnapshot(),
    })).toMatchObject({
      deviceId: "device_1",
      capabilitySnapshot: { maxConcurrency: 1 },
    });
  });

  it("does not expose Loop protocol versions as a worker capability gate", () => {
    const parsed = agentWorkerCapabilitySnapshotSchema.parse(capabilitySnapshot());
    expect(parsed).toEqual(capabilitySnapshot());
  });

  it.each([
    ["provider token", { providers: [{ name: "codex", version: "0.108.0", token: "raw" }] }],
    ["provider cookie", { providers: [{ name: "codex", version: "0.108.0", cookie: "raw" }] }],
    ["root credential", { credential: "raw" }],
    ["root secret", { secret: "raw" }],
  ])("rejects credential-shaped material in %s", (_name, extension) => {
    const value = {
      ...capabilitySnapshot(),
      ...extension,
    };

    expect(agentWorkerCapabilitySnapshotSchema.safeParse(value).success).toBe(false);
  });

  it("accepts concurrency through 128 and rejects values outside the supported range", () => {
    expect(agentWorkerCapabilitySnapshotSchema.safeParse({
      ...capabilitySnapshot(),
      capabilities: ["device_wide_shell"],
    }).success).toBe(false);
    expect(agentWorkerCapabilitySnapshotSchema.safeParse({
      ...capabilitySnapshot(),
      maxConcurrency: 0,
    }).success).toBe(false);
    expect(agentWorkerCapabilitySnapshotSchema.safeParse({
      ...capabilitySnapshot(),
      maxConcurrency: 128,
    }).success).toBe(true);
    expect(agentWorkerCapabilitySnapshotSchema.safeParse({
      ...capabilitySnapshot(),
      maxConcurrency: 129,
    }).success).toBe(false);
  });
});

describe("device execution configuration contracts", () => {
  it("accepts only path-free project Workspace readiness metadata", () => {
    const result = projectDeviceWorkspaceSchema.parse({
      id: "workspace_binding_1",
      projectId: "project_1",
      userId: "user_1",
      localDeviceId: "device_1",
      status: "ready",
      pathFingerprint: "hmac-sha256:abc123",
      configurationVersion: 2,
      lastValidatedAt: "2026-07-31T08:00:00.000Z",
    });

    expect(result).toEqual({
      id: "workspace_binding_1",
      projectId: "project_1",
      userId: "user_1",
      localDeviceId: "device_1",
      status: "ready",
      pathFingerprint: "hmac-sha256:abc123",
      configurationVersion: 2,
      lastValidatedAt: "2026-07-31T08:00:00.000Z",
    });
    expect(projectDeviceWorkspaceSchema.safeParse({
      ...result,
      absolutePath: "/Users/alice/Atlas",
    }).success).toBe(false);
  });

  it("accepts secret-free device runtime readiness and rejects local command paths", () => {
    const result = deviceAgentRuntimeProfileSchema.parse({
      id: "runtime_profile_1",
      userId: "user_1",
      localDeviceId: "device_1",
      provider: "codex",
      label: "Codex CLI",
      status: "ready",
      version: 3,
      capabilities: ["workspace", "commands"],
      lastValidatedAt: "2026-07-31T08:00:00.000Z",
    });

    expect(result.provider).toBe("codex");
    expect(deviceAgentRuntimeProfileSchema.safeParse({
      ...result,
      executablePath: "/opt/homebrew/bin/codex",
    }).success).toBe(false);
    expect(deviceAgentRuntimeProfileSchema.safeParse({
      ...result,
      token: "raw",
    }).success).toBe(false);
  });
});
