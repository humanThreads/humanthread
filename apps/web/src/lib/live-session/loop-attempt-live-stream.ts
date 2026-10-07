import { assertCanReadProject, prisma } from "../../../../../packages/db/src/index";
import {
  liveSessionViewSchema,
  type LiveSessionView,
} from "../../../../../packages/shared/src/index";

export type LoopAttemptLiveStreamResult =
  | {
      mode: "phase" | "tui" | "phase_and_tui";
      session: LiveSessionView;
      phase: {
        name: string;
        status: "pending" | "running" | "succeeded" | "failed" | "skipped";
        startedAt: string;
        finishedAt: string | null;
        code: string | null;
        summary: string | null;
      } | null;
    }
  | {
      unavailableCode:
        | "live_stream_not_available"
        | "live_stream_owner_unavailable"
        | "live_stream_attempt_finished";
    };

/**
 * Reads the live-stream view for one Loop attempt. Only the resolved session
 * owner may observe it, and a non-owner sees the same failure as a missing
 * session so the response cannot be used to probe session existence.
 */
export async function readLoopAttemptLiveStream(input: {
  userId: string;
  loopRunId: string;
  attemptId: string;
  now?: Date;
}): Promise<LoopAttemptLiveStreamResult> {
  const now = input.now ?? new Date();
  const attempt = await prisma.loopNodeAttempt.findFirst({
    where: {
      id: input.attemptId,
      loopNodeRun: { loopRunId: input.loopRunId },
    },
    select: {
      id: true,
      status: true,
      loopNodeRun: {
        select: {
          loopRun: {
            select: {
              id: true,
              projectId: true,
              taskId: true,
              bindingSnapshot: true,
              task: { select: { assigneeUserId: true, createdById: true } },
            },
          },
        },
      },
    },
  });
  if (!attempt) return { unavailableCode: "live_stream_not_available" };
  const run = attempt.loopNodeRun.loopRun;
  if (run.projectId) {
    await assertCanReadProject({ userId: input.userId, projectId: run.projectId });
  }
  const binding = record(run.bindingSnapshot);
  const ownerUserId = nonEmptyId(binding?.createdByUserId)
    ?? nonEmptyId(run.task?.assigneeUserId)
    ?? nonEmptyId(run.task?.createdById);
  if (!ownerUserId) return { unavailableCode: "live_stream_owner_unavailable" };
  if (ownerUserId !== input.userId) return { unavailableCode: "live_stream_not_available" };
  if (isTerminalAttempt(attempt.status)) return { unavailableCode: "live_stream_attempt_finished" };

  const session = await prisma.liveSession.findFirst({
    where: {
      ownerUserId: input.userId,
      autoCreated: true,
      loopNodeAttemptId: attempt.id,
      status: { in: ["starting", "running", "detached"] },
      expiresAt: { gt: now },
    },
    orderBy: [{ leaseGeneration: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      kind: true,
      surface: true,
      spaceId: true,
      projectId: true,
      taskId: true,
      executionPolicy: true,
      targetType: true,
      targetDeviceId: true,
      targetWorkerPoolId: true,
      targetDisplayName: true,
      businessRunType: true,
      businessRunId: true,
      status: true,
      controlState: true,
      journalStatus: true,
      journalRetentionDays: true,
      firstSequence: true,
      lastSequence: true,
      loopNodeRunId: true,
      loopNodeAttemptId: true,
      leaseGeneration: true,
      streamMode: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!session) return { unavailableCode: "live_stream_not_available" };
  // The attempt identity already came from the authorized read above, so only
  // the phase snapshot needs to be re-read here.
  const phaseRecord = await prisma.loopNodeAttempt.findFirst({
    where: { id: attempt.id },
    select: {
      attempt: true,
      executionPhase: true,
      executionPhaseStatus: true,
      executionPhaseStartedAt: true,
      executionPhaseFinishedAt: true,
      executionPhaseCode: true,
      executionPhaseSummary: true,
      executionPhaseUpdatedAt: true,
    },
  });
  if (!phaseRecord) return { unavailableCode: "live_stream_not_available" };
  const projected = liveSessionViewSchema.parse({
    id: session.id,
    kind: session.kind,
    surface: session.surface,
    spaceId: session.spaceId,
    projectId: session.projectId,
    taskId: session.taskId,
    executionPolicy: session.executionPolicy,
    target: session.targetType === "worker_pool"
      ? {
          type: "worker_pool",
          workerPoolId: session.targetWorkerPoolId ?? "",
          displayName: session.targetDisplayName,
        }
      : {
          type: "agent_device",
          deviceId: session.targetDeviceId ?? "",
          displayName: session.targetDisplayName,
        },
    targetDisplayName: session.targetDisplayName,
    businessRun: session.businessRunType && session.businessRunId
      ? { type: session.businessRunType as "loop_run", id: session.businessRunId }
      : null,
    loopAttempt: {
      loopRunId: input.loopRunId,
      loopNodeRunId: session.loopNodeRunId ?? "",
      loopNodeAttemptId: session.loopNodeAttemptId ?? "",
      attemptNo: phaseRecord.attempt,
      leaseGeneration: session.leaseGeneration ?? 0,
    },
    status: session.status === "running" || session.status === "detached" || session.status === "starting"
      ? session.status
      : "starting",
    controlState: "viewer",
    journal: {
      status: session.journalStatus === "degraded" || session.journalStatus === "replay_unavailable"
        ? session.journalStatus
        : "ready",
      retentionDays: session.journalRetentionDays,
      firstSequence: session.firstSequence,
      lastSequence: session.lastSequence,
    },
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  });
  const mode = session.streamMode === "phase"
    || session.streamMode === "tui"
    || session.streamMode === "phase_and_tui"
    ? session.streamMode
    : "phase_and_tui";
  return {
    mode,
    session: projected,
    phase: projectPhase(phaseRecord),
  };
}

function projectPhase(attempt: {
  executionPhase: string | null;
  executionPhaseStatus: string | null;
  executionPhaseStartedAt: Date | null;
  executionPhaseFinishedAt: Date | null;
  executionPhaseCode: string | null;
  executionPhaseSummary: string | null;
  executionPhaseUpdatedAt: Date | null;
}) {
  if (!attempt.executionPhase || !attempt.executionPhaseStatus || !attempt.executionPhaseUpdatedAt) return null;
  if (!["pending", "running", "succeeded", "failed", "skipped"].includes(attempt.executionPhaseStatus)) return null;
  return {
    name: attempt.executionPhase,
    status: attempt.executionPhaseStatus as "pending" | "running" | "succeeded" | "failed" | "skipped",
    startedAt: (attempt.executionPhaseStartedAt ?? attempt.executionPhaseUpdatedAt).toISOString(),
    finishedAt: attempt.executionPhaseFinishedAt?.toISOString() ?? null,
    code: attempt.executionPhaseCode,
    summary: attempt.executionPhaseSummary,
  };
}

function isTerminalAttempt(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "blocked" || status === "cancelled";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
