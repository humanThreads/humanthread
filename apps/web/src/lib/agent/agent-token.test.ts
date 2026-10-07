import { describe, expect, it, vi } from "vitest";
import { hashAgentToken } from "./agent-auth";
import { rotateAgentToken } from "./agent-token";

describe("rotateAgentToken", () => {
  it("generates a new plaintext token and persists only the hash", async () => {
    const updateUserTokenHash = vi.fn().mockResolvedValue(undefined);

    const result = await rotateAgentToken(
      {
        userId: "user_owner",
      },
      {
        createToken: () => "ht_local_user_owner_token",
        updateUserTokenHash,
      },
    );

    expect(result).toEqual({
      userId: "user_owner",
      token: "ht_local_user_owner_token",
    });
    expect(updateUserTokenHash).toHaveBeenCalledWith({
      userId: "user_owner",
      tokenHash: hashAgentToken("ht_local_user_owner_token"),
    });
  });
});
