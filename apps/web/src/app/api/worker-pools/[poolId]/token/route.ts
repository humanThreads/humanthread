import { z } from "zod";
import {
  prisma,
  revealWorkerPoolToken,
  rotateWorkerPoolToken,
} from "@humanthread/db";
import { verifyPasswordHash } from "@/lib/workbench/workbench-auth";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { resolveWorkerManagementScope } from "../../../../../lib/orchestration/worker-resource-scope";

const poolIdSchema = z.string().regex(/^[a-f0-9]{32}$/u);
const tokenCommandSchema = z.object({
  action: z.enum(["reveal", "rotate"]),
  password: z.string().trim().min(1).max(1_024),
  companyId: z.string().trim().min(1).max(64).optional(),
}).strict();

type Context = { params: Promise<{ poolId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const [{ poolId: rawPoolId }, actor, body] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
      request.json(),
    ]);
    const poolId = poolIdSchema.parse(rawPoolId);
    const command = tokenCommandSchema.parse(body);
    const managed = await resolveWorkerManagementScope({
      userId: actor.userId,
      ...(command.companyId === undefined ? {} : { companyId: command.companyId }),
    });
    const user = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: { id: true, status: true, passwordHash: true },
    });
    if (
      !user
      || user.status !== "active"
      || !user.passwordHash
      || !verifyPasswordHash({ password: command.password, passwordHash: user.passwordHash })
    ) {
      return errorResponse(401, "reauthentication_required", "Current password is invalid");
    }
    const input = {
      poolId,
      actorUserId: actor.userId,
      scope: managed.scope,
      ...(managed.companyRole === undefined ? {} : { companyRole: managed.companyRole }),
      reauthenticated: true,
      now: new Date(),
    };
    const result = command.action === "reveal"
      ? await revealWorkerPoolToken(input)
      : await rotateWorkerPoolToken(input);
    return Response.json(result);
  } catch (error) {
    const code = errorCode(error);
    return errorResponse(
      code === "worker_pool_unauthorized" ? 403 : code === "authorization_denied" ? 403 : 400,
      code ?? "validation_failed",
      error instanceof Error ? error.message : "Worker pool token command failed",
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
