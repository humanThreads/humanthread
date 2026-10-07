import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("../../../../lib/agent/agent-token", () => ({
  rotateAgentToken: vi.fn().mockResolvedValue({
    userId: "user_owner",
    token: "ht_local_token_123",
  }),
}));

describe("POST /api/agent/token", () => {
  it("rotates and returns a new local agent token", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/agent/token", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          userId: "user_owner",
        }),
      }),
    );

    const body = (await response.json()) as {
      ok: boolean;
      userId: string;
      token: string;
    };

    expect(body).toEqual({
      ok: true,
      userId: "user_owner",
      token: "ht_local_token_123",
    });
  });

  it("returns 400 when userId is missing", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/agent/token", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );

    const body = (await response.json()) as {
      ok: boolean;
      error: string;
    };

    expect(response.status).toBe(400);
    expect(body).toEqual({
      ok: false,
      error: "User ID is required",
    });
  });
});
