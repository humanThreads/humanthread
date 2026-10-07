import Ajv2020 from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import { relative, sep } from "node:path";
import type {
  AgentWorkerCapabilitySnapshot,
  LoopAgentEvent,
  LoopAssignment,
  LoopAssignmentV2,
  LoopNodeResult,
  LocalRouteDecision,
} from "@humanthread/shared";
import {
  isDurableLoopAgentEventType,
  taskTestReportSchema,
} from "@humanthread/shared";

import {
  calculateLoopOutboxRecordByteSize,
  type LoopOutbox,
  type LoopOutboxRecord,
} from "./loop-outbox";
import type {
  ProjectLoopStageContract,
  ResolvedStageResources,
} from "@humanthread/project-loop-sync";
import type { LoopAssignmentApi } from "./loop-assignment-api";
import type { AgentProviderAdapter, NormalizedRunEvent } from "./providers/provider-adapter";
import type { LocalModelExecutionOptions } from "./local-model-routing-runtime";
import {
  renderProjectConstraints,
  type ConstraintBundle,
} from "./project-constraints";
import {
  buildCodexExecutionPolicy,
  type WorkspaceExecutionEvidence,
} from "./workspace-policy";
import { evaluateStageQualityGate, type StageGateResult } from "./quality-gate";
import { buildStageExecution } from "./stage-runner";
import { decideNextStage } from "./decision-router";
import { DECISION_ROUTER_OUTPUT_SCHEMA } from "./decision-router";
import { createOfflineContinuation, serializeOfflineContinuation } from "./offline-continuation";
import { attemptStageAutoRecovery } from "./stage-auto-recovery";

export type { LoopAssignmentApi } from "./loop-assignment-api";

type ProviderCheckpointMetadata = {
  transport: "codex_app_server" | "codex_cli";
  threadId: string;
  serverGeneration?: number;
  lastTurnId?: string;
  lastEventSequence?: number;
  bindingFingerprint?: string;
};

type AssignmentCheckpoint = {
  providerSessionId?: string;
  providerBindingFingerprint?: string;
  provider?: ProviderCheckpointMetadata;
  value?: unknown;
};

type RunnerGrantSnapshot = {
  permission: "read_only" | "workspace_full";
  networkTargets: string[];
};

type RunnerAssignment = LoopAssignment | LoopAssignmentV2;
type LocalStageContract = {
  stage: ProjectLoopStageContract;
  resourcesByExecId: Record<string, ResolvedStageResources>;
};

export type LoopRunnerDependencies = {
  api: LoopAssignmentApi;
  outbox: LoopOutbox;
  provider: AgentProviderAdapter;
  resolveProvider?(
    assignment: RunnerAssignment,
    options?: LocalModelExecutionOptions,
  ): Promise<AgentProviderAdapter>;
  resolveLocalModel?(assignment: RunnerAssignment): Promise<LocalModelExecutionOptions | undefined>;
  resolveChecklistMcp?(assignment: RunnerAssignment): Promise<NonNullable<LocalModelExecutionOptions["checklistMcp"]>>;
  readCurrentSequence?(assignment: RunnerAssignment): Promise<number>;
  workerId?: string;
  capabilitySnapshot: AgentWorkerCapabilitySnapshot;
  now?: () => Date;
  resolveWorkspace(assignment: RunnerAssignment): Promise<string | WorkspaceExecutionEvidence>;
  loadLocalStageContract?(input: {
    workspaceRoot: string;
    nodeId: string;
    assignment: RunnerAssignment;
  }): Promise<LocalStageContract>;
  loadProjectConstraints?(input: {
    workspaceRoot: string;
    targetPaths: string[];
  }): Promise<ConstraintBundle>;
  writeResultSchema(input: {
    workspaceRealpath: string;
    relativePath: string;
    schema: unknown;
  }): Promise<string>;
  readStageArtifact?(input: { workspaceRealpath: string; relativePath: string }): Promise<string | null>;
  runStageCheck?(input: { workspaceRealpath: string; command: string }): Promise<{ passed: boolean; summary: string }>;
  initialLeaseDurationMs?: number;
  startHeartbeat?: (
    heartbeat: () => Promise<void>,
    intervalMs: number,
  ) => () => void;
  onHeartbeatStatus?: (status: {
    state: "healthy" | "failed";
    errorCode?: string;
    lastSuccessAt?: number;
    leaseExpiresAt?: number;
  }) => void;
  signal?: AbortSignal;
};

function isV2Assignment(assignment: RunnerAssignment): assignment is LoopAssignmentV2 {
  return "contractVersion" in assignment && assignment.contractVersion === 2;
}

const LEGACY_LEASE_DURATION_MS = 30_000;
const MAX_LEASE_DURATION_MS = 300_000;
const MIN_HEARTBEAT_TIMEOUT_MS = 250;

function resolveLeaseDurationMs(value: number | undefined): number {
  if (
    typeof value === "number"
    && Number.isInteger(value)
    && value >= 3_000
    && value <= MAX_LEASE_DURATION_MS
  ) return value;
  return LEGACY_LEASE_DURATION_MS;
}

function assignmentTargetPaths(inputSnapshot: unknown): string[] {
  if (!inputSnapshot || typeof inputSnapshot !== "object" || Array.isArray(inputSnapshot)) return ["."];
  const targetPaths = Reflect.get(inputSnapshot, "targetPaths");
  if (!Array.isArray(targetPaths)) return ["."];
  const paths = targetPaths.filter((value): value is string => typeof value === "string");
  return paths.length > 0 ? paths : ["."];
}

function routeHistory(inputSnapshot: unknown): Array<{ fromNodeId: string; nextNodeId: string }> {
  if (!inputSnapshot || typeof inputSnapshot !== "object" || Array.isArray(inputSnapshot)) return [];
  const history = Reflect.get(inputSnapshot, "routeHistory");
  if (!Array.isArray(history)) return [];
  return history.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const fromNodeId = Reflect.get(item, "fromNodeId");
    const nextNodeId = Reflect.get(item, "nextNodeId");
    return typeof fromNodeId === "string" && typeof nextNodeId === "string" ? [{ fromNodeId, nextNodeId }] : [];
  }).slice(0, 1_024);
}

async function sha256Hex(source: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function routeRecordId(assignment: LoopAssignmentV2, decisionId: string): Promise<string> {
  const source = `${assignment.loopRunId}\0${assignment.loopNodeAttemptId}\0${decisionId}`;
  return `route:${await sha256Hex(source)}`;
}

function parseGrantSnapshot(): RunnerGrantSnapshot {
  // The platform Loop graph is the authorization boundary. Local Agent runs
  // are already leased assignments inside an isolated project workspace; a
  // missing or stale automation grant must not turn the worker read-only or
  // block execution a second time.
  return { permission: "workspace_full", networkTargets: [] };
}

function parseCheckpoint(value: unknown): AssignmentCheckpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const checkpoint = value as Record<string, unknown>;
  const providerValue = checkpoint.provider;
  const providerRecord = providerValue && typeof providerValue === "object" && !Array.isArray(providerValue)
    ? providerValue as Record<string, unknown>
    : null;
  const providerTransport = providerRecord?.transport;
  const providerThreadId = providerRecord?.threadId;
  const parsedProvider = (
    (providerTransport === "codex_app_server" || providerTransport === "codex_cli")
    && typeof providerThreadId === "string"
    && providerThreadId.length > 0
    && providerThreadId.length <= 256
  ) ? {
    transport: providerTransport,
    threadId: providerThreadId,
    ...(typeof providerRecord?.serverGeneration === "number" && Number.isSafeInteger(providerRecord.serverGeneration) && providerRecord.serverGeneration >= 0
      ? { serverGeneration: providerRecord.serverGeneration }
      : {}),
    ...(typeof providerRecord?.lastTurnId === "string" && providerRecord.lastTurnId.length > 0 && providerRecord.lastTurnId.length <= 256
      ? { lastTurnId: providerRecord.lastTurnId }
      : {}),
    ...(typeof providerRecord?.lastEventSequence === "number" && Number.isSafeInteger(providerRecord.lastEventSequence) && providerRecord.lastEventSequence >= 0
      ? { lastEventSequence: providerRecord.lastEventSequence }
      : {}),
    ...(typeof providerRecord?.bindingFingerprint === "string" && /^[a-f0-9]{64}$/u.test(providerRecord.bindingFingerprint)
      ? { bindingFingerprint: providerRecord.bindingFingerprint }
      : {}),
  } satisfies ProviderCheckpointMetadata : undefined;
  return {
    ...(typeof checkpoint.providerSessionId === "string"
      ? { providerSessionId: checkpoint.providerSessionId }
      : {}),
    ...(typeof checkpoint.providerBindingFingerprint === "string"
      ? { providerBindingFingerprint: checkpoint.providerBindingFingerprint }
      : {}),
    ...(parsedProvider ? { provider: parsedProvider } : {}),
    ...(Object.hasOwn(checkpoint, "value") ? { value: checkpoint.value } : {}),
  };
}

function checkpointProviderSessionId(checkpoint: AssignmentCheckpoint | null | undefined): string | undefined {
  return checkpoint?.provider?.threadId ?? checkpoint?.providerSessionId;
}

function checkpointProviderBindingFingerprint(checkpoint: AssignmentCheckpoint | null | undefined): string | undefined {
  return checkpoint?.provider?.bindingFingerprint ?? checkpoint?.providerBindingFingerprint;
}

function providerCheckpointMetadata(input: {
  transport?: "codex_app_server" | "codex_cli" | undefined;
  threadId?: string | undefined;
  generation?: number | undefined;
  turnId?: string | undefined;
  eventSequence?: number | undefined;
  bindingFingerprint?: string | undefined;
}): ProviderCheckpointMetadata | undefined {
  if (!input.transport || !input.threadId) return undefined;
  return {
    transport: input.transport,
    threadId: input.threadId,
    ...(input.generation === undefined ? {} : { serverGeneration: input.generation }),
    ...(input.turnId ? { lastTurnId: input.turnId } : {}),
    ...(input.eventSequence === undefined ? {} : { lastEventSequence: input.eventSequence }),
    ...(input.bindingFingerprint ? { bindingFingerprint: input.bindingFingerprint } : {}),
  };
}

function checkpointIdentity(value: unknown): { branch?: string; commit?: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const identity: { branch?: string; commit?: string } = {};
  for (const key of ["branch", "commit"] as const) {
    const candidate = Reflect.get(value, key);
    if (typeof candidate === "string" && candidate.trim()) identity[key] = candidate.slice(0, 256);
  }
  return Object.keys(identity).length > 0 ? identity : null;
}

function workspaceEvidence(value: string | WorkspaceExecutionEvidence): WorkspaceExecutionEvidence {
  if (typeof value === "string") {
    return {
      workspaceRealpath: value,
      branch: null,
      headCommit: null,
      clean: null,
      isWorktree: false,
    };
  }
  return value;
}

function isStopError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String(Reflect.get(error, "code") ?? "");
  return code === "stale_lease"
    || code === "not_found"
    || code === "authorization_denied"
    || code === "grant_revoked"
    || code === "cancelled";
}

function configurationRejectionCode(
  error: unknown,
): string | null {
  if (!error || typeof error !== "object") return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" && [
    "workspace_configuration_stale",
    "runtime_configuration_stale",
    "project_not_initialized",
    "local_structure_invalid",
    "node_file_missing",
    "node_orphaned",
    "node_contract_migration_required",
    "node_identity_mismatch",
    "node_unconfigured",
    "stage_file_missing",
    "stage_orphaned",
    "stage_unconfigured",
    "stage_identity_ambiguous",
    "stage_identity_mismatch",
    "stage_resource_missing",
    "stage_prompt_missing",
    "stage_skill_missing",
    "invalid_stage_config",
    "invalid_stage_agents",
    "invalid_stage_skill_index",
    "invalid_node_config",
    "invalid_output_schema",
    "invalid_loop_catalog",
    "loop_catalog_unavailable",
    "loop_catalog_sync_failed",
    "workspace_file_too_large",
    "workspace_read_failed",
    "local_model_configuration_invalid",
    "local_model_invalid",
    "task_worktree_required",
    "release_worktree_required",
    "release_worktree_dirty",
  ].includes(code) ? code : null;
}

function localFailureOutput(error: unknown, stage: string, initialized: boolean): {
  errorCode: string;
  message: string;
  stage: string;
} {
  const candidateCode = error && typeof error === "object" ? Reflect.get(error, "code") : null;
  const errorCode = typeof candidateCode === "string" && /^[a-z0-9_]{1,64}$/u.test(candidateCode)
    ? candidateCode
    : initialized ? "local_execution_failed" : "local_initialization_failed";
  const fallbackMessage = initialized
    ? "Local execution failed"
    : "Local execution initialization failed";
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : error && typeof error === "object" && typeof Reflect.get(error, "message") === "string"
        ? String(Reflect.get(error, "message"))
        : fallbackMessage;
  const message = sanitizeFailureText(rawMessage, fallbackMessage);
  return {
    errorCode,
    message,
    stage,
  };
}

function sanitizeFailureText(rawMessage: string, fallbackMessage: string): string {
  const message = rawMessage
    .replace(/(?:[A-Za-z]:\\|\/)(?:[^\s"']+[\\/])*[^\s"']*/gu, "[local path]")
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/giu, "$1=[redacted]")
    .slice(0, 512);
  return message || fallbackMessage;
}

const NON_RETRYABLE_DEPENDENCIES = new Set([
  "MOBILE_SOURCE_UNAVAILABLE",
  "WORKSPACE_MISSING",
  "DEVICE_UNAVAILABLE",
  "CREDENTIAL_MISSING",
]);

const TRANSIENT_FAILURE_CODES = new Set([
  "provider_protocol_error",
  "provider_timeout",
  "timeout",
  "network_timeout",
]);

const FAILURE_EVIDENCE_KINDS = {
  environment: "environment",
  policy: "policies",
  log: "logs",
  artifact: "artifacts",
} as const;

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function failureCode(output: Record<string, unknown>): string {
  const candidate = output.errorCode ?? output.issueType;
  return typeof candidate === "string" && /^[A-Za-z0-9_]{1,96}$/u.test(candidate)
    ? candidate
    : "unknown_failure";
}

function failureStatus(code: string, output: Record<string, unknown>): "FAILED" | "NEEDS_CLARIFICATION" | "TIMEOUT" | "OUTPUT_PARSE_FAILED" {
  const status = output.status;
  if (status === "NEEDS_CLARIFICATION" || status === "OUTPUT_PARSE_FAILED" || status === "TIMEOUT" || status === "FAILED") {
    return status;
  }
  return /timeout/iu.test(code) ? "TIMEOUT" : "FAILED";
}

function failureCategory(
  code: string,
  status: "FAILED" | "NEEDS_CLARIFICATION" | "TIMEOUT" | "OUTPUT_PARSE_FAILED",
): "transient_technical" | "dependency_unavailable" | "requirement_unclear" | "permission_or_policy" | "deterministic_execution" | "business_validation" | "cancelled" | "unknown" {
  if (NON_RETRYABLE_DEPENDENCIES.has(code)) return "dependency_unavailable";
  if (status === "NEEDS_CLARIFICATION") return "requirement_unclear";
  if (/permission|policy|credential/iu.test(code)) return "permission_or_policy";
  if (/cancel/iu.test(code)) return "cancelled";
  if (TRANSIENT_FAILURE_CODES.has(code) || status === "TIMEOUT") return "transient_technical";
  if (/test|assert|parse|validation/iu.test(code)) return "deterministic_execution";
  return "unknown";
}

function failureEvidenceKind(code: string, category: ReturnType<typeof failureCategory>): keyof typeof FAILURE_EVIDENCE_KINDS {
  if (category === "dependency_unavailable") return "environment";
  if (category === "permission_or_policy") return "policy";
  if (category === "transient_technical" || /provider|protocol|timeout/iu.test(code)) return "log";
  return "artifact";
}

async function normalizeLoopFailure(result: LoopNodeResult, occurredAt: string): Promise<LoopNodeResult> {
  if (result.outcome !== "failure" || result.failure !== undefined) return result;
  const output = recordValue(result.output) ?? {};
  const code = failureCode(output);
  const status = failureStatus(code, output);
  const categoryHint = failureCategory(code, status);
  const kind = failureEvidenceKind(code, categoryHint);
  const evidenceValues = Array.isArray(output.evidence)
    ? output.evidence
    : Array.isArray(output.artifacts) ? output.artifacts : [];
  const evidence = await Promise.all(evidenceValues
    .map((value) => {
      if (typeof value === "string") return value;
      const record = recordValue(value);
      const reference = record?.reference ?? record?.path;
      return typeof reference === "string" ? reference : null;
    })
    .filter((value): value is string => value !== null)
    .slice(0, 20)
    .map(async (reference) => {
      const digest = await sha256Hex(reference);
      return {
        kind,
        reference: `${FAILURE_EVIDENCE_KINDS[kind]}/${digest.slice(0, 32)}`,
        digest,
      };
    }));
  const summaryValue = output.summary ?? output.message;
  const summary = sanitizeFailureText(
    typeof summaryValue === "string" ? summaryValue : "Loop execution failed",
    "Loop execution failed",
  );
  const retryable = TRANSIENT_FAILURE_CODES.has(code) || status === "TIMEOUT";
  const checkpoint = output.checkpoint === null || output.checkpoint === undefined
    ? undefined
    : checkpointIdentity(output.checkpoint);
  return {
    ...result,
    failure: {
      status,
      code,
      categoryHint,
      summary,
      evidence,
      retryHint: {
        recommended: retryable && !NON_RETRYABLE_DEPENDENCIES.has(code),
        reason: NON_RETRYABLE_DEPENDENCIES.has(code)
          ? "The required source or dependency is unavailable."
          : retryable
            ? "The provider reported a transient technical failure."
            : "The platform must classify this failure from trusted facts.",
      },
      ...(checkpoint === undefined ? {} : { checkpoint }),
      occurredAt,
    },
  };
}

function defaultStartHeartbeat(
  heartbeat: () => Promise<void>,
  intervalMs: number,
): () => void {
  const timer = globalThis.setInterval(() => { void heartbeat(); }, intervalMs);
  return () => globalThis.clearInterval(timer);
}

function projectProviderSchema(provider: AgentProviderAdapter, schema: unknown): unknown {
  return provider.projectStructuredOutputSchema
    ? provider.projectStructuredOutputSchema(schema)
    : schema;
}

function eventSummary(event: NormalizedRunEvent): unknown {
  switch (event.type) {
    case "agent.message.completed": return { characterCount: [...event.text].length };
    case "tool.requested":
    case "tool.started":
    case "tool.completed": return { tool: event.tool };
    case "approval.requested":
    case "checkpoint.created": return event.payload;
    case "artifact.produced": return providerArtifactSummary(event.payload);
    case "run.started": return {
      ...(event.providerSessionId ? { providerSessionId: event.providerSessionId } : {}),
      ...(event.providerBindingFingerprint ? { providerBindingFingerprint: event.providerBindingFingerprint } : {}),
      ...(event.providerTransport ? { providerTransport: event.providerTransport } : {}),
      ...(event.providerGeneration === undefined ? {} : { providerGeneration: event.providerGeneration }),
      ...(event.providerTurnId ? { providerTurnId: event.providerTurnId } : {}),
    };
    case "run.failed": return { errorCode: event.errorCode, message: event.message.slice(0, 512) };
    case "run.completed": return { usage: event.usage };
    case "run.cancelled": return {};
  }
}

function toLoopEvent(
  assignment: LoopAssignment,
  sequence: number,
  event: NormalizedRunEvent,
  occurredAt: string,
  workspaceRealpath?: string,
): LoopAgentEvent {
  const artifactPaths = event.type === "artifact.produced"
    ? providerArtifactPaths(event.payload, workspaceRealpath)
    : [];
  return {
    eventId: `event:${assignment.loopNodeAttemptId}:${sequence}`,
    loopRunId: assignment.loopRunId,
    loopNodeRunId: assignment.loopNodeRunId,
    loopNodeAttemptId: assignment.loopNodeAttemptId,
    attemptNo: assignment.attemptNo,
    leaseGeneration: assignment.leaseGeneration,
    sequence,
    eventType: event.type,
    occurredAt,
    payloadSummary: event.type === "artifact.produced"
      ? providerArtifactSummary(event.payload, workspaceRealpath)
      : eventSummary(event),
    artifactRefs: artifactPaths,
  };
}

function providerArtifactSummary(value: unknown, workspaceRealpath?: string): unknown {
  const paths = providerArtifactPaths(value, workspaceRealpath);
  return {
    artifactCount: paths.length,
    artifactPaths: paths,
  };
}

function providerArtifactPaths(value: unknown, workspaceRealpath?: string): string[] {
  const payload = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (!payload) return [];
  const candidates: string[] = [];
  for (const key of ["path", "filePath", "relativePath", "savedPath"]) {
    if (typeof payload[key] === "string") candidates.push(payload[key]);
  }
  const changes = payload.changes;
  if (Array.isArray(changes)) {
    for (const change of changes) {
      if (typeof change === "string") {
        candidates.push(change);
        continue;
      }
      const record = change && typeof change === "object" && !Array.isArray(change)
        ? change as Record<string, unknown>
        : null;
      if (!record) continue;
      for (const key of ["path", "filePath", "relativePath"]) {
        if (typeof record[key] === "string") candidates.push(record[key]);
      }
    }
  } else if (changes && typeof changes === "object" && !Array.isArray(changes)) {
    candidates.push(...Object.keys(changes));
  }
  return [...new Set(candidates.flatMap((candidate) => {
    const normalized = normalizeWorkspaceArtifactPath(candidate, workspaceRealpath);
    return normalized ? [normalized] : [];
  }))].slice(0, 100);
}

function normalizeWorkspaceArtifactPath(value: string, workspaceRealpath?: string): string | null {
  if (!value.trim() || value.includes("\0")) return null;
  let normalized = value.trim().replace(/\\/gu, "/");
  if (/^[a-z]:/iu.test(normalized)) return null;
  if (normalized.startsWith("/")) {
    if (!workspaceRealpath) return null;
    const path = relative(workspaceRealpath, value).split(sep).join("/");
    if (!path || path === ".." || path.startsWith("../")) return null;
    normalized = path;
  }
  normalized = normalized.replace(/^\.\/+/u, "");
  if (
    !normalized
    || normalized.startsWith("/")
    || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) return null;
  return normalized;
}

function reviewArtifactPaths(value: unknown, workspaceRealpath?: string): string[] {
  return providerArtifactPaths(value, workspaceRealpath)
    .filter((path) => /^generated\/reviews\/.+\.html?$/iu.test(path));
}

function makeOutboxRecord(input: Omit<LoopOutboxRecord, "byteSize">): LoopOutboxRecord {
  return { ...input, byteSize: calculateLoopOutboxRecordByteSize(input) };
}

function assertStructuredResult(assignment: LoopAssignment, output: unknown, localSchema?: unknown): LoopNodeResult {
  const schema = localSchema ?? assignment.node.outputSchema ?? {};
  try {
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema as AnySchema);
    if (!validate(output)) {
      throw Object.assign(new Error("Provider result does not match the node output Schema"), {
        code: "invalid_provider_result",
        validationErrors: validate.errors,
      });
    }
  } catch (error) {
    if (error && typeof error === "object" && Reflect.get(error, "code") === "invalid_provider_result") {
      throw error;
    }
    throw Object.assign(new Error("Node output Schema is invalid"), {
      code: "invalid_result_schema",
      cause: error,
    });
  }
  return assignment.node.key === "verify_and_push"
    ? taskDevelopmentNodeResult(assignment, output)
    : {
        outcome: providerResultOutcome(output),
        output,
        artifactRefs: providerResultArtifactRefs(output),
        effectReceipts: [],
      };
}

function providerResultOutcome(output: unknown): LoopNodeResult["outcome"] {
  if (!output || typeof output !== "object" || Array.isArray(output)) return "success";
  const status = Reflect.get(output, "status");
  if (status === "SUCCESS") return "success";
  return typeof status === "string" ? "failure" : "success";
}

function providerResultArtifactRefs(output: unknown): string[] {
  if (!output || typeof output !== "object" || Array.isArray(output)) return [];
  const artifacts = Reflect.get(output, "artifacts");
  if (!Array.isArray(artifacts)) return [];
  return [...new Set(artifacts.filter((artifact): artifact is string => (
    typeof artifact === "string"
    && artifact.length > 0
    && artifact.length <= 1_024
    && !artifact.startsWith("/")
    && !artifact.includes("\\")
    && !/^[a-z]:/iu.test(artifact)
    && artifact.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  )))].slice(0, 100);
}

function taskDevelopmentNodeResult(
  assignment: LoopAssignment,
  output: unknown,
): LoopNodeResult {
  const invalid = (message: string): never => {
    throw Object.assign(new Error(message), { code: "invalid_task_development_evidence" });
  };
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return invalid("Task development evidence must be an object");
  }
  const report = taskTestReportSchema.safeParse(Reflect.get(output, "report"));
  const knowledgeRefs = parseKnowledgeRefs(Reflect.get(output, "knowledgeRefs"));
  const pushReceipt = parsePushReceipt(Reflect.get(output, "pushReceipt"));
  if (!report.success || !knowledgeRefs || !pushReceipt) {
    return invalid("Task development evidence is malformed");
  }
  if (
    report.data.branch !== pushReceipt.branch
  ) return invalid("Task development evidence identity does not match the assignment");
  if (
    pushReceipt.status === "succeeded"
    && report.data.commit !== pushReceipt.remoteHeadCommit
  ) return invalid("Task test report commit does not match the remote branch head");

  const artifactRefs = [...new Set([
    ...report.data.requirements.flatMap((requirement) => requirement.evidenceRefs),
    ...report.data.checks.flatMap((check) => check.evidenceRefs),
    ...knowledgeRefs.map((reference) => reference.path),
  ])];
  return {
    outcome: "success",
    output,
    artifactRefs,
    effectReceipts: [{
      operationType: "git.push",
      effectId: `git.push:${pushReceipt.branch}:${pushReceipt.remoteHeadCommit ?? "unknown"}`,
      status: pushReceipt.status,
      branch: pushReceipt.branch,
      remoteHeadCommit: pushReceipt.remoteHeadCommit,
    }],
  };
}

function parseKnowledgeRefs(value: unknown): Array<{ path: string; commit: string }> | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return null;
  const references: Array<{ path: string; commit: string }> = [];
  for (const reference of value) {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)) return null;
    const path = Reflect.get(reference, "path");
    const commit = Reflect.get(reference, "commit");
    if (
      typeof path !== "string"
      || path.length === 0
      || path.length > 512
      || path.startsWith("/")
      || path.includes("\\")
      || path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
      || typeof commit !== "string"
      || !/^[a-f0-9]{40}$/u.test(commit)
    ) return null;
    references.push({ path, commit });
  }
  return references;
}

function parsePushReceipt(value: unknown): {
  status: "succeeded" | "failed" | "unknown";
  branch: string;
  remoteHeadCommit: string | null;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const status = Reflect.get(value, "status");
  const branch = Reflect.get(value, "branch");
  const remoteHeadCommit = Reflect.get(value, "remoteHeadCommit");
  if (
    !["succeeded", "failed", "unknown"].includes(String(status))
    || typeof branch !== "string"
    || branch.length === 0
    || !(remoteHeadCommit === null || (
      typeof remoteHeadCommit === "string" && /^[a-f0-9]{40}$/u.test(remoteHeadCommit)
    ))
  ) return null;
  return {
    status: status as "succeeded" | "failed" | "unknown",
    branch,
    remoteHeadCommit: remoteHeadCommit as string | null,
  };
}


async function sendOutboxRecord(
  api: LoopAssignmentApi,
  record: LoopOutboxRecord,
): Promise<boolean> {
  if (record.kind === "event") {
    const event = record.payload as LoopAgentEvent;
    await api.events({
      agentRunId: record.assignmentId,
      leaseGeneration: record.leaseGeneration,
      commandId: `events:${event.loopNodeAttemptId}:${event.sequence}`,
      loopNodeAttemptId: event.loopNodeAttemptId,
      events: [event],
    });
    return true;
  }
  if (record.kind === "checkpoint") {
    const payload = record.payload as Parameters<LoopAssignmentApi["checkpoint"]>[0];
    await api.checkpoint(payload);
    return true;
  }
  if (record.kind === "terminal_result") {
    const payload = record.payload as Omit<Parameters<LoopAssignmentApi["complete"]>[0], "commandId">;
    await api.complete({ ...payload, commandId: record.id });
    return true;
  }
  if (record.kind === "route_decision") {
    if (!api.routeDecision) throw Object.assign(new Error("Assignment API does not support route decisions"), { code: "route_unavailable" });
    await api.routeDecision({ ...record.payload as Parameters<NonNullable<LoopAssignmentApi["routeDecision"]>>[0], commandId: record.id });
    return true;
  }
  if (record.kind === "offline_stage_result") {
    if (!api.offlineStageResult) throw Object.assign(new Error("Assignment API does not support offline continuation replay"), { code: "offline_replay_unavailable" });
    await api.offlineStageResult({ ...record.payload as Parameters<NonNullable<LoopAssignmentApi["offlineStageResult"]>>[0], commandId: record.id });
    return true;
  }
  return false;
}

export async function flushAssignmentOutbox(
  outbox: LoopOutbox,
  api: LoopAssignmentApi,
  options: {
    onRetryableFailure?(input: { record: LoopOutboxRecord; error: unknown }): void;
  } = {},
): Promise<{ staleAssignmentIds: string[]; online: boolean }> {
  const records = await outbox.list(100);
  const acknowledgedIds: string[] = [];
  const staleAssignmentIds = new Set<string>();
  const retryBlockedAssignmentIds = new Set<string>();
  let online = true;
  for (const record of records) {
    if (retryBlockedAssignmentIds.has(record.assignmentId)) continue;
    try {
      if (await sendOutboxRecord(api, record)) acknowledgedIds.push(record.id);
    } catch (error) {
      if (isStopError(error)) {
        acknowledgedIds.push(record.id);
        staleAssignmentIds.add(record.assignmentId);
        continue;
      }
      try {
        options.onRetryableFailure?.({ record, error });
      } catch {
        // Observability must not interrupt durable replay.
      }
      online = false;
      retryBlockedAssignmentIds.add(record.assignmentId);
    }
  }
  if (acknowledgedIds.length > 0) await outbox.acknowledge(acknowledgedIds);
  return { staleAssignmentIds: [...staleAssignmentIds], online };
}

export async function runLoopAssignment(
  assignment: RunnerAssignment,
  dependencies: LoopRunnerDependencies,
): Promise<void> {
  const now = dependencies.now ?? (() => new Date());
  const controller = new AbortController();
  let provider = dependencies.provider;
  let localModelOptions: LocalModelExecutionOptions | undefined;
  let providerSessionId: string | undefined;
  let providerBindingFingerprint: string | undefined;
  let providerTransport: "codex_app_server" | "codex_cli" | undefined;
  let providerGeneration: number | undefined;
  let providerTurnId: string | undefined;
  let leaseLost = false;
  let heartbeatCount = 0;
  let currentLeaseDurationMs = resolveLeaseDurationMs(dependencies.initialLeaseDurationMs);
  let leaseExpiryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  const cancelProvider = async () => {
    if (leaseLost) return;
    leaseLost = true;
    controller.abort();
    await provider.cancel({
      ...(providerSessionId ? { providerSessionId } : {}),
    });
  };
  const abortFromHost = () => { void cancelProvider(); };
  dependencies.signal?.addEventListener("abort", abortFromHost, { once: true });
  if (dependencies.signal?.aborted) await cancelProvider();
  if (leaseLost) return;
  const scheduleLeaseExpiry = (leaseDurationMs: number) => {
    if (leaseExpiryTimer) globalThis.clearTimeout(leaseExpiryTimer);
    leaseExpiryTimer = globalThis.setTimeout(() => { void cancelProvider(); }, leaseDurationMs);
  };
  const reportHeartbeatStatus = (status: Parameters<NonNullable<LoopRunnerDependencies["onHeartbeatStatus"]>>[0]) => {
    try { dependencies.onHeartbeatStatus?.(status); } catch { /* diagnostics cannot interrupt lease handling */ }
  };
  const heartbeatTimeoutMs = () => Math.max(
    MIN_HEARTBEAT_TIMEOUT_MS,
    Math.floor(currentLeaseDurationMs / 4),
  );
  const heartbeat = async () => {
    let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;
    const requestController = new AbortController();
    try {
      const request = dependencies.api.heartbeat({
        agentRunId: assignment.agentRunId,
        leaseGeneration: assignment.leaseGeneration,
        commandId: `heartbeat:${assignment.loopNodeAttemptId}:${++heartbeatCount}`,
        capabilitySnapshot: dependencies.capabilitySnapshot,
        signal: requestController.signal,
      });
      const result = await Promise.race([
        request,
        new Promise<never>((_, reject) => {
        timeout = globalThis.setTimeout(() => reject(Object.assign(new Error("Lease heartbeat timed out"), { code: "lease_heartbeat_failed" })), heartbeatTimeoutMs());
        }),
      ]);
      currentLeaseDurationMs = resolveLeaseDurationMs(result.leaseDurationMs);
      scheduleLeaseExpiry(currentLeaseDurationMs);
      reportHeartbeatStatus({
        state: "healthy",
        lastSuccessAt: now().getTime(),
        ...(Number.isFinite(Date.parse(result.leaseExpiresAt)) ? { leaseExpiresAt: Date.parse(result.leaseExpiresAt) } : {}),
      });
    } catch (error) {
      const errorCode = error && typeof error === "object" && typeof Reflect.get(error, "code") === "string"
        ? String(Reflect.get(error, "code"))
        : "lease_heartbeat_failed";
      reportHeartbeatStatus({ state: "failed", errorCode });
      if (isStopError(error) || errorCode === "lease_heartbeat_failed") await cancelProvider();
    } finally {
      if (timeout) globalThis.clearTimeout(timeout);
      requestController.abort();
    }
  };
  const flush = async () => {
    const result = await flushAssignmentOutbox(dependencies.outbox, dependencies.api);
    if (result.staleAssignmentIds.includes(assignment.agentRunId)) {
      await cancelProvider();
    }
    return result.online;
  };
  const leaseDurationMs = currentLeaseDurationMs;
  let stopHeartbeat: (() => void) | null = null;
  let initializationComplete = false;
  let terminalResultEnqueued = false;
  let localStageIdentity = assignment.node.nodeId ?? assignment.node.key;
  let sequence = assignment.acceptedThroughSequence + 1;
  const reconcileSequence = async () => {
    if (!dependencies.readCurrentSequence) return;
    const acceptedThroughSequence = await dependencies.readCurrentSequence(assignment);
    if (!Number.isSafeInteger(acceptedThroughSequence) || acceptedThroughSequence < 0) {
      throw Object.assign(new Error("Loop assignment sequence response is invalid"), { code: "provider_protocol_error" });
    }
    sequence = Math.max(sequence, acceptedThroughSequence + 1);
  };
  scheduleLeaseExpiry(leaseDurationMs);
  stopHeartbeat = (dependencies.startHeartbeat ?? defaultStartHeartbeat)(
    heartbeat,
    Math.max(1_000, Math.floor(leaseDurationMs / 3)),
  );
  void heartbeat();
  try {
    let workspaceRealpath: string;
    let workspaceExecutionEvidence: WorkspaceExecutionEvidence;
    let localStageContract: LocalStageContract | null = null;
    try {
      workspaceExecutionEvidence = workspaceEvidence(await dependencies.resolveWorkspace(assignment));
      workspaceRealpath = workspaceExecutionEvidence.workspaceRealpath;
      if (leaseLost) return;
      if (dependencies.loadLocalStageContract) {
        localStageContract = await dependencies.loadLocalStageContract({
          workspaceRoot: workspaceRealpath,
          nodeId: assignment.node.nodeId ?? assignment.node.key,
          assignment,
        });
        localStageIdentity = `${localStageContract.stage.loopId}/${localStageContract.stage.subloopId}`;
      } else if (isV2Assignment(assignment)) {
        throw Object.assign(new Error("Local Stage Package loader is unavailable"), { code: "local_structure_invalid" });
      }
      if (leaseLost) return;
      localModelOptions = await dependencies.resolveLocalModel?.(assignment);
      provider = await dependencies.resolveProvider?.(assignment, localModelOptions) ?? provider;
      if (dependencies.resolveChecklistMcp && assignment.runtime.provider === "codex") {
        localModelOptions = {
          ...(localModelOptions ?? {}),
          checklistMcp: await dependencies.resolveChecklistMcp(assignment),
        };
      }
    } catch (error) {
      const rejectionCode = configurationRejectionCode(error);
      if (!rejectionCode) throw error;
      const rejectionSequence = sequence++;
      const occurredAt = now().toISOString();
      const event = {
        eventId: `event:${assignment.loopNodeAttemptId}:${rejectionSequence}`,
        loopRunId: assignment.loopRunId,
        loopNodeRunId: assignment.loopNodeRunId,
        loopNodeAttemptId: assignment.loopNodeAttemptId,
        attemptNo: assignment.attemptNo,
        leaseGeneration: assignment.leaseGeneration,
        sequence: rejectionSequence,
        eventType: "loop.assignment.configuration_rejected",
        occurredAt,
        payloadSummary: { code: rejectionCode },
        artifactRefs: [],
      } satisfies LoopAgentEvent;
      await dependencies.outbox.enqueue(makeOutboxRecord({
        id: event.eventId,
        assignmentId: assignment.agentRunId,
        leaseGeneration: assignment.leaseGeneration,
        sequence: rejectionSequence * 3,
        priority: "critical",
        kind: "event",
        payload: event,
        createdAt: occurredAt,
      }));
      await flush();
      throw error;
    }
    if (leaseLost) return;
    const uploadedReviewArtifactRefs = new Map<string, string>();
    let artifactUploadSequence = 0;
    const uploadReviewArtifactReferences = async (paths: string[]): Promise<string[]> => {
      if (!dependencies.readStageArtifact || !dependencies.api.uploadArtifact) return [];
      for (const relativePath of [...new Set(paths)]) {
        if (!/^generated\/reviews\/.+\.html?$/iu.test(relativePath)) continue;
        if (uploadedReviewArtifactRefs.has(relativePath)) continue;
        const content = await dependencies.readStageArtifact({ workspaceRealpath, relativePath });
        if (content === null) {
          throw Object.assign(new Error("Generated review HTML could not be read from the Workspace"), {
            code: "review_artifact_read_failed",
          });
        }
        let uploaded: Awaited<ReturnType<NonNullable<LoopAssignmentApi["uploadArtifact"]>>> | null = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            uploaded = await dependencies.api.uploadArtifact({
              agentRunId: assignment.agentRunId,
              leaseGeneration: assignment.leaseGeneration,
              commandId: `artifact:${assignment.loopNodeAttemptId}:${++artifactUploadSequence}`,
              loopRunId: assignment.loopRunId,
              loopNodeRunId: assignment.loopNodeRunId,
              loopNodeAttemptId: assignment.loopNodeAttemptId,
              attemptNo: assignment.attemptNo,
              relativePath,
              content,
            });
            break;
          } catch (error) {
            if (attempt === 3) {
              throw Object.assign(new Error("Generated review HTML upload failed"), {
                code: "review_artifact_upload_failed",
                cause: error,
              });
            }
          }
        }
        if (!uploaded?.storageKey) {
          throw Object.assign(new Error("Review Artifact upload returned no storage key"), {
            code: "review_artifact_upload_failed",
          });
        }
        uploadedReviewArtifactRefs.set(relativePath, uploaded.storageKey);
      }
      return [...uploadedReviewArtifactRefs.values()];
    };
    const uploadProviderReviewArtifacts = (payload: unknown) => (
      uploadReviewArtifactReferences(reviewArtifactPaths(payload, workspaceRealpath))
    );
    const withUploadedReviewArtifacts = (references: string[]): string[] => [
      ...new Set([...references, ...uploadedReviewArtifactRefs.values()]),
    ];
    const constraintBundle = dependencies.loadProjectConstraints
      ? await dependencies.loadProjectConstraints({
          workspaceRoot: workspaceRealpath,
          targetPaths: assignmentTargetPaths(assignment.inputSnapshot),
        })
      : null;
    if (leaseLost) return;
    const localStageExecution = !isV2Assignment(assignment) && localStageContract
      ? await buildStageExecution({
          stage: localStageContract.stage,
          resources: localStageContract.resourcesByExecId[localStageContract.stage.agents.execRuns[0]!.execId]!,
          assignment,
          provider: assignment.runtime.provider,
          constraints: constraintBundle,
        })
      : null;
    const localOutputSchema = localStageExecution?.outputSchema
      ?? localStageContract?.stage.outputSchema
      ?? assignment.node.outputSchema
      ?? {};
    const resultSchemaPath = await dependencies.writeResultSchema({
      workspaceRealpath,
      relativePath: assignment.resultSchemaPath,
      schema: projectProviderSchema(provider, localOutputSchema),
    });
    if (leaseLost) return;
    const grant = parseGrantSnapshot();
    const executionPolicy = buildCodexExecutionPolicy({
      permission: grant.permission,
      workspaceRealpath,
      networkTargets: grant.networkTargets,
    });
    if (constraintBundle) {
      const occurredAt = now().toISOString();
      const constraintSequence = sequence++;
      const event = {
        eventId: `event:${assignment.loopNodeAttemptId}:${constraintSequence}`,
        loopRunId: assignment.loopRunId,
        loopNodeRunId: assignment.loopNodeRunId,
        loopNodeAttemptId: assignment.loopNodeAttemptId,
        attemptNo: assignment.attemptNo,
        leaseGeneration: assignment.leaseGeneration,
        sequence: constraintSequence,
        eventType: "loop.assignment.constraints_loaded",
        occurredAt,
        payloadSummary: { constraintFingerprint: constraintBundle.fingerprint },
        artifactRefs: [],
      } satisfies LoopAgentEvent;
      await dependencies.outbox.enqueue(makeOutboxRecord({
        id: event.eventId,
        assignmentId: assignment.agentRunId,
        leaseGeneration: assignment.leaseGeneration,
        sequence: event.sequence * 3,
        priority: "activity",
        kind: "event",
        payload: event,
        createdAt: occurredAt,
      }));
      await flush();
      if (leaseLost) return;
    }
    initializationComplete = true;
    if (isV2Assignment(assignment) && localStageContract) {
      const checkpoint = parseCheckpoint(assignment.checkpointSnapshot);
      const executions: Array<{ execId: string; result: unknown; gate: StageGateResult; contextFingerprint: `sha256:${string}` }> = [];
      const artifactRefs = new Set<string>();
      const stageIdentity = `${localStageContract.stage.loopId}/${localStageContract.stage.subloopId}`;
      const completeStage = async (result: LoopNodeResult, occurredAt: string, terminalSequence: number, flushResult = true, routeDecision?: LocalRouteDecision) => {
        const normalizedResult = await normalizeLoopFailure(result, occurredAt);
        const commandId = `result:${assignment.loopNodeAttemptId}`;
        await dependencies.outbox.enqueue(makeOutboxRecord({
          id: commandId,
          assignmentId: assignment.agentRunId,
          leaseGeneration: assignment.leaseGeneration,
          sequence: terminalSequence * 3 + 2,
          priority: "critical",
          kind: "terminal_result",
          payload: {
            agentRunId: assignment.agentRunId,
            leaseGeneration: assignment.leaseGeneration,
            loopRunId: assignment.loopRunId,
            loopNodeRunId: assignment.loopNodeRunId,
            loopNodeAttemptId: assignment.loopNodeAttemptId,
            attemptNo: assignment.attemptNo,
            result: normalizedResult,
            ...(routeDecision === undefined ? {} : { routeDecision }),
          },
          createdAt: occurredAt,
        }));
        terminalResultEnqueued = true;
        if (flushResult) await flush();
      };
      const completeStageAndRoute = async (input: {
        result: LoopNodeResult;
        gate: StageGateResult;
        occurredAt: string;
        terminalSequence: number;
      }) => {
        try {
          const routerSchemaPath = await dependencies.writeResultSchema({
            workspaceRealpath,
            relativePath: `${assignment.resultSchemaPath}.router.json`,
            schema: projectProviderSchema(provider, DECISION_ROUTER_OUTPUT_SCHEMA),
          });
          const decision = await decideNextStage({
            assignment,
            provider,
            stageResult: input.result.output,
            gateResult: input.gate,
            workspaceRealpath,
            resultSchemaPath: routerSchemaPath,
            executionPolicy,
            providerModelOptions: (() => {
              const { checklistMcp: _checklistMcp, ...routerModelOptions } = localModelOptions ?? {};
              return routerModelOptions;
            })(),
            routeHistory: routeHistory(assignment.inputSnapshot),
            signal: controller.signal,
          });
          await completeStage(input.result, input.occurredAt, input.terminalSequence, false, decision);
          const routeId = await routeRecordId(assignment, decision.decisionId);
          await dependencies.outbox.enqueue(makeOutboxRecord({
            id: routeId,
            assignmentId: assignment.agentRunId,
            leaseGeneration: assignment.leaseGeneration,
            sequence: input.terminalSequence * 3 + 3,
            priority: "critical",
            kind: "route_decision",
            payload: {
              agentRunId: assignment.agentRunId,
              leaseGeneration: assignment.leaseGeneration,
              commandId: routeId,
              loopRunId: assignment.loopRunId,
              loopNodeRunId: assignment.loopNodeRunId,
              loopNodeAttemptId: assignment.loopNodeAttemptId,
              attemptNo: assignment.attemptNo,
              result: input.result,
              routeDecision: decision,
            },
            createdAt: input.occurredAt,
          }));
          const online = await flush();
          if (!online && dependencies.workerId && assignment.offlineContinuation) {
            const lastExecution = executions.at(-1)?.result;
            const lastCheckpoint = lastExecution && typeof lastExecution === "object" && !Array.isArray(lastExecution)
              ? checkpointIdentity(Reflect.get(lastExecution, "checkpoint"))
              : null;
            const continuation = await createOfflineContinuation({
              assignment,
              decision,
              current: {
                workerId: dependencies.workerId,
                agentProfileId: assignment.runtime.agentProfileId,
                workspaceBindingId: assignment.workspace.bindingId,
              },
              checkpoint: lastCheckpoint?.branch && lastCheckpoint.commit
                ? { branch: lastCheckpoint.branch, commit: lastCheckpoint.commit, artifacts: [...artifactRefs], checklist: localStageContract.stage.checklist }
                : null,
              now: now(),
            });
            if (continuation.status === "continue") {
              const offlineId = continuation.record.provisionalStepId;
              await dependencies.outbox.enqueue(makeOutboxRecord({
                id: offlineId,
                assignmentId: assignment.agentRunId,
                leaseGeneration: assignment.leaseGeneration,
                sequence: input.terminalSequence * 3 + 4,
                priority: "critical",
                kind: "offline_stage_result",
                payload: {
                  agentRunId: assignment.agentRunId,
                  leaseGeneration: assignment.leaseGeneration,
                  commandId: offlineId,
                  loopRunId: assignment.loopRunId,
                  loopNodeRunId: assignment.loopNodeRunId,
                  loopNodeAttemptId: assignment.loopNodeAttemptId,
                  attemptNo: assignment.attemptNo,
                  offlineStageResult: {
                    ...((serializeOfflineContinuation(continuation) as Record<string, unknown>)),
                    stageResult: input.result,
                  },
                },
                createdAt: input.occurredAt,
              }));
            }
          }
        } catch (error) {
          if (input.result.outcome === "failure") {
            await completeStage(input.result, input.occurredAt, input.terminalSequence);
            return;
          }
          await completeStage({
            outcome: "failure",
            output: {
              errorCode: error && typeof error === "object" ? String(Reflect.get(error, "code") ?? "route_unavailable") : "route_unavailable",
              message: error instanceof Error ? error.message.slice(0, 512) : "Router could not select a next node",
              stage: stageIdentity,
            },
            artifactRefs: [...artifactRefs],
            effectReceipts: [],
          }, input.occurredAt, input.terminalSequence);
        }
      };

      for (const [execIndex, exec] of localStageContract.stage.agents.execRuns.entries()) {
        const resources = localStageContract.resourcesByExecId[exec.execId];
        if (!resources) throw Object.assign(new Error(`Stage resources are missing for ${exec.execId}`), { code: "stage_resource_missing" });
        const execution = await buildStageExecution({
          stage: localStageContract.stage,
          resources,
          assignment,
          provider: assignment.runtime.provider,
          constraints: constraintBundle,
          execId: exec.execId,
        });
        const contextOccurredAt = now().toISOString();
        const contextSequence = sequence++;
        const contextEvent = {
          eventId: `event:${assignment.loopNodeAttemptId}:${contextSequence}`,
          loopRunId: assignment.loopRunId,
          loopNodeRunId: assignment.loopNodeRunId,
          loopNodeAttemptId: assignment.loopNodeAttemptId,
          attemptNo: assignment.attemptNo,
          leaseGeneration: assignment.leaseGeneration,
          sequence: contextSequence,
          eventType: "loop.assignment.stage_context_loaded",
          occurredAt: contextOccurredAt,
          payloadSummary: {
            stage: stageIdentity,
            execId: exec.execId,
            contextFingerprint: execution.contextFingerprint,
            globalConstraintFingerprint: execution.globalConstraintFingerprint,
            workspace: workspaceExecutionEvidence,
          },
          artifactRefs: [],
        } satisfies LoopAgentEvent;
        await dependencies.outbox.enqueue(makeOutboxRecord({
          id: contextEvent.eventId,
          assignmentId: assignment.agentRunId,
          leaseGeneration: assignment.leaseGeneration,
          sequence: contextSequence * 3,
          priority: "activity",
          kind: "event",
          payload: contextEvent,
          createdAt: contextOccurredAt,
        }));
        const contextCheckpointId = `checkpoint:${assignment.loopNodeAttemptId}:stage:${exec.execId}`;
        await dependencies.outbox.enqueue(makeOutboxRecord({
          id: contextCheckpointId,
          assignmentId: assignment.agentRunId,
          leaseGeneration: assignment.leaseGeneration,
          sequence: contextSequence * 3 + 1,
          priority: "activity",
          kind: "checkpoint",
          payload: {
            agentRunId: assignment.agentRunId,
            leaseGeneration: assignment.leaseGeneration,
            commandId: contextCheckpointId,
            loopRunId: assignment.loopRunId,
            loopNodeRunId: assignment.loopNodeRunId,
            loopNodeAttemptId: assignment.loopNodeAttemptId,
            attemptNo: assignment.attemptNo,
            checkpoint: {
              value: {
                stage: stageIdentity,
                execId: exec.execId,
                contextFingerprint: execution.contextFingerprint,
                globalConstraintFingerprint: execution.globalConstraintFingerprint,
                workspace: workspaceExecutionEvidence,
              },
            },
          },
          createdAt: contextOccurredAt,
        }));
        await flush();
        if (leaseLost) return;

        const resumeFromCheckpoint = execIndex === 0
          && exec.resumePolicy === "CHECKPOINT"
          && checkpointProviderSessionId(checkpoint)
          && provider.capabilities().sessionResume;
        let recoveryAttemptsUsed = 0;
        let executionPrompt = execution.prompt;
        let executionProviderSessionId = resumeFromCheckpoint ? checkpointProviderSessionId(checkpoint) : undefined;
        let execCompleted = false;
        while (!execCompleted) {
          const providerEvents = provider.executeStructured({
            runId: assignment.agentRunId,
            cwd: workspaceRealpath,
            prompt: executionPrompt,
            resultSchemaPath,
            executionPolicy,
            ...(localModelOptions ?? {}),
            mode: "stage",
            ...(executionProviderSessionId && provider.capabilities().sessionResume
              ? {
                providerSessionId: executionProviderSessionId,
                ...(() => {
                  const bindingFingerprint = checkpointProviderBindingFingerprint(checkpoint);
                  return bindingFingerprint ? { providerBindingFingerprint: bindingFingerprint } : {};
                })(),
              }
              : {}),
            signal: controller.signal,
          });
          let reachedTerminal = false;
          let retryAfterRecovery = false;
          for await (const providerEvent of providerEvents) {
          if (leaseLost) return;
          if (isDurableLoopAgentEventType(providerEvent.type)) await reconcileSequence();
          if (providerEvent.type === "run.started") {
            providerSessionId = providerEvent.providerSessionId;
            providerBindingFingerprint = providerEvent.providerBindingFingerprint;
            providerTransport = providerEvent.providerTransport;
            providerGeneration = providerEvent.providerGeneration;
            providerTurnId = providerEvent.providerTurnId;
            executionProviderSessionId = providerEvent.providerSessionId;
          }
          const occurredAt = now().toISOString();
          const sanitizedProviderEvent = providerEvent.type === "checkpoint.created"
            ? { ...providerEvent, payload: checkpointIdentity(providerEvent.payload) }
            : providerEvent;
          const loopEvent = toLoopEvent(assignment, sequence++, sanitizedProviderEvent, occurredAt, workspaceRealpath);
          if (providerEvent.type === "artifact.produced") {
            const uploadedRefs = await uploadProviderReviewArtifacts(providerEvent.payload);
            uploadedRefs.forEach((reference) => artifactRefs.add(reference));
          }
          if (providerEvent.type === "run.failed" || providerEvent.type === "run.cancelled") {
            reachedTerminal = true;
            await completeStage({
              outcome: "failure",
              output: {
                errorCode: providerEvent.type === "run.failed" ? providerEvent.errorCode : "cancelled",
                message: providerEvent.type === "run.failed" ? providerEvent.message : "Provider execution was cancelled",
              },
              artifactRefs: [...artifactRefs],
              effectReceipts: [],
            }, occurredAt, loopEvent.sequence);
            return;
          }
          if (!isDurableLoopAgentEventType(loopEvent.eventType)) continue;
          if (providerEvent.type === "checkpoint.created") {
            const checkpointCommandId = `checkpoint:${assignment.loopNodeAttemptId}:${loopEvent.sequence}`;
            await dependencies.outbox.enqueue(makeOutboxRecord({
              id: loopEvent.eventId,
              assignmentId: assignment.agentRunId,
              leaseGeneration: assignment.leaseGeneration,
              sequence: loopEvent.sequence * 3,
              priority: "activity",
              kind: "event",
              payload: loopEvent,
              createdAt: occurredAt,
            }));
            await dependencies.outbox.enqueue(makeOutboxRecord({
              id: checkpointCommandId,
              assignmentId: assignment.agentRunId,
              leaseGeneration: assignment.leaseGeneration,
              sequence: loopEvent.sequence * 3 + 1,
              priority: "activity",
              kind: "checkpoint",
              payload: {
                agentRunId: assignment.agentRunId,
                leaseGeneration: assignment.leaseGeneration,
                commandId: checkpointCommandId,
                loopRunId: assignment.loopRunId,
                loopNodeRunId: assignment.loopNodeRunId,
                loopNodeAttemptId: assignment.loopNodeAttemptId,
                attemptNo: assignment.attemptNo,
                checkpoint: {
                  ...(providerSessionId ? { providerSessionId } : {}),
                  ...(providerBindingFingerprint ? { providerBindingFingerprint } : {}),
                  ...(providerCheckpointMetadata({
                    transport: providerTransport,
                    threadId: providerSessionId,
                    generation: providerGeneration,
                    turnId: providerTurnId,
                    eventSequence: loopEvent.sequence,
                    bindingFingerprint: providerBindingFingerprint,
                  }) ? {
                    provider: providerCheckpointMetadata({
                      transport: providerTransport,
                      threadId: providerSessionId,
                      generation: providerGeneration,
                      turnId: providerTurnId,
                      eventSequence: loopEvent.sequence,
                      bindingFingerprint: providerBindingFingerprint,
                    }),
                  } : {}),
                  value: {
                    stage: stageIdentity,
                    execId: exec.execId,
                    contextFingerprint: execution.contextFingerprint,
                    globalConstraintFingerprint: execution.globalConstraintFingerprint,
                    workspace: workspaceExecutionEvidence,
                    checkpoint: checkpointIdentity(providerEvent.payload),
                  },
                },
              },
              createdAt: occurredAt,
            }));
            await flush();
            continue;
          }
          if (providerEvent.type === "run.completed") {
            reachedTerminal = true;
            const resultReviewRefs = await uploadReviewArtifactReferences(providerResultArtifactRefs(providerEvent.result));
            resultReviewRefs.forEach((reference) => artifactRefs.add(reference));
            const recoveryPolicy = localStageContract.stage.autoRecovery;
            if (recoveryPolicy) {
              const recovery = await attemptStageAutoRecovery({
                result: providerEvent.result,
                policy: recoveryPolicy,
                attemptsUsed: recoveryAttemptsUsed,
                workspaceWritable: executionPolicy.mode === "workspace_full",
                runCommand: (command) => dependencies.runStageCheck?.({ workspaceRealpath, command })
                  ?? Promise.resolve({ passed: false, summary: "Stage recovery runner is unavailable" }),
              });
              recoveryAttemptsUsed = recovery.attemptsUsed;
              if (recovery.recovered || recovery.reason === "command_failed") {
                const recoverySequence = sequence++;
                const recoveryEvent = {
                  eventId: `event:${assignment.loopNodeAttemptId}:${recoverySequence}`,
                  loopRunId: assignment.loopRunId,
                  loopNodeRunId: assignment.loopNodeRunId,
                  loopNodeAttemptId: assignment.loopNodeAttemptId,
                  attemptNo: assignment.attemptNo,
                  leaseGeneration: assignment.leaseGeneration,
                  sequence: recoverySequence,
                  eventType: recovery.recovered
                    ? "loop.assignment.stage_auto_recovery_completed"
                    : "loop.assignment.stage_auto_recovery_failed",
                  occurredAt,
                  payloadSummary: {
                    stage: stageIdentity,
                    execId: exec.execId,
                    attempt: recoveryAttemptsUsed,
                    commands: recovery.commandResults.map(({ summary }, index) => ({ step: index + 1, summary })),
                    ...(recovery.recovered ? {} : { failedStep: recovery.commandResults.length }),
                  },
                  artifactRefs: [],
                } satisfies LoopAgentEvent;
                await dependencies.outbox.enqueue(makeOutboxRecord({
                  id: recoveryEvent.eventId,
                  assignmentId: assignment.agentRunId,
                  leaseGeneration: assignment.leaseGeneration,
                  sequence: recoverySequence * 3,
                  priority: recovery.recovered ? "activity" : "critical",
                  kind: "event",
                  payload: recoveryEvent,
                  createdAt: occurredAt,
                }));
                await flush();
              }
              if (recovery.recovered) {
                const issueType = providerEvent.result && typeof providerEvent.result === "object"
                  ? String(Reflect.get(providerEvent.result, "issueType") ?? "RECOVERED_ENVIRONMENT")
                  : "RECOVERED_ENVIRONMENT";
                executionPrompt = [
                  `Environment recovery completed for ${issueType}.`,
                  "Resume from the failed validation only.",
                  "Reuse existing artifacts and checklist evidence. Do not repeat completed implementation steps.",
                  "Run the previously blocked check again, update the checkpoint artifacts, and return the full Stage result.",
                ].join("\n");
                retryAfterRecovery = true;
                break;
              }
            }
            const gate = await evaluateStageQualityGate({
              result: providerEvent.result,
              qualityGate: {
                ...localStageContract.stage.qualityGate,
                checks: [
                  ...localStageContract.stage.qualityGate.checks,
                ],
                commands: [
                  ...constraintBundle?.checks.map(({ command }) => command) ?? [],
                  ...localStageContract.stage.qualityGate.commands ?? [],
                ],
              },
              checklist: localStageContract.stage.checklist,
              outputSchema: localStageContract.stage.outputSchema,
              workspace: {
                readText: (relativePath) => dependencies.readStageArtifact?.({ workspaceRealpath, relativePath }) ?? Promise.resolve(null),
                runCheck: (command) => dependencies.runStageCheck?.({ workspaceRealpath, command }) ?? Promise.resolve({ passed: false, summary: "Stage check runner is unavailable" }),
              },
            });
            gate.evidence.forEach((reference) => artifactRefs.add(reference));
            executions.push({ execId: exec.execId, result: providerEvent.result, gate, contextFingerprint: execution.contextFingerprint });
            if (!gate.passed) {
              await completeStageAndRoute({
                result: {
                  outcome: "failure",
                  output: providerEvent.result,
                  artifactRefs: [...artifactRefs],
                  effectReceipts: [],
                },
                gate,
                occurredAt,
                terminalSequence: loopEvent.sequence,
              });
              return;
            }
            execCompleted = true;
            break;
          }
          await dependencies.outbox.enqueue(makeOutboxRecord({
            id: loopEvent.eventId,
            assignmentId: assignment.agentRunId,
            leaseGeneration: assignment.leaseGeneration,
            sequence: loopEvent.sequence * 3,
            priority: "activity",
            kind: "event",
            payload: loopEvent,
            createdAt: occurredAt,
          }));
          await flush();
          }
          if (retryAfterRecovery) continue;
          if (!reachedTerminal) {
            const occurredAt = now().toISOString();
            await completeStage({
              outcome: "failure",
              output: { errorCode: "provider_protocol_error", message: "Provider stream ended without a terminal result" },
              artifactRefs: [...artifactRefs],
              effectReceipts: [],
            }, occurredAt, sequence++);
            return;
          }
        }
      }
      const occurredAt = now().toISOString();
      const stageResult: LoopNodeResult = {
        outcome: "success",
        output: {
          schemaVersion: 2,
          stage: { loopId: localStageContract.stage.loopId, subloopId: localStageContract.stage.subloopId },
          executions,
        },
        artifactRefs: [...artifactRefs],
        effectReceipts: [],
      };
      await completeStageAndRoute({
        result: stageResult,
        gate: executions.at(-1)?.gate ?? { passed: true, issueType: "NONE", summary: "Stage completed", evidence: [...artifactRefs], checks: [] },
        occurredAt,
        terminalSequence: sequence++,
      });
      return;
    }
    const checkpoint = parseCheckpoint(assignment.checkpointSnapshot);
    const localConstraints = constraintBundle ? renderProjectConstraints(constraintBundle) : "";
    const localPrompt = localStageExecution?.prompt ?? assignment.prompt;
    const providerInput = {
      cwd: workspaceRealpath,
      prompt: localStageExecution ? localPrompt : localConstraints ? `${localPrompt}\n\n${localConstraints}` : localPrompt,
      resultSchemaPath,
      executionPolicy,
      ...(localModelOptions ?? {}),
      signal: controller.signal,
    };
    const checkpointSessionId = checkpointProviderSessionId(checkpoint);
    const events = checkpointSessionId && provider.capabilities().sessionResume
      ? provider.resume({
        ...providerInput,
        providerSessionId: checkpointSessionId,
        ...(() => {
          const bindingFingerprint = checkpointProviderBindingFingerprint(checkpoint);
          return bindingFingerprint ? { providerBindingFingerprint: bindingFingerprint } : {};
        })(),
        ...(checkpoint?.provider ? {
          providerTransport: checkpoint.provider.transport,
          ...(checkpoint.provider.serverGeneration === undefined ? {} : { providerGeneration: checkpoint.provider.serverGeneration }),
          ...(checkpoint.provider.lastTurnId ? { providerTurnId: checkpoint.provider.lastTurnId } : {}),
        } : {}),
      })
      : provider.start(providerInput);
    for await (const providerEvent of events) {
      if (leaseLost) break;
      if (isDurableLoopAgentEventType(providerEvent.type)) await reconcileSequence();
      if (providerEvent.type === "run.started") {
        providerSessionId = providerEvent.providerSessionId;
        providerBindingFingerprint = providerEvent.providerBindingFingerprint;
        providerTransport = providerEvent.providerTransport;
        providerGeneration = providerEvent.providerGeneration;
        providerTurnId = providerEvent.providerTurnId;
      }
      const occurredAt = now().toISOString();
      const loopEvent = toLoopEvent(assignment, sequence++, providerEvent, occurredAt, workspaceRealpath);
      if (providerEvent.type === "artifact.produced") {
        await uploadProviderReviewArtifacts(providerEvent.payload);
      }

      if (providerEvent.type === "run.completed" || providerEvent.type === "run.failed") {
        let result: LoopNodeResult;
        if (providerEvent.type === "run.completed") {
          try {
            result = assertStructuredResult(assignment, providerEvent.result, localStageExecution?.outputSchema);
          } catch (error) {
            result = {
              outcome: "failure",
              output: {
                errorCode: error && typeof error === "object"
                  ? String(Reflect.get(error, "code") ?? "invalid_provider_result")
                  : "invalid_provider_result",
                message: error instanceof Error
                  ? error.message.slice(0, 512)
                  : "Provider result is invalid",
              },
              artifactRefs: [],
              effectReceipts: [],
            };
          }
        } else {
          result = {
              outcome: "failure" as const,
              output: {
                errorCode: providerEvent.errorCode,
                message: providerEvent.message,
              },
              artifactRefs: [],
              effectReceipts: [],
            };
        }
        result = await normalizeLoopFailure(result, occurredAt);
        await uploadReviewArtifactReferences(result.artifactRefs);
        result = { ...result, artifactRefs: withUploadedReviewArtifacts(result.artifactRefs) };
        const commandId = `result:${assignment.loopNodeAttemptId}`;
        await dependencies.outbox.enqueue(makeOutboxRecord({
          id: commandId,
          assignmentId: assignment.agentRunId,
          leaseGeneration: assignment.leaseGeneration,
          sequence: loopEvent.sequence * 3 + 2,
          priority: "critical",
          kind: "terminal_result",
          payload: {
            agentRunId: assignment.agentRunId,
            leaseGeneration: assignment.leaseGeneration,
            loopRunId: assignment.loopRunId,
            loopNodeRunId: assignment.loopNodeRunId,
            loopNodeAttemptId: assignment.loopNodeAttemptId,
            attemptNo: assignment.attemptNo,
            result,
          },
          createdAt: occurredAt,
        }));
        terminalResultEnqueued = true;
        await flush();
        return;
      }

      if (!isDurableLoopAgentEventType(loopEvent.eventType)) continue;

      const eventRecord = makeOutboxRecord({
        id: loopEvent.eventId,
        assignmentId: assignment.agentRunId,
        leaseGeneration: assignment.leaseGeneration,
        sequence: loopEvent.sequence * 3,
        priority: "activity",
        kind: "event",
        payload: loopEvent,
        createdAt: occurredAt,
      });
      await dependencies.outbox.enqueue(eventRecord);

      if (providerEvent.type === "checkpoint.created") {
        const checkpointPayload = {
          ...(providerSessionId ? { providerSessionId } : {}),
          ...(providerBindingFingerprint ? { providerBindingFingerprint } : {}),
          ...(providerCheckpointMetadata({
            transport: providerTransport,
            threadId: providerSessionId,
            generation: providerGeneration,
            turnId: providerTurnId,
            eventSequence: loopEvent.sequence,
            bindingFingerprint: providerBindingFingerprint,
          }) ? {
            provider: providerCheckpointMetadata({
              transport: providerTransport,
              threadId: providerSessionId,
              generation: providerGeneration,
              turnId: providerTurnId,
              eventSequence: loopEvent.sequence,
              bindingFingerprint: providerBindingFingerprint,
            }),
          } : {}),
          workspace: workspaceExecutionEvidence,
          value: providerEvent.payload,
        };
        const commandId = `checkpoint:${assignment.loopNodeAttemptId}:${loopEvent.sequence}`;
        await dependencies.outbox.enqueue(makeOutboxRecord({
          id: commandId,
          assignmentId: assignment.agentRunId,
          leaseGeneration: assignment.leaseGeneration,
          sequence: loopEvent.sequence * 3 + 1,
          priority: "activity",
          kind: "checkpoint",
          payload: {
            agentRunId: assignment.agentRunId,
            leaseGeneration: assignment.leaseGeneration,
            commandId,
            loopRunId: assignment.loopRunId,
            loopNodeRunId: assignment.loopNodeRunId,
            loopNodeAttemptId: assignment.loopNodeAttemptId,
            attemptNo: assignment.attemptNo,
            checkpoint: checkpointPayload,
          },
          createdAt: occurredAt,
        }));
      }

      await flush();

      if (providerEvent.type === "run.cancelled") return;
    }
  } catch (error) {
    if (leaseLost || isStopError(error)) throw error;
    if (terminalResultEnqueued) return;
    const occurredAt = now().toISOString();
    const commandId = `result:${assignment.loopNodeAttemptId}`;
    const result: LoopNodeResult = {
      outcome: "failure",
      output: localFailureOutput(error, localStageIdentity, initializationComplete),
      artifactRefs: [],
      effectReceipts: [],
    };
    const normalizedResult = await normalizeLoopFailure(result, occurredAt);
    await dependencies.outbox.enqueue(makeOutboxRecord({
      id: commandId,
      assignmentId: assignment.agentRunId,
      leaseGeneration: assignment.leaseGeneration,
      sequence: sequence * 3 + 2,
      priority: "critical",
      kind: "terminal_result",
      payload: {
        agentRunId: assignment.agentRunId,
        leaseGeneration: assignment.leaseGeneration,
        loopRunId: assignment.loopRunId,
        loopNodeRunId: assignment.loopNodeRunId,
        loopNodeAttemptId: assignment.loopNodeAttemptId,
        attemptNo: assignment.attemptNo,
        result: normalizedResult,
      },
      createdAt: occurredAt,
    }));
    terminalResultEnqueued = true;
    await flush();
    if (configurationRejectionCode(error)) throw error;
  } finally {
    stopHeartbeat?.();
    if (leaseExpiryTimer) globalThis.clearTimeout(leaseExpiryTimer);
    dependencies.signal?.removeEventListener("abort", abortFromHost);
  }
}

export function startLoopWorker(input: {
  api: LoopAssignmentApi;
  flush(): Promise<boolean | void>;
  pendingAgentRunIds?(): Promise<string[]>;
  runAssignment(assignment: LoopAssignment, leaseDurationMs?: number): Promise<void>;
  openLiveSession?(session: NonNullable<Awaited<ReturnType<LoopAssignmentApi["claim"]>>["liveSession"]>): Promise<{ close(): Promise<void> }>;
  canClaim(): Promise<boolean>;
  capabilitySnapshot: AgentWorkerCapabilitySnapshot;
  cancelActive?(): Promise<void>;
  onActiveCountChange?(activeRunCount: number): void;
}) {
  let stopped = false;
  let activePass: Promise<void> | null = null;
  const activeAssignments = new Map<string, Promise<void>>();
  const activeLiveSessions = new Map<string, { close(): Promise<void> }>();
  let maxConcurrency = input.capabilitySnapshot.maxConcurrency;
  let syncStatus: "online" | "degraded" | "offline" = "offline";

  function currentCapabilitySnapshot(): AgentWorkerCapabilitySnapshot {
    return { ...input.capabilitySnapshot, maxConcurrency };
  }

  async function closeActiveLiveSessions(): Promise<void> {
    const sessions = [...activeLiveSessions.values()];
    activeLiveSessions.clear();
    await Promise.all(sessions.map((session) => session.close().catch(() => undefined)));
  }

  async function onlinePass(): Promise<void> {
    if (stopped) return;
    let online = false;
    try {
      online = (await input.flush()) !== false;
    } catch {
      online = false;
    }
    if (stopped) return;
    let hasOutboxCapacity = false;
    try {
      hasOutboxCapacity = await input.canClaim();
    } catch {
      hasOutboxCapacity = false;
    }
    if (stopped) return;
    let pendingAgentRunIds: string[] = [];
    try {
      pendingAgentRunIds = await input.pendingAgentRunIds?.() ?? [];
    } catch {
      hasOutboxCapacity = false;
    }
    if (stopped) return;
    let acceptAssignments = hasOutboxCapacity
      && activeAssignments.size + activeLiveSessions.size < maxConcurrency;
    while (!stopped) {
      let claimed: Awaited<ReturnType<LoopAssignmentApi["claim"]>>;
      try {
        claimed = await input.api.claim({
          capabilitySnapshot: currentCapabilitySnapshot(),
          activeAgentRunIds: [...new Set([...activeAssignments.keys(), ...pendingAgentRunIds])],
          activeLiveSessionIds: [...activeLiveSessions.keys()],
          acceptAssignments,
        });
        syncStatus = online && acceptAssignments ? "online" : "degraded";
      } catch (error) {
        syncStatus = "offline";
        throw error;
      }
      if (stopped || !acceptAssignments) break;
      if (claimed.liveSession && input.openLiveSession) {
        const sessionId = claimed.liveSession.sessionId;
        if (!activeLiveSessions.has(sessionId)) {
          const handle = await input.openLiveSession(claimed.liveSession);
          activeLiveSessions.set(sessionId, handle);
          input.onActiveCountChange?.(activeAssignments.size + activeLiveSessions.size);
        }
      }
      if (!claimed.assignment) break;
      const assignment = claimed.assignment;
      if (activeAssignments.has(assignment.agentRunId) || pendingAgentRunIds.includes(assignment.agentRunId)) break;
      const execution = (claimed.leaseDurationMs === undefined
        ? input.runAssignment(assignment)
        : input.runAssignment(assignment, claimed.leaseDurationMs))
        .finally(() => {
          activeAssignments.delete(assignment.agentRunId);
          input.onActiveCountChange?.(activeAssignments.size);
        });
      activeAssignments.set(assignment.agentRunId, execution);
      input.onActiveCountChange?.(activeAssignments.size);
      if (activeAssignments.size + activeLiveSessions.size >= maxConcurrency) break;
      acceptAssignments = true;
    }
  }

  return {
    onOnline() {
      if (activePass) return activePass;
      activePass = onlinePass().finally(() => { activePass = null; });
      return activePass;
    },
    stop() {
      stopped = true;
      return Promise.all([
        input.cancelActive?.() ?? Promise.resolve(),
        closeActiveLiveSessions(),
      ]).then(() => undefined);
    },
    updateMaxConcurrency(value: number) {
      if (!Number.isInteger(value) || value < 1 || value > 128) {
        throw new Error("Worker concurrency must be between 1 and 128");
      }
      maxConcurrency = value;
    },
    getSyncStatus() {
      return syncStatus;
    },
    async deactivate() {
      stopped = true;
      await this.stop();
      return input.api.deactivateWorker?.();
    },
  };
}
