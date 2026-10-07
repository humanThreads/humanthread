import { z } from "zod";
import { authenticateWorkerPoolSession } from "@humanthread/db";
import { localRouteDecisionSchema, loopNodeResultSchema } from "../../../../../../../../../packages/shared/src/loop-engine";
import { completeLinuxWorkerAssignmentWithPrisma } from "@/lib/orchestration/worker-commands";

const resultIdentitySchema = z.object({
  poolId: z.string().regex(/^[a-f0-9]{32}$/u),
  leaseGeneration: z.number().int().positive(),
  commandId: z.string().trim().min(1).max(128),
  loopRunId: z.string().trim().min(1).max(128),
  loopNodeRunId: z.string().trim().min(1).max(128),
  loopNodeAttemptId: z.string().trim().min(1).max(128),
  attemptNo: z.number().int().positive(),
});

const resultSchema = z.union([
  resultIdentitySchema.extend({ result: loopNodeResultSchema }).strict(),
  resultIdentitySchema.extend({ result: loopNodeResultSchema, routeDecision: localRouteDecisionSchema }).strict(),
]);

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
      request.json().then((value) => resultSchema.parse(value)),
    ]);
    const now = new Date();
    const session = await authenticateWorkerPoolSession({ poolId: body.poolId, sessionToken, now });
    const result = await completeLinuxWorkerAssignmentWithPrisma({
      agentRunId: agentRunIdSchema.parse(agentRunId),
      sessionId: session.sessionId,
      leaseGeneration: body.leaseGeneration,
      commandId: body.commandId,
      loopRunId: body.loopRunId,
      loopNodeRunId: body.loopNodeRunId,
      loopNodeAttemptId: body.loopNodeAttemptId,
      attemptNo: body.attemptNo,
      result: body.result,
      ...("routeDecision" in body ? { routeDecision: body.routeDecision } : {}),
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
      error instanceof Error ? error.message : "Worker result failed",
    );
  }
}

function errorResponse(status: number, errorCode: string, message: string): Response {
  return Response.json({ ok: false, errorCode, message }, { status });
}
