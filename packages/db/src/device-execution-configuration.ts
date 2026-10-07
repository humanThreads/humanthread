import {
  deviceAgentRuntimeProfileSchema,
  projectDeviceWorkspaceSchema,
  type DeviceAgentRuntimeProfile,
  type ProjectDeviceWorkspace,
} from "@humanthread/shared";

import { assertCanReadProject } from "./access-control";
import { boundedPersistenceId } from "./bounded-id";
import { OrchestrationPersistenceError } from "./orchestration-events";
import { prisma } from "./prisma";

type WorkspaceRow = Omit<ProjectDeviceWorkspace, "lastValidatedAt"> & {
  lastValidatedAt: Date | null;
};
type RuntimeProfileRow = Omit<DeviceAgentRuntimeProfile, "lastValidatedAt"> & {
  lastValidatedAt: Date | null;
};

interface DeviceExecutionConfigurationTx {
  localDevice: {
    findFirst(args: unknown): Promise<{ id: string; userId: string; status: string } | null>;
  };
  projectDeviceWorkspace: {
    findUnique(args: unknown): Promise<WorkspaceRow | null>;
    findMany(args: unknown): Promise<WorkspaceRow[]>;
    create(args: { data: WorkspaceRow }): Promise<WorkspaceRow>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
  deviceAgentRuntimeProfile: {
    findUnique(args: unknown): Promise<RuntimeProfileRow | null>;
    findMany(args: unknown): Promise<RuntimeProfileRow[]>;
    create(args: { data: RuntimeProfileRow }): Promise<RuntimeProfileRow>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
}

interface DeviceExecutionConfigurationDb {
  $transaction<T>(callback: (tx: DeviceExecutionConfigurationTx) => Promise<T>): Promise<T>;
}

export interface DeviceExecutionConfigurationDependencies {
  authorizeProject(input: { userId: string; projectId: string }): Promise<unknown>;
  db: DeviceExecutionConfigurationDb;
}

const DEFAULTS: DeviceExecutionConfigurationDependencies = {
  authorizeProject: (input) => assertCanReadProject(input),
  db: prisma as unknown as DeviceExecutionConfigurationDb,
};

export async function upsertProjectDeviceWorkspace(input: {
  actorUserId: string;
  projectId: string;
  localDeviceId: string;
  expectedVersion?: number;
  status: "ready" | "unavailable";
  pathFingerprint: string;
  validatedAt: Date;
}, dependencies: DeviceExecutionConfigurationDependencies = DEFAULTS): Promise<ProjectDeviceWorkspace> {
  const actorUserId = requiredId(input.actorUserId, "actorUserId", 64);
  const projectId = requiredId(input.projectId, "projectId", 64);
  const localDeviceId = requiredId(input.localDeviceId, "localDeviceId", 64);
  const validatedAt = validDate(input.validatedAt, "validatedAt");
  await dependencies.authorizeProject({ userId: actorUserId, projectId });

  return dependencies.db.$transaction(async (tx) => {
    await assertOwnedAuthorizedDevice(tx, actorUserId, localDeviceId);
    const id = boundedPersistenceId(
      "project-workspace",
      [projectId, actorUserId, localDeviceId],
      96,
    );
    const current = await tx.projectDeviceWorkspace.findUnique({
      where: { projectId_userId_localDeviceId: { projectId, userId: actorUserId, localDeviceId } },
    });
    const configurationVersion = input.expectedVersion === undefined
      ? 1
      : positiveVersion(input.expectedVersion) + 1;
    const parsed = parseProjectWorkspace({
      id,
      projectId,
      userId: actorUserId,
      localDeviceId,
      status: input.status,
      pathFingerprint: input.pathFingerprint,
      configurationVersion,
      lastValidatedAt: validatedAt.toISOString(),
    });
    const row = workspaceRow(parsed);

    if (input.expectedVersion === undefined) {
      if (current) throw versionConflict("Project Workspace already exists");
      await tx.projectDeviceWorkspace.create({ data: row });
      return parsed;
    }
    if (!current || current.configurationVersion !== input.expectedVersion || current.status === "revoked") {
      throw versionConflict("Project Workspace version conflict");
    }
    const updated = await tx.projectDeviceWorkspace.updateMany({
      where: { id: current.id, configurationVersion: input.expectedVersion },
      data: {
        status: parsed.status,
        pathFingerprint: parsed.pathFingerprint,
        configurationVersion: parsed.configurationVersion,
        lastValidatedAt: validatedAt,
      },
    });
    if (updated.count !== 1) throw versionConflict("Project Workspace version conflict");
    return parsed;
  });
}

export async function revokeProjectDeviceWorkspace(input: {
  actorUserId: string;
  projectId: string;
  localDeviceId: string;
  expectedVersion: number;
  revokedAt: Date;
}, dependencies: DeviceExecutionConfigurationDependencies = DEFAULTS): Promise<ProjectDeviceWorkspace> {
  const actorUserId = requiredId(input.actorUserId, "actorUserId", 64);
  const projectId = requiredId(input.projectId, "projectId", 64);
  const localDeviceId = requiredId(input.localDeviceId, "localDeviceId", 64);
  const expectedVersion = positiveVersion(input.expectedVersion);
  const revokedAt = validDate(input.revokedAt, "revokedAt");
  await dependencies.authorizeProject({ userId: actorUserId, projectId });

  return dependencies.db.$transaction(async (tx) => {
    await assertOwnedAuthorizedDevice(tx, actorUserId, localDeviceId);
    const current = await tx.projectDeviceWorkspace.findUnique({
      where: { projectId_userId_localDeviceId: { projectId, userId: actorUserId, localDeviceId } },
    });
    if (!current || current.configurationVersion !== expectedVersion) {
      throw versionConflict("Project Workspace version conflict");
    }
    const next = parseProjectWorkspace({
      ...serializeWorkspace(current),
      status: "revoked",
      configurationVersion: expectedVersion + 1,
      lastValidatedAt: revokedAt.toISOString(),
    });
    const updated = await tx.projectDeviceWorkspace.updateMany({
      where: { id: current.id, configurationVersion: expectedVersion },
      data: { status: "revoked", configurationVersion: next.configurationVersion, lastValidatedAt: revokedAt },
    });
    if (updated.count !== 1) throw versionConflict("Project Workspace version conflict");
    return next;
  });
}

export async function upsertDeviceAgentRuntimeProfile(input: {
  actorUserId: string;
  localDeviceId: string;
  expectedVersion?: number;
  provider: "codex" | "claude";
  label: string;
  status: "ready" | "missing" | "unauthenticated" | "disabled";
  capabilities: string[];
  modelSites?: unknown;
  validatedAt: Date;
}, dependencies: DeviceExecutionConfigurationDependencies = DEFAULTS): Promise<DeviceAgentRuntimeProfile> {
  const actorUserId = requiredId(input.actorUserId, "actorUserId", 64);
  const localDeviceId = requiredId(input.localDeviceId, "localDeviceId", 64);
  const validatedAt = validDate(input.validatedAt, "validatedAt");
  return dependencies.db.$transaction(async (tx) => {
    await assertOwnedAuthorizedDevice(tx, actorUserId, localDeviceId);
    const id = boundedPersistenceId(
      "device-runtime",
      [actorUserId, localDeviceId, input.provider],
      96,
    );
    const current = await tx.deviceAgentRuntimeProfile.findUnique({
      where: { userId_localDeviceId_provider: { userId: actorUserId, localDeviceId, provider: input.provider } },
    });
    const version = input.expectedVersion === undefined ? 1 : positiveVersion(input.expectedVersion) + 1;
    const parsed = parseRuntimeProfile({
      id,
      userId: actorUserId,
      localDeviceId,
      provider: input.provider,
      label: input.label,
      status: input.status,
      version,
      capabilities: [...new Set(input.capabilities)].sort(),
      modelSites: input.modelSites ?? [],
      lastValidatedAt: validatedAt.toISOString(),
    });
    const row = runtimeRow(parsed);
    if (input.expectedVersion === undefined) {
      if (current) throw versionConflict("Device Agent runtime already exists");
      await tx.deviceAgentRuntimeProfile.create({ data: row });
      return parsed;
    }
    if (!current || current.version !== input.expectedVersion) {
      throw versionConflict("Device Agent runtime version conflict");
    }
    const updated = await tx.deviceAgentRuntimeProfile.updateMany({
      where: { id: current.id, version: input.expectedVersion },
      data: {
        label: parsed.label,
        status: parsed.status,
        version: parsed.version,
        capabilities: parsed.capabilities,
        lastValidatedAt: validatedAt,
      },
    });
    if (updated.count !== 1) throw versionConflict("Device Agent runtime version conflict");
    return parsed;
  });
}

export async function disableDeviceAgentRuntimeProfile(input: {
  actorUserId: string;
  localDeviceId: string;
  provider: "codex" | "claude";
  expectedVersion: number;
  disabledAt: Date;
}, dependencies: DeviceExecutionConfigurationDependencies = DEFAULTS): Promise<DeviceAgentRuntimeProfile> {
  const actorUserId = requiredId(input.actorUserId, "actorUserId", 64);
  const localDeviceId = requiredId(input.localDeviceId, "localDeviceId", 64);
  const expectedVersion = positiveVersion(input.expectedVersion);
  const disabledAt = validDate(input.disabledAt, "disabledAt");
  return dependencies.db.$transaction(async (tx) => {
    await assertOwnedAuthorizedDevice(tx, actorUserId, localDeviceId);
    const current = await tx.deviceAgentRuntimeProfile.findUnique({
      where: { userId_localDeviceId_provider: { userId: actorUserId, localDeviceId, provider: input.provider } },
    });
    if (!current || current.version !== expectedVersion) {
      throw versionConflict("Device Agent runtime version conflict");
    }
    const next = parseRuntimeProfile({
      ...serializeRuntime(current),
      status: "disabled",
      version: expectedVersion + 1,
      lastValidatedAt: disabledAt.toISOString(),
    });
    const updated = await tx.deviceAgentRuntimeProfile.updateMany({
      where: { id: current.id, version: expectedVersion },
      data: { status: "disabled", version: next.version, lastValidatedAt: disabledAt },
    });
    if (updated.count !== 1) throw versionConflict("Device Agent runtime version conflict");
    return next;
  });
}

export async function listDeviceExecutionConfiguration(input: {
  actorUserId: string;
  localDeviceId: string;
  projectId?: string;
}, dependencies: DeviceExecutionConfigurationDependencies = DEFAULTS): Promise<{
  workspaces: ProjectDeviceWorkspace[];
  runtimeProfiles: DeviceAgentRuntimeProfile[];
}> {
  const actorUserId = requiredId(input.actorUserId, "actorUserId", 64);
  const localDeviceId = requiredId(input.localDeviceId, "localDeviceId", 64);
  const projectId = input.projectId === undefined ? undefined : requiredId(input.projectId, "projectId", 64);
  if (projectId) await dependencies.authorizeProject({ userId: actorUserId, projectId });
  return dependencies.db.$transaction(async (tx) => {
    await assertOwnedAuthorizedDevice(tx, actorUserId, localDeviceId);
    const [workspaces, runtimeProfiles] = await Promise.all([
      tx.projectDeviceWorkspace.findMany({
        where: { userId: actorUserId, localDeviceId, ...(projectId ? { projectId } : {}) },
        orderBy: [{ projectId: "asc" }, { id: "asc" }],
      }),
      tx.deviceAgentRuntimeProfile.findMany({
        where: { userId: actorUserId, localDeviceId },
        orderBy: [{ provider: "asc" }, { id: "asc" }],
      }),
    ]);
    return {
      workspaces: workspaces.map((row) => parseProjectWorkspace(serializeWorkspace(row))),
      runtimeProfiles: runtimeProfiles.map((row) => parseRuntimeProfile(serializeRuntime(row))),
    };
  });
}

async function assertOwnedAuthorizedDevice(
  tx: DeviceExecutionConfigurationTx,
  userId: string,
  localDeviceId: string,
): Promise<void> {
  const device = await tx.localDevice.findFirst({
    where: { id: localDeviceId, userId, status: "authorized" },
    select: { id: true, userId: true, status: true },
  });
  if (!device) {
    throw Object.assign(new Error("Authorized Local Device not found"), { code: "not_found" as const });
  }
}

function workspaceRow(value: ProjectDeviceWorkspace): WorkspaceRow {
  return { ...value, lastValidatedAt: value.lastValidatedAt ? new Date(value.lastValidatedAt) : null };
}

function runtimeRow(value: DeviceAgentRuntimeProfile): RuntimeProfileRow {
  return { ...value, lastValidatedAt: value.lastValidatedAt ? new Date(value.lastValidatedAt) : null };
}

function serializeWorkspace(value: WorkspaceRow): ProjectDeviceWorkspace {
  return {
    id: value.id,
    projectId: value.projectId,
    userId: value.userId,
    localDeviceId: value.localDeviceId,
    status: value.status,
    pathFingerprint: value.pathFingerprint,
    configurationVersion: value.configurationVersion,
    lastValidatedAt: value.lastValidatedAt?.toISOString() ?? null,
  };
}

function serializeRuntime(value: RuntimeProfileRow): DeviceAgentRuntimeProfile {
  return {
    id: value.id,
    userId: value.userId,
    localDeviceId: value.localDeviceId,
    provider: value.provider,
    label: value.label,
    status: value.status,
    version: value.version,
    capabilities: value.capabilities,
    modelSites: value.modelSites,
    lastValidatedAt: value.lastValidatedAt?.toISOString() ?? null,
  };
}

function parseProjectWorkspace(value: unknown): ProjectDeviceWorkspace {
  const parsed = projectDeviceWorkspaceSchema.safeParse(value);
  if (!parsed.success) {
    throw new OrchestrationPersistenceError("validation_failed", "Project Workspace configuration is invalid");
  }
  return parsed.data;
}

function parseRuntimeProfile(value: unknown): DeviceAgentRuntimeProfile {
  const parsed = deviceAgentRuntimeProfileSchema.safeParse(value);
  if (!parsed.success) {
    throw new OrchestrationPersistenceError("validation_failed", "Device Agent runtime configuration is invalid");
  }
  return parsed.data;
}

function requiredId(value: string, name: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max || normalized !== value) {
    throw new OrchestrationPersistenceError("validation_failed", `${name} is invalid`);
  }
  return normalized;
}

function positiveVersion(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new OrchestrationPersistenceError("validation_failed", "expectedVersion is invalid");
  }
  return value;
}

function validDate(value: Date, name: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new OrchestrationPersistenceError("validation_failed", `${name} is invalid`);
  }
  return value;
}

function versionConflict(message: string): OrchestrationPersistenceError {
  return new OrchestrationPersistenceError("version_conflict", message);
}
