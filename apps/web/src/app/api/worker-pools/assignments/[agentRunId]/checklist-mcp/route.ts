import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateWorkerPoolSession } from "@humanthread/db";
import { createWorkerChecklistMcpServer } from "@/lib/mcp/worker-checklist-mcp";
import {
  readLinuxWorkerInterventionWithPrisma,
  requestLinuxWorkerInterventionWithPrisma,
  writeLinuxWorkerChecklistWithPrisma,
} from "@/lib/orchestration/worker-commands";

export const runtime = "nodejs";

function jsonRpcError(status: number, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status });
}

export async function POST(request: Request, context: { params: Promise<{ agentRunId: string }> }) {
  const sessionToken = request.headers.get("x-worker-pool-session")?.trim();
  const poolId = request.headers.get("x-humanthread-worker-pool")?.trim();
  if (!sessionToken || !poolId || !/^[a-f0-9]{32}$/u.test(poolId)) {
    return jsonRpcError(401, -32001, "Worker pool session is required");
  }
  let session;
  try {
    session = await authenticateWorkerPoolSession({ poolId, sessionToken, now: new Date() });
  } catch (error) {
    return jsonRpcError(401, -32001, error instanceof Error ? error.message : "Worker pool session is invalid");
  }
  const { agentRunId } = await context.params;
  const server = createWorkerChecklistMcpServer({
    agentRunId,
    poolId: session.workerPoolId,
    sessionId: session.sessionId,
    dependencies: {
      writeChecklist: async (input) => {
        if (!("poolId" in input)) throw new Error("Worker pool checklist identity is invalid");
        return writeLinuxWorkerChecklistWithPrisma({ ...input, now: new Date() });
      },
      requestIntervention: async (input) => {
        if (!("poolId" in input)) throw new Error("Worker pool checklist identity is invalid");
        return requestLinuxWorkerInterventionWithPrisma({ ...input, now: new Date() });
      },
      readIntervention: async (input) => {
        if (!("poolId" in input)) throw new Error("Worker pool checklist identity is invalid");
        return readLinuxWorkerInterventionWithPrisma({ ...input, now: new Date() });
      },
    },
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (error) {
    return jsonRpcError(400, -32603, error instanceof Error ? error.message.slice(0, 512) : "Checklist MCP request failed");
  } finally {
    await transport.close();
    await server.close();
  }
}

export function GET() {
  return jsonRpcError(405, -32000, "Method not allowed");
}
