import { describe, expect, it, vi } from "vitest";
import { createWorkbenchLoginSession } from "./workbench-login-session";

describe("createWorkbenchLoginSession", () => {
  it("authenticates credentials and issues one database Web session", async () => {
    const cookieStore = { set: vi.fn() };
    const request = new Request("https://localhost:3000/login");
    const authenticateUser = vi.fn().mockResolvedValue({
      id: "user_owner",
      email: "alice@example.com",
    });
    const createSession = vi.fn().mockResolvedValue({
      token: "raw-session-token",
      session: { id: "a".repeat(32) },
    });

    const result = await createWorkbenchLoginSession({
      email: "  alice@example.com ",
      password: " correct-password ",
      request,
      cookieStore,
      authenticateUser,
      createSession,
    });

    expect(createSession).toHaveBeenCalledWith({ userId: "user_owner", request });
    expect(cookieStore.set).toHaveBeenCalledWith(
      "ht_web_session",
      "raw-session-token",
      expect.objectContaining({ httpOnly: true, secure: true, maxAge: 60 * 60 * 24 * 30 }),
    );
    for (const legacyName of ["ht_workbench_session", "ht_workbench_login_email", "ht_workbench_user_id"]) {
      expect(cookieStore.set).toHaveBeenCalledWith(
        legacyName,
        "",
        expect.objectContaining({ maxAge: 0 }),
      );
    }
    expect(result).toEqual({ email: "alice@example.com", webSessionId: "a".repeat(32) });
  });
});
