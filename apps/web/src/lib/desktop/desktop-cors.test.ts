import { afterEach, describe, expect, it, vi } from "vitest";

import { createDesktopSessionErrorResponse } from "./desktop-cors";

describe("createDesktopSessionErrorResponse", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs safe context for an unexpected desktop session failure", async () => {
    const error = new Error("Desktop session secret is not configured");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const request = new Request("https://humanthread.example/api/desktop/session", {
      method: "POST",
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ password: "secret-password" }),
    });

    const response = createDesktopSessionErrorResponse(request, ["POST"], error);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      code: "internal_error",
      error: "Desktop session request failed",
    });
    expect(log).toHaveBeenCalledWith("desktop_session_request_failed", {
      method: "POST",
      path: "/api/desktop/session",
      errorName: "Error",
      error: "Desktop session secret is not configured",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-token");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-password");
  });
});
