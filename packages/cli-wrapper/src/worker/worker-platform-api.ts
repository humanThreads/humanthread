import { randomUUID } from "node:crypto";

import type {
  LinuxWorkerAssignment,
  WorkerApi,
  WorkerLifecycleEvent,
  WorkerResult,
  WorkerSession,
  WorkerValidationAssignment,
} from "./worker-runtime";

function platformError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message.slice(0, 512)), { code });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isWorkerValidationAssignment(value: unknown): value is WorkerValidationAssignment {
  const assignment = record(value);
  return typeof assignment?.id === "string"
    && /^[a-f0-9]{32}$/u.test(assignment.id)
    && assignment.kind === "worker_validation"
    && assignment.sideEffect === false;
}

function directWorkerLiveSession(value: unknown, poolId: string) {
  const candidate = record(value);
  if (
    !candidate
    || typeof candidate.sessionId !== "string"
    || !/^[a-f0-9]{32}$/u.test(candidate.sessionId)
    || candidate.kind !== "worker"
    || candidate.executionPolicy !== "direct"
    || typeof candidate.projectId !== "string"
    || !candidate.projectId.trim()
    || !(typeof candidate.taskId === "string" || candidate.taskId === null)
    || typeof candidate.relayUrl !== "string"
    || typeof candidate.authorization !== "string"
    || !candidate.authorization.trim()
    || !Number.isSafeInteger(candidate.initialCols)
    || !Number.isSafeInteger(candidate.initialRows)
  ) return null;
  const runtime = record(candidate.runtime);
  if (
    !runtime
    || typeof runtime.endpoint !== "string"
    || typeof runtime.apiKey !== "string"
    || typeof runtime.model !== "string"
    || typeof runtime.reasoningEffort !== "string"
  ) return null;
  const target = record(candidate.target);
  if (target?.type !== "worker_pool" || target.workerPoolId !== poolId || typeof target.displayName !== "string") {
    return null;
  }
  return {
    sessionId: candidate.sessionId,
    kind: "worker" as const,
    projectId: candidate.projectId,
    taskId: candidate.taskId as string | null,
    executionPolicy: "direct" as const,
    relayUrl: candidate.relayUrl,
    authorization: candidate.authorization,
    initialCols: Number(candidate.initialCols),
    initialRows: Number(candidate.initialRows),
    runtime: {
      endpoint: runtime.endpoint,
      apiKey: runtime.apiKey,
      model: runtime.model,
      reasoningEffort: runtime.reasoningEffort,
    },
  };
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export function createWorkerPlatformApi(input: {
  platformUrl: string;
  poolToken: string;
  fetch?: typeof fetch;
  /**
   * Every platform request is bounded. Without a deadline a black-holed
   * connection blocks the worker's single tick loop forever: the process stays
   * alive but stops heartbeating and never claims again, which looks identical
   * to an idle worker from the outside.
   */
  requestTimeoutMs?: number;
  onRegistered?: (session: WorkerSession) => void;
}): WorkerApi {
  let baseUrl: URL;
  try { baseUrl = new URL(input.platformUrl); } catch { throw platformError("invalid_arguments", "Worker platform URL is invalid"); }
  if (!input.poolToken.trim()) throw platformError("authentication_required", "Worker Pool token is required");
  const request = input.fetch ?? fetch;
  const requestTimeoutMs = input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 600_000) {
    throw platformError("invalid_arguments", "Worker platform request timeout is invalid");
  }
  const sequences = new Map<string, number>();
  const deliveries = new Map<string, Promise<void>>();

  const serializeDelivery = <T>(agentRunId: string, operation: () => Promise<T>): Promise<T> => {
    const previous = deliveries.get(agentRunId) ?? Promise.resolve();
    const current = previous.then(operation);
    deliveries.set(agentRunId, current.then(() => undefined, () => undefined));
    return current;
  };

  const post = async (path: string, headers: Record<string, string>, body: unknown): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    timer.unref?.();
    let response: Response;
    try {
      response = await request(new URL(path, baseUrl).toString(), {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      // A deadline breach must be a retryable transport failure, not a silent
      // hang: the caller's backoff then re-registers instead of stalling.
      if (controller.signal.aborted) {
        throw platformError("provider_transport_timeout", `Worker platform request timed out after ${requestTimeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
    let parsed: unknown = null;
    try { parsed = await response.json(); } catch { /* endpoint errors still carry the status */ }
    if (!response.ok) {
      const payload = record(parsed);
      throw platformError(text(payload?.errorCode) ?? "worker_platform_error", text(payload?.message) ?? `Worker platform request failed: ${response.status}`);
    }
    return parsed;
  };

  const sessionHeaders = (session: WorkerSession): Record<string, string> => ({ "x-worker-pool-session": session.sessionToken });

  /**
   * Reports whether a direct LiveSession still exists on the platform. A 404 is
   * the only authoritative "gone" answer; any transport or protocol failure
   * returns true so a transient outage cannot tear down a live TUI.
   */
  const isSessionActive = async (session: WorkerSession, sessionId: string): Promise<boolean> => {
    try {
      await post(
        `/api/worker-pools/live-sessions/${encodeURIComponent(sessionId)}`,
        sessionHeaders(session),
        { poolId: session.poolId },
      );
      return true;
    } catch (error) {
      const code = error && typeof error === "object" ? Reflect.get(error, "code") : null;
      if (code === "live_session_not_found" || code === "live_session_ended") return false;
      return true;
    }
  };

  return {
    async register(registration) {
      const response = record(await post("/api/worker-pools/register", { "x-worker-pool-token": input.poolToken }, registration));
      const poolId = text(response?.poolId);
      const sessionToken = text(response?.sessionToken);
      if (!poolId || !sessionToken) throw platformError("provider_protocol_error", "Worker registration response is invalid");
      const session = { poolId, sessionToken };
      input.onRegistered?.(session);
      return session;
    },
    async claim(session) {
      const response = record(await post("/api/worker-pools/claim", sessionHeaders(session), { poolId: session.poolId, acceptAssignments: true }));
      const result = record(response?.result);
      const assignment = result?.assignment;
      if (assignment === null || assignment === undefined) {
        const liveSession = directWorkerLiveSession(result?.liveSession, session.poolId);
        return { assignment: null, ...(liveSession ? { liveSession } : {}) };
      }
      if (isWorkerValidationAssignment(assignment)) return { assignment };
      const parsed = assignment as LinuxWorkerAssignment;
      if (!text(parsed.agentRunId) || !Number.isSafeInteger(parsed.acceptedThroughSequence) || parsed.acceptedThroughSequence < 0) {
        throw platformError("provider_protocol_error", "Worker claim response is invalid");
      }
      const acceptedSequence = typeof record(assignment)?.acceptedThroughSequence === "number"
        ? Number(record(assignment)?.acceptedThroughSequence)
        : 0;
      sequences.set(parsed.agentRunId, acceptedSequence);
      return { assignment: parsed };
    },
    isSessionActive,
    async acknowledgeValidationChallenge(session, assignment) {
      await post(
        `/api/worker-pools/validation-challenges/${encodeURIComponent(assignment.id)}/acknowledge`,
        sessionHeaders(session),
        { poolId: session.poolId },
      );
    },
    async heartbeat(session, assignment) {
      await post(`/api/worker-pools/assignments/${encodeURIComponent(assignment.agentRunId)}/heartbeat`, sessionHeaders(session), {
        poolId: session.poolId,
        leaseGeneration: assignment.leaseGeneration,
        commandId: randomUUID(),
      });
    },
    async reportEvent(session, event) {
      await serializeDelivery(event.agentRunId, async () => {
        if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) {
          throw platformError("provider_protocol_error", "Worker lifecycle event sequence is invalid");
        }
        const sequence = event.sequence;
        const response = record(await post(`/api/worker-pools/assignments/${encodeURIComponent(event.agentRunId)}/events`, sessionHeaders(session), {
          poolId: session.poolId,
          leaseGeneration: event.leaseGeneration,
          commandId: randomUUID(),
          loopNodeAttemptId: event.loopNodeAttemptId,
          events: [{
            eventId: randomUUID(),
            loopRunId: event.loopRunId,
            loopNodeRunId: event.loopNodeRunId,
            loopNodeAttemptId: event.loopNodeAttemptId,
            attemptNo: event.attemptNo,
            leaseGeneration: event.leaseGeneration,
            sequence,
            eventType: event.eventType,
            occurredAt: event.occurredAt,
            payloadSummary: event.payloadSummary,
            artifactRefs: [],
          }],
        }));
        const acceptedThroughSequence = record(response?.result)?.acceptedThroughSequence;
        sequences.set(
          event.agentRunId,
          typeof acceptedThroughSequence === "number" && Number.isSafeInteger(acceptedThroughSequence)
            ? Math.max(sequence, acceptedThroughSequence)
            : sequence,
        );
      });
    },
    async reportResult(session, completed) {
      await serializeDelivery(completed.agentRunId, async () => {
        await post(`/api/worker-pools/assignments/${encodeURIComponent(completed.agentRunId)}/result`, sessionHeaders(session), {
          poolId: session.poolId,
          leaseGeneration: completed.leaseGeneration,
          commandId: randomUUID(),
          loopRunId: completed.loopRunId,
          loopNodeRunId: completed.loopNodeRunId,
          loopNodeAttemptId: completed.loopNodeAttemptId,
          attemptNo: completed.attemptNo,
          result: completed.result,
        });
        sequences.delete(completed.agentRunId);
        deliveries.delete(completed.agentRunId);
      });
    },
    async uploadArtifact(session, artifact) {
      const response = record(await post(
        `/api/worker-pools/assignments/${encodeURIComponent(artifact.agentRunId)}/artifacts`,
        sessionHeaders(session),
        {
          poolId: session.poolId,
          leaseGeneration: artifact.leaseGeneration,
          commandId: artifact.commandId,
          loopRunId: artifact.loopRunId,
          loopNodeRunId: artifact.loopNodeRunId,
          loopNodeAttemptId: artifact.loopNodeAttemptId,
          attemptNo: artifact.attemptNo,
          relativePath: artifact.relativePath,
          content: artifact.content,
        },
      ));
      const result = record(response?.result);
      const storageKey = text(result?.storageKey);
      const relativePath = text(result?.relativePath);
      if (!storageKey || !relativePath) {
        throw platformError("provider_protocol_error", "Worker Artifact upload response is invalid");
      }
      return { storageKey, relativePath };
    },
    async currentSequence(session, assignment) {
      const response = record(await post(
        `/api/worker-pools/assignments/${encodeURIComponent(assignment.agentRunId)}/sequence`,
        sessionHeaders(session),
        { poolId: session.poolId },
      ));
      const accepted = record(response?.result)?.acceptedThroughSequence;
      if (!Number.isSafeInteger(accepted) || Number(accepted) < 0) {
        throw platformError("provider_protocol_error", "Worker sequence response is invalid");
      }
      return Number(accepted);
    },
  };
}
