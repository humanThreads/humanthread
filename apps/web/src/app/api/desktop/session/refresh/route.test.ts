import { beforeEach, describe, expect, it, vi } from "vitest";

import { refreshDesktopSession } from "../../../../../lib/desktop/desktop-login";
import { POST } from "./route";

vi.mock("../../../../../lib/desktop/desktop-login", () => ({
  refreshDesktopSession: vi.fn(),
}));

describe("POST /api/desktop/session/refresh", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rotates the refresh credential", async () => {
    vi.mocked(refreshDesktopSession).mockResolvedValue({
      accessToken: "v1.access_2.signature",
      accessExpiresAt: "2026-07-27T08:20:00.000Z",
      refreshToken: "ht_desktop_refresh_2",
      sessionId: "desktop_session_1",
    });
    const response = await POST(
      new Request("http://localhost:3000/api/desktop/session/refresh", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "tauri://localhost" },
        body: JSON.stringify({
          sessionId: "desktop_session_1",
          refreshToken: "ht_desktop_refresh_1",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        accessToken: "v1.access_2.signature",
        accessExpiresAt: "2026-07-27T08:20:00.000Z",
        refreshToken: "ht_desktop_refresh_2",
        sessionId: "desktop_session_1",
      },
    });
    expect(refreshDesktopSession).toHaveBeenCalledWith({
      sessionId: "desktop_session_1",
      refreshToken: "ht_desktop_refresh_1",
    });
  });

  it("returns 401 for an invalid refresh credential", async () => {
    vi.mocked(refreshDesktopSession).mockRejectedValue(
      new Error("Desktop refresh credential is invalid"),
    );
    const response = await POST(
      new Request("http://localhost:3000/api/desktop/session/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "desktop_session_1",
          refreshToken: "wrong",
        }),
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
