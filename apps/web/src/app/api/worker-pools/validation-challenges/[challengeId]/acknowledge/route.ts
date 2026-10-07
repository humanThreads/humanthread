import { z } from "zod";
import {
  acknowledgeWorkerValidationChallenge,
  authenticateWorkerPoolSession,
} from "@humanthread/db";

const requestSchema = z.object({ poolId: z.string().regex(/^[a-f0-9]{32}$/u) }).strict();
const challengeIdSchema = z.string().regex(/^[a-f0-9]{32}$/u);

export async function POST(request: Request, context: { params: Promise<{ challengeId: string }> }): Promise<Response> {
  try {
    const sessionToken = request.headers.get("x-worker-pool-session")?.trim();
    if (!sessionToken) return Response.json({ ok: false, errorCode: "worker_pool_unauthorized", message: "Worker pool session is required" }, { status: 401 });
    const [{ challengeId }, body] = await Promise.all([context.params, request.json()]);
    const parsedChallengeId = challengeIdSchema.parse(challengeId);
    const parsedBody = requestSchema.parse(body);
    const session = await authenticateWorkerPoolSession({
      poolId: parsedBody.poolId,
      sessionToken,
      now: new Date(),
    });
    const result = await acknowledgeWorkerValidationChallenge({
      challengeId: parsedChallengeId,
      poolId: session.workerPoolId,
      sessionId: session.sessionId,
      now: new Date(),
    });
    return Response.json({ ok: true, result });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "validation_failed";
    return Response.json({
      ok: false,
      errorCode: code,
      message: error instanceof Error ? error.message : "Worker validation acknowledgement failed",
    }, { status: code === "worker_pool_unauthorized" ? 401 : 400 });
  }
}
