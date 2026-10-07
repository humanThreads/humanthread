import { createHash, randomUUID } from "node:crypto";
import {
  buildEffectKey,
  type ClaimPlatformLoopAttemptInput,
  type CompleteLoopNodeInput,
  type PlatformLoopAttemptLease,
  type ReserveEffectInput,
  type ResolveEffectInput,
} from "@humanthread/db";
import type { PlatformNodeExecution } from "./platform-node-executors";

export interface PlatformExecutionMessage {
  loopRunId: string;
  projectId: string;
  nodeRunId: string;
  attemptId: string;
  attemptNo: number;
  nodeKey: string;
  correlationId: string;
}

interface PlatformExecutionDependencies {
  now(): Date;
  claimAttempt(input: ClaimPlatformLoopAttemptInput): Promise<PlatformLoopAttemptLease | null>;
  reserveEffect(input: ReserveEffectInput & { claimToken: string }): Promise<unknown>;
  resolveEffect(input: ResolveEffectInput & { claimToken: string }): Promise<void>;
  executeNode(input: {
    node: PlatformLoopAttemptLease["node"];
    input: unknown;
    projectId: string;
    actorUserId: string;
    taskId?: string | null;
    loopRunId?: string;
    nodeRunId?: string;
    attemptId?: string;
    correlationId?: string;
    effectKey?: string;
    now: Date;
  }): Promise<PlatformNodeExecution>;
  completeNode(input: CompleteLoopNodeInput): Promise<void>;
  waitNode(input: {
    loopRunId: string;
    nodeRunId: string;
    nodeRunVersion: number;
    attemptId: string;
    attemptNo: number;
    attemptVersion: number;
    claimToken: string;
    occurredAt: Date;
    correlationId: string;
  } & (
    | { waitingReason: "timer"; wakeAt: Date }
    | { waitingReason: "callback"; callbackId: string; secretHash: string }
    | { waitingReason: "child_loop"; childLoopRunId: string }
  )): Promise<void>;
}

export async function executePlatformLoopAttempt(
  message: PlatformExecutionMessage,
  dependencies: PlatformExecutionDependencies,
): Promise<{ status: "completed" | "waiting" | "already_processed" }> {
  const parsed = parseMessage(message);
  const now = dependencies.now();
  if (!Number.isFinite(now.getTime())) throw validationError("Platform execution time is invalid");
  const claim = await dependencies.claimAttempt({
    loopRunId: parsed.loopRunId,
    projectId: parsed.projectId,
    nodeRunId: parsed.nodeRunId,
    attemptId: parsed.attemptId,
    attemptNo: parsed.attemptNo,
    nodeKey: parsed.nodeKey,
    claimToken: `platform-executor:${randomUUID()}`,
    now,
    claimExpiresAt: new Date(now.getTime() + 60_000),
  });
  if (!claim) return { status: "already_processed" };
  let effect: ReturnType<typeof buildEffectIdentity> | undefined;
  try {
    // Everything after the claim must stay inside this try block. A claimed
    // attempt that is never completed leaves the node running forever, because
    // the claim expiry alone does not terminate the attempt.
    assertClaimMatchesMessage(claim, parsed);
    effect = claim.node.type === "platform_action" && claim.node.action !== "task_loop.invoke"
      ? buildEffectIdentity(claim)
      : undefined;
    if (effect) {
      await dependencies.reserveEffect({
        id: effect.id,
        loopRunId: claim.loopRunId,
        nodeRunId: claim.nodeRunId,
        attemptId: claim.attemptId,
        operationType: effect.operationType,
        requestFingerprint: effect.requestFingerprint,
        providerIdempotencyKey: effect.effectKey,
        claimToken: claim.claimToken,
        occurredAt: now,
        correlationId: parsed.correlationId,
        actor: { type: "system", id: "loop-platform-executor" },
      });
    }

    const execution = await dependencies.executeNode({
      node: claim.node,
      input: claim.inputSnapshot,
      projectId: claim.projectId,
      actorUserId: claim.actorUserId,
      ...(claim.taskId === undefined ? {} : { taskId: claim.taskId }),
      loopRunId: claim.loopRunId,
      nodeRunId: claim.nodeRunId,
      attemptId: claim.attemptId,
      correlationId: parsed.correlationId,
      ...(effect === undefined ? {} : { effectKey: effect.effectKey }),
      now,
    });
    if (execution.status === "waiting") {
      await dependencies.waitNode({
        loopRunId: claim.loopRunId,
        nodeRunId: claim.nodeRunId,
        nodeRunVersion: claim.nodeRunVersion,
        attemptId: claim.attemptId,
        attemptNo: claim.attemptNo,
        attemptVersion: claim.attemptVersion,
        claimToken: claim.claimToken,
        ...(execution.waitingReason === "timer"
          ? { waitingReason: "timer" as const, wakeAt: execution.wakeAt }
          : execution.waitingReason === "callback"
          ? {
              waitingReason: "callback" as const,
              callbackId: claim.attemptId,
              secretHash: execution.callbackSecretHash,
            }
          : { waitingReason: "child_loop" as const, childLoopRunId: execution.childLoopRunId }),
        occurredAt: now,
        correlationId: parsed.correlationId,
      });
      return { status: "waiting" };
    }

    if (effect) {
      const providerReceipt = execution.result.effectReceipts[0] ?? null;
      await dependencies.resolveEffect({
        effectKey: effect.effectKey,
        loopRunId: claim.loopRunId,
        nodeRunId: claim.nodeRunId,
        attemptId: claim.attemptId,
        status: "succeeded",
        providerReceipt,
        resultFingerprint: fingerprint(execution.result.output),
        claimToken: claim.claimToken,
        resolvedAt: now,
        correlationId: parsed.correlationId,
        actor: { type: "system", id: "loop-platform-executor" },
      });
    }

    await dependencies.completeNode({
      loopRunId: claim.loopRunId,
      nodeRunId: claim.nodeRunId,
      nodeRunVersion: claim.nodeRunVersion,
      attemptId: claim.attemptId,
      attemptNo: claim.attemptNo,
      attemptVersion: claim.attemptVersion,
      claimToken: claim.claimToken,
      result: execution.result,
      ...(execution.gateDecision === undefined ? {} : { gateDecision: execution.gateDecision }),
      occurredAt: now,
      correlationId: parsed.correlationId,
      actor: { type: "system", id: "loop-platform-executor" },
    });
    return { status: "completed" };
  } catch (error) {
    // A claimed platform attempt must always leave the running state, even
    // when reservation, execution, wait, effect resolution, or completion
    // fails. Resolve the effect first so a prepared reservation cannot be
    // replayed as if the provider call had never failed.
    if (effect) {
      await dependencies.resolveEffect({
        effectKey: effect.effectKey,
        loopRunId: claim.loopRunId,
        nodeRunId: claim.nodeRunId,
        attemptId: claim.attemptId,
        status: "failed",
        resultFingerprint: fingerprint(platformFailureResult(error, now).output),
        claimToken: claim.claimToken,
        resolvedAt: now,
        correlationId: parsed.correlationId,
        actor: { type: "system", id: "loop-platform-executor" },
      }).catch(() => undefined);
    }
    try {
      await dependencies.completeNode({
        loopRunId: claim.loopRunId,
        nodeRunId: claim.nodeRunId,
        nodeRunVersion: claim.nodeRunVersion,
        attemptId: claim.attemptId,
        attemptNo: claim.attemptNo,
        attemptVersion: claim.attemptVersion,
        claimToken: claim.claimToken,
        result: platformFailureResult(error, now),
        occurredAt: now,
        correlationId: parsed.correlationId,
        actor: { type: "system", id: "loop-platform-executor" },
      });
    } catch (cleanupError) {
      if (error instanceof Error && error.cause === undefined) error.cause = cleanupError;
    }
    throw error;
  }
}

function platformFailureResult(error: unknown, occurredAt: Date): CompleteLoopNodeInput["result"] {
  const message = error instanceof Error && error.message.trim() ? error.message.trim() : "Platform execution failed";
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && error.code.trim()
    ? error.code.trim().slice(0, 96)
    : "platform_execution_failed";
  const summary = `Platform node execution failed: ${message}`.slice(0, 4_000);
  return {
    outcome: "failure",
    output: { errorCode: code, message },
    artifactRefs: [],
    effectReceipts: [],
    failure: {
      status: "FAILED",
      code,
      summary,
      evidence: [],
      occurredAt: occurredAt.toISOString(),
    },
  };
}

function buildEffectIdentity(claim: PlatformLoopAttemptLease): {
  id: string;
  effectKey: string;
  operationType: string;
  requestFingerprint: string;
} {
  if (claim.node.type !== "platform_action") throw validationError("Platform effect requires an action node");
  const operationType = requiredText(claim.node.action, "Platform action key", 96);
  const digest = hashCanonical([
    claim.loopRunId,
    claim.nodeRunId,
    claim.attemptId,
    operationType,
  ]);
  const id = `loop_effect:${digest}`;
  return {
    id,
    effectKey: buildEffectKey({
      id,
      loopRunId: claim.loopRunId,
      nodeRunId: claim.nodeRunId,
      attemptId: claim.attemptId,
      operationType,
    }),
    operationType,
    requestFingerprint: `request:${hashCanonical({
      action: operationType,
      config: claim.node.config ?? null,
      input: claim.inputSnapshot,
    })}`,
  };
}

function parseMessage(value: PlatformExecutionMessage): PlatformExecutionMessage {
  const record = requireRecord(value, "Platform execution message is invalid");
  const allowed = new Set([
    "loopRunId",
    "projectId",
    "nodeRunId",
    "attemptId",
    "attemptNo",
    "nodeKey",
    "correlationId",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw validationError("Platform execution message contains unknown fields");
  }
  if (!Number.isInteger(record.attemptNo) || (record.attemptNo as number) <= 0) {
    throw validationError("Platform execution attemptNo is invalid");
  }
  return {
    loopRunId: requiredText(record.loopRunId, "loopRunId", 96),
    projectId: requiredText(record.projectId, "projectId", 64),
    nodeRunId: requiredText(record.nodeRunId, "nodeRunId", 96),
    attemptId: requiredText(record.attemptId, "attemptId", 128),
    attemptNo: record.attemptNo as number,
    nodeKey: requiredText(record.nodeKey, "nodeKey", 96),
    correlationId: requiredText(record.correlationId, "correlationId", 128),
  };
}

function assertClaimMatchesMessage(
  claim: PlatformLoopAttemptLease,
  message: PlatformExecutionMessage,
): void {
  if (
    claim.loopRunId !== message.loopRunId
    || claim.projectId !== message.projectId
    || claim.nodeRunId !== message.nodeRunId
    || claim.attemptId !== message.attemptId
    || claim.attemptNo !== message.attemptNo
    || claim.node.key !== message.nodeKey
  ) throw staleLeaseError();
}

function fingerprint(value: unknown): string {
  return `result:${hashCanonical(value)}`;
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isRecord(value)) throw validationError("Platform execution data must contain JSON values");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw validationError(message);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredText(value: unknown, name: string, maxLength: number): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maxLength
    || value !== value.trim()
  ) throw validationError(`${name} is invalid`);
  return value;
}

function staleLeaseError(): Error {
  return Object.assign(new Error("Platform attempt lease is stale"), { code: "stale_lease" });
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}
