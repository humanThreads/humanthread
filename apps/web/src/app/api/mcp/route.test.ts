import { describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "./route";
import { authenticateMcpRequest } from "../../../lib/mcp/mcp-auth";

vi.mock("../../../lib/mcp/mcp-auth", () => ({
  authenticateMcpRequest: vi.fn().mockResolvedValue({
    credentialId: "mcp_cred_1",
    userId: "user_owner",
    credentialName: "Codex",
  }),
}));

vi.mock("../../../lib/workbench/workbench-spaces", () => ({
  listWorkbenchSpaces: vi.fn().mockResolvedValue([
    {
      id: "space:personal:user_owner",
      type: "personal",
      name: "Personal",
      role: "owner",
      ownerUserId: "user_owner",
      companyId: null,
    },
  ]),
}));

function mcpRequest(body: unknown) {
  return new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      authorization: "Bearer ht_mcp_token_123",
    },
    body: JSON.stringify(body),
  });
}

describe("MCP Streamable HTTP route", () => {
  it("serves clients that only accept application/json", async () => {
    // MCP clients differ on whether they advertise text/event-stream. The
    // transport is stateless JSON, so a JSON-only client must still work
    // instead of being rejected with 406.
    for (const accept of ["application/json", ""]) {
      const response = await POST(new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: {
          ...(accept ? { accept } : {}),
          "content-type": "application/json",
          authorization: "Bearer ht_mcp_token_123",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list", params: {} }),
      }));

      expect(response.status, `accept=${JSON.stringify(accept)}`).toBe(200);
      const body = (await response.json()) as { result?: { tools?: unknown[] }; error?: unknown };
      expect(body.error).toBeUndefined();
      expect(Array.isArray(body.result?.tools)).toBe(true);
    }
  });

  it("initializes a standard MCP client", async () => {
    const response = await POST(
      mcpRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    );
    const body = (await response.json()) as {
      jsonrpc: string;
      id: number;
      result: { serverInfo: { name: string }; capabilities: { tools: unknown } };
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: { name: "humanthread" },
        capabilities: { tools: {} },
      },
    });
    expect(authenticateMcpRequest).toHaveBeenCalledWith({
      authorizationHeader: "Bearer ht_mcp_token_123",
    });
  });

  it("lists standard MCP tools", async () => {
    const response = await POST(
      mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    );
    const body = (await response.json()) as {
      result: { tools: Array<{ name: string }> };
    };

    expect(body.result.tools.map((tool) => tool.name)).toContain("list_spaces");
    expect(body.result.tools.map((tool) => tool.name)).toContain("create_document");
  });

  it("calls a standard MCP tool with the credential actor", async () => {
    const response = await POST(
      mcpRequest({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "list_spaces", arguments: {} },
      }),
    );
    const body = (await response.json()) as {
      result: { structuredContent: { spaces: Array<{ id: string }> } };
    };

    expect(body.result.structuredContent.spaces).toEqual([
      expect.objectContaining({ id: "space:personal:user_owner" }),
    ]);
  });

  it("returns a JSON-RPC authorization error when the bearer token is missing", async () => {
    vi.mocked(authenticateMcpRequest).mockRejectedValueOnce(
      new Error("Missing MCP authorization token"),
    );
    const response = await POST(
      new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: "Missing MCP authorization token" },
    });
  });

  it("returns a standard JSON-RPC error for malformed protocol requests", async () => {
    const response = await POST(mcpRequest({ tool: "list_project_documents" }));
    const body = (await response.json()) as { error: { code: number } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe(-32700);
  });

  it("returns protocol method errors for stateless GET and DELETE", async () => {
    expect(GET()).toMatchObject({ status: 405 });
    expect(DELETE()).toMatchObject({ status: 405 });
  });
});
