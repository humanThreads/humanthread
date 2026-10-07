import { z } from "zod";
import { authenticateWorkerPoolSession } from "@humanthread/db";
import { heartbeatLinuxWorkerAssignmentWithPrisma } from "@/lib/orchestration/worker-commands";

const heartbeatSchema = z.object({
  poolId: z.string().regex(/^[a-f0-9]{32}$/u),
  leaseGeneration: z.number().int().positive(),
  commandId: z.string().trim().min(1).max(128),
}).strict();

const agentRunIdSchema = z.string().trim().min(1).max(128);
const LEASE_DURATION_MS = 60_000;

export async function POST(
  request: Request,
  context: { params: Promise<{ agentRunId: string }> },
): Promise<Response> {
  try {
    const sessionToken = request.headers.get("x-worker-pool-session")?.trim();
    if (!sessionToken) return errorResponse(401, "worker_pool_unauthorized", "Worker pool session is required");
    const [{ agentRunId }, body] = await Promise.all([
      context.params,
      request.json().then((value) => heartbeatSchema.parse(value)),
    ]);
    const now = new Date();
    const session = await authenticateWorkerPoolSession({ poolId: body.poolId, sessionToken, now });
    const result = await heartbeatLinuxWorkerAssignmentWithPrisma({
      agentRunId: agentRunIdSchema.parse(agentRunId),
      poolId: session.workerPoolId,
      sessionId: session.sessionId,
      leaseGeneration: body.leaseGeneration,
      commandId: body.commandId,
      now,
      leaseDurationMs: LEASE_DURATION_MS,
    });
    return Response.json({ ok: true, result });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "validation_failed";
    return errorResponse(
      code === "worker_pool_unauthorized" ? 401 : code === "stale_lease" ? 409 : 400,
      code,
      error instanceof Error ? error.message : "Worker heartbeat failed",
    );
  }
}

function errorResponse(status: number, errorCode: string, message: string): Response {
  return Response.json({ ok: false, errorCode, message }, { status });
}
