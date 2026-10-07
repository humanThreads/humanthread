import { describe, expect, it, vi } from "vitest";

import { buildWorkspaceUpload } from "../lib/execution-configuration";
import {
  buildExecutionConfigStorePath,
  computePathFingerprint,
  createNativeExecutionConfigStore,
  type PersistentExecutionConfigStore,
} from "./execution-config-store";

class FakePersistentStore implements PersistentExecutionConfigStore {
  readonly save = vi.fn().mockResolvedValue(undefined);

  constructor(private readonly values: Map<string, unknown>) {}

  async get<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
}

class FailingMutationPersistentStore extends FakePersistentStore {
  override readonly save = vi.fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("disk unavailable"));
}

describe("local execution configuration store", () => {
  it("persists a real path locally but serializes only its fingerprint for upload", async () => {
    const values = new Map<string, unknown>();
    const store = await createNativeExecutionConfigStore({
      deviceId: "device_1",
      createInstallationKey: () => "installation-key-0000000000000001",
      openStore: async () => new FakePersistentStore(values),
    });

    await store.setWorkspace("project_1", {
      bindingId: "workspace_binding_1",
      absolutePath: "/Users/alice/Atlas",
      realpath: "/Users/alice/Atlas",
      configurationVersion: 1,
    });
    const workspace = await store.getWorkspace("project_1");

    expect(workspace).toMatchObject({ absolutePath: "/Users/alice/Atlas" });
    expect(buildWorkspaceUpload(workspace)).toEqual({
      pathFingerprint: expect.stringMatching(/^hmac-sha256:[A-Za-z0-9_-]+$/u),
      configurationVersion: 1,
    });
    expect(JSON.stringify(buildWorkspaceUpload(workspace))).not.toContain("/Users/alice");

    const restarted = await createNativeExecutionConfigStore({
      deviceId: "device_1",
      openStore: async () => new FakePersistentStore(values),
    });
    expect(await restarted.getWorkspace("project_1")).toEqual(workspace);
    expect(await restarted.getWorkspaceByBindingId("workspace_binding_1")).toEqual(workspace);
  });

  it("defaults Worker execution on with one slot and persists bounded device preferences", async () => {
    const values = new Map<string, unknown>();
    const store = await createNativeExecutionConfigStore({
      deviceId: "device_1",
      createInstallationKey: () => "installation-key-0000000000000001",
      openStore: async () => new FakePersistentStore(values),
    });

    await expect(store.getWorkerPreferences()).resolves.toEqual({
      enabled: true,
      maxConcurrency: 1,
    });
    await expect(store.setWorkerPreferences({ enabled: false, maxConcurrency: 128 })).resolves.toEqual({
      enabled: false,
      maxConcurrency: 128,
    });

    const restarted = await createNativeExecutionConfigStore({
      deviceId: "device_1",
      openStore: async () => new FakePersistentStore(values),
    });
    await expect(restarted.getWorkerPreferences()).resolves.toEqual({ enabled: false, maxConcurrency: 128 });
    await expect(restarted.setWorkerPreferences({ enabled: true, maxConcurrency: 129 })).rejects.toThrow();
  });

  it("defaults session journal retention to 30 days and persists a bounded override", async () => {
    const values = new Map<string, unknown>();
    const store = await createNativeExecutionConfigStore({
      deviceId: "device_1",
      createInstallationKey: () => "installation-key-0000000000000001",
      openStore: async () => new FakePersistentStore(values),
    });

    await expect(store.getSessionJournalPreferences()).resolves.toEqual({ retentionDays: 30 });
    await expect(store.setSessionJournalPreferences({ retentionDays: 14 })).resolves.toEqual({ retentionDays: 14 });
    await expect(store.setSessionJournalPreferences({ retentionDays: 0 })).rejects.toThrow();
  });

  it("migrates runtime entries written before profile IDs and versions were persisted", async () => {
    const values = new Map<string, unknown>([["execution-configuration:v1", {
      schemaVersion: 1,
      installationKey: "installation-key-0000000000000001",
      workspaces: {},
      runtimes: {
        codex: {
          provider: "codex",
          command: "codex",
          environmentRefs: ["CODEX_HOME"],
        },
      },
      workerPreferences: { enabled: true, maxConcurrency: 1 },
      sessionJournalPreferences: { retentionDays: 30 },
    }]]);

    const store = await createNativeExecutionConfigStore({
      deviceId: "device_1",
      openStore: async () => new FakePersistentStore(values),
    });

    await expect(store.getRuntime("codex")).resolves.toEqual({
      runtimeProfileId: null,
      provider: "codex",
      command: "codex",
      environmentRefs: ["CODEX_HOME"],
      credentialRef: null,
      version: 1,
    });
    expect(values.get("execution-configuration:v1")).toEqual({
      schemaVersion: 1,
      installationKey: "installation-key-0000000000000001",
      workspaces: {},
      runtimes: {
        codex: {
          runtimeProfileId: null,
          provider: "codex",
          command: "codex",
          environmentRefs: ["CODEX_HOME"],
          credentialRef: null,
          version: 1,
        },
      },
      workerPreferences: { enabled: true, maxConcurrency: 1 },
      sessionJournalPreferences: { retentionDays: 30 },
    });
  });

  it("migrates configurations written before worker preferences were added", async () => {
    const values = new Map<string, unknown>([["execution-configuration:v1", {
      schemaVersion: 1,
      installationKey: "installation-key-0000000000000001",
      workspaces: {},
      runtimes: {},
    }]]);

    const store = await createNativeExecutionConfigStore({
      deviceId: "device_1",
      openStore: async () => new FakePersistentStore(values),
    });

    await expect(store.getWorkerPreferences()).resolves.toEqual({
      enabled: true,
      maxConcurrency: 1,
    });
    expect(values.get("execution-configuration:v1")).toEqual({
      schemaVersion: 1,
      installationKey: "installation-key-0000000000000001",
      workspaces: {},
      runtimes: {},
      workerPreferences: { enabled: true, maxConcurrency: 1 },
      sessionJournalPreferences: { retentionDays: 30 },
    });
  });

  it("uses an HMAC fingerprint rather than a reversible path encoding", async () => {
    await expect(computePathFingerprint(
      "/Users/alice/Atlas",
      "installation-key-0000000000000001",
    )).resolves.toBe("hmac-sha256:Q_H7FToUiCUxmoNPlChp_sehqf6e7lZHkJ5wR-OHS2I");
  });

  it("publishes no in-memory mutation when save fails", async () => {
    const store = await createNativeExecutionConfigStore({
      deviceId: "device_1",
      createInstallationKey: () => "installation-key-0000000000000001",
      openStore: async () => new FailingMutationPersistentStore(new Map()),
    });

    await expect(store.setWorkspace("project_1", {
      absolutePath: "/Users/alice/Atlas",
      realpath: "/Users/alice/Atlas",
      configurationVersion: 1,
    })).rejects.toThrow("disk unavailable");

    expect(await store.getWorkspace("project_1")).toBeNull();
  });

  it("serializes concurrent runtime mutations without losing providers", async () => {
    const store = await createNativeExecutionConfigStore({
      deviceId: "device_1",
      createInstallationKey: () => "installation-key-0000000000000001",
      openStore: async () => new FakePersistentStore(new Map()),
    });

    await Promise.all([
      store.upsertRuntime({
        provider: "codex",
        command: "/usr/local/bin/codex",
        environmentRefs: ["CODEX_HOME"],
        version: 1,
      }),
      store.upsertRuntime({
        provider: "claude",
        command: "/usr/local/bin/claude",
        environmentRefs: ["CLAUDE_CONFIG_DIR"],
        version: 1,
      }),
    ]);

    expect(await store.getRuntime("codex")).toMatchObject({ provider: "codex" });
    expect(await store.getRuntime("claude")).toMatchObject({ provider: "claude" });
  });

  it("persists the current local provider configuration across restart", async () => {
    const values = new Map<string, unknown>();
    const store = await createNativeExecutionConfigStore({
      deviceId: "device_1",
      createInstallationKey: () => "installation-key-0000000000000001",
      openStore: async () => new FakePersistentStore(values),
    });

    await store.upsertRuntime({
      provider: "codex",
      command: "/usr/local/bin/codex",
      environmentRefs: ["CODEX_HOME"],
      version: 1,
    });

    const restarted = await createNativeExecutionConfigStore({
      deviceId: "device_1",
      openStore: async () => new FakePersistentStore(values),
    });
    await expect(restarted.getRuntime("codex")).resolves.toEqual({
      runtimeProfileId: null,
      provider: "codex",
      command: "/usr/local/bin/codex",
      environmentRefs: ["CODEX_HOME"],
      credentialRef: null,
      version: 1,
    });
  });

  it("migrates legacy runtime profile and version metadata out of the device-local configuration", async () => {
    const values = new Map<string, unknown>([["execution-configuration:v1", {
      schemaVersion: 1,
      installationKey: "installation-key-0000000000000001",
      workspaces: {},
      runtimes: {
        codex: {
          runtimeProfileId: "device-runtime:user_1:device_1:codex",
          provider: "codex",
          command: "/usr/local/bin/codex",
          environmentRefs: ["CODEX_HOME"],
          version: 13,
        },
      },
    }]]);

    const store = await createNativeExecutionConfigStore({
      deviceId: "device_1",
      openStore: async () => new FakePersistentStore(values),
    });

    await expect(store.getRuntime("codex")).resolves.toEqual({
      runtimeProfileId: "device-runtime:user_1:device_1:codex",
      provider: "codex",
      command: "/usr/local/bin/codex",
      environmentRefs: ["CODEX_HOME"],
      credentialRef: null,
      version: 13,
    });
  });

  it("resolves server-issued composite Workspace binding IDs", async () => {
    const store = await createNativeExecutionConfigStore({
      deviceId: "device_1",
      createInstallationKey: () => "installation-key-0000000000000001",
      openStore: async () => new FakePersistentStore(new Map()),
    });

    await store.setWorkspace("project_1", {
      bindingId: "project-workspace:project_1:user_1:device_1",
      absolutePath: "/Users/alice/Atlas",
      realpath: "/Users/alice/Atlas",
      configurationVersion: 1,
    });

    await expect(store.getWorkspaceByBindingId(
      "project-workspace:project_1:user_1:device_1",
    )).resolves.toMatchObject({ projectId: "project_1" });
  });

  it("rejects corrupted state and credential-shaped persisted fields", async () => {
    const values = new Map<string, unknown>([["execution-configuration:v1", {
      schemaVersion: 1,
      installationKey: "installation-key-0000000000000001",
      workspaces: {},
      runtimes: {},
      accessToken: "must-not-be-here",
    }]]);

    await expect(createNativeExecutionConfigStore({
      deviceId: "device_1",
      openStore: async () => new FakePersistentStore(values),
    })).rejects.toMatchObject({ code: "execution_configuration_corrupted" });
  });

  it("rejects unsafe local paths and duplicate runtime environment references", async () => {
    const store = await createNativeExecutionConfigStore({
      deviceId: "device_1",
      createInstallationKey: () => "installation-key-0000000000000001",
      openStore: async () => new FakePersistentStore(new Map()),
    });

    await expect(store.setWorkspace("project_1", {
      absolutePath: "relative/project",
      realpath: "/Users/alice/Atlas",
      configurationVersion: 1,
    })).rejects.toThrow("Path must be absolute");
    await expect(store.upsertRuntime({
      provider: "codex",
      command: "codex",
      environmentRefs: ["CODEX_HOME", "CODEX_HOME"],
      version: 1,
    })).rejects.toThrow("Runtime environment references must be unique");
    await expect(store.upsertRuntime({
      provider: "codex",
      command: "codex",
      environmentRefs: ["DYLD_INSERT_LIBRARIES"],
      version: 1,
    })).rejects.toThrow();
    await expect(store.setWorkspace("project_1", {
      bindingId: "project-workspace::project_1",
      absolutePath: "/Users/alice/Atlas",
      realpath: "/Users/alice/Atlas",
      configurationVersion: 1,
    })).rejects.toThrow();
  });

  it("rotates the installation key and advances every workspace version", async () => {
    const keys = [
      "installation-key-0000000000000001",
      "installation-key-0000000000000002",
    ];
    const store = await createNativeExecutionConfigStore({
      deviceId: "device_1",
      createInstallationKey: () => keys.shift() ?? "unexpected-key",
      openStore: async () => new FakePersistentStore(new Map()),
    });
    await store.setWorkspace("project_1", {
      absolutePath: "/Users/alice/Atlas",
      realpath: "/Users/alice/Atlas",
      configurationVersion: 4,
    });
    const before = await store.getWorkspace("project_1");

    const rotated = await store.rotateInstallationKey();

    expect(rotated).toEqual([expect.objectContaining({
      projectId: "project_1",
      configurationVersion: 5,
    })]);
    expect(rotated[0]?.pathFingerprint).not.toBe(before?.pathFingerprint);
  });

  it("uses one bounded Store namespace per device", () => {
    expect(buildExecutionConfigStorePath("device_1")).toBe(
      "execution-configuration-device_1.json",
    );
    expect(() => buildExecutionConfigStorePath("../device_1")).toThrow(
      "Invalid local Agent device ID",
    );
  });
});
