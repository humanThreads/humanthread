import { NextResponse } from "next/server";
import { z } from "zod";
import {
  assertCanWriteProject,
  createOrReuseWorkerValidationChallenge,
  prisma,
  readWorkerValidationChallenge,
} from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import {
  createWorkerValidationSession,
  evaluateWorkerValidation,
} from "../../../../../lib/orchestration/worker-validation";

const md5Id = z.string().regex(/^[a-f0-9]{32}$/u);
const requestSchema = z.object({ action: z.literal("start"), poolId: md5Id }).strict();
const HEARTBEAT_TIMEOUT_MS = 60_000;
const CHALLENGE_DURATION_MS = 5 * 60_000;
const ENVIRONMENT_CONFIGURATION_VERSION_CAPABILITY = "humanthreadEnvironmentConfigurationVersion";

type ProjectRow = {
  workerPoolId: string | null;
  environmentConfigurationVersion: number;
};

type WorkerSessionRow = {
  id: string;
  instanceId: string;
  capabilities: unknown;
  lastSeenAt: Date | null;
};

function capabilityRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function environmentConfigurationVersion(capabilities: Record<string, unknown>): number | null {
  const value = capabilities[ENVIRONMENT_CONFIGURATION_VERSION_CAPABILITY];
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const [{ projectId }, actor, rawBody] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
      request.json(),
    ]);
    await assertCanWriteProject({ userId: actor.userId, projectId });
    const body = requestSchema.parse(rawBody);
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { workerPoolId: true, environmentConfigurationVersion: true },
    }) as ProjectRow | null;
    if (!project) return NextResponse.json({ ok: false, code: "not_found", error: "项目不存在" }, { status: 404 });
    if (project.workerPoolId !== body.poolId) {
      return NextResponse.json({ ok: false, code: "authorization_denied", error: "Worker Pool 未获项目授权" }, { status: 403 });
    }

    const now = new Date();
    const workerSession = await prisma.workerPoolSession.findFirst({
      where: {
        workerPoolId: body.poolId,
        status: "active",
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, instanceId: true, capabilities: true, lastSeenAt: true },
    }) as WorkerSessionRow | null;
    const capabilities = capabilityRecord(workerSession?.capabilities);
    const session = createWorkerValidationSession({
      projectId,
      poolId: body.poolId,
      environmentConfigurationVersion: project.environmentConfigurationVersion,
      selectedPoolAuthorized: true,
    });
    const challenge = workerSession
      ? await createOrReuseWorkerValidationChallenge({
        projectId,
        poolId: body.poolId,
        sessionId: workerSession.id,
        environmentConfigurationVersion: project.environmentConfigurationVersion,
        now,
        expiresAt: new Date(now.getTime() + CHALLENGE_DURATION_MS),
      })
      : null;
    const persistedChallenge = challenge ? await readWorkerValidationChallenge({ challengeId: challenge.id }) : null;
    if (challenge) session.assignment.id = challenge.id;
    const report = evaluateWorkerValidation({
      session,
      currentEnvironmentConfigurationVersion: project.environmentConfigurationVersion,
      now,
      observation: {
        registered: workerSession !== null,
        lastSeenAt: workerSession?.lastSeenAt ?? null,
        capabilities,
        environmentConfigurationVersion: environmentConfigurationVersion(capabilities),
        claim: persistedChallenge?.status === "completed"
          ? { accepted: true, assignmentId: persistedChallenge.id, sideEffect: false }
          : null,
        validatorConfigured: workerSession !== null,
        claimPending: persistedChallenge?.status === "pending" || persistedChallenge?.status === "claimed",
      },
      heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
    });
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Worker 校验失败";
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "validation_failed";
    const status = message === "Workbench API authentication required" ? 401 : code === "authorization_denied" ? 403 : 400;
    return NextResponse.json({ ok: false, code, error: message }, { status });
  }
}
