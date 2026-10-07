import { derivedPersistenceId } from "../../../../../packages/db/src/index";
import {
  liveSessionViewSchema,
  type LiveSessionView,
} from "../../../../../packages/shared/src/index";

export const LOOP_LIVE_SESSION_TTL_MS = 30 * 60 * 1_000;
export const LOOP_LIVE_SESSION_STREAM_MODE = "phase_and_tui";

type LoopAttemptOwnerRecord = {
  id: string;
  attempt: number;
  loopNodeRunId: string;
  loopNodeRun: {
    loopRunId: string;
    loopRun: {
      id: string;
      projectId: string | null;
      taskId: string | null;
      bindingSnapshot?: unknown;
      task?: {
        id?: string | null;
        spaceId?: string | null;
        projectId?: string | null;
        assigneeUserId?: string | null;
        createdById?: string | null;
      } | null;
    };
  };
};

export type LoopLiveSessionRecord = {
  id: string;
  kind: "agent" | "worker";
  surface: "web" | "android" | "desktop";
  ownerUserId: string;
  spaceId: string;
  projectId: string;
  taskId: string | null;
  executionPolicy: "loop";
  loopNodeRunId: string;
  loopNodeAttemptId: string;
  leaseGeneration: number;
  streamMode: string;
  autoCreated: boolean;
  activeViewerCount: number;
  targetType: "agent_device" | "worker_pool";
  targetDeviceId: string | null;
  targetWorkerPoolId: string | null;
  targetDisplayName: string;
  businessRunType: "loop_run";
  businessRunId: string;
  status: "starting" | "running" | "detached";
  controlState: "detached";
  journal: LiveSessionView["journal"];
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export interface LoopLiveSessionDependencies {
  loadAttempt(input: {
    loopRunId: string;
    loopNodeRunId: string;
    loopNodeAttemptId: string;
    attemptNo: number;
  }): Promise<LoopAttemptOwnerRecord | null>;
  findSession(input: {
    sessionId: string;
    loopNodeAttemptId: string;
    leaseGeneration: number;
  }): Promise<LoopLiveSessionRecord | null>;
  loadProjectSpaceId?(projectId: string): Promise<string | null>;
  createSession(input: LoopLiveSessionRecord): Promise<LoopLiveSessionRecord>;
  updateSession?(input: LoopLiveSessionRecord): Promise<LoopLiveSessionRecord | null>;
  createId(parts: readonly string[]): string;
  createTicket(input: { sessionId: string; kind: "execution"; now: Date }): {
    token: string;
    expiresAt: Date;
  };
  now(): Date;
}

export type LoopLiveSessionUnavailableCode =
  | "live_stream_owner_unavailable"
  | "live_stream_session_conflict";

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Resolves the human who should own an automatically created observation
 * session. The order is deliberate: the run's binding creator is the actor who
 * launched the Loop, the assignee is the current worker, and the task creator
 * is the last safe fallback. No owner means no automatic session.
 */
export function resolveLoopLiveSessionOwner(attempt: LoopAttemptOwnerRecord): string | null {
  const binding = recordValue(attempt.loopNodeRun.loopRun.bindingSnapshot);
  const bindingOwner = nonEmptyId(binding?.createdByUserId);
  if (bindingOwner) return bindingOwner;
  const task = attempt.loopNodeRun.loopRun.task;
  return nonEmptyId(task?.assigneeUserId) ?? nonEmptyId(task?.createdById);
}

function buildSessionRecord(input: {
  attempt: LoopAttemptOwnerRecord;
  ownerUserId: string;
  loopRunId: string;
  loopNodeRunId: string;
  loopNodeAttemptId: string;
  leaseGeneration: number;
  target: { type: "worker_pool"; workerPoolId: string } | { type: "agent_device"; deviceId: string };
  sessionId: string;
  now: Date;
  spaceId: string;
}): LoopLiveSessionRecord {
  const run = input.attempt.loopNodeRun.loopRun;
  const task = run.task;
  const projectId = task?.projectId ?? run.projectId ?? "";
  const spaceId = task?.spaceId ?? input.spaceId;
  const target = input.target;
  return {
    id: input.sessionId,
    kind: target.type === "worker_pool" ? "worker" : "agent",
    surface: "web",
    ownerUserId: input.ownerUserId,
    spaceId,
    projectId,
    taskId: run.taskId ?? task?.id ?? null,
    executionPolicy: "loop",
    loopNodeRunId: input.loopNodeRunId,
    loopNodeAttemptId: input.loopNodeAttemptId,
    leaseGeneration: input.leaseGeneration,
    streamMode: LOOP_LIVE_SESSION_STREAM_MODE,
    autoCreated: true,
    activeViewerCount: 0,
    targetType: target.type,
    targetDeviceId: target.type === "agent_device" ? target.deviceId : null,
    targetWorkerPoolId: target.type === "worker_pool" ? target.workerPoolId : null,
    targetDisplayName: target.type === "worker_pool" ? "Linux Worker Pool" : "Local Agent",
    businessRunType: "loop_run",
    businessRunId: input.loopRunId,
    status: "starting",
    controlState: "detached",
    journal: {
      status: "ready",
      retentionDays: 30,
      firstSequence: 0,
      lastSequence: 0,
    },
    expiresAt: new Date(input.now.getTime() + LOOP_LIVE_SESSION_TTL_MS),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function projectSession(
  record: LoopLiveSessionRecord,
  loopRunId: string,
  loopNodeRunId: string,
  attemptNo: number,
): LiveSessionView {
  return liveSessionViewSchema.parse({
    id: record.id,
    kind: record.kind,
    surface: record.surface,
    spaceId: record.spaceId,
    projectId: record.projectId,
    taskId: record.taskId,
    executionPolicy: record.executionPolicy,
    target: record.targetType === "worker_pool"
      ? {
          type: "worker_pool" as const,
          workerPoolId: record.targetWorkerPoolId ?? "",
          displayName: record.targetDisplayName,
        }
      : {
          type: "agent_device" as const,
          deviceId: record.targetDeviceId ?? "",
          displayName: record.targetDisplayName,
        },
    targetDisplayName: record.targetDisplayName,
    businessRun: { type: "loop_run" as const, id: loopRunId },
    loopAttempt: {
      loopRunId,
      loopNodeRunId,
      loopNodeAttemptId: record.loopNodeAttemptId,
      attemptNo,
      leaseGeneration: record.leaseGeneration,
    },
    status: record.status,
    controlState: record.controlState,
    journal: record.journal,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

/**
 * Binds exactly one automatic observation session to a Loop attempt lease.
 * Failures are returned as stable codes so a claim can continue without a live
 * stream instead of failing the business assignment.
 */
export async function ensureLoopAttemptLiveSession(input: {
  loopRunId: string;
  loopNodeRunId: string;
  loopNodeAttemptId: string;
  attemptNo: number;
  leaseGeneration: number;
  target: { type: "worker_pool"; workerPoolId: string } | { type: "agent_device"; deviceId: string };
  now: Date;
}, dependencies: LoopLiveSessionDependencies): Promise<
  | { session: LiveSessionView; executionTicket: { token: string } }
  | { unavailableCode: LoopLiveSessionUnavailableCode }
> {
  const attempt = await dependencies.loadAttempt({
    loopRunId: input.loopRunId,
    loopNodeRunId: input.loopNodeRunId,
    loopNodeAttemptId: input.loopNodeAttemptId,
    attemptNo: input.attemptNo,
  });
  if (!attempt) return { unavailableCode: "live_stream_session_conflict" };

  const sessionId = dependencies.createId([
    "loop-live-session",
    input.loopNodeAttemptId,
    String(input.leaseGeneration),
  ]);
  const existing = await dependencies.findSession({
    sessionId,
    loopNodeAttemptId: input.loopNodeAttemptId,
    leaseGeneration: input.leaseGeneration,
  });
  if (existing) {
    if (
      existing.id !== sessionId
      || existing.loopNodeAttemptId !== input.loopNodeAttemptId
      || existing.leaseGeneration !== input.leaseGeneration
      || existing.businessRunId !== input.loopRunId
    ) return { unavailableCode: "live_stream_session_conflict" };
    const refreshed = await dependencies.updateSession?.({
      ...existing,
      updatedAt: input.now,
    }) ?? existing;
    return {
      session: projectSession(refreshed, input.loopRunId, input.loopNodeRunId, input.attemptNo),
      executionTicket: {
        token: dependencies.createTicket({
          sessionId,
          kind: "execution",
          now: input.now,
        }).token,
      },
    };
  }

  const ownerUserId = resolveLoopLiveSessionOwner(attempt);
  if (!ownerUserId) return { unavailableCode: "live_stream_owner_unavailable" };

  const projectId = attempt.loopNodeRun.loopRun.task?.projectId
    ?? attempt.loopNodeRun.loopRun.projectId
    ?? "";
  const projectSpaceId = projectId
    ? attempt.loopNodeRun.loopRun.task?.spaceId
      ?? await dependencies.loadProjectSpaceId?.(projectId)
      ?? null
    : null;
  if (!projectId || !projectSpaceId) {
    return { unavailableCode: "live_stream_session_conflict" };
  }

  const record = buildSessionRecord({
    attempt,
    ownerUserId,
    loopRunId: input.loopRunId,
    loopNodeRunId: input.loopNodeRunId,
    loopNodeAttemptId: input.loopNodeAttemptId,
    leaseGeneration: input.leaseGeneration,
    target: input.target,
    sessionId,
    now: input.now,
    spaceId: projectSpaceId,
  });
  if (!record.spaceId || !record.projectId) {
    return { unavailableCode: "live_stream_session_conflict" };
  }
  const created = await dependencies.createSession(record);
  return {
    session: projectSession(created, input.loopRunId, input.loopNodeRunId, input.attemptNo),
    executionTicket: {
      token: dependencies.createTicket({
        sessionId: created.id,
        kind: "execution",
        now: input.now,
      }).token,
    },
  };
}

export function derivedLoopLiveSessionId(loopNodeAttemptId: string, leaseGeneration: number): string {
  return derivedPersistenceId(["loop-live-session", loopNodeAttemptId, String(leaseGeneration)]);
}
