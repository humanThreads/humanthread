import {
  assertCanReadProject,
  assertCanReadSpace,
  buildAccessibleTaskWhere,
  derivedPersistenceId,
  listWorkerModelSites,
  prisma,
  resolveWorkerModelSiteSecret,
} from "../../../../../packages/db/src/index";
import { resolveWorkerProjectScope } from "../orchestration/worker-resource-scope";

import {
  createLiveSessionControl,
  type AgentDeviceTargetRecord,
  type LiveSessionControlDependencies,
  type LiveSessionRecord,
  type WorkerProjectTargetRecord,
} from "./live-session-control";
import { createLiveSessionTicket } from "./live-session-ticket";
import { startLiveSessionLoopRun } from "./live-session-loop-run";
import { triggerTaskLoop } from "../orchestration/loop-trigger-commands";
import { resolveDirectWorkerRuntime } from "./direct-worker-runtime";
import {
  derivedLoopLiveSessionId,
  ensureLoopAttemptLiveSession,
  type LoopLiveSessionDependencies,
  type LoopLiveSessionRecord,
} from "./loop-live-session";

const LIVE_SESSION_TTL_MS = 30 * 60 * 1_000;

/**
 * Desktop-reported sites are untrusted JSON at read time, so the shape is
 * checked here rather than trusted from the column.
 */
function normalizeReportedModelSites(value: unknown): Array<{
  siteId: string;
  name: string;
  adapter: string;
  models: Array<{ name: string; label: string }>;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const site = candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? candidate as Record<string, unknown>
      : null;
    if (
      typeof site?.siteId !== "string"
      || !/^[a-f0-9]{32}$/u.test(site.siteId)
      || typeof site.name !== "string"
      || typeof site.adapter !== "string"
      || !Array.isArray(site.models)
    ) return [];
    const models = site.models.flatMap((entry) => {
      const model = entry && typeof entry === "object" && !Array.isArray(entry)
        ? entry as Record<string, unknown>
        : null;
      return typeof model?.name === "string" && typeof model.label === "string"
        ? [{ name: model.name, label: model.label }]
        : [];
    });
    return [{ siteId: site.siteId, name: site.name, adapter: site.adapter, models }];
  });
}

/**
 * Terminal Attempt states. A session bound to one of these has finished
 * executing and must be presented as history rather than a live target.
 */
const FINISHED_ATTEMPT_STATUSES = new Set(["succeeded", "failed", "blocked", "cancelled"]);

function isFinishedAttempt(status: string | undefined): boolean {
  return status !== undefined && FINISHED_ATTEMPT_STATUSES.has(status);
}

function toRecord(row: {
  id: string;
  kind: string;
  surface: string;
  spaceId: string;
  projectId: string | null;
  taskId: string | null;
  modelSiteId: string | null;
  model: string | null;
  reasoningEffort: string | null;
  executionPolicy: string;
  targetType: string;
  targetDeviceId: string | null;
  targetWorkerPoolId: string | null;
  targetDisplayName: string;
  businessRunType: string | null;
  businessRunId: string | null;
  status: string;
  controlState: string;
  journalStatus: string;
  journalRetentionDays: number;
  firstSequence: number;
  lastSequence: number;
  createdAt: Date;
  updatedAt: Date;
}, extra: { history?: boolean } = {}): LiveSessionRecord {
  const target = row.targetType === "agent_device"
    ? {
        type: "agent_device" as const,
        deviceId: row.targetDeviceId ?? "",
        displayName: row.targetDisplayName,
      }
    : {
        type: "worker_pool" as const,
        workerPoolId: row.targetWorkerPoolId ?? "",
        displayName: row.targetDisplayName,
      };
  return {
    id: row.id,
    kind: row.kind as LiveSessionRecord["kind"],
    surface: row.surface as LiveSessionRecord["surface"],
    spaceId: row.spaceId,
    projectId: row.projectId,
    taskId: row.taskId,
    executionPolicy: row.executionPolicy as LiveSessionRecord["executionPolicy"],
    target,
    targetDisplayName: row.targetDisplayName,
    businessRun: row.businessRunType && row.businessRunId
      ? {
          type: row.businessRunType as "agent_run" | "loop_run",
          id: row.businessRunId,
        }
      : null,
    status: row.status as LiveSessionRecord["status"],
    controlState: row.controlState as LiveSessionRecord["controlState"],
    journal: {
      status: row.journalStatus as LiveSessionRecord["journal"]["status"],
      retentionDays: row.journalRetentionDays,
      firstSequence: row.firstSequence,
      lastSequence: row.lastSequence,
    },
    // The three columns are written together, so any missing part means "no selection".
    modelSelection: row.modelSiteId && row.model && row.reasoningEffort
      ? { siteId: row.modelSiteId, model: row.model, reasoningEffort: row.reasoningEffort }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(extra.history === undefined ? {} : { history: extra.history }),
  };
}

function defaultDependencies(): LiveSessionControlDependencies {
  return {
    authorizeSpace: async ({ userId, spaceId }) => {
      await assertCanReadSpace({ userId, spaceId });
      return { spaceId, role: "member" };
    },
    authorizeProject: async ({ userId, projectId }) => {
      await assertCanReadProject({ userId, projectId });
      return { projectId, role: "member" };
    },
    loadAgentDevice: async ({ userId, deviceId }): Promise<AgentDeviceTargetRecord | null> => {
      const row = await prisma.localDevice.findFirst({
        where: { id: deviceId, userId },
        select: {
          id: true,
          userId: true,
          name: true,
          status: true,
          lastSeenAt: true,
          runtimeProfiles: {
            where: { status: "ready" },
            orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
            take: 1,
            select: { id: true, modelSites: true },
          },
          agentWorkers: {
            where: { status: "online" },
            take: 1,
            select: { id: true },
          },
        },
      });
      return row
        ? {
            id: row.id,
            userId: row.userId,
            name: row.name,
            status: row.status,
            lastSeenAt: row.lastSeenAt,
            runtimeReady: row.runtimeProfiles.length > 0,
            connectorOnline: row.agentWorkers.length > 0,
            modelSites: normalizeReportedModelSites(row.runtimeProfiles[0]?.modelSites),
          }
        : null;
    },
    loadWorkerProjectTarget: async ({ projectId }): Promise<WorkerProjectTargetRecord | null> => {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          spaceId: true,
          workerPoolId: true,
          workerPool: {
            select: {
              displayName: true,
              status: true,
              lastSeenAt: true,
              maxConcurrentRuns: true,
              sessions: {
                where: { status: "active", revokedAt: null, expiresAt: { gt: new Date() } },
                select: { requestedConcurrency: true, linuxRuns: { where: { status: { in: ["claimed", "starting", "running", "waiting_approval"] } }, select: { id: true } } },
              },
            },
          },
        },
      });
      if (!project?.spaceId || !project.workerPoolId || !project.workerPool) return null;
      const capacity = project.workerPool.sessions.reduce((sum, session) => (
        sum + Math.max(0, session.requestedConcurrency - session.linuxRuns.length)
      ), 0);
      return {
        projectId: project.id,
        spaceId: project.spaceId,
        workerPoolId: project.workerPoolId,
        workerPoolName: project.workerPool.displayName,
        workerPoolStatus: project.workerPool.status,
        workerPoolLastSeenAt: project.workerPool.lastSeenAt,
        workerPoolCapacity: capacity,
      };
    },
    resolveDirectWorkerRuntime: ({ projectId, selection }) => resolveDirectWorkerRuntime(projectId, {
      loadProject: async (id) => {
        const project = await prisma.project.findUnique({
          where: { id },
          select: { ownerType: true, ownerUserId: true, companyId: true },
        });
        return project && (project.ownerType === "personal" || project.ownerType === "company")
          ? { ownerType: project.ownerType, ownerUserId: project.ownerUserId, companyId: project.companyId }
          : null;
      },
      loadBinding: (id) => prisma.projectLoopBinding.findFirst({
        where: { projectId: id, status: "enabled", bindingRole: "task_development" },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        select: { workerStageConfigurations: true },
      }),
      resolveModelSiteSecret: (runtimeInput) => resolveWorkerModelSiteSecret(runtimeInput),
    }, selection ?? null),
    listModelSites: async ({ userId, projectId }) => {
      const scope = await resolveWorkerProjectScope({ userId, projectId });
      const sites = await listWorkerModelSites({ actorUserId: userId, scope });
      return sites.map((site) => ({ id: site.id, name: site.name, models: site.models }));
    },
    // Model choices are Worker-resource audits; reuse the existing table rather
    // than inventing a second audit surface. WorkerPoolAudit has required
    // foreign keys, so the caller must supply the Pool and actor it belongs to.
    recordModelAudit: async ({ action, actorUserId, workerPoolId, metadata }) => {
      await prisma.workerPoolAudit.create({
        data: {
          id: derivedPersistenceId(["live-session-model-audit", action, actorUserId, JSON.stringify(metadata)]),
          workerPoolId,
          actorUserId,
          action,
          metadata: metadata as never,
          createdAt: new Date(),
        },
      });
    },
    loadTask: async ({ userId, taskId }) => {
      const task = await prisma.task.findFirst({
        where: { AND: [{ id: taskId }, buildAccessibleTaskWhere({ userId })] },
        select: { id: true, projectId: true, spaceId: true, statusCategory: true },
      });
      return task?.projectId && task.spaceId
        ? { ...task, projectId: task.projectId, spaceId: task.spaceId }
        : null;
    },
    createBusinessRun: async (input) => {
      if (input.kind === "loop_run") {
        return startLiveSessionLoopRun({
          userId: input.userId,
          projectId: input.projectId,
          taskId: input.taskId,
          commandId: input.commandId,
          target: input.target,
        }, {
          triggerTaskLoop: async (command) => {
            const result = await triggerTaskLoop(command);
            return { id: result.id };
          },
          findLocalAgentProfile: async ({ projectId }) => {
            const profile = await prisma.agentProfile.findFirst({
              where: {
                status: "active",
                space: { projects: { some: { id: projectId } } },
              },
              orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
              select: { id: true },
            });
            return profile;
          },
        });
      }
      const id = derivedPersistenceId([
        "live-session-agent-run",
        input.userId,
        input.projectId,
        input.taskId,
        new Date().toISOString(),
      ]);
      const profile = await prisma.agentProfile.findFirst({
        where: {
          status: "active",
          space: {
            projects: { some: { id: input.projectId } },
          },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        select: { id: true },
      });
      if (!profile) throw Object.assign(new Error("No active Agent profile is available"), { code: "agent_runtime_unavailable" });
      await prisma.agentRun.create({
        data: {
          id,
          projectId: input.projectId,
          taskId: input.taskId,
          attempt: 1,
          agentProfileId: profile.id,
          status: "queued",
          inputSnapshot: {
            source: "live_session",
            executionPolicy: input.executionPolicy,
          },
        },
      });
      return { type: "agent_run" as const, id };
    },
    createSession: async (record) => {
      const created = await prisma.liveSession.create({
        data: {
          id: record.id,
          kind: record.kind,
          surface: record.surface,
          ownerUserId: record.ownerUserId,
          spaceId: record.spaceId,
          projectId: record.projectId,
          taskId: record.taskId,
          modelSiteId: record.modelSelection?.siteId ?? null,
          model: record.modelSelection?.model ?? null,
          reasoningEffort: record.modelSelection?.reasoningEffort ?? null,
          executionPolicy: record.executionPolicy,
          targetType: record.target.type,
          targetDeviceId: record.target.type === "agent_device" ? record.target.deviceId : null,
          targetWorkerPoolId: record.target.type === "worker_pool" ? record.target.workerPoolId : null,
          targetDisplayName: record.targetDisplayName,
          businessRunType: record.businessRun?.type ?? null,
          businessRunId: record.businessRun?.id ?? null,
          status: record.status,
          controlState: record.controlState,
          journalStatus: record.journal.status,
          journalRetentionDays: record.journal.retentionDays,
          firstSequence: record.journal.firstSequence,
          lastSequence: record.journal.lastSequence,
          expiresAt: new Date(record.createdAt.getTime() + LIVE_SESSION_TTL_MS),
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        },
      });
      return toRecord(created);
    },
    listSessions: async ({ userId }) => {
      const rows = await prisma.liveSession.findMany({
        where: { ownerUserId: userId, status: { notIn: ["ended", "failed", "cancelled"] }, expiresAt: { gt: new Date() } },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 100,
      });
      // Auto-created Loop sessions outlive their Attempt by up to the full TTL.
      // Without this flag they keep showing as a live target that is merely
      // "waiting for an executor", and their newest-first rows bury the session
      // the user is actually watching.
      const attemptIds = [...new Set(rows.flatMap((row) => row.loopNodeAttemptId ? [row.loopNodeAttemptId] : []))];
      const attempts = attemptIds.length === 0
        ? []
        : await prisma.loopNodeAttempt.findMany({
            where: { id: { in: attemptIds } },
            select: { id: true, status: true },
          });
      const attemptStatus = new Map(attempts.map((attempt) => [attempt.id, attempt.status]));
      return rows.map((row) => toRecord(row, row.loopNodeAttemptId
        ? { history: isFinishedAttempt(attemptStatus.get(row.loopNodeAttemptId)) }
        : {}));
    },
    closeSession: async ({ userId, sessionId }) => {
      const result = await prisma.liveSession.deleteMany({
        where: { id: sessionId, ownerUserId: userId },
      });
      return result.count === 1;
    },
    createId: (parts) => derivedPersistenceId(parts),
    now: () => new Date(),
  };
}

export function getLiveSessionControl() {
  return createLiveSessionControl(defaultDependencies(), {
    createTicket: ({ sessionId, kind, now }) => createLiveSessionTicket({ sessionId, kind, now }),
  });
}

export function issueLiveSessionControlTicket(input: { sessionId: string; now?: Date }) {
  return createLiveSessionTicket({
    sessionId: input.sessionId,
    kind: "control",
    ...(input.now ? { now: input.now } : {}),
  });
}

export function issueLiveSessionViewerTicket(input: { sessionId: string; now?: Date }) {
  return createLiveSessionTicket({
    sessionId: input.sessionId,
    kind: "viewer",
    ...(input.now ? { now: input.now } : {}),
  });
}

function loopLiveSessionDependencies(): LoopLiveSessionDependencies {
  return {
    loadAttempt: async ({ loopRunId, loopNodeRunId, loopNodeAttemptId, attemptNo }) => {
      const attempt = await prisma.loopNodeAttempt.findFirst({
        where: {
          id: loopNodeAttemptId,
          loopNodeRunId,
          attempt: attemptNo,
          loopNodeRun: { loopRunId },
        },
        select: {
          id: true,
          attempt: true,
          loopNodeRunId: true,
          loopNodeRun: {
            select: {
              loopRunId: true,
              loopRun: {
                select: {
                  id: true,
                  projectId: true,
                  taskId: true,
                  bindingSnapshot: true,
                  task: {
                    select: {
                      id: true,
                      spaceId: true,
                      projectId: true,
                      assigneeUserId: true,
                      createdById: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      return attempt;
    },
    findSession: async ({ sessionId, loopNodeAttemptId, leaseGeneration }) => {
      const row = await prisma.liveSession.findFirst({
        where: {
          id: sessionId,
          autoCreated: true,
          loopNodeAttemptId,
          leaseGeneration,
        },
      });
      return row ? toLoopLiveSessionRecord(row) : null;
    },
    loadProjectSpaceId: async (projectId) => {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { spaceId: true },
      });
      return project?.spaceId ?? null;
    },
    createSession: async (record) => {
      const created = await prisma.liveSession.create({
        data: {
          id: record.id,
          kind: record.kind,
          surface: record.surface,
          ownerUserId: record.ownerUserId,
          spaceId: record.spaceId,
          projectId: record.projectId,
          taskId: record.taskId,
          executionPolicy: record.executionPolicy,
          loopNodeRunId: record.loopNodeRunId,
          loopNodeAttemptId: record.loopNodeAttemptId,
          leaseGeneration: record.leaseGeneration,
          streamMode: record.streamMode,
          autoCreated: record.autoCreated,
          activeViewerCount: record.activeViewerCount,
          targetType: record.targetType,
          targetDeviceId: record.targetDeviceId,
          targetWorkerPoolId: record.targetWorkerPoolId,
          targetDisplayName: record.targetDisplayName,
          businessRunType: record.businessRunType,
          businessRunId: record.businessRunId,
          status: record.status,
          controlState: record.controlState,
          journalStatus: record.journal.status,
          journalRetentionDays: record.journal.retentionDays,
          firstSequence: record.journal.firstSequence,
          lastSequence: record.journal.lastSequence,
          expiresAt: record.expiresAt,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        },
      });
      return toLoopLiveSessionRecord(created);
    },
    updateSession: async (record) => {
      const updated = await prisma.liveSession.updateMany({
        where: {
          id: record.id,
          autoCreated: true,
          loopNodeAttemptId: record.loopNodeAttemptId,
          leaseGeneration: record.leaseGeneration,
          expiresAt: { gt: record.updatedAt },
        },
        data: { lastTargetHeartbeatAt: record.updatedAt },
      });
      return updated.count === 1 ? record : null;
    },
    createId: (parts) => derivedPersistenceId(parts),
    createTicket: ({ sessionId, kind, now }) => createLiveSessionTicket({ sessionId, kind, now }),
    now: () => new Date(),
  };
}

function toLoopLiveSessionRecord(row: {
  id: string;
  kind: string;
  surface: string;
  ownerUserId: string;
  spaceId: string;
  projectId: string | null;
  taskId: string | null;
  executionPolicy: string;
  loopNodeRunId: string | null;
  loopNodeAttemptId: string | null;
  leaseGeneration: number | null;
  streamMode: string;
  autoCreated: boolean;
  activeViewerCount: number;
  targetType: string;
  targetDeviceId: string | null;
  targetWorkerPoolId: string | null;
  targetDisplayName: string;
  businessRunType: string | null;
  businessRunId: string | null;
  status: string;
  controlState: string;
  journalStatus: string;
  journalRetentionDays: number;
  firstSequence: number;
  lastSequence: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): LoopLiveSessionRecord {
  return {
    id: row.id,
    kind: row.kind === "worker" ? "worker" : "agent",
    surface: row.surface === "desktop" ? "desktop" : row.surface === "android" ? "android" : "web",
    ownerUserId: row.ownerUserId,
    spaceId: row.spaceId,
    projectId: row.projectId ?? "",
    taskId: row.taskId,
    executionPolicy: "loop",
    loopNodeRunId: row.loopNodeRunId ?? "",
    loopNodeAttemptId: row.loopNodeAttemptId ?? "",
    leaseGeneration: row.leaseGeneration ?? 0,
    streamMode: row.streamMode,
    autoCreated: row.autoCreated,
    activeViewerCount: row.activeViewerCount,
    targetType: row.targetType === "agent_device" ? "agent_device" : "worker_pool",
    targetDeviceId: row.targetDeviceId,
    targetWorkerPoolId: row.targetWorkerPoolId,
    targetDisplayName: row.targetDisplayName,
    businessRunType: "loop_run",
    businessRunId: row.businessRunId ?? "",
    status: row.status === "running" || row.status === "detached" ? row.status : "starting",
    controlState: "detached",
    journal: {
      status: row.journalStatus === "degraded" || row.journalStatus === "replay_unavailable"
        ? row.journalStatus
        : "ready",
      retentionDays: row.journalRetentionDays,
      firstSequence: row.firstSequence,
      lastSequence: row.lastSequence,
    },
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function ensureLoopAttemptLiveSessionWithPrisma(input: {
  loopRunId: string;
  loopNodeRunId: string;
  loopNodeAttemptId: string;
  attemptNo: number;
  leaseGeneration: number;
  target: { type: "worker_pool"; workerPoolId: string } | { type: "agent_device"; deviceId: string };
  now: Date;
}) {
  return ensureLoopAttemptLiveSession(input, loopLiveSessionDependencies());
}

export { derivedLoopLiveSessionId };
