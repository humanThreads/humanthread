import { beforeEach, describe, expect, it, vi } from "vitest";

import { revokeDesktopSession } from "../../../../../lib/desktop/desktop-session-store";
import { POST } from "./route";

vi.mock("../../../../../lib/desktop/desktop-session-store", () => ({
  revokeDesktopSession: vi.fn(),
}));

describe("POST /api/desktop/session/logout", () => {
  beforeEach(() => vi.clearAllMocks());

  it("revokes the session only with refresh proof", async () => {
    vi.mocked(revokeDesktopSession).mockResolvedValue({ id: "desktop_session_1" } as never);
    const response = await POST(
      new Request("http://localhost:3000/api/desktop/session/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "desktop_session_1",
          refreshToken: "ht_desktop_refresh_2",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { sessionId: "desktop_session_1" },
    });
    expect(revokeDesktopSession).toHaveBeenCalledWith({
      sessionId: "desktop_session_1",
      refreshToken: "ht_desktop_refresh_2",
    });
  });

  it("does not disclose whether an invalid session exists", async () => {
    vi.mocked(revokeDesktopSession).mockRejectedValue(
      new Error("Desktop refresh credential is invalid"),
    );
    const response = await POST(
      new Request("http://localhost:3000/api/desktop/session/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "desktop_session_1", refreshToken: "wrong" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      code: "authentication_required",
      error: "Desktop refresh credential is invalid",
    });
  });
});
