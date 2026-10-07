import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  authenticateMcpRequest,
  hashMcpToken,
  issueMcpCredential,
} from "./mcp-auth";

describe("MCP auth", () => {
  it("hashes MCP tokens with sha256", () => {
    expect(hashMcpToken("ht_mcp_token_123")).toBe(
      createHash("sha256").update("ht_mcp_token_123").digest("hex"),
    );
  });

  it("issues an MCP credential and persists only the token hash", async () => {
    const createCredential = vi.fn().mockResolvedValue({
      id: "mcp_cred_1",
      name: "Codex",
      userId: "user_owner",
    });

    const result = await issueMcpCredential(
      {
        userId: "user_owner",
        name: "Codex",
      },
      {
        createToken: () => "ht_mcp_token_123",
        createCredential,
      },
    );

    expect(result).toEqual({
      credentialId: "mcp_cred_1",
      userId: "user_owner",
      name: "Codex",
      token: "ht_mcp_token_123",
    });
    expect(createCredential).toHaveBeenCalledWith({
      userId: "user_owner",
      name: "Codex",
      tokenHash: hashMcpToken("ht_mcp_token_123"),
      status: "active",
    });
  });

  it("authenticates an active MCP token and updates the last used timestamp", async () => {
    const loadCredential = vi.fn().mockResolvedValue({
      id: "mcp_cred_1",
      userId: "user_owner",
      name: "Codex",
      status: "active",
      revokedAt: null,
      tokenHash: hashMcpToken("ht_mcp_token_123"),
      user: {
        id: "user_owner",
        status: "active",
      },
    });
    const touchCredential = vi.fn().mockResolvedValue(undefined);

    const result = await authenticateMcpRequest(
      {
        authorizationHeader: "Bearer ht_mcp_token_123",
      },
      {
        loadCredential,
        touchCredential,
      },
    );

    expect(result).toEqual({
      credentialId: "mcp_cred_1",
      userId: "user_owner",
      credentialName: "Codex",
      credentialTransportKey: hashMcpToken("ht_mcp_token_123"),
    });
    expect(touchCredential).toHaveBeenCalledWith({
      credentialId: "mcp_cred_1",
      now: expect.any(Date),
    });
  });

  it("rejects missing MCP tokens", async () => {
    await expect(
      authenticateMcpRequest(
        {
          authorizationHeader: null,
        },
        {
          loadCredential: vi.fn(),
          touchCredential: vi.fn(),
        },
      ),
    ).rejects.toThrow("Missing MCP authorization token");
  });

  it("rejects revoked MCP tokens", async () => {
    const loadCredential = vi.fn().mockResolvedValue({
      id: "mcp_cred_1",
      userId: "user_owner",
      name: "Codex",
      status: "revoked",
      revokedAt: new Date("2026-05-19T00:00:00.000Z"),
      tokenHash: hashMcpToken("ht_mcp_token_123"),
      user: {
        id: "user_owner",
        status: "active",
      },
    });

    await expect(
      authenticateMcpRequest(
        {
          authorizationHeader: "Bearer ht_mcp_token_123",
        },
        {
          loadCredential,
          touchCredential: vi.fn(),
        },
      ),
    ).rejects.toThrow("MCP credential is revoked");
  });
});
