import { derivedPersistenceId } from "./bounded-id";
import { prisma } from "./prisma";

type ChallengeStatus = "pending" | "claimed" | "completed";

type ChallengeRow = {
  id: string;
  projectId: string;
  workerPoolId: string;
  workerPoolSessionId: string;
  environmentConfigurationVersion: number;
  status: ChallengeStatus;
  claimedAt: Date | null;
  acknowledgedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type ChallengeTx = {
  workerValidationChallenge: {
    findFirst(input: { where: Record<string, unknown> }): Promise<ChallengeRow | null>;
    findUnique(input: { where: { id: string } }): Promise<ChallengeRow | null>;
    create(input: { data: Record<string, unknown> }): Promise<ChallengeRow>;
    updateMany(input: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
};

type ChallengeDb = { $transaction<T>(callback: (tx: ChallengeTx) => Promise<T>): Promise<T> };

export interface WorkerValidationChallengeDependencies {
  db: ChallengeDb;
  createId: (parts: readonly string[]) => string;
}

const DEFAULT_DEPENDENCIES: WorkerValidationChallengeDependencies = {
  db: prisma as unknown as ChallengeDb,
  createId: derivedPersistenceId,
};

export type WorkerValidationChallenge = {
  id: string;
  projectId: string;
  poolId: string;
  sessionId: string;
  environmentConfigurationVersion: number;
  status: ChallengeStatus;
  expiresAt: Date;
  acknowledgedAt: Date | null;
};

export type WorkerValidationAssignment = {
  id: string;
  kind: "worker_validation";
  sideEffect: false;
};

function validationError(message: string): Error & { code: "validation_failed" } {
  return Object.assign(new Error(message), { code: "validation_failed" as const });
}

function md5(value: string, field: string): string {
  if (!/^[a-f0-9]{32}$/u.test(value)) throw validationError(`${field} is invalid`);
  return value;
}

function projectId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 64) throw validationError("projectId is invalid");
  return normalized;
}

function validDate(value: Date, field: string): Date {
  if (!Number.isFinite(value.getTime())) throw validationError(`${field} is invalid`);
  return value;
}

function serialize(row: ChallengeRow): WorkerValidationChallenge {
  return {
    id: row.id,
    projectId: row.projectId,
    poolId: row.workerPoolId,
    sessionId: row.workerPoolSessionId,
    environmentConfigurationVersion: row.environmentConfigurationVersion,
    status: row.status,
    expiresAt: row.expiresAt,
    acknowledgedAt: row.acknowledgedAt,
  };
}

export async function createOrReuseWorkerValidationChallenge(input: {
  projectId: string;
  poolId: string;
  sessionId: string;
  environmentConfigurationVersion: number;
  now: Date;
  expiresAt: Date;
}, dependencies: WorkerValidationChallengeDependencies = DEFAULT_DEPENDENCIES): Promise<WorkerValidationChallenge> {
  const normalizedProjectId = projectId(input.projectId);
  const poolId = md5(input.poolId, "poolId");
  const sessionId = md5(input.sessionId, "sessionId");
  const now = validDate(input.now, "now");
  const expiresAt = validDate(input.expiresAt, "expiresAt");
  if (!Number.isInteger(input.environmentConfigurationVersion) || input.environmentConfigurationVersion < 1 || expiresAt <= now) {
    throw validationError("Worker validation challenge configuration is invalid");
  }
  return dependencies.db.$transaction(async (tx) => {
    const existing = await tx.workerValidationChallenge.findFirst({
      where: {
        projectId: normalizedProjectId,
        workerPoolId: poolId,
        workerPoolSessionId: sessionId,
        environmentConfigurationVersion: input.environmentConfigurationVersion,
        expiresAt: { gt: now },
      },
    });
    if (existing) return serialize(existing);
    const id = dependencies.createId(["worker-validation-challenge", normalizedProjectId, poolId, sessionId, String(input.environmentConfigurationVersion), now.toISOString()]);
    md5(id, "challengeId");
    const row = await tx.workerValidationChallenge.create({
      data: {
        id,
        projectId: normalizedProjectId,
        workerPoolId: poolId,
        workerPoolSessionId: sessionId,
        environmentConfigurationVersion: input.environmentConfigurationVersion,
        status: "pending",
        claimedAt: null,
        acknowledgedAt: null,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      },
    });
    return serialize(row);
  });
}

export async function claimWorkerValidationChallenge(input: {
  poolId: string;
  sessionId: string;
  now: Date;
}, dependencies: WorkerValidationChallengeDependencies = DEFAULT_DEPENDENCIES): Promise<WorkerValidationAssignment | null> {
  const poolId = md5(input.poolId, "poolId");
  const sessionId = md5(input.sessionId, "sessionId");
  const now = validDate(input.now, "now");
  return dependencies.db.$transaction(async (tx) => {
    const row = await tx.workerValidationChallenge.findFirst({
      where: { workerPoolId: poolId, workerPoolSessionId: sessionId, status: "pending", expiresAt: { gt: now } },
    });
    if (!row) return null;
    const claimed = await tx.workerValidationChallenge.updateMany({
      where: { id: row.id, status: "pending" },
      data: { status: "claimed", claimedAt: now, updatedAt: now },
    });
    if (claimed.count !== 1) return null;
    return { id: row.id, kind: "worker_validation", sideEffect: false };
  });
}

export async function acknowledgeWorkerValidationChallenge(input: {
  challengeId: string;
  poolId: string;
  sessionId: string;
  now: Date;
}, dependencies: WorkerValidationChallengeDependencies = DEFAULT_DEPENDENCIES): Promise<{ completed: boolean; sideEffect: false }> {
  const challengeId = md5(input.challengeId, "challengeId");
  const poolId = md5(input.poolId, "poolId");
  const sessionId = md5(input.sessionId, "sessionId");
  const now = validDate(input.now, "now");
  return dependencies.db.$transaction(async (tx) => {
    const row = await tx.workerValidationChallenge.findUnique({ where: { id: challengeId } });
    if (!row || row.workerPoolId !== poolId || row.workerPoolSessionId !== sessionId || row.expiresAt <= now) {
      throw validationError("Worker validation challenge is unavailable");
    }
    if (row.status === "completed") return { completed: true, sideEffect: false };
    const completed = await tx.workerValidationChallenge.updateMany({
      where: { id: row.id, status: "claimed" },
      data: { status: "completed", acknowledgedAt: now, updatedAt: now },
    });
    if (completed.count !== 1) throw validationError("Worker validation challenge is unavailable");
    return { completed: true, sideEffect: false };
  });
}

export async function readWorkerValidationChallenge(input: {
  challengeId: string;
}, dependencies: WorkerValidationChallengeDependencies = DEFAULT_DEPENDENCIES): Promise<WorkerValidationChallenge | null> {
  const challengeId = md5(input.challengeId, "challengeId");
  return dependencies.db.$transaction(async (tx) => {
    const row = await tx.workerValidationChallenge.findUnique({ where: { id: challengeId } });
    return row ? serialize(row) : null;
  });
}
