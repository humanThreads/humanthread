import { z } from "zod";
import { authenticateWorkerPoolSession, claimWorkerValidationChallenge, prisma } from "@humanthread/db";
import { claimLinuxWorkerAssignmentWithPrisma } from "@/lib/orchestration/worker-commands";
import { getWorkbenchSiteSettings } from "@/lib/workbench/workbench-site-settings";
import {
  buildAttemptLiveSessionDispatch,
  findDispatchForClaimedLoop,
  findDispatchableWorkerLiveSession,
} from "@/lib/live-session/live-session-dispatch";
import { ensureLoopAttemptLiveSessionWithPrisma } from "@/lib/live-session/live-session-store";
import { resolveDirectWorkerRuntime } from "@/lib/live-session/direct-worker-runtime";
import { resolveWorkerModelSiteSecret } from "@humanthread/db";

const claimSchema = z.object({
  poolId: z.string().regex(/^[a-f0-9]{32}$/u),
  acceptAssignments: z.boolean().default(true),
}).strict();

const LEASE_DURATION_MS = 60_000;
// A Worker that stopped heartbeating for this long no longer owns its live
// session; the Pool may hand that session to another replica.
const STALE_SESSION_MS = 120_000;

function resourceLimits(configuration: Record<string, unknown>): { gpuConcurrency: number; unityBuildConcurrency: number } {
  const limit = (key: "gpuConcurrency" | "unityBuildConcurrency") => {
    const value = configuration[key];
    return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 128 ? Number(value) : 1;
  };
  return { gpuConcurrency: limit("gpuConcurrency"), unityBuildConcurrency: limit("unityBuildConcurrency") };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const sessionToken = request.headers.get("x-worker-pool-session")?.trim();
    if (!sessionToken) return errorResponse(401, "worker_pool_unauthorized", "Worker pool session is required");
    const body = claimSchema.parse(await request.json());
    const now = new Date();
    const session = await authenticateWorkerPoolSession({
      poolId: body.poolId,
      sessionToken,
      now,
    });
    const validationAssignment = await claimWorkerValidationChallenge({
      poolId: session.workerPoolId,
      sessionId: session.sessionId,
      now,
    });
    if (validationAssignment) {
      return Response.json({ ok: true, result: { assignment: validationAssignment } });
    }
    const { siteBaseUrl } = await getWorkbenchSiteSettings();
    const result = await claimLinuxWorkerAssignmentWithPrisma({
      poolId: session.workerPoolId,
      sessionId: session.sessionId,
      instanceId: session.instanceId,
      ownerType: session.ownerType,
      ownerUserId: session.ownerUserId,
      companyId: session.companyId,
      capabilities: session.capabilities,
      requestedConcurrency: session.requestedConcurrency,
      runtime: session.runtime,
      maxConcurrentRuns: session.maxConcurrentRuns,
      resourceLimits: resourceLimits(session.configuration),
      acceptAssignments: body.acceptAssignments,
      now,
      leaseDurationMs: LEASE_DURATION_MS,
    });
    const liveSession = result.assignment?.loopRunId
      ? await ensureAttemptLiveSession(
          result.assignment,
          session,
          siteBaseUrl,
          now,
        ) ?? await findDispatchForClaimedLoop({
          ownerUserId: session.ownerUserId,
          target: { type: "worker_pool", id: session.workerPoolId },
          loopRunId: result.assignment.loopRunId,
          relayBaseUrl: siteBaseUrl,
          now,
            load: async ({ ownerUserId, targetType, targetId, loopRunId, now }) => prisma.liveSession.findFirst({
            where: {
              ...(ownerUserId === null ? {} : { ownerUserId }),
              targetType,
              ...(targetType === "agent_device" ? { targetDeviceId: targetId } : { targetWorkerPoolId: targetId }),
              businessRunType: "loop_run",
              businessRunId: loopRunId,
              status: { in: ["starting", "running", "detached"] },
              expiresAt: { gt: now },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: {
              id: true,
              kind: true,
              targetType: true,
              targetDeviceId: true,
              targetWorkerPoolId: true,
              projectId: true,
              taskId: true,
              businessRunType: true,
              businessRunId: true,
              status: true,
              expiresAt: true,
            },
            }),
          markRunning: async (sessionId, now) => {
            await prisma.liveSession.updateMany({
              where: { id: sessionId, status: "starting", ownerUserId: session.ownerUserId!, expiresAt: { gt: now } },
              data: { status: "running", lastTargetHeartbeatAt: now },
            });
          },
        })
      : await findDispatchableWorkerLiveSession({
            workerPoolId: session.workerPoolId,
            relayBaseUrl: siteBaseUrl,
            now,
            // A `starting` session always wins: it is an explicit user request
            // waiting for a Worker. Only when none is waiting does the oldest
            // stale in-flight session become a re-acquisition candidate, so an
            // abandoned `running` row can never block the queue.
            load: async (workerPoolId, now) => {
              const waiting = await prisma.liveSession.findFirst({
                where: {
                  targetType: "worker_pool",
                  targetWorkerPoolId: workerPoolId,
                  kind: "worker",
                  executionPolicy: "direct",
                  businessRunType: null,
                  businessRunId: null,
                  status: "starting",
                  expiresAt: { gt: now },
                },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                select: liveSessionDispatchSelect,
              });
              if (waiting) return waiting;
              return prisma.liveSession.findFirst({
                where: {
                  targetType: "worker_pool",
                  targetWorkerPoolId: workerPoolId,
                  kind: "worker",
                  executionPolicy: "direct",
                  businessRunType: null,
                  businessRunId: null,
                  status: "running",
                  expiresAt: { gt: now },
                  // A recent heartbeat means another Worker still owns this
                  // session and must not be duplicated.
                  OR: [
                    { lastTargetHeartbeatAt: null },
                    { lastTargetHeartbeatAt: { lt: new Date(now.getTime() - STALE_SESSION_MS) } },
                  ],
                },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                select: liveSessionDispatchSelect,
              });
            },
            claimStarting: async (sessionId, markedAt) => {
              const claimed = await prisma.liveSession.updateMany({
                where: { id: sessionId, status: "starting", expiresAt: { gt: markedAt } },
                data: { status: "running", lastTargetHeartbeatAt: markedAt },
              });
              return claimed.count === 1;
            },
            reacquire: async (sessionId, markedAt) => {
              // updateMany re-checks staleness atomically so two Workers cannot
              // both take over the same abandoned session.
              const claimed = await prisma.liveSession.updateMany({
                where: {
                  id: sessionId,
                  status: "running",
                  expiresAt: { gt: markedAt },
                  OR: [
                    { lastTargetHeartbeatAt: null },
                    { lastTargetHeartbeatAt: { lt: new Date(markedAt.getTime() - STALE_SESSION_MS) } },
                  ],
                },
                data: { lastTargetHeartbeatAt: markedAt },
              });
              return claimed.count === 1;
            },
            resolveRuntime: (record) => directWorkerRuntime({
              workerPoolId: session.workerPoolId,
              ownerType: session.ownerType,
              ownerUserId: session.ownerUserId,
              companyId: session.companyId,
              modelSiteId: record.modelSiteId ?? null,
              model: record.model ?? null,
              reasoningEffort: record.reasoningEffort ?? null,
            }),
          });
    const assignment = result.assignment
      ? {
        ...result.assignment,
        checklistMcp: {
          url: new URL(
            `/api/worker-pools/assignments/${encodeURIComponent(result.assignment.agentRunId)}/checklist-mcp`,
            siteBaseUrl,
          ).toString(),
        },
        ...(liveSession ? { liveSession } : {}),
      }
      : null;
    return Response.json({
      ok: true,
      result: {
        ...result,
        assignment,
        ...(liveSession && !result.assignment ? { liveSession } : {}),
      },
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "validation_failed";
    return errorResponse(
      code === "worker_pool_unauthorized" ? 401 : 400,
      code,
      error instanceof Error ? error.message : "Worker claim failed",
    );
  }
}

/**
 * Automatically binds one observation session to the claimed Loop attempt.
 * Session creation is best effort: the business assignment must still succeed
 * when the live stream cannot be provisioned.
 */
async function ensureAttemptLiveSession(
  assignment: {
    loopRunId: string;
    loopNodeRunId: string;
    loopNodeAttemptId: string;
    attemptNo: number;
    leaseGeneration: number;
  },
  session: { workerPoolId: string },
  siteBaseUrl: string,
  now: Date,
): Promise<ReturnType<typeof buildAttemptLiveSessionDispatch> | null> {
  try {
    const ensured = await ensureLoopAttemptLiveSessionWithPrisma({
      loopRunId: assignment.loopRunId,
      loopNodeRunId: assignment.loopNodeRunId,
      loopNodeAttemptId: assignment.loopNodeAttemptId,
      attemptNo: assignment.attemptNo,
      leaseGeneration: assignment.leaseGeneration,
      target: { type: "worker_pool", workerPoolId: session.workerPoolId },
      now,
    });
    if (!("session" in ensured)) return null;
    // The attempt-bound row is created as `starting` and may already exist from
    // an earlier claim. Claiming the assignment is what proves an execution
    // target is now attached, so either path must promote it to `running`
    // before the Worker opens the relay socket. Without this the browser keeps
    // showing "等待执行端接入" even though the Worker is streaming.
    await prisma.liveSession.updateMany({
      where: {
        id: ensured.session.id,
        autoCreated: true,
        loopNodeAttemptId: assignment.loopNodeAttemptId,
        leaseGeneration: assignment.leaseGeneration,
        status: "starting",
        expiresAt: { gt: now },
      },
      data: { status: "running", lastTargetHeartbeatAt: now },
    });
    return buildAttemptLiveSessionDispatch({
      session: ensured.session,
      executionTicket: ensured.executionTicket,
      relayBaseUrl: siteBaseUrl,
    });
  } catch {
    return null;
  }
}

async function directWorkerRuntime(session: {
  workerPoolId: string;
  ownerType: "personal" | "company";
  ownerUserId: string | null;
  companyId: string | null;
  modelSiteId?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
}) {
  const project = await prisma.project.findFirst({
    where: {
      workerPoolId: session.workerPoolId,
      ...(session.ownerType === "company"
        ? { companyId: session.companyId }
        : { ownerUserId: session.ownerUserId }),
    },
    select: { id: true },
  });
  if (!project) {
    throw Object.assign(new Error("Project Worker configuration is unavailable"), {
      code: "worker_direct_runtime_missing",
    });
  }
  // A session-level choice made at creation time wins over the project stage
  // default; both are resolved here so the Worker only receives the result.
  const selection = session.modelSiteId && session.model
    ? {
        siteId: session.modelSiteId,
        model: session.model,
        reasoningEffort: session.reasoningEffort ?? "high",
      }
    : null;
  return resolveDirectWorkerRuntime(project.id, {
    loadProject: async (projectId) => {
      const configuration = await prisma.project.findUnique({
        where: { id: projectId },
        select: { ownerType: true, ownerUserId: true, companyId: true },
      });
      return configuration && (configuration.ownerType === "personal" || configuration.ownerType === "company")
        ? {
            ownerType: configuration.ownerType,
            ownerUserId: configuration.ownerUserId,
            companyId: configuration.companyId,
          }
        : null;
    },
    loadBinding: (projectId) => prisma.projectLoopBinding.findFirst({
      where: { projectId, status: "enabled", bindingRole: "task_development" },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: { workerStageConfigurations: true },
    }),
    resolveModelSiteSecret: (runtimeInput) => resolveWorkerModelSiteSecret(runtimeInput),
  }, selection);
}

const liveSessionDispatchSelect = {
  lastTargetHeartbeatAt: true,
  modelSiteId: true,
  model: true,
  reasoningEffort: true,
  id: true,
  kind: true,
  targetType: true,
  targetDeviceId: true,
  targetWorkerPoolId: true,
  projectId: true,
  taskId: true,
  businessRunType: true,
  businessRunId: true,
  targetDisplayName: true,
  executionPolicy: true,
  status: true,
  expiresAt: true,
} as const;

function errorResponse(status: number, errorCode: string, message: string): Response {
  return Response.json({ ok: false, errorCode, message }, { status });
}
