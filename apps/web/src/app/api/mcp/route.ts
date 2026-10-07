import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcpRequest } from "../../../lib/mcp/mcp-auth";
import { createHumanThreadMcpServer } from "../../../lib/mcp/mcp-server";

export const runtime = "nodejs";

/**
 * The stateless transport always answers with JSON, but the SDK transport still
 * requires clients to advertise `text/event-stream`. MCP clients disagree on
 * that header, so normalize it here rather than rejecting otherwise valid
 * clients with 406.
 */
function withJsonAcceptHeader(request: Request): Request {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream") && accept.includes("application/json")) {
    return request;
  }
  const headers = new Headers(request.headers);
  const jsonFirst = accept.trim() === "" ? "application/json" : `${accept}, application/json`;
  headers.set("accept", `${jsonFirst}, text/event-stream`);
  return new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
    duplex: "half",
  } as RequestInit);
}

function jsonRpcError(input: {
  status: number;
  code: number;
  message: string;
  headers?: HeadersInit;
}) {
  return Response.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: input.code,
        message: input.message,
      },
    },
    {
      status: input.status,
      ...(input.headers ? { headers: input.headers } : {}),
    },
  );
}

export async function POST(request: Request) {
  let actor;

  try {
    actor = await authenticateMcpRequest({
      authorizationHeader: request.headers.get("authorization"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP authorization failed";

    return jsonRpcError({
      status: 401,
      code: -32001,
      message,
      headers: { "www-authenticate": "Bearer" },
    });
  }

  const server = createHumanThreadMcpServer({ actorUserId: actor.userId, credentialTransportKey: actor.credentialTransportKey });
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(withJsonAcceptHeader(request));
  } catch {
    return jsonRpcError({
      status: 500,
      code: -32603,
      message: "Internal MCP server error",
    });
  } finally {
    await transport.close();
    await server.close();
  }
}

function methodNotAllowed() {
  return jsonRpcError({
    status: 405,
    code: -32000,
    message: "Method not allowed in stateless MCP mode",
    headers: { allow: "POST" },
  });
}

export function GET() {
  return methodNotAllowed();
}

export function DELETE() {
  return methodNotAllowed();
}
