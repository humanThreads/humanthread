import { describe, expect, it } from "vitest";

import {
  createDesktopSessionRecord,
  type DesktopSessionRecord,
  type DesktopSessionRepository,
  revokeDesktopSession,
  rotateDesktopRefreshToken,
} from "./desktop-session-store";

function createMemoryRepository(): DesktopSessionRepository & {
  records: Map<string, DesktopSessionRecord>;
} {
  const records = new Map<string, DesktopSessionRecord>();

  return {
    records,
    async create(input) {
      const record: DesktopSessionRecord = { ...input };
      records.set(record.id, record);
      return record;
    },
    async findById(sessionId) {
      return records.get(sessionId) ?? null;
    },
    async rotate(input) {
      const current = records.get(input.sessionId);
      if (!current || current.version !== input.expectedVersion || current.status !== "active") {
        return null;
      }
      const next: DesktopSessionRecord = {
        ...current,
        refreshTokenHash: input.refreshTokenHash,
        lastUsedAt: input.now,
        updatedAt: input.now,
        version: current.version + 1,
      };
      records.set(next.id, next);
      return next;
    },
    async revoke(input) {
      const current = records.get(input.sessionId);
      if (!current || current.version !== input.expectedVersion || current.status !== "active") {
        return null;
      }
      const next: DesktopSessionRecord = {
        ...current,
        status: "revoked",
        revokedAt: input.now,
        updatedAt: input.now,
        version: current.version + 1,
      };
      records.set(next.id, next);
      return next;
    },
  };
}

const now = new Date("2026-07-27T08:00:00.000Z");
const expiresAt = new Date("2026-08-26T08:00:00.000Z");

async function createSession(repository: DesktopSessionRepository) {
  return createDesktopSessionRecord(
    {
      userId: "user_1",
      installationId: "install_1",
      deviceId: "device_1",
      refreshToken: "ht_desktop_refresh_1",
      expiresAt,
      now,
      createId: () => "desktop_session_1",
    },
    repository,
  );
}

describe("desktop session store", () => {
  it("persists only the refresh credential hash", async () => {
    const repository = createMemoryRepository();

    const created = await createSession(repository);

    expect(created).toMatchObject({
      id: "desktop_session_1",
      userId: "user_1",
      installationId: "install_1",
      deviceId: "device_1",
      status: "active",
      expiresAt,
      lastUsedAt: now,
      revokedAt: null,
      version: 1,
    });
    expect(created.refreshTokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(created).not.toHaveProperty("refreshToken");
  });

  it("rejects a wrong refresh credential without changing the record", async () => {
    const repository = createMemoryRepository();
    const created = await createSession(repository);

    await expect(
      rotateDesktopRefreshToken(
        {
          sessionId: created.id,
          currentRefreshToken: "wrong",
          nextRefreshToken: "ht_desktop_refresh_2",
          now: new Date("2026-07-27T08:05:00.000Z"),
        },
        repository,
      ),
    ).rejects.toThrow("Desktop refresh credential is invalid");
    expect(repository.records.get(created.id)).toEqual(created);
  });

  it("rotates once and revokes with the latest refresh credential", async () => {
    const repository = createMemoryRepository();
    const created = await createSession(repository);
    const rotatedAt = new Date("2026-07-27T08:05:00.000Z");
    const rotated = await rotateDesktopRefreshToken(
      {
        sessionId: created.id,
        currentRefreshToken: "ht_desktop_refresh_1",
        nextRefreshToken: "ht_desktop_refresh_2",
        now: rotatedAt,
      },
      repository,
    );

    expect(rotated.version).toBe(2);
    expect(rotated.refreshTokenHash).not.toBe(created.refreshTokenHash);
    await expect(
      rotateDesktopRefreshToken(
        {
          sessionId: created.id,
          currentRefreshToken: "ht_desktop_refresh_1",
          nextRefreshToken: "ht_desktop_refresh_3",
          now: rotatedAt,
        },
        repository,
      ),
    ).rejects.toThrow("Desktop refresh credential is invalid");

    const revokedAt = new Date("2026-07-27T08:10:00.000Z");
    const revoked = await revokeDesktopSession(
      {
        sessionId: created.id,
        refreshToken: "ht_desktop_refresh_2",
        now: revokedAt,
      },
      repository,
    );
    expect(revoked).toMatchObject({
      status: "revoked",
      revokedAt,
      version: 3,
    });
  });
});
