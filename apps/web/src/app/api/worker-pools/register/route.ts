import {
  authenticateWorkerPoolBootstrapToken,
  createWorkerPoolSession,
  WORKER_POOL_SESSION_DURATION_MS,
} from "@humanthread/db";
import { workerPoolRegistrationSchema } from "@humanthread/shared";

export async function POST(request: Request): Promise<Response> {
  try {
    const bootstrapToken = request.headers.get("x-worker-pool-token")?.trim();
    if (!bootstrapToken) {
      return errorResponse(401, "worker_pool_unauthorized", "Worker pool token is required");
    }
    const registration = workerPoolRegistrationSchema.parse(await request.json());
    const now = new Date();
    const pool = await authenticateWorkerPoolBootstrapToken({
      token: bootstrapToken,
      now,
    });
    if (registration.poolName !== undefined && registration.poolName !== pool.displayName) {
      return errorResponse(400, "worker_pool_configuration_required", "Worker pool name does not match the bootstrap token");
    }
    const session = await createWorkerPoolSession({
      poolId: pool.id,
      instanceId: registration.instanceId,
      ...(registration.poolName === undefined ? {} : { poolName: registration.poolName }),
      runtime: registration.runtime,
      ...(registration.taskGroupName === undefined ? {} : { taskGroupName: registration.taskGroupName }),
      capabilities: registration.capabilities,
      requestedConcurrency: registration.requestedConcurrency,
      now,
      expiresAt: new Date(now.getTime() + WORKER_POOL_SESSION_DURATION_MS),
    });
    return Response.json({
      poolId: pool.id,
      sessionId: session.sessionId,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt.toISOString(),
    });
  } catch (error) {
    const code = errorCode(error);
    return errorResponse(
      code === "worker_pool_unauthorized" ? 401 : 400,
      code ?? "validation_failed",
      error instanceof Error ? error.message : "Worker pool registration failed",
    );
  }
}

function errorCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : null;
}

function errorResponse(status: number, errorCode: string, message: string): Response {
  return Response.json({ errorCode, message }, { status });
}
