import { beforeEach, describe, expect, it, vi } from "vitest";

import { issueDesktopWebHandoff } from "../../../../lib/desktop/desktop-web-handoff";
import { resolveWorkbenchApiActor } from "../../../../lib/workbench/workbench-api-session";
import { OPTIONS, POST } from "./route";

vi.mock("../../../../lib/desktop/desktop-web-handoff", () => ({
  issueDesktopWebHandoff: vi.fn(),
}));
vi.mock("../../../../lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn(),
}));

const url = "http://localhost:3000/api/desktop/web-handoff";

function request(body: unknown, origin = "tauri://localhost") {
  return new Request(url, {
    method: "POST",
    headers: {
      authorization: "Bearer v1.desktop-access-token.signature",
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/desktop/web-handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({
      userId: "user_1",
      authKind: "desktop_token",
      sessionId: "desktop_session_1",
    });
    vi.mocked(issueDesktopWebHandoff).mockResolvedValue({
      code: "handoff_code_1",
      targetPath: "/settings/companies",
      expiresAt: new Date("2026-07-27T08:01:00.000Z"),
    });
  });

  it("issues a same-deployment consume URL for an authenticated desktop session", async () => {
    const response = await POST(request({ targetPath: "/settings/companies" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(issueDesktopWebHandoff).toHaveBeenCalledWith({
      userId: "user_1",
      sessionId: "desktop_session_1",
      targetPath: "/settings/companies",
    });
    expect(await response.json()).toEqual({
      ok: true,
      consumeUrl: "http://localhost:3000/api/desktop/web-handoff/consume?code=handoff_code_1",
      targetPath: "/settings/companies",
      expiresAt: "2026-07-27T08:01:00.000Z",
    });
  });

  it("rejects Cookie actors because only a revocable desktop session may issue a handoff", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValueOnce({
      userId: "user_1",
      authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    const response = await POST(request({ targetPath: "/settings/companies" }));

    expect(response.status).toBe(403);
    expect(issueDesktopWebHandoff).not.toHaveBeenCalled();
  });

  it("rejects malformed or extra request fields", async () => {
    const response = await POST(request({
      targetPath: "/settings/companies",
      accessToken: "must-not-cross-the-body",
    }));

    expect(response.status).toBe(400);
    expect(issueDesktopWebHandoff).not.toHaveBeenCalled();
  });

  it("supports desktop CORS preflight", () => {
    const response = OPTIONS(new Request(url, {
      method: "OPTIONS",
      headers: { origin: "tauri://localhost" },
    }));

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
  });
});
