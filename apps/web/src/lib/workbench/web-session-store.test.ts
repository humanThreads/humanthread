import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createWebSession,
  hashWebSessionToken,
  listActiveWebSessions,
  resolveActiveWebSession,
  revokeOtherWebSessions,
  revokeWebSession,
} from "./web-session-store";

const now = new Date("2026-08-12T00:00:00.000Z");
const future = new Date("2026-09-01T00:00:00.000Z");
const past = new Date("2026-08-11T00:00:00.000Z");

function activeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "a".repeat(32),
    userId: "user_1",
    deviceName: "Mac",
    browserName: "Chrome",
    operatingSystem: "macOS",
    createdAt: past,
    lastSeenAt: new Date("2026-08-11T23:50:00.000Z"),
    expiresAt: future,
    status: "active",
    revokedAt: null,
    user: { email: "owner@example.com", status: "active" },
    ...overrides,
  };
}

describe("web session store", () => {
  it("persists only the token hash and returns the raw token once", async () => {
    const create = vi.fn().mockImplementation(({ data }) => ({
      ...data,
      createdAt: now,
    }));
    const token = "raw-secret-token";

    const result = await createWebSession({
      userId: "user_1",
      now,
      request: new Request("http://localhost:3000/login", {
        headers: {
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0",
          "x-forwarded-for": "203.0.113.8, 10.0.0.2",
        },
      }),
      generateToken: () => token,
      db: { webSession: { create } },
    });

    const createInput = create.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;
    expect(createInput).toBeDefined();
    const persisted = createInput?.data ?? {};
    expect(result.token).toBe(token);
    expect(persisted.tokenHash).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
    expect(JSON.stringify(persisted)).not.toContain(token);
    expect(persisted.id).toMatch(/^[a-f0-9]{32}$/u);
    expect(persisted.expiresAt).toEqual(new Date("2026-09-11T00:00:00.000Z"));
    expect(persisted.ipAddress).toBe("203.0.113.8");
    expect(result.session).toMatchObject({
      userId: "user_1",
      browserName: "Chrome",
      operatingSystem: "macOS",
    });
  });

  it("hashes tokens without exposing them", () => {
    expect(hashWebSessionToken("token")).toBe(
      "3c469e9d6c5875d37a43f353d4f88e61fcf812c66eee3457465a40b0da4153e0",
    );
  });

  it.each([
    ["revoked", { status: "revoked", revokedAt: now }],
    ["expired", { expiresAt: past }],
    ["disabled user", { user: { email: "owner@example.com", status: "disabled" } }],
  ])("rejects %s sessions", async (_label, overrides) => {
    const findUnique = vi.fn().mockResolvedValue(activeRow(overrides));
    const updateMany = vi.fn();

    await expect(resolveActiveWebSession({
      token: "token",
      db: { webSession: { findUnique, updateMany } },
      now,
    })).resolves.toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("resolves an active actor and throttles last-seen writes to five minutes", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue(activeRow({
      lastSeenAt: new Date("2026-08-11T23:57:00.000Z"),
    }));

    await expect(resolveActiveWebSession({
      token: "token",
      db: { webSession: { findUnique, updateMany } },
      now,
    })).resolves.toEqual({
      userId: "user_1",
      webSessionId: "a".repeat(32),
      email: "owner@example.com",
    });
    expect(updateMany).not.toHaveBeenCalled();

    findUnique.mockResolvedValueOnce(activeRow());
    await resolveActiveWebSession({
      token: "token",
      db: { webSession: { findUnique, updateMany } },
      now,
    });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "a".repeat(32) }),
      data: { lastSeenAt: now },
    }));
  });

  it("lists only active unexpired sessions without private metadata", async () => {
    const findMany = vi.fn().mockResolvedValue([activeRow()]);
    await expect(listActiveWebSessions({
      userId: "user_1",
      now,
      db: { webSession: { findMany } },
    })).resolves.toEqual([{
      id: "a".repeat(32),
      deviceName: "Mac",
      browserName: "Chrome",
      operatingSystem: "macOS",
      createdAt: past,
      lastSeenAt: new Date("2026-08-11T23:50:00.000Z"),
      expiresAt: future,
    }]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: "user_1", status: "active" }),
    }));
  });

  it("scopes direct and password-change revocation to the authenticated user", async () => {
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 2 });
    const db = { webSession: { updateMany } };

    await revokeWebSession({
      userId: "user_1",
      targetSessionId: "b".repeat(32),
      reason: "remote_logout",
      now,
      db,
    });
    await expect(revokeOtherWebSessions({
      userId: "user_1",
      currentSessionId: "a".repeat(32),
      reason: "password_changed",
      now,
      db,
    })).resolves.toBe(2);

    const directRevoke = updateMany.mock.calls[0]?.[0] as
      | { where: Record<string, unknown> }
      | undefined;
    const passwordRevoke = updateMany.mock.calls[1]?.[0] as
      | { where: Record<string, unknown> }
      | undefined;
    expect(directRevoke?.where).toMatchObject({
      id: "b".repeat(32),
      userId: "user_1",
      status: "active",
      revokedAt: null,
    });
    expect(passwordRevoke?.where).toMatchObject({
      userId: "user_1",
      id: { not: "a".repeat(32) },
      status: "active",
      revokedAt: null,
    });
  });
});
