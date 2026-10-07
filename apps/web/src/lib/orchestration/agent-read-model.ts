import type { Prisma } from "@prisma/client";
import { buildAccessibleTaskWhere, prisma } from "../../../../../packages/db/src/index";
import { projectApprovalDecisionItem } from "./approval-read-model";
import { buildActiveApprovalWhere, expirePendingApprovals } from "./approval-visibility";

type AgentControlPlaneInput = {
  userId: string;
  ownerType?: "company" | "personal" | null;
  companyId?: string | null;
  includeRuns?: boolean;
  runCursor?: string | null;
};

export const AGENT_RUN_PAGE_SIZE = 20;
const ACTIVE_WORKER_HEARTBEAT_WINDOW_MS = 30_000;
const ACTIVE_AGENT_RUN_STATUSES = ["claimed", "starting", "running", "waiting_approval"] as const;

type AgentRunCursor = { id: string; createdAt: Date };

export function encodeAgentRunCursor(cursor: AgentRunCursor): string {
  return Buffer.from(JSON.stringify({ id: cursor.id, createdAt: cursor.createdAt.toISOString() }), "utf8").toString("base64url");
}

export function decodeAgentRunCursor(value: string | null | undefined): AgentRunCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { id?: unknown; createdAt?: unknown };
    const createdAt = new Date(typeof parsed.createdAt === "string" ? parsed.createdAt : "");
    if (typeof parsed.id !== "string" || parsed.id.length === 0 || Number.isNaN(createdAt.getTime())) return null;
    return { id: parsed.id, createdAt };
  } catch {
    return null;
  }
}

export function getAgentRunCursorWhere(value: string | null | undefined): Prisma.AgentRunWhereInput | null {
  const cursor = decodeAgentRunCursor(value);
  if (!cursor) return null;
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

export function isTaskScopedRecord<T extends { taskId: string | null; task: unknown | null }>(
  record: T,
): record is T & { taskId: string; task: NonNullable<T["task"]> } {
  return Boolean(record.taskId && record.task);
}

type AgentLoopMonitorRecord = {
  id: string;
  taskId: string | null;
  task: { title: string } | null;
  project: { name: string } | null;
  inputSnapshot: unknown;
  status: string;
  statusReason: string | null;
  version: number;
  currentIteration: number;
  budgetSnapshot: unknown;
  parentLoopRunId: string | null;
  parentLoopRun: { loopVersion: { loopDefinition: { name: string } } | null } | null;
  loopVersion: { loopDefinition: { name: string; scope: string } } | null;
};

export function projectLoopMonitorItem(
  loop: AgentLoopMonitorRecord,
  latestRun: { attempt: number; lastHeartbeatAt: Date | null } | undefined,
) {
  const budget = loop.budgetSnapshot && typeof loop.budgetSnapshot === "object"
    ? loop.budgetSnapshot as Record<string, unknown>
    : {};
  const inputSnapshot = loop.inputSnapshot && typeof loop.inputSnapshot === "object" && !Array.isArray(loop.inputSnapshot)
    ? loop.inputSnapshot as Record<string, unknown>
    : {};
  const releasePlanName = typeof inputSnapshot.releasePlanName === "string" && inputSnapshot.releasePlanName.trim()
    ? inputSnapshot.releasePlanName.trim()
    : null;
  return {
    id: loop.id,
    taskId: loop.taskId,
    taskTitle: loop.task?.title ?? releasePlanName ?? `${loop.project?.name ?? "项目"} · 项目级 Loop`,
    loopName: loop.loopVersion?.loopDefinition.name ?? "未命名 Loop",
    scope: loop.loopVersion?.loopDefinition.scope === "project" ? "project" as const : "task" as const,
    parentLoopRunId: loop.parentLoopRunId,
    parentLoopName: loop.parentLoopRun?.loopVersion?.loopDefinition.name ?? null,
    status: loop.status,
    waitingReason: loop.statusReason,
    version: loop.version,
    currentIteration: loop.currentIteration,
    maxIterations: Number(budget.maxIterations ?? 1),
    attempt: latestRun?.attempt ?? 0,
    lastHeartbeatAt: latestRun?.lastHeartbeatAt ?? null,
  };
}

export function buildAccessibleAgentSpaceWhere(input: AgentControlPlaneInput): Prisma.SpaceWhereInput {
  if (input.ownerType === "personal") return { type: "personal", ownerUserId: input.userId };
  if (input.ownerType === "company" && input.companyId) {
    return {
      type: "company",
      companyId: input.companyId,
      company: { members: { some: { userId: input.userId, status: "active" } } },
    };
  }
  return {
    OR: [
      { type: "personal", ownerUserId: input.userId },
      { type: "company", company: { members: { some: { userId: input.userId, status: "active" } } } },
    ],
  };
}

export function buildActiveAgentLoopRunWhere(spaceIds: string[]): Prisma.LoopRunWhereInput {
  return {
    OR: [
      { taskId: { not: null }, task: { project: { spaceId: { in: spaceIds } } } },
      { taskId: null, project: { spaceId: { in: spaceIds } } },
    ],
    status: { in: ["created", "running", "paused", "waiting_approval", "waiting"] },
  };
}

export function buildAgentWorkerWhere(input: {
  userId: string;
  spaceIds: string[];
  now?: Date;
}): Prisma.AgentWorkerWhereInput {
  const freshAfter = new Date((input.now ?? new Date()).getTime() - ACTIVE_WORKER_HEARTBEAT_WINDOW_MS);
  return {
    status: "online",
    AND: [
      { OR: [
        { spaceId: { in: input.spaceIds } },
        { localDevice: { userId: input.userId, status: "authorized" } },
      ] },
      { OR: [
        { lastHeartbeatAt: { gte: freshAfter } },
        { runs: { some: {
          status: { in: [...ACTIVE_AGENT_RUN_STATUSES] },
          lastHeartbeatAt: { gte: freshAfter },
        } } },
      ] },
    ],
  };
}

export async function getAgentControlPlane(input: AgentControlPlaneInput) {
  const spaces = await prisma.space.findMany({
    where: buildAccessibleAgentSpaceWhere(input),
    select: {
      id: true,
      type: true,
      ownerUserId: true,
      company: { select: { members: { where: { userId: input.userId, status: "active" }, take: 1, select: { role: true } } } },
    },
  });
  const spaceIds = spaces.map(({ id }) => id);
  const canManage = spaces.some((space) =>
    space.type === "personal" && space.ownerUserId === input.userId
    || ["owner", "admin", "member"].includes(space.company?.members[0]?.role ?? ""),
  );
  const now = new Date();
  await expirePendingApprovals({
    now,
    scope: { project: { spaceId: { in: spaceIds } } },
    updateMany: (args) => prisma.approvalRequest.updateMany(args),
  });
  const runCursorWhere = getAgentRunCursorWhere(input.runCursor);
  const runsQuery = input.includeRuns === false
    ? Promise.resolve([])
    : prisma.agentRun.findMany({ where: { agentProfile: { spaceId: { in: spaceIds } }, OR: [{ taskId: { not: null } }, { loopRunId: { not: null }, loopNodeRunId: { not: null } }], ...(runCursorWhere ? { AND: [runCursorWhere] } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: AGENT_RUN_PAGE_SIZE + 1, select: { id: true, taskId: true, loopRunId: true, loopNodeRunId: true, status: true, attempt: true, createdAt: true, lastHeartbeatAt: true, task: { select: { title: true } }, loopRun: { select: { task: { select: { title: true } } } }, loopNodeRun: { select: { nodeKey: true } }, agentProfile: { select: { provider: true } }, worker: { select: { name: true } } } });
  const [profiles, workers, runs, approvals, loops] = await Promise.all([
    prisma.agentProfile.findMany({ where: { spaceId: { in: spaceIds } }, orderBy: { name: "asc" }, select: { id: true, spaceId: true, name: true, provider: true, status: true, model: true } })
      .then((rows) => rows.map((profile) => ({
        ...profile,
        provider: profile.provider === "claude" ? "claude" as const : "codex" as const,
        status: profile.status === "disabled" ? "disabled" as const : "active" as const,
      }))),
    prisma.agentWorker.findMany({ where: buildAgentWorkerWhere({ userId: input.userId, spaceIds, now }), orderBy: { name: "asc" }, select: { id: true, name: true, runtimeType: true, agentVersion: true, status: true, activeRunCount: true, maxConcurrentRuns: true, lastHeartbeatAt: true } }),
    runsQuery,
    prisma.approvalRequest.findMany({ where: { project: { spaceId: { in: spaceIds } }, ...buildActiveApprovalWhere(now) }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, type: true, status: true, projectId: true, createdAt: true, requestPayload: true, policySnapshot: true, taskId: true, task: { select: { id: true, shortId: true, title: true } }, project: { select: { name: true } }, loopRunId: true, loopRun: { select: { id: true, taskId: true, task: { select: { id: true, shortId: true, title: true } }, loopVersion: { select: { graph: true, loopDefinition: { select: { name: true } } } } } }, loopNodeRunId: true, loopNodeRun: { select: { id: true, nodeKey: true, inputSnapshot: true, artifacts: { where: { type: "review_html" }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, type: true, mimeType: true, byteSize: true, metadata: true } } } } } }),
    prisma.loopRun.findMany({ where: buildActiveAgentLoopRunWhere(spaceIds), orderBy: { createdAt: "desc" }, take: 30, select: { id: true, taskId: true, status: true, statusReason: true, version: true, currentIteration: true, budgetSnapshot: true, inputSnapshot: true, parentLoopRunId: true, task: { select: { title: true } }, project: { select: { name: true } }, loopVersion: { select: { loopDefinition: { select: { name: true, scope: true } } } }, parentLoopRun: { select: { loopVersion: { select: { loopDefinition: { select: { name: true } } } } } } } }),
  ]);
  const hasMoreRuns = runs.length > AGENT_RUN_PAGE_SIZE;
  const runPage = runs.slice(0, AGENT_RUN_PAGE_SIZE);
  const taskRuns = runPage.filter((run) => Boolean(run.taskId && run.task) || Boolean(run.loopRunId && run.loopNodeRun));
  const taskLoops = loops.filter(isTaskScopedRecord);
  const latestRunsByTask = new Map<string, { attempt: number; lastHeartbeatAt: Date | null }>();
  const latestAttemptGroups = taskLoops.length === 0 ? [] : await prisma.agentRun.groupBy({ by: ["taskId"], where: { taskId: { in: taskLoops.map(({ taskId }) => taskId) } }, _max: { attempt: true } });
  const loopRuns = latestAttemptGroups.length === 0 ? [] : await prisma.agentRun.findMany({ where: { OR: latestAttemptGroups.flatMap((group) => group.taskId && group._max.attempt !== null ? [{ taskId: group.taskId, attempt: group._max.attempt }] : []) }, select: { taskId: true, attempt: true, lastHeartbeatAt: true } });
  for (const run of loopRuns) if (run.taskId) latestRunsByTask.set(run.taskId, run);
  return {
    profiles,
    workers,
    canManage,
    nextRunCursor: hasMoreRuns && runPage.length > 0 ? encodeAgentRunCursor(runPage[runPage.length - 1]!) : null,
    runs: taskRuns.map((run) => ({ id: run.id, taskId: run.taskId ?? null, loopRunId: run.loopRunId, nodeKey: run.loopNodeRun?.nodeKey ?? null, taskTitle: run.task?.title ?? run.loopRun?.task?.title ?? "未关联任务", status: run.status, attempt: run.attempt, provider: run.agentProfile.provider, workerName: run.worker?.name ?? null, createdAt: run.createdAt, lastHeartbeatAt: run.lastHeartbeatAt })),
    loops: loops.map((loop) => projectLoopMonitorItem(loop, loop.taskId ? latestRunsByTask.get(loop.taskId) : undefined)),
    approvals: approvals.map(projectApprovalDecisionItem),
  };
}

export async function listTaskAgentProfiles(input: { userId: string; taskId: string }) {
  const task = await prisma.task.findFirst({
    where: {
      AND: [{ id: input.taskId }, buildAccessibleTaskWhere({ userId: input.userId })],
    },
    select: { spaceId: true },
  });
  if (!task?.spaceId) return [];
  return prisma.agentProfile.findMany({
    where: { spaceId: task.spaceId, status: "active" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, provider: true, status: true },
  });
}
