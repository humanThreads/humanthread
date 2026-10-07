import { createHash } from "node:crypto";
import type {
  ActivateLoopNodeInput,
} from "@humanthread/db";
import { buildLoopNodeAttemptId } from "@humanthread/db";
import type { AutomationPolicyDecision, LoopNodeDefinition } from "@humanthread/orchestration-core";

export interface ReadyLoopNodeCandidate {
  loopRunId: string;
  projectId: string;
  nodeRunId: string;
  nodeRunVersion: number;
  nodeKey: string;
  activationNo: number;
  attemptCount: number;
  inputSnapshot: unknown;
  bindingSnapshot: unknown;
  agentProfileId?: string;
  policyDecision?: AutomationPolicyDecision;
  actionFingerprint?: string;
  humanGateRoutes?: {
    pass: string[];
    rework: string[];
    reject: string[];
  };
  localExecutionReadiness?: {
    ready: boolean;
    reason: string | null;
    configurationVersion: string;
    evidence: Record<string, unknown>;
  };
  requiredLoopContractVersion?: 2;
  workerSupportedLoopContractVersions?: readonly number[];
  configurationRecipientUserId?: string;
  node: LoopNodeDefinition;
}

interface LoopSchedulerInput {
  limit: number;
  now: Date;
  loadReady(input: { limit: number }): Promise<ReadyLoopNodeCandidate[]>;
  activate(input: ActivateLoopNodeInput): Promise<unknown>;
  dispatch?(
    candidate: ReadyLoopNodeCandidate,
    assignment: ActivateLoopNodeInput,
  ): Promise<unknown>;
}

export async function scheduleReadyLoopNodes(
  input: LoopSchedulerInput,
): Promise<{ scanned: number; activated: number; contended: number }> {
  if (!Number.isInteger(input.limit) || input.limit <= 0 || input.limit > 1_000) {
    throw validationError("Loop scheduler limit must be between 1 and 1000");
  }
  if (Number.isNaN(input.now.getTime())) throw validationError("Loop scheduler time is invalid");

  const candidates = (await input.loadReady({ limit: input.limit }))
    .filter((candidate) => candidate.requiredLoopContractVersion !== 2
      || candidate.workerSupportedLoopContractVersions?.includes(2) === true);
  let activated = 0;
  let contended = 0;
  for (const candidate of candidates) {
    const executionTarget = resolveExecutionTarget(candidate.node);
    const attemptNo = positiveInteger(candidate.attemptCount, "attemptCount", true) + 1;
    const attemptId = buildLoopNodeAttemptId(candidate.nodeRunId, attemptNo);
    const configurationBlocked = candidate.localExecutionReadiness?.ready === false;
    const agentProfileId = candidate.agentProfileId ?? singleAllowedAgentProfileId(candidate.bindingSnapshot);
    const agentRun = executionTarget === "local" && !configurationBlocked
      ? {
          id: persistenceId("agent_run", [candidate.nodeRunId, String(attemptNo)], 96),
          projectId: requiredText(candidate.projectId, "projectId", 64),
          agentProfileId: requiredText(agentProfileId, "agentProfileId", 96),
          inputSnapshot: candidate.inputSnapshot,
        }
      : undefined;

    try {
      const assignment = {
        loopRunId: requiredText(candidate.loopRunId, "loopRunId", 96),
        nodeRunId: requiredText(candidate.nodeRunId, "nodeRunId", 96),
        nodeRunVersion: positiveInteger(candidate.nodeRunVersion, "nodeRunVersion"),
        nodeKey: requiredText(candidate.nodeKey, "nodeKey", 96),
        activationNo: positiveInteger(candidate.activationNo, "activationNo"),
        inputSnapshot: candidate.inputSnapshot,
        executionTarget,
        attemptId,
        ...(agentRun === undefined ? {} : { agentRun }),
        occurredAt: input.now,
        correlationId: `loop:${candidate.loopRunId}`,
        actor: { type: "system", id: "loop-scheduler" },
      } satisfies ActivateLoopNodeInput;
      if (input.dispatch) await input.dispatch(candidate, assignment);
      else await input.activate(assignment);
      activated += 1;
    } catch (error) {
      if (errorCode(error) !== "stale_lease") throw error;
      contended += 1;
    }
  }

  return { scanned: candidates.length, activated, contended };
}

function resolveExecutionTarget(node: LoopNodeDefinition): "platform" | "local" {
  if (node.type === "agent_action") return "local";
  return "platform";
}

function persistenceId(prefix: string, parts: readonly string[], maxLength: number): string {
  const digest = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  const id = `${prefix}:${digest}`;
  if (id.length > maxLength) throw validationError(`${prefix} exceeds its persistence limit`);
  return id;
}

function positiveInteger(value: unknown, name: string, allowZero = false): number {
  if (!Number.isInteger(value) || (allowZero ? (value as number) < 0 : (value as number) <= 0)) {
    throw validationError(`${name} is invalid`);
  }
  return value as number;
}

function requiredText(value: unknown, name: string, maxLength: number): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maxLength
    || value !== value.trim()
  ) {
    throw validationError(`${name} is invalid`);
  }
  return value;
}

function singleAllowedAgentProfileId(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const allowed = (value as { allowedAgentProfileIds?: unknown }).allowedAgentProfileIds;
  if (!Array.isArray(allowed)) return undefined;
  const profiles = allowed.filter((profile): profile is string => typeof profile === "string" && profile.trim().length > 0);
  return profiles.length === 1 ? profiles[0] : undefined;
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}
