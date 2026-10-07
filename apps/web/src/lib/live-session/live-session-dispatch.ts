import { createLiveSessionTicket } from "./live-session-ticket";
import type { LiveSessionView } from "../../../../../packages/shared/src/index";

/**
 * The Worker/Local Agent assignment only ever needs enough information to open
 * the execution socket. It is intentionally narrower than the full browser
 * dispatch so the assignment payload cannot leak session metadata.
 */
export type LiveSessionDispatch = {
  sessionId: string;
  relayUrl: string;
  authorization: string;
  initialCols: number;
  initialRows: number;
};

export interface DispatchableLiveSessionRecord {
  id: string;
  kind: "agent" | "worker";
  targetType: string;
  targetDeviceId: string | null;
  targetWorkerPoolId: string | null;
  projectId: string | null;
  taskId: string | null;
  businessRunType: string | null;
  businessRunId: string | null;
  targetDisplayName: string;
  executionPolicy: "direct" | "loop";
  status: string;
  expiresAt: Date;
  /** Last heartbeat reported by the execution target, when known. */
  lastTargetHeartbeatAt?: Date | null;
  /** Session-level model choice made at creation time, when one was made. */
  modelSiteId?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
}

export function parseDispatchableLiveSessionRecord(value: unknown): DispatchableLiveSessionRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string"
    || (candidate.kind !== "agent" && candidate.kind !== "worker")
    || (candidate.targetType !== "agent_device" && candidate.targetType !== "worker_pool")
    || (candidate.targetDeviceId !== null && typeof candidate.targetDeviceId !== "string")
    || (candidate.targetWorkerPoolId !== null && typeof candidate.targetWorkerPoolId !== "string")
    || (candidate.projectId !== null && typeof candidate.projectId !== "string")
    || (candidate.taskId !== null && typeof candidate.taskId !== "string")
    || (candidate.businessRunType !== null && typeof candidate.businessRunType !== "string")
    || (candidate.businessRunId !== null && typeof candidate.businessRunId !== "string")
    || (candidate.targetDisplayName !== undefined && typeof candidate.targetDisplayName !== "string")
    || (candidate.executionPolicy !== undefined && candidate.executionPolicy !== "direct" && candidate.executionPolicy !== "loop")
    || typeof candidate.status !== "string"
    || !(candidate.expiresAt instanceof Date)
  ) return null;
  return {
    id: candidate.id,
    kind: candidate.kind,
    targetType: candidate.targetType,
    targetDeviceId: candidate.targetDeviceId as string | null,
    targetWorkerPoolId: candidate.targetWorkerPoolId as string | null,
    projectId: candidate.projectId as string | null,
    taskId: candidate.taskId as string | null,
    businessRunType: candidate.businessRunType as string | null,
    businessRunId: candidate.businessRunId as string | null,
    targetDisplayName: typeof candidate.targetDisplayName === "string" ? candidate.targetDisplayName : "",
    executionPolicy: candidate.executionPolicy === "loop" ? "loop" : "direct",
    status: candidate.status,
    expiresAt: candidate.expiresAt,
    lastTargetHeartbeatAt: candidate.lastTargetHeartbeatAt instanceof Date ? candidate.lastTargetHeartbeatAt : null,
    modelSiteId: typeof candidate.modelSiteId === "string" ? candidate.modelSiteId : null,
    model: typeof candidate.model === "string" ? candidate.model : null,
    reasoningEffort: typeof candidate.reasoningEffort === "string" ? candidate.reasoningEffort : null,
  };
}

export function buildLiveSessionDispatch(input: {
  record: DispatchableLiveSessionRecord;
  relayBaseUrl: string;
  now?: Date;
}): {
  sessionId: string;
  kind: "agent" | "worker";
  target: {
    type: "agent_device";
    deviceId: string;
    displayName: string;
  } | {
    type: "worker_pool";
    workerPoolId: string;
    displayName: string;
  };
  projectId: string | null;
  taskId: string | null;
  executionPolicy: "direct" | "loop";
  relayUrl: string;
  authorization: string;
  modelSelection?: { siteId: string; model: string; reasoningEffort: string } | null;
  initialCols: number;
  initialRows: number;
} {
  const now = input.now ?? new Date();
  if (input.record.status !== "starting" && input.record.status !== "running" && input.record.status !== "detached") {
    throw Object.assign(new Error("Live session is not dispatchable"), { code: "live_session_ended" });
  }
  if (input.record.expiresAt <= now) {
    throw Object.assign(new Error("Live session has expired"), { code: "live_session_ended" });
  }
  let relay: URL;
  try {
    relay = new URL("/live-session/execution", input.relayBaseUrl);
  } catch {
    throw Object.assign(new Error("Live relay URL is invalid"), { code: "live_session_gateway_unavailable" });
  }
  if (relay.protocol !== "https:" && relay.protocol !== "http:") {
    throw Object.assign(new Error("Live relay URL must use HTTP(S)"), { code: "live_session_gateway_unavailable" });
  }
  const ticket = createLiveSessionTicket({
    sessionId: input.record.id,
    kind: "execution",
    now,
  });
  relay.protocol = relay.protocol === "https:" ? "wss:" : "ws:";
  relay.searchParams.set("sessionId", input.record.id);
  relay.searchParams.set("ticket", ticket.token);
  return {
    sessionId: input.record.id,
    kind: input.record.kind,
    target: input.record.targetType === "agent_device"
      ? {
          type: "agent_device" as const,
          deviceId: input.record.targetDeviceId ?? "",
          displayName: input.record.targetDisplayName ?? "",
        }
      : {
          type: "worker_pool" as const,
          workerPoolId: input.record.targetWorkerPoolId ?? "",
          displayName: input.record.targetDisplayName ?? "",
        },
    projectId: input.record.projectId,
    taskId: input.record.taskId,
    executionPolicy: input.record.executionPolicy,
    relayUrl: relay.toString(),
    authorization: ticket.token,
    // Only present when the user picked a model; absent keeps the Desktop on its
    // own account default, which is what older desktops rely on.
    ...(input.record.modelSiteId && input.record.model
      ? {
          modelSelection: {
            siteId: input.record.modelSiteId,
            model: input.record.model,
            reasoningEffort: input.record.reasoningEffort ?? "high",
          },
        }
      : {}),
    initialCols: 120,
    initialRows: 36,
  };
}

export async function findDispatchableAgentLiveSession(input: {
  deviceId: string;
  userId: string;
  now: Date;
  relayBaseUrl: string;
  resolveRuntime?(): Promise<{
    endpoint: string;
    apiKey: string;
    model: string;
    reasoningEffort: string;
  }>;
  load(deviceId: string, userId: string, now: Date): Promise<unknown>;
  claimStarting?(sessionId: string, now: Date): Promise<boolean>;
}): Promise<ReturnType<typeof buildLiveSessionDispatch> | null> {
  const record = parseDispatchableLiveSessionRecord(
    await input.load(input.deviceId, input.userId, input.now),
  );
  if (!record) return null;
  if (record.status !== "starting") return null;
  if (input.claimStarting && !await input.claimStarting(record.id, input.now)) return null;
  const runtime = input.resolveRuntime ? await input.resolveRuntime() : undefined;
  const dispatch = buildLiveSessionDispatch({
    record,
    relayBaseUrl: input.relayBaseUrl,
    now: input.now,
  });
  const withRuntime = runtime ? { ...dispatch, runtime } : dispatch;
  return withRuntime;
}

export async function findDispatchableWorkerLiveSession(input: {
  workerPoolId: string;
  now: Date;
  relayBaseUrl: string;
  resolveRuntime?(record: DispatchableLiveSessionRecord): Promise<{
    endpoint: string;
    apiKey: string;
    model: string;
    reasoningEffort: string;
  }>;
  load(workerPoolId: string, now: Date): Promise<unknown>;
  claimStarting?(sessionId: string, now: Date): Promise<boolean>;
  /**
   * Reclaims an in-flight session whose execution target stopped heartbeating
   * (for example a Worker Pod that was replaced). Without this an abandoned
   * `running` row blocks its Worker Pool queue forever, because the claim path
   * only ever inspects the oldest active row.
   */
  reacquire?(sessionId: string, now: Date): Promise<boolean>;
}): Promise<ReturnType<typeof buildLiveSessionDispatch> | null> {
  const record = parseDispatchableLiveSessionRecord(
    await input.load(input.workerPoolId, input.now),
  );
  if (!record) return null;
  if (record.status === "starting") {
    if (input.claimStarting && !await input.claimStarting(record.id, input.now)) return null;
  } else if (record.status === "running" || record.status === "detached") {
    // Ownership of a live session is proven by a recent heartbeat; callers only
    // load stale rows here, and `reacquire` re-checks that atomically.
    if (!input.reacquire || !await input.reacquire(record.id, input.now)) return null;
  } else return null;
  const runtime = input.resolveRuntime ? await input.resolveRuntime(record) : undefined;
  const dispatch = buildLiveSessionDispatch({
    record,
    relayBaseUrl: input.relayBaseUrl,
    now: input.now,
  });
  const withRuntime = runtime ? { ...dispatch, runtime } : dispatch;
  return withRuntime;
}

export async function loadLiveSessionDispatchForAssignment(input: {
  ownerUserId: string;
  target: { type: "agent_device"; id: string } | { type: "worker_pool"; id: string };
  loopRunId: string;
  relayBaseUrl: string;
  now: Date;
  load(query: {
    ownerUserId: string;
    targetType: "agent_device" | "worker_pool";
    targetId: string;
    loopRunId: string;
    now: Date;
  }): Promise<DispatchableLiveSessionRecord | null>;
}): Promise<ReturnType<typeof buildLiveSessionDispatch> | null> {
  const record = await input.load({
    ownerUserId: input.ownerUserId,
    targetType: input.target.type,
    targetId: input.target.id,
    loopRunId: input.loopRunId,
    now: input.now,
  });
  if (!record) return null;
  if (record.businessRunType !== "loop_run" || record.businessRunId !== input.loopRunId) {
    throw Object.assign(new Error("Live session business run does not match the claimed assignment"), {
      code: "live_session_ended",
    });
  }
  return buildLiveSessionDispatch({
    record,
    relayBaseUrl: input.relayBaseUrl,
    now: input.now,
  });
}

/**
 * Resolves at most one active LiveSession for a claimed Loop attempt. The
 * newest starting session wins so a user retry attaches to the current run
 * instead of an abandoned earlier attempt. The returned dispatch contains a
 * short-lived execution ticket and never terminal content.
 */
export async function findDispatchForClaimedLoop(input: {
  ownerUserId: string | null;
  target: { type: "agent_device"; id: string } | { type: "worker_pool"; id: string };
  loopRunId: string;
  relayBaseUrl: string;
  now: Date;
  load(query: {
    ownerUserId: string | null;
    targetType: "agent_device" | "worker_pool";
    targetId: string;
    loopRunId: string;
    now: Date;
  }): Promise<unknown>;
  markRunning?(sessionId: string, now: Date): Promise<void>;
}): Promise<ReturnType<typeof buildLiveSessionDispatch> | null> {
  const loaded = await input.load({
    ownerUserId: input.ownerUserId,
    targetType: input.target.type,
    targetId: input.target.id,
    loopRunId: input.loopRunId,
    now: input.now,
  });
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) return null;
  const candidate = loaded as Record<string, unknown>;
  if (
    typeof candidate.id !== "string"
    || (candidate.kind !== "agent" && candidate.kind !== "worker")
    || (candidate.targetType !== "agent_device" && candidate.targetType !== "worker_pool")
    || (candidate.targetDeviceId !== null && typeof candidate.targetDeviceId !== "string")
    || (candidate.targetWorkerPoolId !== null && typeof candidate.targetWorkerPoolId !== "string")
    || (candidate.projectId !== null && typeof candidate.projectId !== "string")
    || (candidate.taskId !== null && typeof candidate.taskId !== "string")
    || (candidate.businessRunType !== null && typeof candidate.businessRunType !== "string")
    || (candidate.businessRunId !== null && typeof candidate.businessRunId !== "string")
    || typeof candidate.status !== "string"
    || !(candidate.expiresAt instanceof Date)
  ) return null;
  const record: DispatchableLiveSessionRecord = {
    id: candidate.id,
    kind: candidate.kind,
    targetType: candidate.targetType,
    targetDeviceId: candidate.targetDeviceId as string | null,
    targetWorkerPoolId: candidate.targetWorkerPoolId as string | null,
    projectId: candidate.projectId as string | null,
    taskId: candidate.taskId as string | null,
    businessRunType: candidate.businessRunType as string | null,
    businessRunId: candidate.businessRunId as string | null,
    targetDisplayName: typeof candidate.targetDisplayName === "string" ? candidate.targetDisplayName : "",
    executionPolicy: candidate.executionPolicy === "loop" ? "loop" : "direct",
    status: candidate.status,
    expiresAt: candidate.expiresAt,
    lastTargetHeartbeatAt: candidate.lastTargetHeartbeatAt instanceof Date ? candidate.lastTargetHeartbeatAt : null,
  };
  const dispatch = buildLiveSessionDispatch({
    record,
    relayBaseUrl: input.relayBaseUrl,
    now: input.now,
  });
  await input.markRunning?.(dispatch.sessionId, input.now);
  return dispatch;
}

/**
 * Builds the execution dispatch for an automatically created Loop session.
 * The session record is already persisted and attempt-bound, so this only has
 * to project the relay endpoint and a short-lived execution ticket.
 */
export function buildAttemptLiveSessionDispatch(input: {
  session: LiveSessionView;
  executionTicket: { token: string };
  relayBaseUrl: string;
}): LiveSessionDispatch {
  const relay = new URL("/live-session/execution", input.relayBaseUrl);
  if (relay.protocol !== "https:" && relay.protocol !== "http:") {
    throw Object.assign(new Error("Live relay URL must use HTTP(S)"), {
      code: "live_session_gateway_unavailable",
    });
  }
  relay.protocol = relay.protocol === "https:" ? "wss:" : "ws:";
  relay.searchParams.set("sessionId", input.session.id);
  relay.searchParams.set("ticket", input.executionTicket.token);
  return {
    authorization: input.executionTicket.token,
    relayUrl: relay.toString(),
    sessionId: input.session.id,
    initialCols: 120,
    initialRows: 36,
  };
}
