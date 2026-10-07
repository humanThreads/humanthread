import { z } from "zod";
import { authenticateWorkerPoolSession, prisma } from "@humanthread/db";

const bodySchema = z.object({
  poolId: z.string().regex(/^[a-f0-9]{32}$/u),
}).strict();

const sessionIdSchema = z.string().regex(/^[a-f0-9]{32}$/u);

/**
 * Lets a Worker Pool ask whether one of its direct LiveSessions is still active.
 *
 * A Worker cannot learn that a session ended from the terminal itself, so
 * without this probe a TUI can outlive its session and hold the worker's only
 * concurrency slot indefinitely. The answer is deliberately narrow: any
 * transport failure is treated by the caller as "still active", so only this
 * explicit 404 ends a session.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  try {
    const sessionToken = request.headers.get("x-worker-pool-session")?.trim();
    if (!sessionToken) return errorResponse(401, "worker_pool_unauthorized", "Worker pool session is required");
    const [{ sessionId }, body] = await Promise.all([
      context.params,
      request.json().then((value) => bodySchema.parse(value)),
    ]);
    const now = new Date();
    const session = await authenticateWorkerPoolSession({ poolId: body.poolId, sessionToken, now });

    const live = await prisma.liveSession.findFirst({
      where: {
        id: sessionIdSchema.parse(sessionId),
        targetWorkerPoolId: session.workerPoolId,
        targetType: "worker_pool",
        kind: "worker",
        status: { in: ["starting", "running", "detached"] },
        // An expired session counts as gone: the worker must release its slot.
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (!live) return errorResponse(404, "live_session_not_found", "Live session is no longer active");

    return Response.json({ ok: true, result: { active: true } });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "validation_failed";
    return errorResponse(400, code, error instanceof Error ? error.message : "Live session probe failed");
  }
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, errorCode: code, message }, { status });
}
