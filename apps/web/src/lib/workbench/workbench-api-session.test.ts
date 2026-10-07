import { describe, expect, it, vi } from "vitest";
import {
  resolveDesktopApiActor,
  resolveWorkbenchApiActor,
} from "./workbench-api-session";

const now = new Date("2026-07-27T08:00:00.000Z");

describe("desktop API actor", () => {
  it("revalidates the signed subject against an active database session", async () => {
    await expect(
      resolveDesktopApiActor("v1.access.signature", {
        now: () => now,
        verifyAccessToken: () => ({
          userId: "user_1",
          sessionId: "desktop_session_1",
          issuedAt: new Date("2026-07-27T07:55:00.000Z"),
          expiresAt: new Date("2026-07-27T08:10:00.000Z"),
        }),
        loadSession: async () => ({
          id: "desktop_session_1",
          userId: "user_1",
          status: "active",
          expiresAt: new Date("2026-08-26T08:00:00.000Z"),
          revokedAt: null,
          user: { status: "active" },
        }),
      }),
    ).resolves.toEqual({ userId: "user_1", sessionId: "desktop_session_1" });
  });

  it("rejects a session that belongs to another user", async () => {
    await expect(
      resolveDesktopApiActor("v1.access.signature", {
        now: () => now,
        verifyAccessToken: () => ({
          userId: "user_attacker",
          sessionId: "desktop_session_1",
          issuedAt: new Date("2026-07-27T07:55:00.000Z"),
          expiresAt: new Date("2026-07-27T08:10:00.000Z"),
        }),
        loadSession: async () => ({
          id: "desktop_session_1",
          userId: "user_owner",
          status: "active",
          expiresAt: new Date("2026-08-26T08:00:00.000Z"),
          revokedAt: null,
          user: { status: "active" },
        }),
      }),
    ).rejects.toThrow("Desktop session is unavailable");
  });
});

describe("workbench API actor", () => {
  it("resolves the Web actor only from the database session cookie", async () => {
    const resolveWorkbenchSession = vi.fn().mockResolvedValue({
      loginEmail: "owner@example.com",
      webSessionId: "a".repeat(32),
      context: { userId: "user_owner" },
    });

    await expect(
      resolveWorkbenchApiActor(
        new Request("http://localhost/api/documents/doc_1?userId=user_attacker", {
          headers: { cookie: "ht_web_session=opaque" },
        }),
        { resolveWorkbenchSession },
      ),
    ).resolves.toEqual({
      userId: "user_owner",
      webSessionId: "a".repeat(32),
      authKind: "web_session",
    });
  });

  it.each([
    "ht_workbench_session=legacy-signed",
    "ht_workbench_login_email=owner@example.com",
    "ht_workbench_user_id=user_owner",
  ])("rejects legacy Web authentication: %s", async (cookie) => {
    const resolveWorkbenchSession = vi.fn();
    await expect(resolveWorkbenchApiActor(
      new Request("https://host/api/tasks", { headers: { cookie } }),
      { resolveWorkbenchSession },
    )).rejects.toThrow("Workbench API authentication required");
    expect(resolveWorkbenchSession).not.toHaveBeenCalled();
  });

  it("resolves a human actor from a desktop access token", async () => {
    const resolveDesktopActor = vi.fn().mockResolvedValue({
      userId: "user_1",
      sessionId: "desktop_session_1",
    });

    await expect(
      resolveWorkbenchApiActor(
        new Request("https://host/api/tasks", {
          headers: { authorization: "Bearer v1.desktop_access.signature" },
        }),
        {
          resolveDesktopActor,
          resolveWorkbenchSession: vi.fn(),
        },
      ),
    ).resolves.toEqual({
      userId: "user_1",
      authKind: "desktop_token",
      sessionId: "desktop_session_1",
    });
    expect(resolveDesktopActor).toHaveBeenCalledWith("v1.desktop_access.signature");
  });

  it("rejects an Agent device token at the human actor boundary", async () => {
    const resolveDesktopActor = vi.fn();

    await expect(
      resolveWorkbenchApiActor(
        new Request("https://host/api/tasks", {
          headers: { authorization: "Bearer ht_device_1" },
        }),
        {
          resolveDesktopActor,
          resolveWorkbenchSession: vi.fn(),
        },
      ),
    ).rejects.toThrow("Workbench API authentication required");
    expect(resolveDesktopActor).not.toHaveBeenCalled();
  });

  it("rejects requests without an authenticated session", async () => {
    const resolveWorkbenchSession = vi.fn().mockRejectedValue(new Error("database unavailable"));

    await expect(
      resolveWorkbenchApiActor(new Request("http://localhost/api/documents/doc_1"), {
        resolveWorkbenchSession,
      }),
    ).rejects.toThrow("Workbench API authentication required");
    expect(resolveWorkbenchSession).not.toHaveBeenCalled();
  });
});
