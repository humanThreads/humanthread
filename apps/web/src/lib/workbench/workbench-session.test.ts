import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWorkbenchSession } from "./workbench-session";
import { WEB_SESSION_COOKIE } from "./web-session-cookie";
import { resolveActiveWebSession } from "./web-session-store";

vi.mock("./web-session-store", () => ({ resolveActiveWebSession: vi.fn() }));

describe("resolveWorkbenchSession", () => {
  beforeEach(() => vi.mocked(resolveActiveWebSession).mockReset());

  it("resolves identity only from a database-backed Web session", async () => {
    vi.mocked(resolveActiveWebSession).mockResolvedValue({
      userId: "user_owner",
      webSessionId: "a".repeat(32),
      email: "owner@example.com",
    });
    const getWorkbenchContext = vi.fn().mockResolvedValue({
      teamId: "team_1",
      userId: "user_owner",
      projectId: "project_1",
      matterTypeId: "matter_dev",
    });

    const result = await resolveWorkbenchSession({
      getWorkbenchContext,
      getCookieValue: (name) => name === WEB_SESSION_COOKIE ? "opaque-token" : undefined,
    });

    expect(resolveActiveWebSession).toHaveBeenCalledWith({ token: "opaque-token" });
    expect(getWorkbenchContext).toHaveBeenCalledWith({ selectedUserId: "user_owner" });
    expect(result).toEqual({
      loginEmail: "owner@example.com",
      selectedUserId: null,
      webSessionId: "a".repeat(32),
      context: {
        teamId: "team_1",
        userId: "user_owner",
        projectId: "project_1",
        matterTypeId: "matter_dev",
      },
    });
  });

  it.each([
    "ht_workbench_session=legacy-signed",
    "ht_workbench_login_email=owner@example.com",
    "ht_workbench_user_id=user_owner",
  ])("does not authenticate a legacy cookie: %s", async (cookie) => {
    const [name, value] = cookie.split("=");
    const getWorkbenchContext = vi.fn().mockResolvedValue({ userId: "default_user" });
    const result = await resolveWorkbenchSession({
      getWorkbenchContext,
      getCookieValue: (candidate) => candidate === name ? value : undefined,
    });

    expect(resolveActiveWebSession).not.toHaveBeenCalled();
    expect(result.loginEmail).toBeNull();
    expect(result.webSessionId).toBeNull();
  });

  it("does not authenticate an unknown or revoked Web token", async () => {
    vi.mocked(resolveActiveWebSession).mockResolvedValue(null);
    const getWorkbenchContext = vi.fn().mockResolvedValue({ userId: "default_user" });
    const result = await resolveWorkbenchSession({
      getWorkbenchContext,
      getCookieValue: (name) => name === WEB_SESSION_COOKIE ? "revoked" : undefined,
    });
    expect(result.loginEmail).toBeNull();
    expect(result.webSessionId).toBeNull();
  });

  it("fails closed when the session database lookup fails", async () => {
    let caught: unknown;
    try {
      await resolveWorkbenchSession({
        getWorkbenchContext: vi.fn(),
        resolveActiveWebSession: async () => {
          throw new Error("database unavailable");
        },
        getCookieValue: (name) => {
          if (name === WEB_SESSION_COOKIE) return "token";
          if (name === "ht_workbench_login_email") return "legacy@example.com";
          return undefined;
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toEqual(new Error("database unavailable"));
  });

  it("uses ht_web_session as the only authentication cookie", () => {
    expect(WEB_SESSION_COOKIE).toBe("ht_web_session");
  });
});
