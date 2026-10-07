import { describe, expect, it, vi } from "vitest";

import { loginCliSession, refreshCliSession } from "./cli-session-api";

const sessionResponse = {
  ok: true,
  data: {
    accessToken: "v1.access.signature",
    accessExpiresAt: "2026-08-26T08:00:00.000Z",
    refreshToken: "ht_desktop_refresh_1",
    sessionId: "desktop_session_1",
    device: { id: "cli_device_1" },
  },
};

describe("CLI session API", () => {
  it("logs in through the desktop session endpoint without an Agent API token", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => sessionResponse });

    await expect(loginCliSession({
      baseUrl: "http://localhost:3000/",
      email: "person@example.com",
      password: "secret",
      installationId: "ht-cli-installation",
      deviceId: "cli_device_1",
      fetch,
    })).resolves.toMatchObject({ baseUrl: "http://localhost:3000", accessToken: "v1.access.signature" });
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/api/desktop/session", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"email":"person@example.com"'),
    }));
  });

  it("rotates the refresh credential before catalog reads", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      ok: true,
      data: {
        accessToken: "v1.access.signature",
        accessExpiresAt: "2026-08-26T08:00:00.000Z",
        refreshToken: "ht_desktop_refresh_1",
        sessionId: "desktop_session_1",
      },
    }) });
    await expect(refreshCliSession({
      baseUrl: "http://localhost:3000",
      installationId: "ht-cli-installation",
      deviceId: "cli_device_1",
      sessionId: "desktop_session_1",
      accessToken: "v1.access.old",
      accessExpiresAt: "2026-08-26T07:00:00.000Z",
      refreshToken: "ht_desktop_refresh_old",
    }, fetch)).resolves.toMatchObject({ accessToken: "v1.access.signature", refreshToken: "ht_desktop_refresh_1" });
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/api/desktop/session/refresh", expect.objectContaining({
      body: JSON.stringify({ sessionId: "desktop_session_1", refreshToken: "ht_desktop_refresh_old" }),
    }));
  });
});
