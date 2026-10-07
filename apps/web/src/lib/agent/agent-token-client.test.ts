import { describe, expect, it, vi } from "vitest";
import { requestAgentToken } from "./agent-token-client";

describe("requestAgentToken", () => {
  it("posts the trimmed user id and returns the plaintext token", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        userId: "user_owner",
        token: "ht_local_token_123",
      }),
    });

    const result = await requestAgentToken("  user_owner  ", {
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith("/api/agent/token", {
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
      token: "ht_local_token_123",
    });
  });

  it("rejects a blank user id before calling the API", async () => {
    const fetcher = vi.fn();

    await expect(
      requestAgentToken("   ", {
        fetcher,
      }),
    ).rejects.toThrow("User ID is required");

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces API error messages", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        ok: false,
        error: "Agent token rotation failed",
      }),
    });

    await expect(
      requestAgentToken("user_owner", {
        fetcher,
      }),
    ).rejects.toThrow("Agent token rotation failed");
  });
});
