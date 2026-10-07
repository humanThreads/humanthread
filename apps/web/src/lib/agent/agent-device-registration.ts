import type {
  AgentDeviceRegisterResponse,
  AgentDeviceStatus,
  AgentWorkerCapabilitySnapshot,
  LocalAgentPlatform,
} from "@humanthread/shared";
import { randomBytes } from "node:crypto";
import { prisma } from "@humanthread/db";
import {
  agentWorkerCapabilitySnapshotSchema,
  buildLocalAgentWorkerId,
} from "../../../../../packages/shared/src/index";
import { hashAgentToken } from "./agent-auth";

export interface RegisterAgentDeviceInput {
  userId: string;
  deviceId: string;
  deviceName: string;
  platform: LocalAgentPlatform;
  capabilitySnapshot?: AgentWorkerCapabilitySnapshot;
  agentVersion?: string;
  currentDeviceToken?: string;
  allowAuthorizedDeviceTokenRotation?: boolean;
  authorizeDevice?: boolean;
  now?: Date;
}

interface AgentDeviceUserRecord {
  id: string;
  status: string;
}

interface AgentDeviceRecord {
  id: string;
  userId: string;
  status: string;
  deviceTokenHash: string | null;
}

interface RegisterAgentDeviceDependencies {
  loadUser: (input: { userId: string }) => Promise<AgentDeviceUserRecord | null>;
  loadDevice: (input: { deviceId: string }) => Promise<AgentDeviceRecord | null>;
  createDeviceToken: () => string;
  upsertDevice: (input: {
    id: string;
    userId: string;
    name: string;
    platform: LocalAgentPlatform;
    now: Date;
    status: AgentDeviceStatus;
    deviceTokenHash: string;
    capabilitySnapshot?: AgentWorkerCapabilitySnapshot;
    authorizedAt?: Date | null;
    revokedAt?: Date | null;
  }) => Promise<AgentDeviceRecord>;
}

export interface HeartbeatLocalAgentWorkerInput {
  userId: string;
  deviceId: string;
  workerId: string;
  capabilitySnapshot: AgentWorkerCapabilitySnapshot;
  agentVersion?: string;
  now: Date;
}

interface HeartbeatLocalAgentWorkerDevice {
  id: string;
  userId: string;
  name: string;
  status: string;
}

interface HeartbeatLocalAgentWorkerSpace {
  id: string;
  status: string;
}

interface HeartbeatLocalAgentWorkerDependencies {
  loadDevice: (input: { deviceId: string }) => Promise<HeartbeatLocalAgentWorkerDevice | null>;
  resolveWorkerSpace: (input: { workerId: string; userId: string }) => Promise<HeartbeatLocalAgentWorkerSpace | null>;
  persist: (input: {
    workerId: string;
    userId: string;
    deviceId: string;
    deviceName: string;
    spaceId: string;
    capabilities: string[];
    maxConcurrentRuns: number;
    agentVersion?: string;
    capabilitySnapshot: AgentWorkerCapabilitySnapshot;
    now: Date;
  }) => Promise<{ workerId: string }>;
}

function staleLeaseError(message: string): Error & { code: "stale_lease" } {
  return Object.assign(new Error(message), { code: "stale_lease" as const });
}

/**
 * Claim is also the liveness signal for a Desktop Worker. This path is
 * intentionally independent from device registration so older clients can
 * recover a missing Worker row simply by polling for assignments.
 */
export async function heartbeatLocalAgentWorker(
  input: HeartbeatLocalAgentWorkerInput,
  dependencies: HeartbeatLocalAgentWorkerDependencies = {
    loadDevice: async ({ deviceId }) => prisma.localDevice.findUnique({
      where: { id: deviceId },
      select: { id: true, userId: true, name: true, status: true },
    }),
    resolveWorkerSpace: async ({ workerId, userId }) => {
      const existing = await prisma.agentWorker.findUnique({
        where: { id: workerId },
        select: { spaceId: true, space: { select: { id: true, status: true } } },
      });
      if (existing?.space && existing.space.status === "active") return existing.space;
      return prisma.space.findUnique({
        where: { ownerUserId: userId },
        select: { id: true, status: true },
      });
    },
    persist: async ({
      workerId,
      userId,
      deviceId,
      deviceName,
      spaceId,
      capabilities,
      maxConcurrentRuns,
      capabilitySnapshot,
      agentVersion,
      now,
    }) => prisma.$transaction(async (tx) => {
      const device = await tx.localDevice.updateMany({
        where: { id: deviceId, userId, status: "authorized" },
        data: {
          capabilitySnapshot,
          lastSeenAt: now,
        },
      });
      if (device.count !== 1) throw staleLeaseError("Local device is no longer authorized");
      const worker = await tx.agentWorker.upsert({
        where: { id: workerId },
        update: {
          spaceId,
          localDeviceId: deviceId,
          name: deviceName,
          runtimeType: "local_agent",
          status: "online",
          capabilities,
          maxConcurrentRuns,
          ...(agentVersion === undefined ? {} : { agentVersion }),
          lastHeartbeatAt: now,
        },
        create: {
          id: workerId,
          spaceId,
          localDeviceId: deviceId,
          name: deviceName,
          runtimeType: "local_agent",
          status: "online",
          capabilities,
          maxConcurrentRuns,
          ...(agentVersion === undefined ? {} : { agentVersion }),
          activeRunCount: 0,
          lastHeartbeatAt: now,
        },
        select: { id: true },
      });
      return { workerId: worker.id };
    }),
  },
): Promise<{ workerId: string }> {
  if (input.workerId !== buildLocalAgentWorkerId(input.deviceId)) {
    throw staleLeaseError("Worker does not belong to the authenticated device");
  }
  if (!Number.isFinite(input.now.getTime())) {
    throw Object.assign(new Error("Worker heartbeat time is invalid"), { code: "validation_failed" });
  }
  const capabilitySnapshot = agentWorkerCapabilitySnapshotSchema.parse(input.capabilitySnapshot);
  const device = await dependencies.loadDevice({ deviceId: input.deviceId });
  if (!device || device.userId !== input.userId || device.status !== "authorized") {
    throw staleLeaseError("Local device is not authorized for the authenticated user");
  }
  const space = await dependencies.resolveWorkerSpace({
    workerId: input.workerId,
    userId: input.userId,
  });
  if (!space || space.status !== "active") {
    throw Object.assign(new Error("Agent Worker Space is unavailable"), { code: "configuration_missing" });
  }
  return dependencies.persist({
    workerId: input.workerId,
    userId: input.userId,
    deviceId: input.deviceId,
    deviceName: device.name,
    spaceId: space.id,
    capabilities: [...new Set([
      ...capabilitySnapshot.capabilities,
      ...capabilitySnapshot.providers.map(({ name }) => name),
    ])],
    maxConcurrentRuns: capabilitySnapshot.maxConcurrency,
    ...(input.agentVersion === undefined ? {} : { agentVersion: input.agentVersion }),
    capabilitySnapshot,
    now: input.now,
  });
}

function normalizeDeviceStatus(value: string | null | undefined): AgentDeviceStatus {
  if (value === "authorized" || value === "revoked") {
    return value;
  }

  return "pending";
}

function canReuseDeviceToken(
  currentDeviceToken: string | undefined,
  existingDeviceTokenHash: string | null,
): currentDeviceToken is string {
  const normalizedToken = currentDeviceToken?.trim() ?? "";

  if (!normalizedToken || !existingDeviceTokenHash?.trim()) {
    return false;
  }

  return hashAgentToken(normalizedToken) === existingDeviceTokenHash.trim();
}

export async function registerAgentDevice(
  input: RegisterAgentDeviceInput,
  dependencies: RegisterAgentDeviceDependencies = {
    loadUser: async ({ userId }) =>
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          status: true,
        },
      }),
    loadDevice: async ({ deviceId }) =>
      prisma.localDevice.findUnique({
        where: { id: deviceId },
        select: {
          id: true,
          userId: true,
          status: true,
          deviceTokenHash: true,
        },
      }),
    createDeviceToken: () => `ht_device_${randomBytes(18).toString("hex")}`,
    upsertDevice: async ({
      id,
      userId,
      name,
      platform,
      now,
      status,
      deviceTokenHash,
      capabilitySnapshot,
      authorizedAt,
      revokedAt,
    }) =>
      prisma.localDevice.upsert({
        where: { id },
        update: {
          userId,
          name,
          platform,
          status,
          deviceTokenHash,
          ...(capabilitySnapshot === undefined ? {} : { capabilitySnapshot }),
          lastSeenAt: now,
          ...(authorizedAt === undefined ? {} : { authorizedAt }),
          ...(revokedAt === undefined ? {} : { revokedAt }),
        },
        create: {
          id,
          userId,
          name,
          platform,
          status,
          deviceTokenHash,
          ...(capabilitySnapshot === undefined ? {} : { capabilitySnapshot }),
          lastSeenAt: now,
          ...(authorizedAt === undefined ? {} : { authorizedAt }),
          ...(revokedAt === undefined ? {} : { revokedAt }),
        },
        select: {
          id: true,
          userId: true,
          status: true,
          deviceTokenHash: true,
        },
      }),
  },
): Promise<AgentDeviceRegisterResponse> {
  const user = await dependencies.loadUser({
    userId: input.userId,
  });

  if (!user || user.status !== "active") {
    throw new Error("Agent user is unavailable");
  }

  const existingDevice = await dependencies.loadDevice({
    deviceId: input.deviceId,
  });

  if (existingDevice && existingDevice.userId !== input.userId) {
    throw new Error("Local device belongs to a different user");
  }

  const status = input.authorizeDevice
    ? "authorized"
    : normalizeDeviceStatus(existingDevice?.status);
  const currentDeviceToken = input.currentDeviceToken?.trim();
  const canReuseCurrentToken = canReuseDeviceToken(
    currentDeviceToken,
    existingDevice?.deviceTokenHash ?? null,
  );
  const reusableDeviceToken = canReuseCurrentToken
    ? currentDeviceToken
    : undefined;

  if (
    existingDevice &&
    status === "authorized" &&
    !canReuseCurrentToken &&
    input.allowAuthorizedDeviceTokenRotation === false
  ) {
    throw new Error("Current device token is required for authorized device binding");
  }

  const deviceToken = reusableDeviceToken ?? dependencies.createDeviceToken();
  const now = input.now ?? new Date();
  const capabilitySnapshot = input.capabilitySnapshot === undefined
    ? undefined
    : agentWorkerCapabilitySnapshotSchema.parse(input.capabilitySnapshot);
  const device = await dependencies.upsertDevice({
    id: input.deviceId,
    userId: input.userId,
    name: input.deviceName,
    platform: input.platform,
    now,
    status,
    deviceTokenHash: hashAgentToken(deviceToken),
    ...(capabilitySnapshot === undefined ? {} : { capabilitySnapshot }),
    ...(input.authorizeDevice
      ? { authorizedAt: now, revokedAt: null }
      : {}),
  });
  return {
    userId: input.userId,
    deviceId: device.id,
    status: normalizeDeviceStatus(device.status),
    deviceToken,
  };
}
