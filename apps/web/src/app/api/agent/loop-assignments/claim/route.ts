import { z } from "zod";
import { prisma } from "@humanthread/db";
import { agentWorkerCapabilitySnapshotSchema, localAgentBuildVersionSchema } from "../../../../../../../../packages/shared/src/index";
import { heartbeatLocalAgentWorker } from "../../../../../lib/agent/agent-device-registration";
import { claimLoopAssignmentWithPrisma } from "../../../../../lib/orchestration/worker-commands";
import {
  buildAttemptLiveSessionDispatch,
  findDispatchForClaimedLoop,
  findDispatchableAgentLiveSession,
} from "../../../../../lib/live-session/live-session-dispatch";
import { ensureLoopAttemptLiveSessionWithPrisma } from "../../../../../lib/live-session/live-session-store";
import { getWorkbenchSiteSettings } from "../../../../../lib/workbench/workbench-site-settings";
import {
  authenticateLoopAssignmentRequest,
  LOOP_ASSIGNMENT_LEASE_MS,
  loopAssignmentFailure,
  loopAssignmentIdSchema,
  loopAssignmentOptions,
  loopAssignmentSuccess,
  parseLoopAssignmentBody,
} from "../route-helpers";

const claimSchema = z.object({
  userId: loopAssignmentIdSchema,
  deviceId: loopAssignmentIdSchema,
  workerId: loopAssignmentIdSchema,
  capabilitySnapshot: agentWorkerCapabilitySnapshotSchema,
  agentVersion: localAgentBuildVersionSchema.optional(),
  activeAgentRunIds: z.array(loopAssignmentIdSchema).max(128).default([]),
  activeLiveSessionIds: z.array(z.string().regex(/^[a-f0-9]{32}$/u)).max(128).default([]),
  acceptAssignments: z.boolean().default(true),
}).strict();

export const OPTIONS = loopAssignmentOptions;

export async function POST(request: Request) {
  try {
    const body = await parseLoopAssignmentBody(request, claimSchema);
    const actor = await authenticateLoopAssignmentRequest(request, body);
    await heartbeatLocalAgentWorker({
      userId: actor.userId,
      workerId: body.workerId,
      deviceId: body.deviceId,
      capabilitySnapshot: body.capabilitySnapshot,
      ...(body.agentVersion === undefined ? {} : { agentVersion: body.agentVersion }),
      now: new Date(),
    });
    const result = await claimLoopAssignmentWithPrisma({
      userId: actor.userId,
      workerId: body.workerId,
      deviceId: body.deviceId,
      capabilities: [
        ...body.capabilitySnapshot.capabilities,
        ...body.capabilitySnapshot.providers.map(({ name }) => name),
      ],
      activeAgentRunIds: body.activeAgentRunIds,
      acceptAssignments: body.acceptAssignments,
      now: new Date(),
      leaseDurationMs: LOOP_ASSIGNMENT_LEASE_MS,
    });
    const { siteBaseUrl } = await getWorkbenchSiteSettings();
    const now = new Date();
    const assignment = result.assignment;
    const attemptLiveSession = assignment?.loopNodeAttemptId
      ? await ensureLoopAttemptLiveSessionWithPrisma({
          loopRunId: assignment.loopRunId,
          loopNodeRunId: assignment.loopNodeRunId,
          loopNodeAttemptId: assignment.loopNodeAttemptId,
          attemptNo: assignment.attemptNo,
          leaseGeneration: assignment.leaseGeneration,
          target: { type: "agent_device", deviceId: body.deviceId },
          now,
        }).catch(() => ({ unavailableCode: "live_stream_session_conflict" as const }))
      : null;
    const attemptDispatch = attemptLiveSession && "session" in attemptLiveSession && assignment
      ? await dispatchAttemptLiveSession({
          assignment,
          session: attemptLiveSession.session,
          executionTicket: attemptLiveSession.executionTicket,
          relayBaseUrl: siteBaseUrl,
          now,
        })
      : null;
    const liveSession = result.assignment?.loopRunId
      ? attemptDispatch ?? await findDispatchForClaimedLoop({
          ownerUserId: actor.userId,
          target: { type: "agent_device", id: body.deviceId },
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
            select: liveSessionDispatchSelect,
          }),
          markRunning: markSessionRunning(actor.userId),
        })
      : await findDispatchableAgentLiveSession({
          deviceId: body.deviceId,
          userId: actor.userId,
          now,
          relayBaseUrl: siteBaseUrl,
          load: async (deviceId, userId, now) => prisma.liveSession.findFirst({
            where: {
              ownerUserId: userId,
              targetType: "agent_device",
              targetDeviceId: deviceId,
              kind: "agent",
              executionPolicy: "direct",
              businessRunType: null,
              businessRunId: null,
              ...(body.activeLiveSessionIds.length === 0 ? {} : { id: { notIn: body.activeLiveSessionIds } }),
              status: { in: ["starting", "running", "detached"] },
              expiresAt: { gt: now },
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: liveSessionDispatchSelect,
          }),
          claimStarting: claimDirectSessionStarting(actor.userId),
        });
    if (!result.assignment) return loopAssignmentSuccess(request, { ...result, liveSession });
    return loopAssignmentSuccess(request, {
      ...result,
      assignment: liveSession ? { ...result.assignment, liveSession } : result.assignment,
    });
  } catch (error) {
    return loopAssignmentFailure(request, error);
  }
}

const liveSessionDispatchSelect = {
  id: true,
  modelSiteId: true,
  model: true,
  reasoningEffort: true,
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

function claimDirectSessionStarting(ownerUserId: string) {
  return async (sessionId: string, now: Date): Promise<boolean> => {
    const claimed = await prisma.liveSession.updateMany({
      where: { id: sessionId, status: "starting", ownerUserId, expiresAt: { gt: now } },
      data: { status: "running", lastTargetHeartbeatAt: now },
    });
    return claimed.count === 1;
  };
}

/**
 * Promotes an attempt-bound session from `starting` to `running` and returns its
 * dispatch. The row may already exist from an earlier claim, and its owner is
 * resolved from the Loop rather than the claiming actor, so the update is keyed
 * to the attempt identity. Without this promotion the browser stays on
 * "等待执行端接入" while the Agent is already streaming.
 */
async function dispatchAttemptLiveSession(input: {
  assignment: { loopNodeAttemptId: string; leaseGeneration: number };
  session: Parameters<typeof buildAttemptLiveSessionDispatch>[0]["session"];
  executionTicket: { token: string };
  relayBaseUrl: string;
  now: Date;
}): Promise<ReturnType<typeof buildAttemptLiveSessionDispatch>> {
  await prisma.liveSession.updateMany({
    where: {
      id: input.session.id,
      autoCreated: true,
      loopNodeAttemptId: input.assignment.loopNodeAttemptId,
      leaseGeneration: input.assignment.leaseGeneration,
      status: "starting",
      expiresAt: { gt: input.now },
    },
    data: { status: "running", lastTargetHeartbeatAt: input.now },
  });
  return buildAttemptLiveSessionDispatch({
    session: input.session,
    executionTicket: input.executionTicket,
    relayBaseUrl: input.relayBaseUrl,
  });
}

function markSessionRunning(ownerUserId: string) {
  return async (sessionId: string, now: Date): Promise<void> => {
    await prisma.liveSession.updateMany({
      where: { id: sessionId, status: "starting", ownerUserId, expiresAt: { gt: now } },
      data: { status: "running", lastTargetHeartbeatAt: now },
    });
  };
}
