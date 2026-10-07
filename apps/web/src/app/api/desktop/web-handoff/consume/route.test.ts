import { beforeEach, describe, expect, it, vi } from "vitest";

import { consumeDesktopWebHandoff } from "../../../../../lib/desktop/desktop-web-handoff";
import { createWebSession } from "../../../../../lib/workbench/web-session-store";
import { GET } from "./route";

vi.mock("../../../../../lib/desktop/desktop-web-handoff", () => ({
  consumeDesktopWebHandoff: vi.fn(),
}));
vi.mock("../../../../../lib/workbench/web-session-store", () => ({
  createWebSession: vi.fn(),
}));

const consumeUrl = "https://ht.example.com/api/desktop/web-handoff/consume?code=handoff_code_1";

describe("GET /api/desktop/web-handoff/consume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(consumeDesktopWebHandoff).mockResolvedValue({
      id: "desktop_handoff_1",
      userId: "user_1",
      userEmail: "owner@example.com",
      sessionId: "desktop_session_1",
      codeHash: "a".repeat(64),
      targetPath: "/settings/companies",
      expiresAt: new Date("2026-07-27T08:01:00.000Z"),
      consumedAt: new Date("2026-07-27T08:00:10.000Z"),
      createdAt: new Date("2026-07-27T08:00:00.000Z"),
    });
    vi.mocked(createWebSession).mockResolvedValue({
      token: "opaque-web-session",
      session: {
        id: "a".repeat(32),
        userId: "user_1",
        deviceName: "macOS",
        browserName: "Chrome",
        operatingSystem: "macOS",
        createdAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: new Date("2026-08-26T08:00:10.000Z"),
      },
    });
  });

  it("atomically consumes the code, establishes HttpOnly Web session cookies and redirects", async () => {
    const response = await GET(new Request(consumeUrl));

    expect(consumeDesktopWebHandoff).toHaveBeenCalledWith("handoff_code_1");
    expect(createWebSession).toHaveBeenCalledWith({
      userId: "user_1",
      request: expect.any(Request),
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://ht.example.com/settings/companies");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const cookieHeader = response.headers.get("set-cookie") ?? "";
    expect(cookieHeader).toContain("ht_web_session=opaque-web-session");
    expect(cookieHeader).toContain("HttpOnly");
    expect(cookieHeader).toContain("SameSite=lax");
  });

  it("returns 400 without a code", async () => {
    const response = await GET(new Request(
      "https://ht.example.com/api/desktop/web-handoff/consume",
    ));

    expect(response.status).toBe(400);
    expect(consumeDesktopWebHandoff).not.toHaveBeenCalled();
  });

  it("rejects oversized codes before hashing or repository access", async () => {
    const response = await GET(new Request(
      `https://ht.example.com/api/desktop/web-handoff/consume?code=${"a".repeat(257)}`,
    ));

    expect(response.status).toBe(400);
    expect(consumeDesktopWebHandoff).not.toHaveBeenCalled();
  });

  it.each([
    "Desktop Web handoff has already been consumed",
    "Desktop Web handoff has expired",
  ])("returns 410 when the code can no longer be consumed: %s", async (message) => {
    vi.mocked(consumeDesktopWebHandoff).mockRejectedValueOnce(new Error(message));

    const response = await GET(new Request(consumeUrl));

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
