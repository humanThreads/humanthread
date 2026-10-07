import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createWorkerChecklistMcpServer } from "@/lib/mcp/worker-checklist-mcp";
import {
  readLocalWorkerInterventionWithPrisma,
  requestLocalWorkerInterventionWithPrisma,
  writeLocalWorkerChecklistWithPrisma,
} from "@/lib/orchestration/worker-commands";
import {
  authenticateLoopAssignmentRequest,
  loopAssignmentIdSchema,
  loopAssignmentLeaseSchema,
} from "../../route-helpers";

export const runtime = "nodejs";

function jsonRpcError(status: number, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status });
}

function header<T>(request: Request, name: string, schema: { parse(value: string): T }): T {
  return schema.parse(request.headers.get(name)?.trim() ?? "");
}

export async function POST(request: Request, context: { params: Promise<{ agentRunId: string }> }) {
  try {
    const [params, userId, deviceId, workerId, leaseGeneration] = await Promise.all([
      context.params,
      Promise.resolve(header(request, "x-humanthread-loop-user", loopAssignmentIdSchema)),
      Promise.resolve(header(request, "x-humanthread-loop-device", loopAssignmentIdSchema)),
      Promise.resolve(header(request, "x-humanthread-loop-worker", loopAssignmentIdSchema)),
      Promise.resolve(header(request, "x-humanthread-loop-lease", loopAssignmentLeaseSchema)),
    ]);
    const actor = await authenticateLoopAssignmentRequest(request, { userId, deviceId });
    const server = createWorkerChecklistMcpServer({
      agentRunId: loopAssignmentIdSchema.parse(params.agentRunId),
      workerId,
      deviceId: actor.deviceId ?? deviceId,
      leaseGeneration,
      dependencies: {
        writeChecklist: async (input) => {
          if (!("workerId" in input)) throw new Error("Local checklist identity is invalid");
          return writeLocalWorkerChecklistWithPrisma({ ...input, now: new Date() });
        },
        requestIntervention: async (input) => {
          if (!("workerId" in input)) throw new Error("Local checklist identity is invalid");
          return requestLocalWorkerInterventionWithPrisma({ ...input, now: new Date() });
        },
        readIntervention: async (input) => {
          if (!("workerId" in input)) throw new Error("Local checklist identity is invalid");
          return readLocalWorkerInterventionWithPrisma({ ...input, now: new Date() });
        },
      },
    });
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    try {
      await server.connect(transport);
      return await transport.handleRequest(request);
    } finally {
      await transport.close();
      await server.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 512) : "Checklist MCP request failed";
    const isAuthenticationFailure = /authorization|agent user|agent device|device token/iu.test(message);
    return jsonRpcError(isAuthenticationFailure ? 401 : 400, isAuthenticationFailure ? -32001 : -32603, message);
  }
}

export function GET() {
  return jsonRpcError(405, -32000, "Method not allowed");
}
