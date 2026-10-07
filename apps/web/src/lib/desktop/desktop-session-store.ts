import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { prisma } from "../../../../../packages/db/src/index";

export interface DesktopSessionRecord {
  id: string;
  userId: string;
  installationId: string;
  deviceId: string;
  refreshTokenHash: string;
  status: string;
  expiresAt: Date;
  lastUsedAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

interface DesktopSessionConditionalWrite {
  sessionId: string;
  expectedVersion: number;
  now: Date;
}

export interface DesktopSessionRepository {
  create(input: DesktopSessionRecord): Promise<DesktopSessionRecord>;
  findById(sessionId: string): Promise<DesktopSessionRecord | null>;
  rotate(
    input: DesktopSessionConditionalWrite & { refreshTokenHash: string },
  ): Promise<DesktopSessionRecord | null>;
  revoke(input: DesktopSessionConditionalWrite): Promise<DesktopSessionRecord | null>;
}

function defaultDesktopSessionRepository(): DesktopSessionRepository {
  return {
    create: (input) => prisma.desktopSession.create({ data: input }),
    findById: (sessionId) => prisma.desktopSession.findUnique({ where: { id: sessionId } }),
    rotate: async ({ sessionId, expectedVersion, refreshTokenHash, now }) => {
      const result = await prisma.desktopSession.updateMany({
        where: {
          id: sessionId,
          version: expectedVersion,
          status: "active",
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          refreshTokenHash,
          lastUsedAt: now,
          version: { increment: 1 },
        },
      });
      return result.count === 1
        ? prisma.desktopSession.findUnique({ where: { id: sessionId } })
        : null;
    },
    revoke: async ({ sessionId, expectedVersion, now }) => {
      const result = await prisma.desktopSession.updateMany({
        where: {
          id: sessionId,
          version: expectedVersion,
          status: "active",
          revokedAt: null,
        },
        data: {
          status: "revoked",
          revokedAt: now,
          version: { increment: 1 },
        },
      });
      return result.count === 1
        ? prisma.desktopSession.findUnique({ where: { id: sessionId } })
        : null;
    },
  };
}

export function hashDesktopRefreshToken(refreshToken: string): string {
  return createHash("sha256").update(refreshToken).digest("hex");
}

function hasMatchingRefreshCredential(rawToken: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashDesktopRefreshToken(rawToken), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function loadSessionForCredential(
  input: { sessionId: string; refreshToken: string },
  repository: DesktopSessionRepository,
): Promise<DesktopSessionRecord> {
  const record = await repository.findById(input.sessionId);
  if (!record || !hasMatchingRefreshCredential(input.refreshToken, record.refreshTokenHash)) {
    throw new Error("Desktop refresh credential is invalid");
  }
  if (record.status !== "active" || record.revokedAt) {
    throw new Error("Desktop session is unavailable");
  }
  return record;
}

export async function createDesktopSessionRecord(
  input: {
    userId: string;
    installationId: string;
    deviceId: string;
    refreshToken: string;
    expiresAt: Date;
    now?: Date;
    createId?: () => string;
  },
  repository: DesktopSessionRepository = defaultDesktopSessionRepository(),
): Promise<DesktopSessionRecord> {
  const now = input.now ?? new Date();
  return repository.create({
    id: input.createId?.() ?? `desktop_session_${randomUUID()}`,
    userId: input.userId,
    installationId: input.installationId,
    deviceId: input.deviceId,
    refreshTokenHash: hashDesktopRefreshToken(input.refreshToken),
    status: "active",
    expiresAt: input.expiresAt,
    lastUsedAt: now,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
}

export async function rotateDesktopRefreshToken(
  input: {
    sessionId: string;
    currentRefreshToken: string;
    nextRefreshToken: string;
    now?: Date;
  },
  repository: DesktopSessionRepository = defaultDesktopSessionRepository(),
): Promise<DesktopSessionRecord> {
  const now = input.now ?? new Date();
  const current = await loadSessionForCredential(
    { sessionId: input.sessionId, refreshToken: input.currentRefreshToken },
    repository,
  );
  if (current.expiresAt <= now) {
    throw new Error("Desktop session has expired");
  }

  const rotated = await repository.rotate({
    sessionId: current.id,
    expectedVersion: current.version,
    refreshTokenHash: hashDesktopRefreshToken(input.nextRefreshToken),
    now,
  });
  if (!rotated) {
    throw new Error("Desktop refresh credential has already been used");
  }
  return rotated;
}

export async function revokeDesktopSession(
  input: { sessionId: string; refreshToken: string; now?: Date },
  repository: DesktopSessionRepository = defaultDesktopSessionRepository(),
): Promise<DesktopSessionRecord> {
  const now = input.now ?? new Date();
  const current = await loadSessionForCredential(input, repository);
  const revoked = await repository.revoke({
    sessionId: current.id,
    expectedVersion: current.version,
    now,
  });
  if (!revoked) {
    throw new Error("Desktop session could not be revoked");
  }
  return revoked;
}
