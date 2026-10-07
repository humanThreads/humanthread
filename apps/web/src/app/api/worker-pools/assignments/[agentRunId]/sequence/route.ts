import { z } from "zod";
import { authenticateWorkerPoolSession } from "@humanthread/db";
import { readLinuxWorkerAssignmentSequenceWithPrisma } from "@/lib/orchestration/worker-commands";

const bodySchema = z.object({ poolId: z.string().regex(/^[a-f0-9]{32}$/u) }).strict();

export async function POST(request: Request, context: { params: Promise<{ agentRunId: string }> }) {
  try {
    const sessionToken = request.headers.get("x-worker-pool-session")?.trim();
    if (!sessionToken) return errorResponse(401, "worker_pool_unauthorized", "Worker pool session is required");
    const [{ agentRunId }, body] = await Promise.all([context.params, request.json().then((value) => bodySchema.parse(value))]);
    const now = new Date();
    const session = await authenticateWorkerPoolSession({ poolId: body.poolId, sessionToken, now });
    const result = await readLinuxWorkerAssignmentSequenceWithPrisma({ agentRunId, sessionId: session.sessionId, now });
    return Response.json({ ok: true, result });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "validation_failed";
    return errorResponse(code === "worker_pool_unauthorized" ? 401 : code === "stale_lease" ? 409 : 400, code, error instanceof Error ? error.message : "Worker sequence read failed");
  }
}

function errorResponse(status: number, errorCode: string, message: string) {
  return Response.json({ ok: false, errorCode, message }, { status });
}
