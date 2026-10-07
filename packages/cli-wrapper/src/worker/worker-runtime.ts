import type { CodexAppServerStartInput } from "./app-server-client";
import { mkdir } from "node:fs/promises";
import type { LiveSessionJournal } from "@humanthread/live-session-journal";
import type { WorkerDeliveryEvidence, WorkerWorktreePreparation } from "./worker-worktree";
import type { WorkerWorktreePhaseEvent } from "./worker-worktree";
import type {
  WorkerLiveSessionConnector,
  WorkerLiveSessionPhase,
} from "./live-session-connector";
import { redactWorkerPayload, type WorkerOutboxRecord } from "./worker-outbox";
import {
  isValidWorkerBranchName,
  isWorkerBranchPattern,
  matchesWorkerBranchPattern,
  RUNTIME_CHECKLIST_PROTOCOL_PROMPT,
  type LoopFailureEnvelope,
} from "@humanthread/shared";

export type WorkerExecutionSnapshot = {
  version: 1;
  workerPoolId: string;
  workerInstanceId?: string;
  repository: { url: string; branch: string; branchPolicy: { allowedBranches: string[] } };
  model: {
    provider: "codex";
    siteId: string;
    endpoint: string;
    apiKeyReference: string;
    model: string;
    reasoningEffort: "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
  };
  resources: { gpu: boolean; unityBuild: boolean };
  deliveryPolicy: { requireGitDelivery: boolean };
  grants: unknown[];
  logPolicy: { redactCredentials: true };
};

export type LinuxWorkerAssignment = {
  agentRunId: string;
  loopRunId: string;
  loopNodeRunId: string;
  loopNodeAttemptId: string;
  attemptNo: number;
  leaseGeneration: number;
  acceptedThroughSequence: number;
  prompt: string;
  executionSnapshot: WorkerExecutionSnapshot;
  executionCredentials: { apiKey: string; environment?: Record<string, string> };
  stageRef?: {
    loopDefinitionId: string;
    loopVersionId: string;
    nodeId: string;
    subloopId: string;
  };
  checklistMcp?: { url: string };
  liveSession?: {
    sessionId: string;
    relayUrl: string;
    authorization: string;
    initialCols: number;
    initialRows: number;
  };
};

export type WorkerValidationAssignment = {
  id: string;
  kind: "worker_validation";
  sideEffect: false;
};

export type WorkerSession = {
  poolId: string;
  sessionToken: string;
};

export type WorkerLifecycleEvent = {
  agentRunId: string;
  loopRunId: string;
  loopNodeRunId: string;
  loopNodeAttemptId: string;
  attemptNo: number;
  leaseGeneration: number;
  sequence: number;
  eventType: string;
  occurredAt: string;
  payloadSummary: unknown;
};

export type WorkerResult = {
  agentRunId: string;
  loopRunId: string;
  loopNodeRunId: string;
  loopNodeAttemptId: string;
  attemptNo: number;
  leaseGeneration: number;
  result: {
    outcome: "success" | "failure";
    output: unknown;
    artifactRefs: string[];
    effectReceipts: unknown[];
    failure?: {
      status: "FAILED" | "NEEDS_CLARIFICATION" | "TIMEOUT" | "OUTPUT_PARSE_FAILED";
      code: string;
      summary: string;
      categoryHint?: "transient_technical" | "dependency_unavailable" | "requirement_unclear" | "permission_or_policy" | "deterministic_execution" | "business_validation" | "cancelled" | "unknown";
      retryHint?: {
        recommended: boolean;
        reason: string;
      };
      evidence: unknown[];
      occurredAt: string;
    };
  };
};

type WorkerLease = Pick<LinuxWorkerAssignment, "agentRunId" | "leaseGeneration">;

const REVIEW_ARTIFACT_PATH = /^generated\/reviews\/.+\.html?$/iu;

/**
 * Durable phase-transition event type. The platform validates the same payload
 * shape against `loopExecutionPhaseSchema` and stores the newest snapshot on
 * the Loop attempt, which is what the Loop page reads after a reload.
 */
const EXECUTION_PHASE_EVENT_TYPE = "loop.node.execution_phase_changed";

/**
 * The Worker owns the workspace, so a review page written by the Agent only
 * reaches the platform when the Worker uploads it. Without this step the
 * approval that follows silently loses the review HTML.
 */
async function uploadReviewArtifacts(
  activeSession: WorkerSession,
  assignment: LinuxWorkerAssignment,
  cwd: string,
  dependencies: {
    collectReviewArtifacts?: (cwd: string) => Promise<ReadonlyArray<{ relativePath: string; content: string }>>;
    uploadArtifact?: WorkerApi["uploadArtifact"];
  },
  declaredPaths?: readonly string[],
): Promise<{ artifactRefs: string[]; failures: Array<{ relativePath: string; code: string }> }> {
  const collect = dependencies.collectReviewArtifacts;
  const upload = dependencies.uploadArtifact;
  if (!collect || !upload) return { artifactRefs: [], failures: [] };
  const collected = await collect(cwd);
  // A task branch is shared by every stage, so the review directory also holds
  // pages committed by earlier batches. Uploading all of them buries the
  // current page in unrelated history, so honor the stage's declared artifact
  // list when it named any review page.
  const declared = declaredPaths === undefined
    ? null
    : new Set(declaredPaths.filter((path) => REVIEW_ARTIFACT_PATH.test(path)));
  const storageKeys: string[] = [];
  const failures: Array<{ relativePath: string; code: string }> = [];
  let sequence = 0;
  for (const artifact of collected) {
    if (!REVIEW_ARTIFACT_PATH.test(artifact.relativePath)) continue;
    if (declared && declared.size > 0 && !declared.has(artifact.relativePath)) continue;
    let uploaded: { storageKey: string } | null = null;
    let failure: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        uploaded = await upload.call(dependencies.uploadArtifact, activeSession, {
          agentRunId: assignment.agentRunId,
          loopRunId: assignment.loopRunId,
          loopNodeRunId: assignment.loopNodeRunId,
          loopNodeAttemptId: assignment.loopNodeAttemptId,
          attemptNo: assignment.attemptNo,
          leaseGeneration: assignment.leaseGeneration,
          commandId: `artifact:${assignment.loopNodeAttemptId}:${++sequence}`,
          relativePath: artifact.relativePath,
          content: artifact.content,
        });
        break;
      } catch (error) {
        failure = error;
      }
    }
    if (!uploaded?.storageKey) {
      // The Codex turn itself already succeeded. A missing or unwritable review
      // page is a degraded, operator-visible artifact rather than a reason to
      // rewrite a completed turn as a failure and trigger a retry loop.
      const code = failure && typeof failure === "object" && typeof Reflect.get(failure, "code") === "string"
        ? String(Reflect.get(failure, "code"))
        : "review_artifact_upload_failed";
      failures.push({ relativePath: artifact.relativePath, code });
      continue;
    }
    storageKeys.push(uploaded.storageKey);
  }
  return { artifactRefs: storageKeys, failures };
}

export type WorkerApi = {
  register(input: { instanceId: string; poolName?: string; runtime?: "docker" | "kubernetes"; taskGroupName?: string; capabilities: Record<string, unknown>; requestedConcurrency: number }): Promise<WorkerSession>;
  claim(session: WorkerSession): Promise<{
    assignment: LinuxWorkerAssignment | WorkerValidationAssignment | null;
    liveSession?: {
      sessionId: string;
      kind: "worker";
      projectId: string;
      taskId: string | null;
      executionPolicy: "direct";
      relayUrl: string;
      authorization: string;
      initialCols: number;
      initialRows: number;
      runtime: {
        endpoint: string;
        apiKey: string;
        model: string;
        reasoningEffort: string;
      };
    };
  }>;
  acknowledgeValidationChallenge?(session: WorkerSession, assignment: WorkerValidationAssignment): Promise<void>;
  heartbeat(session: WorkerSession, assignment: WorkerLease): Promise<void>;
  reportEvent(session: WorkerSession, event: WorkerLifecycleEvent): Promise<void>;
  reportResult(session: WorkerSession, result: WorkerResult): Promise<void>;
  /**
   * Uploads a review HTML Artifact produced in the Worker workspace. The
   * platform persists it as `Artifact(type=review_html)` and returns the
   * storage key that the terminal result must carry in `artifactRefs`, so the
   * approval that follows can render the review page.
   */
  uploadArtifact?(session: WorkerSession, input: {
    agentRunId: string;
    loopRunId: string;
    loopNodeRunId: string;
    loopNodeAttemptId: string;
    attemptNo: number;
    leaseGeneration: number;
    commandId: string;
    relativePath: string;
    content: string;
  }): Promise<{ storageKey: string; relativePath: string }>;
  currentSequence?(session: WorkerSession, assignment: LinuxWorkerAssignment): Promise<number>;
  /**
   * Reports whether a direct LiveSession is still active on the platform. A
   * Worker cannot learn about an ended or expired session from the terminal
   * itself, so without this probe a TUI can outlive its session and hold the
   * worker's only concurrency slot indefinitely.
   */
  isSessionActive?(session: WorkerSession, sessionId: string): Promise<boolean>;
};

type AppServer = {
  start(input: CodexAppServerStartInput): Promise<void>;
  request(method: string, params?: unknown): Promise<unknown>;
  subscribe(listener: (event: { method: string; params: unknown }) => void): () => void;
  stop(): Promise<void>;
  endpoint?(): string | null;
};

type WorkerOutbox = {
  enqueue(input: { type: string; payload: unknown }): Promise<void>;
  read(): Promise<WorkerOutboxRecord[]>;
  acknowledge(recordIds: readonly string[]): Promise<void>;
};

export type WorkerRuntime = {
  tick(): Promise<void>;
  drain(): Promise<void>;
  state(): "registering" | "idle" | "claimed" | "preparing" | "running" | "draining" | "degraded" | "offline";
};

function workerError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

async function defaultEnsureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
}

function executionPrompt(assignment: LinuxWorkerAssignment): string {
  const prompt = assignment.prompt;
  return assignment.checklistMcp
    ? `${prompt}\n\n${RUNTIME_CHECKLIST_PROTOCOL_PROMPT}`
    : prompt;
}

function isWorkerValidationAssignment(value: LinuxWorkerAssignment | WorkerValidationAssignment): value is WorkerValidationAssignment {
  return "kind" in value && value.kind === "worker_validation" && value.sideEffect === false;
}

function liveSessionRuntimeSnapshot(capabilities: Record<string, unknown>): {
  endpoint: string;
  apiKey: string;
  model: string;
  reasoningEffort: string;
} | null {
  const candidate = record(capabilities.humanthreadDirectSessionRuntime);
  if (
    !candidate
    || typeof candidate.endpoint !== "string"
    || typeof candidate.apiKey !== "string"
    || typeof candidate.model !== "string"
    || typeof candidate.reasoningEffort !== "string"
  ) return null;
  return {
    endpoint: candidate.endpoint,
    apiKey: candidate.apiKey,
    model: candidate.model,
    reasoningEffort: candidate.reasoningEffort,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredString(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum ? value : null;
}

function isStrictModelEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && url.username === ""
      && url.password === ""
      && url.search === ""
      && url.hash === "";
  } catch {
    return false;
  }
}

function parseExecutionSnapshot(value: unknown): WorkerExecutionSnapshot | null {
  const snapshot = record(value);
  const repository = record(snapshot?.repository);
  const branchPolicy = record(repository?.branchPolicy);
  const model = record(snapshot?.model);
  const workerPoolId = requiredString(snapshot?.workerPoolId, 32);
  const workerInstanceId = requiredString(snapshot?.workerInstanceId, 191);
  const repositoryUrl = requiredString(repository?.url, 1_024);
  const branch = requiredString(repository?.branch, 191);
  const rawAllowedBranches = Array.isArray(branchPolicy?.allowedBranches) ? branchPolicy.allowedBranches : [];
  const allowedBranches = rawAllowedBranches.filter((entry): entry is string => requiredString(entry, 191) !== null);
  const endpoint = requiredString(model?.endpoint, 1_024);
  const modelId = requiredString(model?.model, 191);
  const siteId = requiredString(model?.siteId, 32);
  const apiKeyReference = requiredString(model?.apiKeyReference, 32);
  const reasoningEffort = model?.reasoningEffort;
  const resources = record(snapshot?.resources);
  if (
    snapshot?.version !== 1
    || !workerPoolId || !repositoryUrl || !branch || rawAllowedBranches.length !== allowedBranches.length
    || !allowedBranches.every(isWorkerBranchPattern)
    || !isValidWorkerBranchName(branch)
    || !allowedBranches.some((pattern) => matchesWorkerBranchPattern(branch, pattern))
    || model?.provider !== "codex" || !endpoint || !modelId || !siteId || !apiKeyReference
    || !isStrictModelEndpoint(endpoint)
    || typeof resources?.gpu !== "boolean" || typeof resources?.unityBuild !== "boolean"
    || typeof record(snapshot?.deliveryPolicy)?.requireGitDelivery !== "boolean"
    || !["low", "medium", "high", "xhigh", "max", "ultra"].includes(String(reasoningEffort))
    || !Array.isArray(snapshot?.grants) || record(snapshot?.logPolicy)?.redactCredentials !== true
  ) return null;
  return {
    version: 1,
    workerPoolId,
    ...(workerInstanceId === null ? {} : { workerInstanceId }),
    repository: { url: repositoryUrl, branch, branchPolicy: { allowedBranches } },
    model: {
      provider: "codex", siteId, endpoint, apiKeyReference, model: modelId,
      reasoningEffort: reasoningEffort as WorkerExecutionSnapshot["model"]["reasoningEffort"],
    },
    resources: { gpu: resources.gpu as boolean, unityBuild: resources.unityBuild as boolean },
    deliveryPolicy: { requireGitDelivery: record(snapshot?.deliveryPolicy)?.requireGitDelivery as boolean },
    grants: snapshot.grants,
    logPolicy: { redactCredentials: true },
  };
}

function extractId(value: unknown, key: string): string | null {
  const direct = record(value)?.[key];
  if (typeof direct === "string" && direct.trim()) return direct;
  const nested = record(value)?.[key.slice(0, -2)];
  return typeof record(nested)?.id === "string" ? String(record(nested)?.id) : null;
}

function assignmentEvent(
  assignment: LinuxWorkerAssignment,
  sequence: number,
  eventType: string,
  payloadSummary: unknown,
  now: () => Date,
  secrets: readonly string[] = [],
): WorkerLifecycleEvent {
  return {
    agentRunId: assignment.agentRunId,
    loopRunId: assignment.loopRunId,
    loopNodeRunId: assignment.loopNodeRunId,
    loopNodeAttemptId: assignment.loopNodeAttemptId,
    attemptNo: assignment.attemptNo,
    leaseGeneration: assignment.leaseGeneration,
    sequence,
    eventType,
    occurredAt: now().toISOString(),
    payloadSummary: redactWorkerPayload(payloadSummary, "", 0, secrets),
  };
}

function failureResult(assignment: LinuxWorkerAssignment, error: unknown, now: () => Date, secrets: readonly string[] = []): WorkerResult {
  const code = error && typeof error === "object" && typeof Reflect.get(error, "code") === "string"
    ? String(Reflect.get(error, "code"))
    : "worker_execution_failed";
  const rawMessage = error instanceof Error ? error.message : "Linux Worker execution failed";
  const summary = String(redactWorkerPayload(rawMessage, "", 0, secrets)).slice(0, 4_000);
  // A stage that declares NEEDS_CLARIFICATION/TIMEOUT itself must keep that
  // status. Collapsing every stage-declared failure into FAILED hides the fact
  // that the platform must ask a human instead of retrying the same input.
  const declared = error && typeof error === "object"
    ? Reflect.get(error, "stageFailure") as DeclaredStageFailure | undefined
    : undefined;
  const status: NonNullable<LoopFailureEnvelope["status"]> = declared && typeof declared.status === "string"
    ? declared.status
    : "FAILED";
  const providerDiagnostic = providerDiagnosticPayload(error, secrets);
  return {
    agentRunId: assignment.agentRunId,
    loopRunId: assignment.loopRunId,
    loopNodeRunId: assignment.loopNodeRunId,
    loopNodeAttemptId: assignment.loopNodeAttemptId,
    attemptNo: assignment.attemptNo,
    leaseGeneration: assignment.leaseGeneration,
    result: {
      outcome: "failure",
      // Keep a compact, structured diagnostic in output as well as the
      // failure envelope. The database stores output as the node error field,
      // so this is what the Web run viewer can display when the turn fails
      // before an app-server result exists.
      output: {
        errorCode: code,
        message: summary,
        ...(providerDiagnostic === undefined ? {} : { providerDiagnostic }),
      },
      artifactRefs: [],
      effectReceipts: [],
      failure: {
        status,
        code,
        summary,
        ...(status === "NEEDS_CLARIFICATION" || status === "TIMEOUT"
          ? {
            categoryHint: status === "NEEDS_CLARIFICATION" ? "requirement_unclear" as const : "transient_technical" as const,
            retryHint: {
              // A timeout is retryable, but a vague timeout is not: the
              // platform still decides using its own retry budget.
              recommended: status === "TIMEOUT",
              reason: status === "NEEDS_CLARIFICATION"
                ? "The stage requires human clarification before it can produce output."
                : "The stage reported a timeout; retry only through the platform retry budget.",
            },
          }
          : {}),
        evidence: [],
        occurredAt: now().toISOString(),
      },
    },
  };
}

function providerDiagnosticPayload(error: unknown, secrets: readonly string[]): Record<string, unknown> | undefined {
  const value = record(error);
  const diagnostic = record(value?.providerDiagnostic);
  if (!diagnostic) return undefined;
  const allowed = ["code", "httpStatus", "type", "requestId", "message"] as const;
  const result: Record<string, unknown> = {};
  for (const key of allowed) {
    const candidate = diagnostic[key];
    if (typeof candidate === "string") result[key] = String(redactWorkerPayload(candidate, "", 0, secrets)).slice(0, 512);
    else if (typeof candidate === "number" && Number.isFinite(candidate)) result[key] = candidate;
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

function parseTerminalNotification(value: { method: string; params: unknown }): { success: boolean; output: unknown } | null {
  if (value.method === "turn/completed") {
    const turn = record(record(value.params)?.turn);
    const status = turn?.status;
    if (status === "completed") return { success: true, output: turn?.result ?? null };
    if (status === "failed" || status === "interrupted") return { success: false, output: turn?.error ?? value.params };
  }
  if (value.method === "turn/failed") return { success: false, output: value.params };
  // `error` is not a turn terminal: Codex 0.159.2+ reports retryable sampling
  // failures (for example `stream disconnected before completion`) with
  // `willRetry: true` and then retries the same turn. Treating it as terminal
  // makes the Worker abort the app-server and TUI while Codex is recovering.
  // `willRetry: false` is still a real, authoritative failure.
  if (value.method === "error") {
    const params = record(value.params);
    return params?.willRetry === true ? null : { success: false, output: value.params };
  }
  return null;
}

function completedAssistantMessage(
  value: { method: string; params: unknown },
  onDelta: (delta: string) => void,
): string | null {
  if (value.method === "item/agentMessage/delta") {
    const delta = record(value.params)?.delta;
    if (typeof delta === "string" && delta) onDelta(delta);
    return null;
  }
  if (value.method === "item/completed") {
    const item = record(record(value.params)?.item);
    if (item?.type !== "agentMessage") return null;
    const itemMessage = item.text;
    if (typeof itemMessage === "string" && itemMessage.trim()) return itemMessage;
    return null;
  }
  if (value.method !== "item/agentMessage/completed") return null;
  const params = record(value.params);
  const message = params?.message;
  if (typeof message === "string" && message.trim()) return message;
  const structuredMessage = record(message);
  if (typeof structuredMessage?.text === "string" && structuredMessage.text.trim()) return structuredMessage.text;
  return null;
}

function terminalOutput(turnResult: unknown, assistantMessage: string | null): unknown {
  if (turnResult === null || turnResult === undefined) return assistantMessage;
  if (record(turnResult) && Object.keys(turnResult).length === 0 && assistantMessage) return assistantMessage;
  return turnResult;
}

const STAGE_EXEC_STATUSES = new Set([
  "SUCCESS",
  "FAILED",
  "NEEDS_CLARIFICATION",
  "TIMEOUT",
  "OUTPUT_PARSE_FAILED",
]);

type DeclaredStageFailure = {
  status: "FAILED" | "NEEDS_CLARIFICATION" | "TIMEOUT" | "OUTPUT_PARSE_FAILED";
  code: string;
  summary: string;
};

/**
 * Stage agents report through a fenced Stage result block in their final
 * message. The Worker used to forward only the surrounding prose and always
 * report `success`, so a stage that explicitly declared itself blocked still
 * advanced the Loop without producing anything. Honor an explicit non-SUCCESS
 * status; prose-only stages keep their previous behavior because their Loop
 * nodes carry no output contract to validate against.
 */
function declaredStageFailure(value: unknown): DeclaredStageFailure | null {
  const fromCandidate = (candidate: Record<string, unknown> | null): DeclaredStageFailure | null => {
    const status = candidate?.status;
    if (typeof status !== "string" || !STAGE_EXEC_STATUSES.has(status) || status === "SUCCESS") return null;
    const issueType = typeof candidate?.issueType === "string" ? candidate.issueType.trim() : "";
    const summary = typeof candidate?.summary === "string" ? candidate.summary.trim() : "";
    // Require the shape of a Stage result so unrelated tooling JSON that
    // happens to carry a `status` key cannot fail a healthy stage.
    const execId = typeof candidate?.execId === "string" ? candidate.execId.trim() : "";
    const confidence = candidate?.confidence;
    if (!execId && !(issueType && summary && typeof confidence === "number")) return null;
    return {
      status: status as DeclaredStageFailure["status"],
      code: /^[A-Za-z0-9_]{1,96}$/u.test(issueType) ? issueType : "stage_execution_failed",
      summary: summary.slice(0, 4_000) || "Stage declared itself unsuccessful",
    };
  };
  // A relay that preserves the structured result reports the status directly.
  const direct = fromCandidate(record(value));
  if (direct) return direct;
  const texts: string[] = [];
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > 4 || texts.length >= 64) return;
    if (typeof candidate === "string") {
      if (candidate.length <= 262_144) texts.push(candidate);
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate.slice(0, 64)) visit(item, depth + 1);
      return;
    }
    const candidateRecord = record(candidate);
    if (!candidateRecord) return;
    for (const item of Object.values(candidateRecord)) visit(item, depth + 1);
  };
  visit(value, 0);
  for (const text of texts) {
    for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)) {
      const raw = match[1]?.trim();
      if (!raw) continue;
      let decoded: unknown;
      try { decoded = JSON.parse(raw); } catch { continue; }
      const declared = fromCandidate(record(decoded));
      if (declared) return declared;
    }
  }
  return null;
}

function stageFailureError(failure: DeclaredStageFailure): Error & {
  code: string;
  stageFailure: DeclaredStageFailure;
} {
  return Object.assign(new Error(failure.summary), { code: failure.code, stageFailure: failure });
}

/**
 * Review pages the stage named in its own Stage result. Both `artifacts` and
 * `evidence` are honored because the stage packages declare the review page in
 * either list. Returns undefined when the stage declared nothing, so the
 * caller keeps the previous upload-everything behavior.
 */
function declaredReviewArtifactPaths(value: unknown): string[] | undefined {
  const texts: string[] = [];
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > 3 || texts.length >= 32) return;
    if (typeof candidate === "string") {
      if (candidate.length <= 262_144) texts.push(candidate);
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate.slice(0, 64)) visit(item, depth + 1);
      return;
    }
    const candidateRecord = record(candidate);
    if (!candidateRecord) return;
    for (const item of Object.values(candidateRecord)) visit(item, depth + 1);
  };
  visit(value, 0);
  const declared = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)) {
      const raw = match[1]?.trim();
      if (!raw) continue;
      let decoded: unknown;
      try { decoded = JSON.parse(raw); } catch { continue; }
      const candidate = record(decoded);
      if (!candidate) continue;
      for (const key of ["artifacts", "evidence"] as const) {
        const values = candidate[key];
        if (!Array.isArray(values)) continue;
        for (const entry of values.slice(0, 64)) {
          if (typeof entry === "string" && REVIEW_ARTIFACT_PATH.test(entry)) declared.add(entry);
        }
      }
    }
  }
  return declared.size > 0 ? [...declared] : undefined;
}

function deliveryFailure(evidence: WorkerDeliveryEvidence | null, requireGitDelivery: boolean): Error & { code: string } | null {
  if (!requireGitDelivery) return null;
  if (!evidence) return workerError("delivery_evidence_unavailable", "Linux Worker could not collect Git delivery evidence");
  if (!evidence.baseCommit || !evidence.headCommit || !evidence.remoteHeadCommit || evidence.headCommit !== evidence.remoteHeadCommit) {
    return workerError("delivery_not_pushed", "Task branch does not contain a pushed Worker commit");
  }
  if (evidence.commits.length === 0 || evidence.changedFiles.length === 0) {
    return workerError("delivery_no_changes", "Codex completed without a committed task change on the task branch");
  }
  if (!evidence.clean) return workerError("delivery_worktree_dirty", "Worker worktree contains uncommitted changes");
  return null;
}

export function createWorkerRuntime(dependencies: {
  config: {
    instanceId: string;
    poolName?: string;
    runtime?: "docker" | "kubernetes";
    taskGroupName?: string;
    capabilities: Record<string, unknown>;
    requestedConcurrency: number;
    resourceLimits?: { gpuConcurrency: number; unityBuildConcurrency: number };
    stateDirectory: string;
    sessionJournalRetentionDays?: number;
    heartbeatIntervalMs?: number;
    /** How often a direct LiveSession's platform liveness is re-checked. */
    directSessionLivenessIntervalMs?: number;
  };
  api: WorkerApi;
  outbox: WorkerOutbox;
    prepareWorktree(input: {
      agentRunId: string;
      repository: WorkerExecutionSnapshot["repository"];
      /** Stable owner of the checkout; prevents cross-run worktree reuse. */
      workspaceKey?: string;
      environment?: Record<string, string>;
      reportPhase?: (event: WorkerWorktreePhaseEvent) => void | Promise<void>;
    }): Promise<WorkerWorktreePreparation | string>;
    appServer(options?: { transport?: "stdio" | "websocket" }): AppServer;
  /**
   * Builds the execution-side relay connector for one automatic Loop session.
   * Injectable so the runtime can be driven without a real Relay in tests.
   */
  createLiveSessionConnector?: (
    session: NonNullable<LinuxWorkerAssignment["liveSession"]>,
  ) => WorkerLiveSessionConnector;
  liveSessionJournal?: LiveSessionJournal;
  onLiveSession?: (input: {
    assignment: LinuxWorkerAssignment;
    appServer: AppServer;
    threadId: string;
    cwd: string;
    codexHome: string;
    environment: Record<string, string>;
    /** Connector already opened before worktree preparation for this attempt. */
    connector?: WorkerLiveSessionConnector | null;
  }) => Promise<{ close?(): Promise<void> } | void>;
  onDirectLiveSession?: (input: {
    session: NonNullable<Awaited<ReturnType<WorkerApi["claim"]>>["liveSession"]>;
    appServer: AppServer;
    threadId: string;
    cwd: string;
    codexHome: string;
  }) => Promise<{ close?(): Promise<void>; wait?(): Promise<void> } | void>;
  ensureDirectory?(path: string): Promise<void>;
  /**
   * Reads the review HTML pages the Agent wrote under `generated/reviews/`.
   * Injectable so runtime tests do not need a real workspace.
   */
  collectReviewArtifacts?(cwd: string): Promise<ReadonlyArray<{ relativePath: string; content: string }>>;
  onExecutionFailure?(failure: { agentRunId: string; code: string; summary: string }): void;
  now?: () => Date;
}): WorkerRuntime {
  const now = dependencies.now ?? (() => new Date());
  let session: WorkerSession | null = null;
  let currentState: ReturnType<WorkerRuntime["state"]> = "offline";
  let draining = false;
  const active = new Set<Promise<void>>();
  const resourceLimits = dependencies.config.resourceLimits ?? { gpuConcurrency: 1, unityBuildConcurrency: 1 };
  const heartbeatIntervalMs = dependencies.config.heartbeatIntervalMs ?? 20_000;
  const sessionJournalRetentionDays = dependencies.config.sessionJournalRetentionDays ?? 30;
  const directSessionLivenessIntervalMs = dependencies.config.directSessionLivenessIntervalMs ?? 30_000;
  if (!Number.isInteger(heartbeatIntervalMs) || heartbeatIntervalMs < 1 || heartbeatIntervalMs > 60_000) {
    throw workerError("invalid_arguments", "Linux Worker heartbeat interval is invalid");
  }
  if (!Number.isInteger(directSessionLivenessIntervalMs) || directSessionLivenessIntervalMs < 1 || directSessionLivenessIntervalMs > 600_000) {
    throw workerError("invalid_arguments", "Linux Worker direct session liveness interval is invalid");
  }
  if (!Number.isInteger(sessionJournalRetentionDays) || sessionJournalRetentionDays < 1 || sessionJournalRetentionDays > 3_650) {
    throw workerError("invalid_arguments", "Linux Worker session journal retention is invalid");
  }
  let activeGpu = 0;
  let activeUnityBuilds = 0;
  let consecutiveTransportFailures = 0;
  let retryAfterMs = 0;

  const executeDirectLiveSession = async (
    registeredSession: WorkerSession,
    session: NonNullable<Awaited<ReturnType<WorkerApi["claim"]>>["liveSession"]>,
  ): Promise<void> => {
    if (!dependencies.onDirectLiveSession) {
      throw workerError("executor_not_configured", "Current Worker image does not support direct Worker sessions");
    }
    const snapshot = session.runtime;
    const appServer = dependencies.appServer({ transport: "websocket" });
    const cwd = `${dependencies.config.stateDirectory}/direct-sessions/${session.sessionId}`;
    const codexHome = `${dependencies.config.stateDirectory}/codex/${session.sessionId}`;
    await (dependencies.ensureDirectory ?? defaultEnsureDirectory)(cwd);
    let handle: { close?(): Promise<void>; wait?(): Promise<void> } | null = null;
    let livenessTimer: ReturnType<typeof setInterval> | null = null;
    // Resolves when the platform reports the session gone, which releases the
    // `await handle?.wait?.()` below and lets the finally block tear the TUI
    // down instead of holding this worker's concurrency slot forever.
    let sessionEnded: (() => void) | null = null;
    const sessionEndedSignal = new Promise<void>((resolve) => { sessionEnded = resolve; });
    try {
      await appServer.start({
        cwd,
        codexHome,
        endpoint: snapshot.endpoint,
        apiKey: snapshot.apiKey,
        model: snapshot.model,
        reasoningEffort: snapshot.reasoningEffort,
        sessionId: session.sessionId,
      });
      const thread = await appServer.request("thread/start", {
        cwd,
        model: snapshot.model,
        sandbox: "danger-full-access",
        approvalPolicy: "never",
      });
      const threadId = extractId(thread, "threadId") ?? extractId(thread, "thread") ?? "";
      if (!threadId) throw workerError("provider_protocol_error", "Codex app-server did not return a thread ID");
      handle = await dependencies.onDirectLiveSession({
        session,
        appServer,
        threadId,
        cwd,
        codexHome,
      }) ?? null;
      const probe = dependencies.api.isSessionActive;
      if (probe && session.sessionId) {
        livenessTimer = setInterval(() => {
          void probe(registeredSession, session.sessionId)
            .then((stillActive) => { if (!stillActive) sessionEnded?.(); })
            // A probe failure is not proof the session ended; keep the TUI and
            // retry on the next tick rather than dropping a live session.
            .catch(() => undefined);
        }, directSessionLivenessIntervalMs);
        livenessTimer.unref?.();
      }
      await Promise.race([
        handle?.wait?.() ?? Promise.resolve(),
        sessionEndedSignal,
      ]);
    } finally {
      if (livenessTimer) clearInterval(livenessTimer);
      await handle?.close?.().catch(() => undefined);
      await appServer.stop().catch(() => undefined);
    }
  };

  const registerSession = async (): Promise<WorkerSession> => {
    currentState = "registering";
    const registered = await dependencies.api.register({
      instanceId: dependencies.config.instanceId,
      ...(dependencies.config.poolName ? { poolName: dependencies.config.poolName } : {}),
      runtime: dependencies.config.runtime ?? "docker",
      ...(dependencies.config.taskGroupName ? { taskGroupName: dependencies.config.taskGroupName } : {}),
      capabilities: dependencies.config.capabilities,
      requestedConcurrency: dependencies.config.requestedConcurrency,
    });
    session = registered;
    return registered;
  };

  const sendEvent = async (activeSession: WorkerSession, event: WorkerLifecycleEvent): Promise<void> => {
    try {
      await dependencies.api.reportEvent(activeSession, event);
    } catch (error) {
      await dependencies.outbox.enqueue({ type: "event", payload: { event } });
      throw error;
    }
  };

  const sendResult = async (activeSession: WorkerSession, result: WorkerResult): Promise<void> => {
    try {
      await dependencies.api.reportResult(activeSession, result);
    } catch (error) {
      try {
        await dependencies.outbox.enqueue({ type: "result", payload: { result } });
      } catch (outboxError) {
        // Without durable terminal evidence we cannot safely claim that the
        // completed Codex turn will reach the platform. Preserve the original
        // delivery failure as cause, but expose a specific infrastructure
        // fault so operators can repair the state volume instead of retrying
        // an already-completed turn.
        const unavailable = workerError(
          "worker_outbox_unavailable",
          "Worker cannot durably store its terminal result for replay",
        );
        Object.assign(unavailable, { cause: error, outboxCause: outboxError });
        throw unavailable;
      }
      // The terminal execution result is durably queued. Its delivery will be
      // retried with lease heartbeats on the next worker tick; callers must
      // not reinterpret an acknowledgement delay as a failed Codex turn.
      return;
    }
  };

  /**
   * A terminal result is not complete until the platform accepts it.  Replay
   * keeps its lease alive before every retained lifecycle/result delivery so
   * a temporary platform rejection cannot turn finished work into a false
   * `lease_expired` failure.
   */
  const replayOutbox = async (activeSession: WorkerSession): Promise<boolean> => {
    const records = await dependencies.outbox.read();
    const acknowledged: string[] = [];
    let deliveryBlocked = false;
    for (const entry of records) {
      const payload = record(entry.payload);
      try {
        if (entry.type === "event" && payload?.event) {
          const event = payload.event as WorkerLifecycleEvent;
          await dependencies.api.heartbeat(activeSession, event);
          await dependencies.api.reportEvent(activeSession, event);
        } else if (entry.type === "result" && payload?.result) {
          const result = payload.result as WorkerResult;
          await dependencies.api.heartbeat(activeSession, result);
          await dependencies.api.reportResult(activeSession, result);
        }
        else { acknowledged.push(entry.id); continue; }
        acknowledged.push(entry.id);
      } catch (error) {
        // A terminal assignment can no longer accept its queued records after
        // cancellation or lease expiry. Drop only that record; transport and
        // protocol failures must remain queued for a later retry.
        const code = error && typeof error === "object" ? Reflect.get(error, "code") : null;
        if (code === "stale_lease") {
          acknowledged.push(entry.id);
          continue;
        }
        // An expired pool session can be recovered by registering again. Do
        // not hide that condition behind a pending-delivery state.
        if (code === "worker_pool_unauthorized") throw error;
        deliveryBlocked = true;
        break;
      }
    }
    if (acknowledged.length > 0) await dependencies.outbox.acknowledge(acknowledged);
    return !deliveryBlocked;
  };

  const execute = async (registeredSession: WorkerSession, assignment: LinuxWorkerAssignment): Promise<void> => {
    let activeSession = registeredSession;
    const parsedSnapshot = parseExecutionSnapshot(assignment.executionSnapshot);
    let appServer: AppServer | null = null;
    const subscription: { unsubscribe: (() => void) | null } = { unsubscribe: null };
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let resourcesReserved = false;
    let terminalResult: WorkerResult | null = null;
    let executionError: unknown = null;
    let preparedWorktreeCleanup: (() => Promise<void>) | null = null;
    let hasUndeliveredEvents = false;
    let liveSessionHandle: { close?(): Promise<void> } | null = null;
    let eventDelivery = Promise.resolve();
    let nextEventSequence = assignment.acceptedThroughSequence;
    let finalAssistantMessage: string | null = null;
    let liveSessionConnector: WorkerLiveSessionConnector | null = null;
    let liveSessionDegraded = false;
    // Phase frames are display-only and live in the relay's memory, so a page
    // reload or relay restart lost every phase. Mirror each transition into a
    // durable `loop.node.execution_phase_changed` event so the attempt snapshot
    // (and therefore the Loop page) can be rebuilt from the database.
    const phaseSnapshot = {
      phase: null as string | null,
      status: null as WorkerLiveSessionPhase["status"] | null,
    };
    const persistPhase = (
      phase: string,
      status: WorkerLiveSessionPhase["status"],
      frame: WorkerLiveSessionPhase,
    ): void => {
      if (phaseSnapshot.phase === phase && phaseSnapshot.status === status) return;
      phaseSnapshot.phase = phase;
      phaseSnapshot.status = status;
      const payload = {
        phase,
        status,
        startedAt: frame.startedAt,
        finishedAt: frame.finishedAt,
        code: frame.code,
        summary: frame.summary,
      };
      // Sequence numbers are allocated synchronously so the shared delivery
      // chain stays monotonic. The platform fences appends on
      // `lastEventSequence < sequence`, so a phase event must never overtake an
      // already-queued lifecycle event. A dropped phase event leaves a gap,
      // which that fence tolerates.
      const event = assignmentEvent(
        assignment,
        ++nextEventSequence,
        EXECUTION_PHASE_EVENT_TYPE,
        payload,
        now,
        runtimeSecrets,
      );
      eventDelivery = eventDelivery.then(async () => {
        // Once a lifecycle event is only queued in the outbox, the platform has
        // not seen its sequence yet. Persisting a later phase event now would
        // advance the platform's monotonic fence past that queued evidence and
        // make its replay look stale. Degrade with the rest of the stream
        // instead; the phase snapshot is diagnostic.
        if (hasUndeliveredEvents) return;
        try {
          // Deliver straight to the platform instead of going through
          // `emitLifecycle`: the outbox exists for terminal evidence, and a
          // missing phase snapshot must never queue ahead of the result that
          // ends the assignment.
          await dependencies.api.reportEvent(activeSession, event);
        } catch {
          // Phase persistence is diagnostic. A rejected append must never fail
          // or delay the business assignment that is already running.
        }
      });
    };
    const emitPhase = async (
      phase: string,
      status: WorkerLiveSessionPhase["status"],
      details: { code?: string | null; summary?: string | null; startedAt?: Date; finishedAt?: Date | null } = {},
    ): Promise<void> => {
      const frame: WorkerLiveSessionPhase = {
        phase,
        status,
        startedAt: (details.startedAt ?? now()).toISOString(),
        finishedAt: details.finishedAt === undefined
          ? (status === "running" || status === "pending" ? null : now().toISOString())
          : details.finishedAt?.toISOString() ?? null,
        code: details.code ?? null,
        summary: details.summary ?? null,
      };
      persistPhase(phase, status, frame);
      if (!liveSessionConnector || liveSessionDegraded) return;
      await liveSessionConnector.publishPhase(frame).catch(() => {
        // Phase reporting is display-only: a relay problem must never fail the
        // business assignment that is already committed to run.
        liveSessionDegraded = true;
      });
    };
    const runPhase = async <T>(
      phase: string,
      action: () => Promise<T>,
      summary?: string,
    ): Promise<T> => {
      const startedAt = now();
      await emitPhase(phase, "running", { startedAt, summary: summary ?? null });
      try {
        const result = await action();
        await emitPhase(phase, "succeeded", { startedAt });
        return result;
      } catch (error) {
        const code = error && typeof error === "object" && typeof Reflect.get(error, "code") === "string"
          ? String(Reflect.get(error, "code"))
          : "worker_execution_failed";
        await emitPhase(phase, "failed", { startedAt, code });
        throw error;
      }
    };
    const reportWorktreePhase = (event: WorkerWorktreePhaseEvent): void => {
      const frame: WorkerLiveSessionPhase = {
        phase: event.phase,
        status: event.status,
        startedAt: now().toISOString(),
        finishedAt: event.status === "running" ? null : now().toISOString(),
        code: event.code ?? null,
        summary: event.action ? `worktree.${event.action}` : null,
      };
      persistPhase(event.phase, event.status, frame);
      if (!liveSessionConnector || liveSessionDegraded) return;
      liveSessionConnector.publishPhase(frame).catch(() => {
        liveSessionDegraded = true;
      });
    };
    const executionApiKey = typeof assignment.executionCredentials?.apiKey === "string"
      ? assignment.executionCredentials.apiKey.trim()
      : "";
    let runtimeSecrets: string[] = [executionApiKey];
    const heartbeat = async (): Promise<void> => {
      try {
        await dependencies.api.heartbeat(activeSession, assignment);
      } catch (error) {
        const code = error && typeof error === "object" ? Reflect.get(error, "code") : null;
        if (code !== "worker_pool_unauthorized") throw error;
        activeSession = await registerSession();
        await dependencies.api.heartbeat(activeSession, assignment);
        currentState = "running";
      }
    };
    const emitLifecycle = (eventType: string, payloadSummary: unknown): Promise<void> => {
      const event = assignmentEvent(assignment, ++nextEventSequence, eventType, payloadSummary, now, runtimeSecrets);
      eventDelivery = eventDelivery.then(async () => {
        if (hasUndeliveredEvents) {
          await dependencies.outbox.enqueue({ type: "event", payload: { event } });
          return;
        }
        try {
          await sendEvent(activeSession, event);
        } catch {
          hasUndeliveredEvents = true;
        }
      });
      return eventDelivery;
    };
    try {
      await emitLifecycle("worker.assignment.claimed", { state: "claimed" });
      // The observation socket opens before repository work so the browser can
      // already distinguish "waiting on Git" from "nothing started".
      const liveSession = assignment.liveSession;
      if (liveSession && dependencies.createLiveSessionConnector) {
        liveSessionConnector = dependencies.createLiveSessionConnector(liveSession);
        await liveSessionConnector.start().catch(() => {
          liveSessionDegraded = true;
        });
        await emitPhase("assignment.claimed", "succeeded", { startedAt: now() });
      }
      if (!parsedSnapshot || !executionApiKey) {
        throw workerError("configuration_required", "Linux Worker assignment has no complete immutable Codex configuration");
      }
      if (parsedSnapshot.workerInstanceId !== undefined && parsedSnapshot.workerInstanceId !== dependencies.config.instanceId) {
        throw workerError("worker_affinity_mismatch", "Linux Worker assignment is bound to a different Worker instance");
      }
      if (
        (parsedSnapshot.resources.gpu && activeGpu >= resourceLimits.gpuConcurrency)
        || (parsedSnapshot.resources.unityBuild && activeUnityBuilds >= resourceLimits.unityBuildConcurrency)
      ) {
        throw workerError("resource_concurrency_unavailable", "Linux Worker resource concurrency is unavailable");
      }
      if (parsedSnapshot.resources.gpu) activeGpu += 1;
      if (parsedSnapshot.resources.unityBuild) activeUnityBuilds += 1;
      resourcesReserved = true;
      currentState = "preparing";
      // The lease is only 60s and a cold clone or a slow network can exceed it
      // before app-server ever starts. Begin heartbeating as soon as the work
      // is committed to this Worker so preparation cannot expire the lease and
      // turn a healthy run into a terminal `lease_expired`.
      await heartbeat();
      heartbeatTimer = setInterval(() => {
        void heartbeat().catch(() => { currentState = "degraded"; });
      }, heartbeatIntervalMs);
      const projectEnvironment = assignment.executionCredentials?.environment ?? {};
      await emitPhase("repository.configuration_check", "succeeded");
      const preparedWorktree = await dependencies.prepareWorktree({
        agentRunId: assignment.agentRunId,
        repository: parsedSnapshot.repository,
        workspaceKey: assignment.loopRunId,
        ...(Object.keys(projectEnvironment).length === 0 ? {} : { environment: projectEnvironment }),
        ...(liveSessionConnector && !liveSessionDegraded ? { reportPhase: reportWorktreePhase } : {}),
      });
      const cwd = typeof preparedWorktree === "string" ? preparedWorktree : preparedWorktree.cwd;
      if (typeof preparedWorktree !== "string") preparedWorktreeCleanup = preparedWorktree.cleanup ?? null;
      if (typeof preparedWorktree !== "string" && preparedWorktree.gitEnvironment) {
        runtimeSecrets = [
          ...runtimeSecrets,
          preparedWorktree.gitEnvironment.HT_GIT_USERNAME ?? "",
          preparedWorktree.gitEnvironment.HT_GIT_TOKEN ?? "",
          preparedWorktree.gitEnvironment.HT_GIT_SECRET ?? "",
        ];
      }
      runtimeSecrets = [...runtimeSecrets, ...Object.values(projectEnvironment)];
      // Only a session that must expose an attachable TUI needs the WebSocket
      // listener. Every other Worker run keeps the proven stdio transport.
      const server = dependencies.appServer(assignment.liveSession ? { transport: "websocket" } : undefined);
      appServer = server;
      await emitLifecycle("worker.stage.started", { state: "preparing" });
      await server.start({
        cwd,
        codexHome: `${dependencies.config.stateDirectory}/codex/${assignment.agentRunId}`,
        endpoint: parsedSnapshot.model.endpoint,
        apiKey: executionApiKey,
        model: parsedSnapshot.model.model,
        reasoningEffort: parsedSnapshot.model.reasoningEffort,
        sessionId: assignment.agentRunId,
        ...(typeof preparedWorktree === "string" || !preparedWorktree.gitEnvironment
          ? {}
          : { gitEnvironment: preparedWorktree.gitEnvironment }),
        ...(Object.keys(projectEnvironment).length === 0 ? {} : { runtimeEnvironment: projectEnvironment }),
        ...(assignment.checklistMcp ? {
          checklistMcp: {
            url: assignment.checklistMcp.url,
            headers: {
              "x-worker-pool-session": activeSession.sessionToken,
              "x-humanthread-worker-pool": activeSession.poolId,
            },
          },
        } : {}),
      });
      currentState = "running";
      await heartbeat();
      await emitLifecycle("worker.app_server.started", { state: "running" });
      await emitPhase("app_server.start", "succeeded");
      let streamedAssistantMessage = "";
      const terminal = new Promise<{ success: boolean; output: unknown }>((resolve) => {
        subscription.unsubscribe = server.subscribe((notification) => {
          const completedMessage = completedAssistantMessage(notification, (delta) => {
            streamedAssistantMessage += delta;
          });
          if (completedMessage) {
            finalAssistantMessage = completedMessage;
            streamedAssistantMessage = "";
          }
          const parsed = parseTerminalNotification(notification);
          if (parsed) {
            // Relays may finish a turn without a structured result, and some
            // app-server versions only stream assistant deltas before the
            // completed item. Fall back to whichever assistant text arrived.
            const fallback = finalAssistantMessage ?? (streamedAssistantMessage.trim() || null);
            resolve({ ...parsed, output: parsed.success ? terminalOutput(parsed.output, fallback) : parsed.output });
          }
        });
      });
      const thread = await server.request("thread/start", {
        cwd,
        model: parsedSnapshot.model.model,
        // The Worker container and task worktree are the isolation boundary.
        // Bubblewrap workspace-write cannot create mount namespaces under the
        // Kubernetes security context, so Codex must not try to sandbox again.
        sandbox: "danger-full-access",
        approvalPolicy: "never",
      });
      const threadId = extractId(thread, "threadId") ?? extractId(thread, "thread") ?? "";
      if (!threadId) throw workerError("provider_protocol_error", "Codex app-server did not return a thread ID");
      if (assignment.liveSession && dependencies.onLiveSession) {
        await emitPhase("tui.attach", "running");
        liveSessionHandle = await dependencies.onLiveSession({
          assignment: { ...assignment, liveSession: { ...assignment.liveSession } },
          appServer: server,
          threadId,
          cwd,
          codexHome: `${dependencies.config.stateDirectory}/codex/${assignment.agentRunId}`,
          environment: projectEnvironment,
          connector: liveSessionConnector,
        }) ?? null;
        await emitPhase("tui.attach", "succeeded");
      }
      await emitPhase("codex.turn", "running");
      await server.request("turn/start", {
        threadId,
        input: [{ type: "text", text: executionPrompt(assignment) }],
        cwd,
        model: parsedSnapshot.model.model,
        effort: parsedSnapshot.model.reasoningEffort,
        // App-server v2 applies the execution policy at turn start. The
        // Kubernetes Worker container is the isolation boundary, so avoid a
        // nested bubblewrap sandbox that cannot create mount namespaces.
        sandboxPolicy: { type: "dangerFullAccess" },
        approvalPolicy: "never",
      });
      const finished = await terminal;
      await emitPhase("codex.turn", finished.success ? "succeeded" : "failed", {
        code: finished.success ? null : "provider_turn_failed",
      });
      if (dependencies.api.currentSequence) {
        nextEventSequence = Math.max(nextEventSequence, await dependencies.api.currentSequence(activeSession, assignment));
      }
      if (!finished.success) {
        const failurePayload = record(finished.output);
        const providerError = record(failurePayload?.error) ?? failurePayload;
        const failureMessage = typeof failurePayload?.message === "string"
          ? failurePayload.message
          : typeof failurePayload?.error === "string"
          ? failurePayload.error
          : "Codex app-server reported a failed turn";
        const failure = workerError("provider_error", String(redactWorkerPayload(failureMessage, "", 0, runtimeSecrets)).slice(0, 4_000));
        if (providerError) {
          Object.assign(failure, {
            providerDiagnostic: {
              ...(typeof providerError.code === "string" ? { code: providerError.code } : {}),
              ...(typeof providerError.httpStatus === "number" ? { httpStatus: providerError.httpStatus } : {}),
              ...(typeof providerError.type === "string" ? { type: providerError.type } : {}),
              ...(typeof providerError.requestId === "string" ? { requestId: providerError.requestId } : {}),
              ...(typeof providerError.message === "string" ? { message: providerError.message } : {}),
            },
          });
        }
        throw failure;
      }
      if (finished.output === null || finished.output === undefined) {
        throw workerError(
          "empty_terminal_result",
          "Codex completed without a terminal result or final assistant message",
        );
      }
      const declaredFailure = declaredStageFailure(finished.output);
      if (declaredFailure) throw stageFailureError(declaredFailure);
      // Preparation and analysis stages may need a repository but have no
      // delivery obligation. Do not push a branch merely to collect evidence:
      // an older task worktree can legitimately be behind the remote branch.
      const deliveryEvidence = !parsedSnapshot.deliveryPolicy.requireGitDelivery || typeof preparedWorktree === "string"
        ? null
        : await preparedWorktree.inspectDelivery?.() ?? null;
      const deliveryError = deliveryFailure(deliveryEvidence, parsedSnapshot.deliveryPolicy.requireGitDelivery);
      if (deliveryError) throw deliveryError;
      const reviewArtifacts = await uploadReviewArtifacts(activeSession, assignment, cwd, {
        ...(dependencies.collectReviewArtifacts ? { collectReviewArtifacts: dependencies.collectReviewArtifacts } : {}),
        ...(dependencies.api.uploadArtifact ? { uploadArtifact: dependencies.api.uploadArtifact } : {}),
      }, declaredReviewArtifactPaths(finished.output));
      if (reviewArtifacts.failures.length > 0) {
        await emitLifecycle("worker.review_artifact.degraded", {
          state: "degraded",
          failures: reviewArtifacts.failures,
        });
      }
      terminalResult = {
        agentRunId: assignment.agentRunId,
        loopRunId: assignment.loopRunId,
        loopNodeRunId: assignment.loopNodeRunId,
        loopNodeAttemptId: assignment.loopNodeAttemptId,
        attemptNo: assignment.attemptNo,
        leaseGeneration: assignment.leaseGeneration,
        result: {
          outcome: "success",
          output: redactWorkerPayload({
            appServer: finished.output,
            delivery: {
              required: parsedSnapshot.deliveryPolicy.requireGitDelivery,
              evidence: deliveryEvidence,
            },
          }, "", 0, runtimeSecrets),
          artifactRefs: reviewArtifacts.artifactRefs,
          effectReceipts: [],
        },
      };
      await emitLifecycle("worker.stage.completed", { state: "completed" });
    } catch (error) {
      executionError = error;
      terminalResult = failureResult(assignment, error, now, runtimeSecrets);
      dependencies.onExecutionFailure?.({
        agentRunId: assignment.agentRunId,
        code: terminalResult.result.failure?.code ?? "worker_execution_failed",
        summary: terminalResult.result.failure?.summary ?? "Linux Worker execution failed",
      });
      await emitLifecycle("worker.stage.failed", {
        state: "failed",
        code: terminalResult.result.failure?.code ?? "worker_execution_failed",
      });
    } finally {
      await emitLifecycle("worker.cleanup.started", { state: "cleaning" });
      await emitPhase("cleanup", "running");
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      subscription.unsubscribe?.();
      await liveSessionHandle?.close?.().catch(() => undefined);
      await appServer?.stop().catch(() => undefined);
      await preparedWorktreeCleanup?.().catch(() => undefined);
      if (resourcesReserved) {
        if (parsedSnapshot?.resources.gpu) activeGpu -= 1;
        if (parsedSnapshot?.resources.unityBuild) activeUnityBuilds -= 1;
      }
      await emitLifecycle("worker.cleanup.completed", { state: "cleaned" });
      await emitPhase("cleanup", "succeeded");
      await liveSessionConnector?.close().catch(() => undefined);
      if (terminalResult) {
        try {
          if (hasUndeliveredEvents) {
            await dependencies.outbox.enqueue({ type: "result", payload: { result: terminalResult } });
          } else await sendResult(activeSession, terminalResult);
        } catch (error) {
          // A normal delivery rejection is already durable in the outbox and
          // does not reach here. Reaching here means the outbox itself failed,
          // so the Worker must expose that unrecoverable local state failure.
          if (!executionError) {
            const code = error && typeof error === "object" && typeof Reflect.get(error, "code") === "string"
              ? String(Reflect.get(error, "code"))
              : "worker_outbox_unavailable";
            dependencies.onExecutionFailure?.({
              agentRunId: assignment.agentRunId,
              code,
              summary: error instanceof Error ? error.message : "Worker cannot durably store its terminal result",
            });
          }
          executionError ??= error;
        }
      }
    }
    if (executionError) throw executionError;
  };

  return {
    async tick() {
      if (draining) return;
      if (now().getTime() < retryAfterMs) return;
      try {
        if (!session) {
          await registerSession();
        }
        const activeSession = session;
        if (!activeSession) throw workerError("provider_transport_error", "Worker pool session is unavailable");
        const outboxDelivered = await replayOutbox(activeSession);
        if (!outboxDelivered) {
          // Keep the current lease alive through the outbox replay path and
          // do not claim another task while terminal evidence is unacked.
          currentState = "running";
          return;
        }
        consecutiveTransportFailures = 0;
        retryAfterMs = 0;
        currentState = "idle";
        if (active.size >= dependencies.config.requestedConcurrency) return;
        const claimed = await dependencies.api.claim(activeSession);
        if (draining) return;
        if (!claimed.assignment && claimed.liveSession) {
          const execution = executeDirectLiveSession(activeSession, claimed.liveSession);
          active.add(execution);
          void execution.catch(() => { currentState = "degraded"; }).finally(() => {
            active.delete(execution);
            if (active.size === 0 && currentState !== "degraded") currentState = draining ? "draining" : "idle";
          });
          return;
        }
        if (!claimed.assignment) return;
        if (isWorkerValidationAssignment(claimed.assignment)) {
          if (!dependencies.api.acknowledgeValidationChallenge) {
            throw workerError("executor_not_configured", "当前 Worker 不支持无副作用 claim 校验，请更新 Worker 镜像");
          }
          await dependencies.api.acknowledgeValidationChallenge(activeSession, claimed.assignment);
          return;
        }
        currentState = "claimed";
        const execution = execute(activeSession, claimed.assignment);
        active.add(execution);
        void execution.catch(() => { currentState = "degraded"; }).finally(() => {
          active.delete(execution);
          // Do not erase a terminal local failure (for example, an unavailable
          // outbox) simply because its execution promise settled. Recovery
          // requires an operator-visible degraded state rather than a false
          // idle readiness signal.
          if (active.size === 0 && currentState !== "degraded") currentState = draining ? "draining" : "idle";
        });
      } catch (error) {
        const code = error && typeof error === "object" ? Reflect.get(error, "code") : null;
        if (code === "worker_pool_unauthorized") {
          session = null;
          consecutiveTransportFailures = 0;
          retryAfterMs = 0;
        } else {
          consecutiveTransportFailures = Math.min(consecutiveTransportFailures + 1, 8);
          retryAfterMs = now().getTime() + Math.min(60_000, 1_000 * (2 ** (consecutiveTransportFailures - 1)));
        }
        currentState = "degraded";
      }
    },
    async drain() {
      draining = true;
      currentState = "draining";
      await Promise.allSettled([...active]);
    },
    state() { return currentState; },
  };
}
