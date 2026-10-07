import { z } from "zod";
import { authenticateWorkerPoolSession } from "@humanthread/db";
import { loopAgentEventSchema } from "../../../../../../../../../packages/shared/src/loop-engine";
import { appendLinuxWorkerAssignmentEventsWithPrisma } from "@/lib/orchestration/worker-commands";

const eventsSchema = z.object({
  poolId: z.string().regex(/^[a-f0-9]{32}$/u),
  leaseGeneration: z.number().int().positive(),
  commandId: z.string().trim().min(1).max(128),
  loopNodeAttemptId: z.string().trim().min(1).max(128),
  events: z.array(loopAgentEventSchema).min(1).max(100),
}).strict();

const agentRunIdSchema = z.string().trim().min(1).max(128);

export async function POST(
  request: Request,
  context: { params: Promise<{ agentRunId: string }> },
): Promise<Response> {
  try {
    const sessionToken = request.headers.get("x-worker-pool-session")?.trim();
    if (!sessionToken) return errorResponse(401, "worker_pool_unauthorized", "Worker pool session is required");
    const [{ agentRunId }, body] = await Promise.all([
      context.params,
      request.json().then((value) => eventsSchema.parse(value)),
    ]);
    const now = new Date();
    const session = await authenticateWorkerPoolSession({ poolId: body.poolId, sessionToken, now });
    const result = await appendLinuxWorkerAssignmentEventsWithPrisma({
      agentRunId: agentRunIdSchema.parse(agentRunId),
      sessionId: session.sessionId,
      leaseGeneration: body.leaseGeneration,
      commandId: body.commandId,
      loopNodeAttemptId: body.loopNodeAttemptId,
      events: body.events,
      now,
    });
    return Response.json({ ok: true, result });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "validation_failed";
    return errorResponse(
      code === "worker_pool_unauthorized" ? 401 : code === "stale_lease" ? 409 : 400,
      code,
      error instanceof Error ? error.message : "Worker event batch failed",
    );
  }
}

function errorResponse(status: number, errorCode: string, message: string): Response {
  return Response.json({ ok: false, errorCode, message }, { status });
}
