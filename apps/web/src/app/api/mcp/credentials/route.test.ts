import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/mcp/mcp-auth", () => ({
  issueMcpCredential: vi.fn().mockResolvedValue({
    credentialId: "mcp_cred_1",
    userId: "user_owner",
    name: "Codex",
    token: "ht_mcp_token_123",
  }),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_owner" }),
}));

describe("POST /api/mcp/credentials", () => {
  it("creates an MCP credential only for the signed-in user", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/mcp/credentials", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          userId: "user_attacker",
          name: "Codex",
        }),
      }),
    );

    const body = (await response.json()) as {
      ok: boolean;
      credential: {
        credentialId: string;
        userId: string;
        name: string;
      };
      token: string;
    };

    expect(response.status).toBe(201);
    expect(body).toEqual({
      ok: true,
      credential: {
        credentialId: "mcp_cred_1",
        userId: "user_owner",
        name: "Codex",
      },
      token: "ht_mcp_token_123",
    });
    const { issueMcpCredential } = await import("@/lib/mcp/mcp-auth");
    expect(vi.mocked(issueMcpCredential)).toHaveBeenCalledWith({ userId: "user_owner", name: "Codex" });
  });

  it("returns 401 without a signed Workbench session", async () => {
    const { resolveWorkbenchApiActor } = await import("@/lib/workbench/workbench-api-session");
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValueOnce(new Error("Workbench API authentication required"));
    const response = await POST(new Request("http://localhost:3000/api/mcp/credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Codex" }),
    }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Workbench API authentication required" });
  });
});
