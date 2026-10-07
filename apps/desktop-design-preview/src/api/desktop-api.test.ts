import { desktopBootstrapResponseSchema } from "@humanthread/workbench-client";
import { describe, expect, it, vi } from "vitest";

import { createDesktopApiClient, type DesktopTokenSet } from "./desktop-api";

const tokens: DesktopTokenSet = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  sessionId: "session-1",
  accessExpiresAt: "2099-01-01T00:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createDesktopApiClient", () => {
  it("adds the in-memory bearer token and parses the official response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      data: {
        spaces: [{ key: "personal", kind: "personal", name: "个人空间" }],
        activeSpaceKey: "personal",
        currentTask: null,
        capabilities: { nativeExecution: false },
      },
    }));
    const api = createDesktopApiClient({
      fetch: fetchMock,
      getTokens: () => tokens,
      refreshTokens: vi.fn(),
    });

    const response = await api.request(
      "/api/desktop/session/bootstrap?space=personal",
      desktopBootstrapResponseSchema,
    );

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer access-token");
    expect(response.data.activeSpaceKey).toBe("personal");
  });

  it("refreshes once and replays a request after a 401", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: false,
        code: "authentication_required",
        error: "Desktop session has expired",
      }, 401))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        data: {
          spaces: [{ key: "personal", kind: "personal", name: "个人空间" }],
          activeSpaceKey: "personal",
          currentTask: null,
          capabilities: { nativeExecution: false },
        },
      }));
    const refreshTokens = vi.fn().mockResolvedValue({
      ...tokens,
      accessToken: "refreshed-access",
      refreshToken: "refreshed-refresh",
    });
    const api = createDesktopApiClient({
      fetch: fetchMock,
      getTokens: () => tokens,
      refreshTokens,
    });

    await api.request("/api/desktop/session/bootstrap?space=personal", desktopBootstrapResponseSchema);

    expect(refreshTokens).toHaveBeenCalledTimes(1);
    const replayHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(replayHeaders.get("authorization")).toBe("Bearer refreshed-access");
  });
});
