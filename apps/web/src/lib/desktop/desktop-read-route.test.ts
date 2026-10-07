import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createDesktopReadResponse } from "./desktop-read-route";

describe("createDesktopReadResponse", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs safe context for an unexpected desktop read failure", async () => {
    const error = new Error("No workbench project found for team team_1");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const request = new Request(
      "https://humanthread.example/api/desktop/session/bootstrap?space=personal",
      { headers: { authorization: "Bearer secret-token" } },
    );

    const response = await createDesktopReadResponse(
      request,
      async () => {
        throw error;
      },
      z.object({ ok: z.literal(true), data: z.unknown() }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      code: "internal_error",
      error: "Desktop read request failed",
    });
    expect(log).toHaveBeenCalledWith("desktop_read_request_failed", {
      method: "GET",
      path: "/api/desktop/session/bootstrap",
      errorName: "Error",
      error: "No workbench project found for team team_1",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-token");
  });

  it("strips forward-compatible fields before validating a desktop response", async () => {
    const response = await createDesktopReadResponse(
      new Request("https://humanthread.example/api/desktop/agents"),
      async () => ({ value: "known", waitingReason: "worker_offline" }),
      z.object({
        ok: z.literal(true),
        data: z.object({ value: z.string() }).strict(),
      }).strict(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { value: "known" } });
  });
});
