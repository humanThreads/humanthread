import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  workerPoolRegistrationSchema,
  workerPoolStatusSchema,
  type WorkerPoolInstanceStatus,
  type WorkerPoolRegistration,
  type WorkerPoolStatus,
} from "@humanthread/shared";

import { derivedPersistenceId } from "./bounded-id";
import { prisma } from "./prisma";
import {
  canManageWorkerResources,
  normalizeWorkerResourceScope,
  workerResourceScopeWhere,
  type CompanyResourceRole,
  type WorkerResourceScope,
} from "./worker-resource-tenancy";

type WorkerPoolRow = {
  id: string;
  ownerType: "personal" | "company";
  ownerUserId: string | null;
  companyId: string | null;
  displayName: string;
  status: string;
  maxConcurrentRuns: number;
  configuration: unknown;
  bootstrapTokenHash: string;
  bootstrapTokenEncrypted: string;
  tokenVersion: number;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sessions?: Array<{
    instanceId: string;
    runtime: string;
    taskGroupName: string | null;
    requestedConcurrency: number;
    lastSeenAt: Date | null;
    linuxRuns: Array<{ id: string }>;
  }>;
};

export const WORKER_POOL_SESSION_DURATION_MS = 15 * 60 * 1_000;

type WorkerPoolSessionRow = {
  id: string;
  workerPoolId: string;
  instanceId: string;
  runtime: string;
  taskGroupName: string | null;
  tokenHash: string;
  status: string;
  capabilities: unknown;
  requestedConcurrency: number;
  expiresAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

interface WorkerPoolTx {
  workerPool: {
    findUnique(args: unknown): Promise<WorkerPoolRow | null>;
    findFirst(args: unknown): Promise<WorkerPoolRow | null>;
    findMany(args: unknown): Promise<WorkerPoolRow[]>;
    create(args: { data: Record<string, unknown> }): Promise<WorkerPoolRow>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
  workerPoolSession: {
    findUnique(args: unknown): Promise<WorkerPoolSessionRow | null>;
    findFirst(args: unknown): Promise<WorkerPoolSessionRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<WorkerPoolSessionRow>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
  workerPoolAudit: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

interface WorkerPoolDb {
  $transaction<T>(callback: (tx: WorkerPoolTx) => Promise<T>): Promise<T>;
}

export interface WorkerPoolDependencies {
  db: WorkerPoolDb;
  createToken: () => string;
  createSessionToken: () => string;
  tokenEncryptionKey: string;
  createId: (parts: readonly string[]) => string;
}

const DEFAULT_DEPENDENCIES: WorkerPoolDependencies = {
  db: prisma as unknown as WorkerPoolDb,
  createToken: () => `htwp_${randomBytes(32).toString("base64url")}`,
  createSessionToken: () => `htwps_${randomBytes(32).toString("base64url")}`,
  tokenEncryptionKey: process.env.HUMANTHREAD_WORKER_POOL_TOKEN_ENCRYPTION_KEY ?? "",
  createId: derivedPersistenceId,
};

type WorkerPoolErrorCode =
  | "worker_pool_conflict"
  | "worker_pool_configuration_required"
  | "worker_pool_reauthentication_required"
  | "worker_pool_unauthorized";

function workerPoolError(code: WorkerPoolErrorCode, message: string): Error & { code: WorkerPoolErrorCode } {
  return Object.assign(new Error(message), { code });
}

export function hashWorkerPoolToken(token: string): string {
  return createHash("sha256").update(requiredToken(token)).digest("hex");
}

export function encryptWorkerPoolToken(token: string, keyValue: string): string {
  return encryptWorkerSecret(token, keyValue, "HUMANTHREAD_WORKER_POOL_TOKEN_ENCRYPTION_KEY");
}

export function encryptWorkerSecret(value: string, keyValue: string, keyName: string): string {
  const key = parseEncryptionKey(keyValue, keyName);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(requiredToken(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function decryptWorkerPoolToken(encrypted: string, keyValue: string): string {
  return decryptWorkerSecret(encrypted, keyValue, "HUMANTHREAD_WORKER_POOL_TOKEN_ENCRYPTION_KEY");
}

export function decryptWorkerSecret(encrypted: string, keyValue: string, keyName: string): string {
  const key = parseEncryptionKey(keyValue, keyName);
  const payload = Buffer.from(encrypted, "base64url");
  if (payload.length < 29) {
    throw workerPoolError("worker_pool_configuration_required", "Worker pool token material is invalid");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
}

export async function listWorkerPools(input: {
  actorUserId?: string;
  scope?: WorkerResourceScope;
  now?: Date;
}, dependencies: WorkerPoolDependencies = DEFAULT_DEPENDENCIES): Promise<WorkerPoolStatus[]> {
  const scope = resolveScope(input);
  const now = input.now === undefined ? new Date() : validDate(input.now, "now");
  const pools = await dependencies.db.$transaction((tx) => tx.workerPool.findMany({
    where: workerResourceScopeWhere(scope),
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    include: {
      sessions: {
        where: { status: "active", revokedAt: null, expiresAt: { gt: now } },
        select: {
          instanceId: true,
          runtime: true,
          taskGroupName: true,
          requestedConcurrency: true,
          lastSeenAt: true,
          linuxRuns: {
            where: { status: { in: ["claimed", "starting", "running", "waiting_approval"] } },
            select: { id: true },
          },
        },
      },
    },
  }));
  return pools.map((pool) => serializeWorkerPool(pool, now));
}

export async function createWorkerPool(input: {
  actorUserId: string;
  scope?: WorkerResourceScope;
  companyRole?: CompanyResourceRole | null;
  displayName: string;
  maxConcurrentRuns: number;
  configuration: Record<string, unknown>;
  now: Date;
}, dependencies: WorkerPoolDependencies = DEFAULT_DEPENDENCIES): Promise<{
  pool: WorkerPoolStatus;
  bootstrapToken: string;
}> {
  const actorUserId = requiredId(input.actorUserId, "actorUserId", 64);
  const scope = resolveScope(input);
  assertCanManageScope(scope, input.companyRole);
  const displayName = requiredId(input.displayName, "displayName", 191);
  const maxConcurrentRuns = positiveConcurrency(input.maxConcurrentRuns);
  const configuration = requiredConfiguration(input.configuration);
  const now = validDate(input.now, "now");
  const bootstrapToken = requiredToken(dependencies.createToken());
  const id = dependencies.createId(["worker-pool", scope.ownerType, scope.ownerUserId ?? scope.companyId ?? "", displayName]);
  assertMd5Id(id);
  const tokenHash = hashWorkerPoolToken(bootstrapToken);
  const tokenEncrypted = encryptWorkerPoolToken(bootstrapToken, dependencies.tokenEncryptionKey);

  return dependencies.db.$transaction(async (tx) => {
    const existing = await tx.workerPool.findUnique({
      where: poolNameWhere(scope, displayName),
    });
    if (existing) throw workerPoolError("worker_pool_conflict", "Worker pool name is already in use");
    const row = await tx.workerPool.create({
      data: {
        id,
        ...scope,
        displayName,
        status: "active",
        maxConcurrentRuns,
        configuration,
        bootstrapTokenHash: tokenHash,
        bootstrapTokenEncrypted: tokenEncrypted,
        tokenVersion: 1,
        lastSeenAt: null,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    await recordAudit(tx, {
      workerPoolId: row.id,
      actorUserId,
      action: "created",
      metadata: { tokenVersion: 1 },
      now,
    }, dependencies);
    return { pool: serializeWorkerPool(row), bootstrapToken };
  });
}

export async function revealWorkerPoolToken(input: {
  poolId: string;
  actorUserId: string;
  scope?: WorkerResourceScope;
  companyRole?: CompanyResourceRole | null;
  reauthenticated: boolean;
  now: Date;
}, dependencies: WorkerPoolDependencies = DEFAULT_DEPENDENCIES): Promise<{ bootstrapToken: string }> {
  const poolId = requiredPoolId(input.poolId);
  const actorUserId = requiredId(input.actorUserId, "actorUserId", 64);
  const scope = resolveScope(input);
  assertCanManageScope(scope, input.companyRole);
  const now = validDate(input.now, "now");
  if (!input.reauthenticated) {
    throw workerPoolError("worker_pool_reauthentication_required", "Reauthentication is required to reveal a Worker pool token");
  }
  return dependencies.db.$transaction(async (tx) => {
    const pool = await findOwnedActivePool(tx, poolId, scope);
    const bootstrapToken = decryptWorkerPoolToken(pool.bootstrapTokenEncrypted, dependencies.tokenEncryptionKey);
    await recordAudit(tx, {
      workerPoolId: pool.id,
      actorUserId,
      action: "token_revealed",
      metadata: { tokenVersion: pool.tokenVersion },
      now,
    }, dependencies);
    return { bootstrapToken };
  });
}

export async function rotateWorkerPoolToken(input: {
  poolId: string;
  actorUserId: string;
  scope?: WorkerResourceScope;
  companyRole?: CompanyResourceRole | null;
  reauthenticated: boolean;
  now: Date;
}, dependencies: WorkerPoolDependencies = DEFAULT_DEPENDENCIES): Promise<{ bootstrapToken: string; tokenVersion: number }> {
  const poolId = requiredPoolId(input.poolId);
  const actorUserId = requiredId(input.actorUserId, "actorUserId", 64);
  const scope = resolveScope(input);
  assertCanManageScope(scope, input.companyRole);
  const now = validDate(input.now, "now");
  if (!input.reauthenticated) {
    throw workerPoolError("worker_pool_reauthentication_required", "Reauthentication is required to rotate a Worker pool token");
  }
  const bootstrapToken = requiredToken(dependencies.createToken());
  return dependencies.db.$transaction(async (tx) => {
    const pool = await findOwnedActivePool(tx, poolId, scope);
    const tokenVersion = pool.tokenVersion + 1;
    const updated = await tx.workerPool.updateMany({
      where: { id: pool.id, ...workerResourceScopeWhere(scope), status: "active", tokenVersion: pool.tokenVersion },
      data: {
        bootstrapTokenHash: hashWorkerPoolToken(bootstrapToken),
        bootstrapTokenEncrypted: encryptWorkerPoolToken(bootstrapToken, dependencies.tokenEncryptionKey),
        tokenVersion,
        updatedAt: now,
      },
    });
    if (updated.count !== 1) throw workerPoolError("worker_pool_unauthorized", "Worker pool is unavailable");
    await tx.workerPoolSession.updateMany({
      where: { workerPoolId: pool.id, status: "active" },
      data: { status: "revoked", revokedAt: now, updatedAt: now },
    });
    await recordAudit(tx, {
      workerPoolId: pool.id,
      actorUserId,
      action: "token_rotated",
      metadata: { tokenVersion },
      now,
    }, dependencies);
    return { bootstrapToken, tokenVersion };
  });
}

export async function revokeWorkerPool(input: {
  poolId: string;
  actorUserId: string;
  scope?: WorkerResourceScope;
  companyRole?: CompanyResourceRole | null;
  now: Date;
}, dependencies: WorkerPoolDependencies = DEFAULT_DEPENDENCIES): Promise<void> {
  const poolId = requiredPoolId(input.poolId);
  const actorUserId = requiredId(input.actorUserId, "actorUserId", 64);
  const scope = resolveScope(input);
  assertCanManageScope(scope, input.companyRole);
  const now = validDate(input.now, "now");
  await dependencies.db.$transaction(async (tx) => {
    const pool = await findOwnedActivePool(tx, poolId, scope);
    const updated = await tx.workerPool.updateMany({
      where: { id: pool.id, ...workerResourceScopeWhere(scope), status: "active" },
      data: { status: "revoked", revokedAt: now, updatedAt: now },
    });
    if (updated.count !== 1) throw workerPoolError("worker_pool_unauthorized", "Worker pool is unavailable");
    await tx.workerPoolSession.updateMany({
      where: { workerPoolId: pool.id, status: "active" },
      data: { status: "revoked", revokedAt: now, updatedAt: now },
    });
    await recordAudit(tx, {
      workerPoolId: pool.id,
      actorUserId,
      action: "revoked",
      metadata: { tokenVersion: pool.tokenVersion },
      now,
    }, dependencies);
  });
}

export async function authenticateWorkerPoolToken(input: {
  ownerUserId?: string;
  scope?: WorkerResourceScope;
  token: string;
  now: Date;
}, dependencies: WorkerPoolDependencies = DEFAULT_DEPENDENCIES): Promise<WorkerPoolStatus> {
  const scope = input.scope === undefined
    ? { ownerType: "personal" as const, ownerUserId: requiredId(input.ownerUserId ?? "", "ownerUserId", 64), companyId: null }
    : normalizeWorkerResourceScope(input.scope);
  const pool = await authenticateWorkerPoolBootstrapToken(input, dependencies);
  if (!sameScope(pool, scope)) {
    throw workerPoolError("worker_pool_unauthorized", "Worker pool credentials are invalid");
  }
  return pool;
}

export async function authenticateWorkerPoolBootstrapToken(input: {
  token: string;
  now: Date;
}, dependencies: WorkerPoolDependencies = DEFAULT_DEPENDENCIES): Promise<WorkerPoolStatus> {
  const tokenHash = hashWorkerPoolToken(input.token);
  const now = validDate(input.now, "now");
  const pool = await dependencies.db.$transaction((tx) => tx.workerPool.findFirst({
    where: { status: "active", bootstrapTokenHash: tokenHash },
  }));
  if (!pool || !constantTimeHashEqual(tokenHash, pool.bootstrapTokenHash) || (pool.revokedAt && pool.revokedAt <= now)) {
    throw workerPoolError("worker_pool_unauthorized", "Worker pool credentials are invalid");
  }
  return serializeWorkerPool(pool);
}

export async function createWorkerPoolSession(input: {
  poolId: string;
  ownerUserId?: string;
  auditActorUserId?: string;
  instanceId: string;
  poolName?: string;
  runtime?: "docker" | "kubernetes";
  taskGroupName?: string;
  capabilities: Record<string, unknown>;
  requestedConcurrency: number;
  now: Date;
  expiresAt: Date;
}, dependencies: WorkerPoolDependencies = DEFAULT_DEPENDENCIES): Promise<{
  sessionId: string;
  sessionToken: string;
  expiresAt: Date;
}> {
  const poolId = requiredPoolId(input.poolId);
  const auditActorUserId = input.auditActorUserId === undefined && input.ownerUserId === undefined
    ? null
    : requiredId(input.auditActorUserId ?? input.ownerUserId ?? "", "auditActorUserId", 64);
  const registration = workerPoolRegistrationSchema.parse({
    instanceId: input.instanceId,
    ...(input.poolName === undefined ? {} : { poolName: input.poolName }),
    runtime: input.runtime ?? "docker",
    ...(input.taskGroupName === undefined ? {} : { taskGroupName: input.taskGroupName }),
    capabilities: input.capabilities,
    requestedConcurrency: input.requestedConcurrency,
  }) satisfies WorkerPoolRegistration;
  const now = validDate(input.now, "now");
  const expiresAt = validDate(input.expiresAt, "expiresAt");
  if (expiresAt <= now) throw workerPoolError("worker_pool_unauthorized", "Worker pool session expiry is invalid");
  const sessionToken = requiredToken(dependencies.createSessionToken());
  const tokenHash = hashWorkerPoolToken(sessionToken);
  const id = dependencies.createId(["worker-pool-session", poolId, registration.instanceId, tokenHash]);
  assertMd5Id(id);
  return dependencies.db.$transaction(async (tx) => {
    const pool = await findActivePool(tx, poolId);
    if (registration.poolName !== undefined && registration.poolName !== pool.displayName) {
      throw workerPoolError("worker_pool_configuration_required", "Worker pool name does not match the bootstrap token");
    }
    const existing = await tx.workerPoolSession.findUnique({
      where: { workerPoolId_instanceId: { workerPoolId: poolId, instanceId: registration.instanceId } },
    });
    const taskGroupName = registration.runtime === "kubernetes"
      ? registration.taskGroupName ?? pool.displayName
      : null;
    const sessionData = {
      tokenHash,
      status: "active",
      runtime: registration.runtime,
      taskGroupName,
      capabilities: registration.capabilities,
      requestedConcurrency: registration.requestedConcurrency,
      expiresAt,
      lastSeenAt: now,
      revokedAt: null,
      updatedAt: now,
    };
    const sessionId = existing?.id ?? id;
    if (existing) {
      const refreshed = await tx.workerPoolSession.updateMany({
        where: { id: existing.id },
        data: sessionData,
      });
      if (refreshed.count !== 1) throw workerPoolError("worker_pool_unauthorized", "Worker pool session is unavailable");
    } else {
      await tx.workerPoolSession.create({
        data: {
          id,
          workerPoolId: poolId,
          instanceId: registration.instanceId,
          ...sessionData,
          createdAt: now,
        },
      });
    }
    const touched = await tx.workerPool.updateMany({
      where: { id: pool.id, status: "active", revokedAt: null },
      data: { lastSeenAt: now, updatedAt: now },
    });
    if (touched.count !== 1) throw workerPoolError("worker_pool_unauthorized", "Worker pool is unavailable");
    if (auditActorUserId !== null) {
      await recordAudit(tx, {
        workerPoolId: poolId,
        actorUserId: auditActorUserId,
        action: existing ? "session_refreshed" : "session_registered",
        metadata: { instanceId: registration.instanceId, requestedConcurrency: registration.requestedConcurrency },
        now,
      }, dependencies);
    }
    return { sessionId, sessionToken, expiresAt };
  });
}

export async function authenticateWorkerPoolSession(input: {
  poolId: string;
  sessionToken: string;
  now: Date;
}, dependencies: WorkerPoolDependencies = DEFAULT_DEPENDENCIES): Promise<{
  sessionId: string;
  workerPoolId: string;
  ownerType: "personal" | "company";
  ownerUserId: string | null;
  companyId: string | null;
  instanceId: string;
  runtime: "docker" | "kubernetes";
  taskGroupName: string | null;
  capabilities: Record<string, unknown>;
  requestedConcurrency: number;
  maxConcurrentRuns: number;
  configuration: Record<string, unknown>;
}> {
  const poolId = requiredPoolId(input.poolId);
  const now = validDate(input.now, "now");
  const tokenHash = hashWorkerPoolToken(input.sessionToken);
  const [pool, session] = await dependencies.db.$transaction(async (tx) => [
    await tx.workerPool.findUnique({ where: { id: poolId } }),
    await tx.workerPoolSession.findFirst({
      where: { workerPoolId: poolId, tokenHash, status: "active", expiresAt: { gt: now } },
    }),
  ]);
  if (
    !pool
    || pool.status !== "active"
    || pool.revokedAt !== null
    || !session
    || !constantTimeHashEqual(tokenHash, session.tokenHash)
  ) throw workerPoolError("worker_pool_unauthorized", "Worker pool session is invalid");
  await dependencies.db.$transaction(async (tx) => {
    const [updatedSession, updatedPool] = await Promise.all([
      tx.workerPoolSession.updateMany({
        where: { id: session.id, workerPoolId: pool.id, status: "active", expiresAt: { gt: now } },
        data: {
          lastSeenAt: now,
          expiresAt: new Date(now.getTime() + WORKER_POOL_SESSION_DURATION_MS),
          updatedAt: now,
        },
      }),
      tx.workerPool.updateMany({
        where: { id: pool.id, status: "active", revokedAt: null },
        data: { lastSeenAt: now, updatedAt: now },
      }),
    ]);
    if (updatedSession.count !== 1 || updatedPool.count !== 1) {
      throw workerPoolError("worker_pool_unauthorized", "Worker pool session is invalid");
    }
  });
  const capabilities = workerPoolRegistrationSchema.shape.capabilities.parse(session.capabilities);
  return {
    sessionId: session.id,
    workerPoolId: pool.id,
    ownerType: pool.ownerType,
    ownerUserId: pool.ownerUserId,
    companyId: pool.companyId,
    instanceId: session.instanceId,
    runtime: session.runtime === "kubernetes" ? "kubernetes" : "docker",
    taskGroupName: session.taskGroupName,
    capabilities,
    requestedConcurrency: session.requestedConcurrency,
    maxConcurrentRuns: pool.maxConcurrentRuns,
    configuration: workerPoolRegistrationSchema.shape.capabilities.parse(pool.configuration),
  };
}

async function findOwnedActivePool(tx: WorkerPoolTx, poolId: string, scope: WorkerResourceScope): Promise<WorkerPoolRow> {
  const pool = await tx.workerPool.findFirst({ where: { id: poolId, ...workerResourceScopeWhere(scope), status: "active" } });
  if (!pool) throw workerPoolError("worker_pool_unauthorized", "Worker pool is unavailable");
  return pool;
}

async function findActivePool(tx: WorkerPoolTx, poolId: string): Promise<WorkerPoolRow> {
  const pool = await tx.workerPool.findFirst({ where: { id: poolId, status: "active", revokedAt: null } });
  if (!pool) throw workerPoolError("worker_pool_unauthorized", "Worker pool is unavailable");
  return pool;
}

async function recordAudit(tx: WorkerPoolTx, input: {
  workerPoolId: string;
  actorUserId: string;
  action: string;
  metadata: Record<string, unknown>;
  now: Date;
}, dependencies: WorkerPoolDependencies): Promise<void> {
  const id = dependencies.createId([
    "worker-pool-audit",
    input.workerPoolId,
    input.action,
    input.now.toISOString(),
    randomBytes(16).toString("hex"),
  ]);
  assertMd5Id(id);
  await tx.workerPoolAudit.create({
    data: {
      id,
      workerPoolId: input.workerPoolId,
      actorUserId: input.actorUserId,
      action: input.action,
      metadata: input.metadata,
      createdAt: input.now,
    },
  });
}

function serializeWorkerPool(row: WorkerPoolRow, now = new Date()): WorkerPoolStatus {
  const sessions = row.sessions ?? [];
  const runtime = sessions.some((session) => session.runtime === "kubernetes") ? "kubernetes" : "docker";
  const aliveSessions = sessions.filter((session) => workerPoolSessionIsAlive(session, now));
  const capacitySessions = runtime === "kubernetes" ? aliveSessions : sessions;
  const capacity = Math.min(row.maxConcurrentRuns, capacitySessions.reduce((total, session) => total + session.requestedConcurrency, 0));
  const currentRuns = capacitySessions.reduce((total, session) => total + session.linuxRuns.length, 0);
  const instances = runtime === "kubernetes" ? [] : sessions
    .map((session): WorkerPoolInstanceStatus => ({
      instanceId: session.instanceId,
      health: workerPoolInstanceHealth(row, session, session.linuxRuns.length, now),
      requestedConcurrency: session.requestedConcurrency,
      currentRuns: session.linuxRuns.length,
      lastSeenAt: session.lastSeenAt?.toISOString() ?? null,
    }))
    .sort((left, right) => left.instanceId.localeCompare(right.instanceId));
  return workerPoolStatusSchema.parse({
    id: row.id,
    ownerType: row.ownerType,
    ownerUserId: row.ownerUserId,
    companyId: row.companyId,
    displayName: row.displayName,
    status: row.status,
    maxConcurrentRuns: row.maxConcurrentRuns,
    health: workerPoolHealth(row, capacitySessions, currentRuns, now),
    capacity,
    currentRuns,
    runtime,
    taskGroupName: runtime === "kubernetes"
      ? sessions.find((session) => session.taskGroupName !== null)?.taskGroupName ?? row.displayName
      : null,
    aliveInstanceCount: aliveSessions.length,
    instances,
    configuration: row.configuration,
    tokenVersion: row.tokenVersion,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function resolveScope(input: { actorUserId?: string; scope?: WorkerResourceScope }): WorkerResourceScope {
  const scope = input.scope === undefined
    ? { ownerType: "personal" as const, ownerUserId: requiredId(input.actorUserId ?? "", "actorUserId", 64), companyId: null }
    : normalizeWorkerResourceScope(input.scope);
  if (scope.ownerType === "personal" && input.actorUserId !== undefined
    && scope.ownerUserId !== requiredId(input.actorUserId, "actorUserId", 64)) {
    throw workerPoolError("worker_pool_unauthorized", "Personal Worker resources belong to the current user");
  }
  return scope;
}

function assertCanManageScope(scope: WorkerResourceScope, role: CompanyResourceRole | null | undefined): void {
  const allowed = role === undefined
    ? canManageWorkerResources({ ownerType: scope.ownerType })
    : canManageWorkerResources({ ownerType: scope.ownerType, role });
  if (!allowed) {
    throw workerPoolError("worker_pool_unauthorized", "Worker pool management is not authorized");
  }
}

function poolNameWhere(scope: WorkerResourceScope, displayName: string): Record<string, unknown> {
  return scope.ownerType === "personal"
    ? { ownerUserId_displayName: { ownerUserId: scope.ownerUserId, displayName } }
    : { companyId_displayName: { companyId: scope.companyId, displayName } };
}

function sameScope(pool: WorkerPoolStatus, scope: WorkerResourceScope): boolean {
  return pool.ownerType === scope.ownerType
    && pool.ownerUserId === scope.ownerUserId
    && pool.companyId === scope.companyId;
}

function workerPoolInstanceHealth(
  pool: WorkerPoolRow,
  session: NonNullable<WorkerPoolRow["sessions"]>[number],
  currentRuns: number,
  now: Date,
): "idle" | "running" | "degraded" | "offline" | "revoked" {
  if (pool.status === "revoked" || pool.revokedAt !== null) return "revoked";
  if (!session.lastSeenAt) return "offline";
  if (!workerPoolSessionIsAlive(session, now)) return "degraded";
  return currentRuns > 0 ? "running" : "idle";
}

function workerPoolSessionIsAlive(
  session: NonNullable<WorkerPoolRow["sessions"]>[number],
  now: Date,
): boolean {
  return session.lastSeenAt !== null && now.getTime() - session.lastSeenAt.getTime() <= 90_000;
}

function workerPoolHealth(
  pool: WorkerPoolRow,
  sessions: readonly NonNullable<WorkerPoolRow["sessions"]>[number][],
  currentRuns: number,
  now: Date,
): "idle" | "running" | "degraded" | "offline" | "revoked" {
  if (pool.status === "revoked" || pool.revokedAt !== null) return "revoked";
  const health = sessions.map((session) => workerPoolInstanceHealth(pool, session, session.linuxRuns.length, now));
  if (health.includes("running")) return "running";
  if (health.includes("idle")) return "idle";
  if (health.includes("degraded")) return "degraded";
  return "offline";
}

function requiredConfiguration(value: Record<string, unknown>): Record<string, unknown> {
  return workerPoolRegistrationSchema.shape.capabilities.parse(value);
}

function requiredId(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw workerPoolError("worker_pool_unauthorized", `${field} is invalid`);
  }
  return normalized;
}

function requiredPoolId(value: string): string {
  const normalized = value.trim();
  assertMd5Id(normalized);
  return normalized;
}

function requiredToken(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw workerPoolError("worker_pool_unauthorized", "Worker pool token is invalid");
  return normalized;
}

function positiveConcurrency(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 128) {
    throw workerPoolError("worker_pool_unauthorized", "Worker pool concurrency is invalid");
  }
  return value;
}

function validDate(value: Date, field: string): Date {
  if (!Number.isFinite(value.getTime())) throw workerPoolError("worker_pool_unauthorized", `${field} is invalid`);
  return value;
}

function assertMd5Id(value: string): void {
  if (!/^[a-f0-9]{32}$/u.test(value)) {
    throw workerPoolError("worker_pool_configuration_required", "Worker pool IDs must be MD5 identifiers");
  }
}

function constantTimeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === 32 && rightBuffer.length === 32 && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseEncryptionKey(value: string, keyName: string): Buffer {
  const normalized = value.trim();
  const key = /^[a-f0-9]{64}$/iu.test(normalized)
    ? Buffer.from(normalized, "hex")
    : Buffer.from(normalized, "base64");
  if (key.length !== 32) {
    throw workerPoolError(
      "worker_pool_configuration_required",
      `${keyName} must be a 32-byte base64 or 64-character hex key`,
    );
  }
  return key;
}
