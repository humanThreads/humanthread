import type {
  AgentWorkerCapabilitySnapshot,
  LoopAgentEvent,
  LoopAssignment,
  LoopAssignmentV2,
  LoopNodeResult,
  LiveSessionDispatch,
  LocalRouteDecision,
} from "@humanthread/shared";
import {
  liveSessionDispatchSchema,
  loopAssignmentSchema,
  loopAssignmentV2Schema,
} from "@humanthread/shared";

export type LoopAssignmentApiFetch = typeof fetch;

type LoopApiErrorBody = {
  ok?: false;
  code?: string;
  error?: string;
};

type LoopApiSuccessBody<TResult> = {
  ok: true;
  result: TResult;
};

function isLegacyClaimValidationError(error: unknown): boolean {
  return Boolean(error
    && typeof error === "object"
    && Reflect.get(error, "status") === 400
    && Reflect.get(error, "code") === "validation_failed");
}

export type LoopAssignmentApiCredentials = {
  apiBaseUrl: string;
  userId: string;
  deviceId: string;
  deviceToken: string;
  apiToken: string;
  workerId: string;
  agentVersion: string;
};

export type LoopAssignmentClaimResult = {
  assignment: LoopAssignment | LoopAssignmentV2 | null;
  leaseGeneration: number | null;
  leaseExpiresAt: string | null;
  leaseDurationMs?: number;
  liveSession?: LiveSessionDispatch;
};

export type LoopAssignmentIdentity = {
  agentRunId: string;
  leaseGeneration: number;
  commandId: string;
};

export type LoopAssignmentArtifact = {
  artifactId: string;
  storageKey: string;
  fileName: string;
  mimeType: "text/html";
  byteSize: number;
  checksum: string;
  relativePath: string;
  href: string;
};

type RouteDecisionRequest = LoopAssignmentIdentity & {
  loopRunId: string;
  loopNodeRunId: string;
  loopNodeAttemptId: string;
  attemptNo: number;
  result?: LoopNodeResult;
  routeDecision: LocalRouteDecision;
};

type OfflineStageResultRequest = LoopAssignmentIdentity & {
  loopRunId: string;
  loopNodeRunId: string;
  loopNodeAttemptId: string;
  attemptNo: number;
  offlineStageResult: unknown;
};

export interface LoopAssignmentApi {
  claim(input: {
    capabilitySnapshot: AgentWorkerCapabilitySnapshot;
    activeAgentRunIds?: string[];
    activeLiveSessionIds?: string[];
    acceptAssignments?: boolean;
  }): Promise<LoopAssignmentClaimResult>;
  heartbeat(input: LoopAssignmentIdentity & {
    capabilitySnapshot: AgentWorkerCapabilitySnapshot;
    signal?: AbortSignal;
  }): Promise<{ leaseExpiresAt: string; leaseDurationMs?: number }>;
  events(input: LoopAssignmentIdentity & {
    loopNodeAttemptId: string;
    events: LoopAgentEvent[];
  }): Promise<{ acceptedThroughSequence: number }>;
  checkpoint(input: LoopAssignmentIdentity & {
    loopRunId: string;
    loopNodeRunId: string;
    loopNodeAttemptId: string;
    attemptNo: number;
    checkpoint: unknown;
  }): Promise<{ checkpointed: boolean; duplicate?: boolean }>;
  complete(input: LoopAssignmentIdentity & {
    loopRunId: string;
    loopNodeRunId: string;
    loopNodeAttemptId: string;
    attemptNo: number;
    result: LoopNodeResult;
    routeDecision?: LocalRouteDecision;
  }): Promise<unknown>;
  uploadArtifact?(input: LoopAssignmentIdentity & {
    loopRunId: string;
    loopNodeRunId: string;
    loopNodeAttemptId: string;
    attemptNo: number;
    relativePath: string;
    content: string;
  }): Promise<LoopAssignmentArtifact>;
  routeDecision?(input: RouteDecisionRequest): Promise<unknown>;
  offlineStageResult?(input: OfflineStageResultRequest): Promise<unknown>;
  currentSequence?(input: Pick<LoopAssignmentIdentity, "agentRunId" | "leaseGeneration">): Promise<{ acceptedThroughSequence: number }>;
  deactivateWorker?(): Promise<{ workerId: string; status: "offline"; invalidated: number }>;
}

function callFetch(
  fetchImplementation: LoopAssignmentApiFetch,
  input: Parameters<LoopAssignmentApiFetch>[0],
  init: Parameters<LoopAssignmentApiFetch>[1],
): ReturnType<LoopAssignmentApiFetch> {
  return Reflect.apply(
    fetchImplementation as unknown as (...args: Parameters<LoopAssignmentApiFetch>) => ReturnType<LoopAssignmentApiFetch>,
    globalThis,
    [input, init],
  ) as ReturnType<LoopAssignmentApiFetch>;
}

export function createLoopAssignmentApi(
  credentials: LoopAssignmentApiCredentials,
  dependencies: { fetch?: LoopAssignmentApiFetch } = {},
): LoopAssignmentApi {
  const fetchImplementation = dependencies.fetch ?? fetch;
  const apiBaseUrl = credentials.apiBaseUrl.trim().replace(/\/+$/u, "");
  const commonBody = {
    userId: credentials.userId,
    deviceId: credentials.deviceId,
    workerId: credentials.workerId,
  };

  async function post<TResult>(path: string, body: unknown, options: { signal?: AbortSignal } = {}): Promise<TResult> {
    const authorization = credentials.apiToken.trim();
    const response = await callFetch(fetchImplementation, `${apiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
        "content-type": "application/json",
        "x-agent-device-token": credentials.deviceToken.trim(),
      },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    let parsed: LoopApiSuccessBody<TResult> | LoopApiErrorBody;
    try {
      parsed = await response.json() as LoopApiSuccessBody<TResult> | LoopApiErrorBody;
    } catch {
      parsed = { ok: false, error: `Request failed with status ${response.status}` };
    }
    if (!response.ok || parsed.ok !== true) {
      const failure = parsed as LoopApiErrorBody;
      throw Object.assign(
        new Error(failure.error?.trim() || `Request failed with status ${response.status}`),
        { code: failure.code ?? "request_failed", status: response.status },
      );
    }
    return parsed.result;
  }

  function assignmentPath(agentRunId: string, command: string): string {
    return `/api/agent/loop-assignments/${encodeURIComponent(agentRunId)}/${command}`;
  }

  return {
    claim: async ({ capabilitySnapshot, activeAgentRunIds = [], activeLiveSessionIds = [], acceptAssignments }) => {
      const claimBody = {
        ...commonBody,
        agentVersion: credentials.agentVersion,
        capabilitySnapshot,
        activeAgentRunIds,
        activeLiveSessionIds,
        acceptAssignments,
      };
      let result: LoopAssignmentClaimResult;
      try {
        result = await post<LoopAssignmentClaimResult>("/api/agent/loop-assignments/claim", claimBody);
      } catch (error) {
        if (acceptAssignments === undefined || !isLegacyClaimValidationError(error)) throw error;
        result = await post<LoopAssignmentClaimResult>("/api/agent/loop-assignments/claim", {
          ...commonBody,
          agentVersion: credentials.agentVersion,
          capabilitySnapshot,
          activeAgentRunIds,
          activeLiveSessionIds,
        });
      }
      const assignment = result.assignment === null
        ? null
        : result.assignment
          && typeof result.assignment === "object"
          && Reflect.get(result.assignment, "contractVersion") === 2
          ? loopAssignmentV2Schema.parse(result.assignment)
          : loopAssignmentSchema.parse(result.assignment);
      if (
        assignment !== null
        && (
          result.leaseGeneration !== assignment.leaseGeneration
          || result.leaseExpiresAt !== assignment.leaseExpiresAt
        )
      ) throw new Error("Loop assignment lease response is inconsistent");
      const liveSession = result.liveSession === undefined
        ? undefined
        : liveSessionDispatchSchema.parse(result.liveSession);
      return {
        ...result,
        assignment,
        ...(liveSession === undefined ? {} : { liveSession }),
      };
    },
    heartbeat: (input) => post(assignmentPath(input.agentRunId, "heartbeat"), {
      ...commonBody,
      agentVersion: credentials.agentVersion,
      leaseGeneration: input.leaseGeneration,
      commandId: input.commandId,
      capabilitySnapshot: input.capabilitySnapshot,
    }, input.signal ? { signal: input.signal } : {}),
    events: (input) => post(assignmentPath(input.agentRunId, "events"), {
      ...commonBody,
      leaseGeneration: input.leaseGeneration,
      commandId: input.commandId,
      loopNodeAttemptId: input.loopNodeAttemptId,
      events: input.events,
    }),
    checkpoint: (input) => post(assignmentPath(input.agentRunId, "checkpoint"), {
      ...commonBody,
      leaseGeneration: input.leaseGeneration,
      commandId: input.commandId,
      loopRunId: input.loopRunId,
      loopNodeRunId: input.loopNodeRunId,
      loopNodeAttemptId: input.loopNodeAttemptId,
      attemptNo: input.attemptNo,
      checkpoint: input.checkpoint,
    }),
    complete: (input) => post(assignmentPath(input.agentRunId, "result"), {
      ...commonBody,
      leaseGeneration: input.leaseGeneration,
      commandId: input.commandId,
      loopRunId: input.loopRunId,
      loopNodeRunId: input.loopNodeRunId,
      loopNodeAttemptId: input.loopNodeAttemptId,
      attemptNo: input.attemptNo,
      result: input.result,
      ...(input.routeDecision === undefined ? {} : { routeDecision: input.routeDecision }),
    }),
    uploadArtifact: (input) => post(assignmentPath(input.agentRunId, "artifacts"), {
      ...commonBody,
      leaseGeneration: input.leaseGeneration,
      commandId: input.commandId,
      loopRunId: input.loopRunId,
      loopNodeRunId: input.loopNodeRunId,
      loopNodeAttemptId: input.loopNodeAttemptId,
      attemptNo: input.attemptNo,
      relativePath: input.relativePath,
      content: input.content,
    }),
    routeDecision: (input) => post(assignmentPath(input.agentRunId, "result"), {
      ...commonBody,
      leaseGeneration: input.leaseGeneration,
      commandId: input.commandId,
      loopRunId: input.loopRunId,
      loopNodeRunId: input.loopNodeRunId,
      loopNodeAttemptId: input.loopNodeAttemptId,
      attemptNo: input.attemptNo,
      result: input.result,
      routeDecision: input.routeDecision,
    }),
    offlineStageResult: (input) => post(assignmentPath(input.agentRunId, "result"), {
      ...commonBody,
      leaseGeneration: input.leaseGeneration,
      commandId: input.commandId,
      loopRunId: input.loopRunId,
      loopNodeRunId: input.loopNodeRunId,
      loopNodeAttemptId: input.loopNodeAttemptId,
      attemptNo: input.attemptNo,
      offlineStageResult: input.offlineStageResult,
    }),
    currentSequence: (input) => post(assignmentPath(input.agentRunId, "sequence"), {
      ...commonBody,
      leaseGeneration: input.leaseGeneration,
    }),
    deactivateWorker: () => post("/api/agent/loop-assignments/worker-state", {
      ...commonBody,
      enabled: false,
    }),
  };
}
