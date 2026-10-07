import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  disableDeviceAgentRuntimeProfile,
  listDeviceExecutionConfiguration,
  revokeProjectDeviceWorkspace,
  upsertDeviceAgentRuntimeProfile,
  upsertProjectDeviceWorkspace,
} from "./device-execution-configuration";

const validatedAt = new Date("2026-07-31T08:00:00.000Z");

describe("device execution configuration repository", () => {
  let fixture: ReturnType<typeof createFixture>;

  beforeEach(() => {
    fixture = createFixture();
  });

  it("advances the Workspace configuration version without storing a path", async () => {
    const first = await upsertProjectDeviceWorkspace({
      actorUserId: "user_1",
      projectId: "project_1",
      localDeviceId: "device_1",
      status: "ready",
      pathFingerprint: "hmac-sha256:first01",
      validatedAt,
    }, fixture.dependencies);
    const changed = await upsertProjectDeviceWorkspace({
      actorUserId: "user_1",
      projectId: "project_1",
      localDeviceId: "device_1",
      expectedVersion: 1,
      status: "ready",
      pathFingerprint: "hmac-sha256:second02",
      validatedAt,
    }, fixture.dependencies);

    expect(first.configurationVersion).toBe(1);
    expect(changed).toMatchObject({
      id: "project-workspace:project_1:user_1:device_1",
      configurationVersion: 2,
      pathFingerprint: "hmac-sha256:second02",
      status: "ready",
    });
    expect(JSON.stringify(fixture.workspaces.get(changed.id))).not.toMatch(/absolutePath|\/Users\//u);
    expect(fixture.authorizeProject).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
    });
  });

  it("bounds production-length Workspace IDs to the persistence contract", async () => {
    const actorUserId = `user_${"u".repeat(15)}`;
    const projectId = `project_${"p".repeat(36)}`;
    const localDeviceId = `device_${"d".repeat(20)}`;
    fixture.device.id = localDeviceId;
    fixture.device.userId = actorUserId;

    const readableId = `project-workspace:${projectId}:${actorUserId}:${localDeviceId}`;
    expect(readableId.length).toBeGreaterThan(96);
    expect(readableId.length).toBeLessThanOrEqual(128);

    const result = await upsertProjectDeviceWorkspace({
      actorUserId,
      projectId,
      localDeviceId,
      status: "ready",
      pathFingerprint: "hmac-sha256:production01",
      validatedAt,
    }, fixture.dependencies);

    expect(result.id).toBe(
      "project-workspace:324a1640c0b09e299274e2f6c17a840dd741892913bf25a2c0e2b3c1c71c386f",
    );
    expect(result.id.length).toBeLessThanOrEqual(96);
  });

  it("bounds production-length Runtime Profile IDs to the persistence contract", async () => {
    const actorUserId = `user_${"u".repeat(35)}`;
    const localDeviceId = `device_${"d".repeat(33)}`;
    fixture.device.id = localDeviceId;
    fixture.device.userId = actorUserId;

    const readableId = `device-runtime:${actorUserId}:${localDeviceId}:codex`;
    expect(readableId.length).toBeGreaterThan(96);
    expect(readableId.length).toBeLessThanOrEqual(128);

    const result = await upsertDeviceAgentRuntimeProfile({
      actorUserId,
      localDeviceId,
      provider: "codex",
      label: "Codex CLI",
      status: "ready",
      capabilities: ["commands", "workspace"],
      validatedAt,
    }, fixture.dependencies);

    expect(result.id).toBe(
      "device-runtime:bb20fa1516e978401645f5944f899f3f230369650270cde47de0d5544c12d164",
    );
    expect(result.id.length).toBeLessThanOrEqual(96);
  });

  it("rejects stale Workspace updates before replacing the stored fingerprint", async () => {
    fixture.seedWorkspace({ configurationVersion: 2, pathFingerprint: "hmac-sha256:current03" });

    await expect(upsertProjectDeviceWorkspace({
      actorUserId: "user_1",
      projectId: "project_1",
      localDeviceId: "device_1",
      expectedVersion: 1,
      status: "ready",
      pathFingerprint: "hmac-sha256:stale004",
      validatedAt,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "version_conflict" });

    expect(fixture.workspaces.values().next().value).toMatchObject({
      configurationVersion: 2,
      pathFingerprint: "hmac-sha256:current03",
    });
  });

  it("revokes instead of deleting a Workspace mapping", async () => {
    fixture.seedWorkspace({ configurationVersion: 2, pathFingerprint: "hmac-sha256:current03" });

    const result = await revokeProjectDeviceWorkspace({
      actorUserId: "user_1",
      projectId: "project_1",
      localDeviceId: "device_1",
      expectedVersion: 2,
      revokedAt: validatedAt,
    }, fixture.dependencies);

    expect(result).toMatchObject({ status: "revoked", configurationVersion: 3 });
    expect(fixture.workspaces.values().next().value).toMatchObject({
      status: "revoked",
      pathFingerprint: "hmac-sha256:current03",
    });
  });

  it("versions secret-free Provider readiness and lists it with the Workspace", async () => {
    fixture.seedWorkspace({ configurationVersion: 1, pathFingerprint: "hmac-sha256:current03" });
    const first = await upsertDeviceAgentRuntimeProfile({
      actorUserId: "user_1",
      localDeviceId: "device_1",
      provider: "codex",
      label: "Codex CLI",
      status: "ready",
      capabilities: ["commands", "workspace"],
      validatedAt,
    }, fixture.dependencies);
    const disabled = await disableDeviceAgentRuntimeProfile({
      actorUserId: "user_1",
      localDeviceId: "device_1",
      provider: "codex",
      expectedVersion: first.version,
      disabledAt: validatedAt,
    }, fixture.dependencies);
    const configuration = await listDeviceExecutionConfiguration({
      actorUserId: "user_1",
      localDeviceId: "device_1",
      projectId: "project_1",
    }, fixture.dependencies);

    expect(disabled).toMatchObject({ status: "disabled", version: 2 });
    expect(configuration.runtimeProfiles).toEqual([
      expect.objectContaining({ provider: "codex", status: "disabled", version: 2 }),
    ]);
    expect(configuration.workspaces).toEqual([
      expect.objectContaining({ projectId: "project_1", configurationVersion: 1 }),
    ]);
    expect(JSON.stringify(configuration)).not.toMatch(/token|credential|executablePath|\/Users\//iu);
  });

  it("projects Prisma runtime rows without persistence metadata", async () => {
    fixture.seedRuntime({
      createdAt: new Date("2026-07-31T07:00:00.000Z"),
      updatedAt: new Date("2026-07-31T08:00:00.000Z"),
    });

    const configuration = await listDeviceExecutionConfiguration({
      actorUserId: "user_1",
      localDeviceId: "device_1",
    }, fixture.dependencies);

    expect(configuration.runtimeProfiles).toEqual([{
      id: "device-runtime:user_1:device_1:codex",
      userId: "user_1",
      localDeviceId: "device_1",
      provider: "codex",
      label: "Codex CLI",
      status: "ready",
      version: 1,
      capabilities: ["commands", "workspace"],
      modelSites: [],
      lastValidatedAt: "2026-07-31T08:00:00.000Z",
    }]);
  });

  it("projects Prisma Workspace rows without persistence metadata", async () => {
    fixture.seedWorkspace({
      createdAt: new Date("2026-07-31T07:00:00.000Z"),
      updatedAt: new Date("2026-07-31T08:00:00.000Z"),
    });

    const configuration = await listDeviceExecutionConfiguration({
      actorUserId: "user_1",
      localDeviceId: "device_1",
      projectId: "project_1",
    }, fixture.dependencies);

    expect(configuration.workspaces).toEqual([{
      id: "project-workspace:project_1:user_1:device_1",
      projectId: "project_1",
      userId: "user_1",
      localDeviceId: "device_1",
      status: "ready",
      pathFingerprint: "hmac-sha256:seed0001",
      configurationVersion: 1,
      lastValidatedAt: "2026-07-31T08:00:00.000Z",
    }]);
  });

  it("rejects an unauthorized device and path-like fingerprint before persistence", async () => {
    fixture.device.userId = "user_2";
    await expect(upsertProjectDeviceWorkspace({
      actorUserId: "user_1",
      projectId: "project_1",
      localDeviceId: "device_1",
      status: "ready",
      pathFingerprint: "hmac-sha256:valid001",
      validatedAt,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "not_found" });
    fixture.device.userId = "user_1";
    await expect(upsertProjectDeviceWorkspace({
      actorUserId: "user_1",
      projectId: "project_1",
      localDeviceId: "device_1",
      status: "ready",
      pathFingerprint: "hmac-sha256:/Users/alice/Atlas",
      validatedAt,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });
    expect(fixture.workspaces.size).toBe(0);
  });
  it("persists reported model sites and rejects credential material", async () => {
    const stored = await upsertDeviceAgentRuntimeProfile({
      actorUserId: "user_1",
      localDeviceId: "device_1",
      provider: "codex",
      label: "Codex 0.154.0",
      status: "ready",
      capabilities: ["approvals"],
      modelSites: [
        {
          siteId: "a".repeat(32),
          name: "本机 Codex",
          adapter: "codex_environment",
          models: [{ name: "gpt-5.6-terra", label: "Terra" }],
        },
      ],
      validatedAt,
    }, fixture.dependencies);

    expect(stored.modelSites).toEqual([
      expect.objectContaining({ siteId: "a".repeat(32), name: "本机 Codex" }),
    ]);

    // Credential material must never be persisted with the reported sites; the
    // shared schema is strict, so an unknown key is a validation failure.
    await expect(upsertDeviceAgentRuntimeProfile({
      actorUserId: "user_1",
      localDeviceId: "device_1",
      provider: "codex",
      label: "Codex 0.154.0",
      status: "ready",
      capabilities: [],
      modelSites: [
        {
          siteId: "a".repeat(32),
          name: "S",
          adapter: "codex_environment",
          models: [],
          apiKey: "secret",
        },
      ],
      validatedAt,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects control characters in reported site names, model names and labels", async () => {
    // Reported values are rendered in the platform model picker and written to
    // logs. A control character (for example ESC) would let a local device inject
    // terminal escapes into another surface, so it must be refused on the way in.
    const attempt = (siteName: string, modelName: string, modelLabel: string) => upsertDeviceAgentRuntimeProfile({
      actorUserId: "user_1",
      localDeviceId: "device_1",
      provider: "codex",
      label: "Codex 0.154.0",
      status: "ready",
      capabilities: [],
      modelSites: [
        {
          siteId: "a".repeat(32),
          name: siteName,
          adapter: "codex_environment",
          models: [{ name: modelName, label: modelLabel }],
        },
      ],
      validatedAt,
    }, fixture.dependencies);

    await expect(attempt("bad\u001bsite", "ok-model", "Ok")).rejects.toMatchObject({ code: "validation_failed" });
    await expect(attempt("ok-site", "bad\u001bmodel", "Ok")).rejects.toMatchObject({ code: "validation_failed" });
    await expect(attempt("ok-site", "ok-model", "bad\u001blabel")).rejects.toMatchObject({ code: "validation_failed" });

    // And a clean report still persists, so the guard is not rejecting everything.
    const stored = await attempt("Good Site", "good-model", "Good Model");
    expect(stored.modelSites[0]?.name).toBe("Good Site");
  });

  it("reports an empty model site list when none were sent", async () => {
    const stored = await upsertDeviceAgentRuntimeProfile({
      actorUserId: "user_1",
      localDeviceId: "device_1",
      provider: "codex",
      label: "Codex 0.154.0",
      status: "ready",
      capabilities: [],
      validatedAt,
    }, fixture.dependencies);

    expect(stored.modelSites).toEqual([]);
  });

});

function createFixture() {
  type WorkspaceRow = {
    id: string;
    projectId: string;
    userId: string;
    localDeviceId: string;
    status: string;
    pathFingerprint: string;
    configurationVersion: number;
    lastValidatedAt: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
  };
  type RuntimeRow = {
    id: string;
    userId: string;
    localDeviceId: string;
    provider: string;
    label: string;
    status: string;
    version: number;
    capabilities: string[];
    lastValidatedAt: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
  };
  const workspaces = new Map<string, WorkspaceRow>();
  const runtimeProfiles = new Map<string, RuntimeRow>();
  const device = { id: "device_1", userId: "user_1", status: "authorized" };
  const workspaceId = "project-workspace:project_1:user_1:device_1";
  const runtimeId = "device-runtime:user_1:device_1:codex";
  const authorizeProject = vi.fn().mockResolvedValue({ projectId: "project_1", role: "contributor" });

  const tx = {
    localDevice: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => (
        where.id === device.id && where.userId === device.userId && where.status === device.status
          ? { ...device }
          : null
      )),
    },
    projectDeviceWorkspace: {
      findUnique: vi.fn(async () => workspaces.get(workspaceId) ?? null),
      findMany: vi.fn(async () => [...workspaces.values()]),
      create: vi.fn(async ({ data }: { data: WorkspaceRow }) => {
        workspaces.set(data.id, { ...data });
        return { ...data };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const current = workspaces.get(String(where.id));
        if (!current || current.configurationVersion !== where.configurationVersion) return { count: 0 };
        workspaces.set(current.id, { ...current, ...data } as WorkspaceRow);
        return { count: 1 };
      }),
    },
    deviceAgentRuntimeProfile: {
      findUnique: vi.fn(async () => runtimeProfiles.get(runtimeId) ?? null),
      findMany: vi.fn(async () => [...runtimeProfiles.values()]),
      create: vi.fn(async ({ data }: { data: RuntimeRow }) => {
        runtimeProfiles.set(data.id, { ...data });
        return { ...data };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const current = runtimeProfiles.get(String(where.id));
        if (!current || current.version !== where.version) return { count: 0 };
        runtimeProfiles.set(current.id, { ...current, ...data } as RuntimeRow);
        return { count: 1 };
      }),
    },
  };

  return {
    authorizeProject,
    device,
    workspaces,
    runtimeProfiles,
    dependencies: {
      authorizeProject,
      db: { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) },
    },
    seedWorkspace(overrides: Partial<WorkspaceRow> = {}) {
      workspaces.set(workspaceId, {
        id: workspaceId,
        projectId: "project_1",
        userId: "user_1",
        localDeviceId: "device_1",
        status: "ready",
        pathFingerprint: "hmac-sha256:seed0001",
        configurationVersion: 1,
        lastValidatedAt: validatedAt,
        ...overrides,
      });
    },
    seedRuntime(overrides: Partial<RuntimeRow> = {}) {
      runtimeProfiles.set(runtimeId, {
        id: runtimeId,
        userId: "user_1",
        localDeviceId: "device_1",
        provider: "codex",
        label: "Codex CLI",
        status: "ready",
        version: 1,
        capabilities: ["commands", "workspace"],
        lastValidatedAt: validatedAt,
        ...overrides,
      });
    },
  };
}
