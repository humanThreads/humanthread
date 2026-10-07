import { OrchestrationPersistenceError } from "./orchestration-events";
import { parsePublishedLoopGraph } from "@humanthread/shared";
import type { Prisma } from "@prisma/client";
import { buildAccessibleProjectWhere } from "./access-control";

export interface AgentRunIdentity {
  taskId?: string | null;
  loopNodeRunId?: string | null;
  task?: unknown;
  loopNodeRun?: unknown;
}

type AgentRunRecordCreateInput<TData extends AgentRunIdentity, TResult> = {
  agentRun: { create(args: { data: TData }): Promise<TResult> };
  data: TData;
  persist?: never;
};

type AgentRunRecordPersistInput<
  TData extends AgentRunIdentity | readonly AgentRunIdentity[],
  TResult,
> = {
  agentRun?: never;
  data: TData;
  persist(data: TData): Promise<TResult>;
};

type AgentRunRecordInput =
  | AgentRunRecordCreateInput<AgentRunIdentity, unknown>
  | AgentRunRecordPersistInput<
      AgentRunIdentity | readonly AgentRunIdentity[],
      unknown
    >;

function hasAgentRunDelegate(
  input: AgentRunRecordInput,
): input is AgentRunRecordCreateInput<AgentRunIdentity, unknown> {
  return "agentRun" in input;
}

export function assertAgentRunIdentity(identity: AgentRunIdentity): void {
  const hasLegacyIdentity = identity.taskId != null || identity.task != null;
  const hasGraphIdentity =
    identity.loopNodeRunId != null || identity.loopNodeRun != null;
  if (hasLegacyIdentity === hasGraphIdentity) {
    throw Object.assign(
      new Error("AgentRun must have exactly one legacy Task or graph NodeRun identity"),
      { code: "invalid_agent_run_identity" },
    );
  }
}

export function createAgentRunRecord<TData extends AgentRunIdentity, TResult>(
  input: AgentRunRecordCreateInput<TData, TResult>,
): Promise<TResult>;
export function createAgentRunRecord<
  TData extends AgentRunIdentity | readonly AgentRunIdentity[],
  TResult,
>(
  input: AgentRunRecordPersistInput<TData, TResult>,
): Promise<TResult>;
export async function createAgentRunRecord(
  input: AgentRunRecordInput,
): Promise<unknown> {
  const identities = Array.isArray(input.data) ? input.data : [input.data];
  for (const identity of identities) {
    assertAgentRunIdentity(identity);
  }

  if (hasAgentRunDelegate(input)) {
    return input.agentRun.create({ data: input.data });
  }

  return input.persist(input.data);
}

export async function claimAgentRun(input: {
  tx: Pick<Prisma.TransactionClient, "agentWorker" | "agentRun" | "deviceAgentRuntimeProfile">;
  workerId: string;
  deviceId: string;
  userId: string;
  capabilities: string[];
  now: Date;
  leaseDurationMs: number;
}) {
  const worker = await input.tx.agentWorker.findUnique({
    where: { id: input.workerId },
    select: {
      id: true,
      localDeviceId: true,
      status: true,
      capabilities: true,
      activeRunCount: true,
      maxConcurrentRuns: true,
    },
  });
  const workerCapabilities = stringArray(worker?.capabilities);
  const requestedCapabilities = [...new Set(input.capabilities)];
  if (
    !worker
    || worker.localDeviceId !== input.deviceId
    || worker.status !== "online"
    || worker.activeRunCount >= worker.maxConcurrentRuns
    || requestedCapabilities.some((capability) => !workerCapabilities.includes(capability))
  ) return null;

  const runtimeProfiles = await input.tx.deviceAgentRuntimeProfile.findMany({
    where: {
      userId: input.userId,
      localDeviceId: input.deviceId,
      status: "ready",
    },
    select: { provider: true, capabilities: true },
  });
  const runtimeCapabilitiesByProvider = new Map(runtimeProfiles.map((profile) => [
    profile.provider,
    stringArray(profile.capabilities),
  ]));

  const candidates = await input.tx.agentRun.findMany({
    where: {
      status: "queued",
      taskId: null,
      project: { is: buildAccessibleProjectWhere({ userId: input.userId }) },
      loopNodeRunId: { not: null },
      loopRun: { engineKind: "graph_v1", status: "running" },
      loopNodeAttempt: {
        executorType: "local",
        status: "running",
        loopNodeRun: { status: "running", selectedExecutionTarget: "local" },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 25,
    select: {
      id: true,
      leaseGeneration: true,
      agentProfile: { select: { provider: true, capabilities: true } },
      loopNodeAttempt: {
        select: {
          loopNodeRun: {
            select: {
              nodeKey: true,
              loopRun: { select: { bindingSnapshot: true, executionSnapshot: true, loopVersion: { select: { graph: true } } } },
            },
          },
        },
      },
    },
  });
  const run = candidates.find((candidate) => {
    const attempt = candidate.loopNodeAttempt;
    const loopRun = attempt?.loopNodeRun.loopRun;
    const graphValue = loopRun?.loopVersion?.graph;
    if (!attempt || graphValue === undefined) return false;
    if (hasLinuxWorkerExecution(loopRun?.executionSnapshot, loopRun?.bindingSnapshot)) return false;
    const graph = parsePublishedLoopGraph(graphValue);
    const node = graph.nodes.find(({ key }) => key === attempt.loopNodeRun.nodeKey);
    if (!node || node.type !== "agent_action") return false;
    return matchesAgentRunCapabilities({
      workerCapabilities,
      advertisedCapabilities: requestedCapabilities,
      runtimeCapabilities: runtimeCapabilitiesByProvider.get(candidate.agentProfile.provider) ?? [],
      profileCapabilities: stringArray(candidate.agentProfile.capabilities),
      requiredCapabilities: node.requiredCapabilities ?? [],
    });
  });
  if (!run) return null;
  const nextGeneration = run.leaseGeneration + 1;
  const leaseExpiresAt = new Date(input.now.getTime() + input.leaseDurationMs);
  const claimed = await input.tx.agentRun.updateMany({ where: { id: run.id, status: "queued", leaseGeneration: run.leaseGeneration }, data: { status: "claimed", workerId: input.workerId, leaseGeneration: nextGeneration, leaseExpiresAt, lastHeartbeatAt: input.now, version: { increment: 1 } } });
  if (claimed.count !== 1) throw new OrchestrationPersistenceError("version_conflict", "AgentRun was claimed concurrently");
  const reservedCapacity = await input.tx.agentWorker.updateMany({
    where: {
      id: worker.id,
      localDeviceId: input.deviceId,
      status: "online",
      activeRunCount: worker.activeRunCount,
      maxConcurrentRuns: worker.maxConcurrentRuns,
    },
    data: { activeRunCount: { increment: 1 } },
  });
  if (reservedCapacity.count !== 1) {
    throw new OrchestrationPersistenceError("version_conflict", "AgentWorker capacity changed concurrently");
  }
  return input.tx.agentRun.findUnique({ where: { id: run.id } });
}

function hasLinuxWorkerExecution(executionSnapshot: unknown, bindingSnapshot: unknown): boolean {
  const target = executionSnapshot
    && typeof executionSnapshot === "object"
    && !Array.isArray(executionSnapshot)
    ? (executionSnapshot as { target?: { type?: unknown } }).target
    : undefined;
  if (target && typeof target === "object" && target.type === "linux_worker_pool") return true;
  if (target && typeof target === "object" && target.type === "local_agent") return false;
  return Boolean(
    bindingSnapshot
    && typeof bindingSnapshot === "object"
    && !Array.isArray(bindingSnapshot)
    && "workerExecution" in bindingSnapshot
    && (bindingSnapshot as { workerExecution?: unknown }).workerExecution !== undefined,
  );
}

export function matchesAgentRunCapabilities(input: {
  workerCapabilities: string[];
  advertisedCapabilities: string[];
  runtimeCapabilities: string[];
  profileCapabilities: string[];
  requiredCapabilities: string[];
}): boolean {
  const workerCapabilities = new Set(input.workerCapabilities.map(normalizeAgentCapability));
  const advertisedCapabilities = new Set(input.advertisedCapabilities.map(normalizeAgentCapability));
  const runtimeCapabilities = new Set(input.runtimeCapabilities.map(normalizeAgentCapability));
  return [...new Set([
    ...input.profileCapabilities,
    ...input.requiredCapabilities,
  ].map(normalizeAgentCapability))].every((capability) => (
    runtimeCapabilities.has(capability)
    || (workerCapabilities.has(capability) && advertisedCapabilities.has(capability))
  ));
}

function normalizeAgentCapability(capability: string): string {
  return capability === "filesystem" ? "files" : capability;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return [];
  }

  return value;
}

export async function heartbeatAgentRun(input: {
  tx: Pick<Prisma.TransactionClient, "agentRun">;
  runId: string; workerId: string; leaseGeneration: number; now: Date; leaseDurationMs: number;
}) {
  const leaseExpiresAt = new Date(input.now.getTime() + input.leaseDurationMs);
  const result = await input.tx.agentRun.updateMany({ where: { id: input.runId, workerId: input.workerId, leaseGeneration: input.leaseGeneration, status: { in: ["claimed", "starting", "running", "waiting_approval"] }, leaseExpiresAt: { gt: input.now } }, data: { lastHeartbeatAt: input.now, leaseExpiresAt } });
  if (result.count !== 1) throw Object.assign(new Error("Stale or expired AgentRun lease"), { code: "stale_lease" });
  return { leaseExpiresAt };
}

const ACTIVE_AGENT_RUN_STATUSES = ["claimed", "starting", "running", "waiting_approval"] as const;

export async function invalidateLoopRunAgentLeases(input: {
  tx: Pick<Prisma.TransactionClient, "agentRun" | "agentWorker">;
  loopRunId: string;
  reason: "pause" | "cancel";
  now: Date;
}): Promise<{ invalidated: number; releasedCapacity: number }> {
  const activeRuns = await input.tx.agentRun.findMany({
    where: {
      loopRunId: input.loopRunId,
      status: { in: [...ACTIVE_AGENT_RUN_STATUSES] },
    },
    select: { id: true, workerId: true, leaseGeneration: true },
  });
  const releasedByWorker = new Map<string, number>();
  let invalidated = 0;
  for (const run of activeRuns) {
    const updated = await input.tx.agentRun.updateMany({
      where: {
        id: run.id,
        loopRunId: input.loopRunId,
        leaseGeneration: run.leaseGeneration,
        status: { in: [...ACTIVE_AGENT_RUN_STATUSES] },
      },
      data: {
        status: input.reason === "pause" ? "orphaned" : "cancelled",
        leaseGeneration: run.leaseGeneration + 1,
        leaseExpiresAt: input.now,
        exitReason: input.reason === "pause" ? "loop_paused" : "loop_cancelled",
        ...(input.reason === "cancel" ? { finishedAt: input.now } : {}),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) continue;
    invalidated += 1;
    if (run.workerId) releasedByWorker.set(run.workerId, (releasedByWorker.get(run.workerId) ?? 0) + 1);
  }

  let releasedCapacity = 0;
  for (const [workerId, count] of releasedByWorker) {
    const released = await input.tx.agentWorker.updateMany({
      where: { id: workerId, activeRunCount: { gte: count } },
      data: { activeRunCount: { decrement: count }, version: { increment: 1 } },
    });
    if (released.count === 1) releasedCapacity += count;
  }
  return { invalidated, releasedCapacity };
}

export async function deactivateAgentWorker(input: {
  tx: Pick<Prisma.TransactionClient, "agentRun" | "agentWorker">;
  workerId: string;
  deviceId: string;
  now: Date;
}): Promise<{ invalidated: number }> {
  const invalidated = await input.tx.agentRun.updateMany({
    where: {
      workerId: input.workerId,
      status: { in: [...ACTIVE_AGENT_RUN_STATUSES] },
    },
    data: {
      status: "orphaned",
      leaseGeneration: { increment: 1 },
      leaseExpiresAt: input.now,
      exitReason: "worker_disabled",
      version: { increment: 1 },
    },
  });
  const worker = await input.tx.agentWorker.updateMany({
    where: { id: input.workerId, localDeviceId: input.deviceId },
    data: {
      status: "offline",
      activeRunCount: 0,
      lastHeartbeatAt: input.now,
      version: { increment: 1 },
    },
  });
  if (worker.count !== 1) {
    throw new OrchestrationPersistenceError("version_conflict", "AgentWorker changed while disabling execution");
  }
  return { invalidated: invalidated.count };
}
