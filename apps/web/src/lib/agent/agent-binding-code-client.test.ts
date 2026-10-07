import { describe, expect, it, vi } from "vitest";
import { requestAgentBindingCode } from "./agent-binding-code-client";

describe("requestAgentBindingCode", () => {
  it("posts the trimmed user id and returns a short-lived binding code", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        userId: "user_owner",
        teamId: "team_1",
        code: "signed-binding-code",
        expiresAt: "2026-05-20T00:10:00.000Z",
      }),
    });

    const result = await requestAgentBindingCode("  user_owner  ", {
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith("/api/agent/binding-code", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        userId: "user_owner",
      }),
    });
    expect(result).toEqual({
      userId: "user_owner",
      teamId: "team_1",
      code: "signed-binding-code",
      expiresAt: "2026-05-20T00:10:00.000Z",
    });
  });

  it("rejects a blank user id before calling the API", async () => {
    const fetcher = vi.fn();

    await expect(
      requestAgentBindingCode("   ", {
        fetcher,
      }),
    ).rejects.toThrow("User ID is required");

    expect(fetcher).not.toHaveBeenCalled();
  });
});
