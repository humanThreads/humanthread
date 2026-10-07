import { createHash } from "node:crypto";

export interface WaitingLoopCandidate {
  loopRunId: string;
  nodeRunId: string;
  nodeRunVersion: number;
  attemptId: string;
  attemptNo: number;
  attemptVersion: number;
  inputSnapshot: unknown;
  checkpoint: unknown;
}

interface LoopWaitDependencies {
  loadWaiting(input: { limit: number; now: Date }): Promise<WaitingLoopCandidate[]>;
  completeWaitingNode(input: {
    loopRunId: string;
    nodeRunId: string;
    nodeRunVersion: number;
    attemptId: string;
    attemptNo: number;
    attemptVersion: number;
    commandId: string;
    waitingReason: "timer";
    result: {
      outcome: "success";
      output: unknown;
      artifactRefs: [];
      effectReceipts: [];
    };
    occurredAt: Date;
    correlationId: string;
  }): Promise<void>;
}

export async function resumeDueLoopWaits(
  input: { now: Date; limit: number },
  dependencies: LoopWaitDependencies,
): Promise<{ scanned: number; due: number; resumed: number; contended: number; invalid: number }> {
  if (!Number.isFinite(input.now.getTime())) throw validationError("Loop wait scan time is invalid");
  if (!Number.isInteger(input.limit) || input.limit <= 0 || input.limit > 1_000) {
    throw validationError("Loop wait scan limit must be between 1 and 1000");
  }

  const candidates = await dependencies.loadWaiting({
    limit: Math.min(input.limit * 4, 1_000),
    now: input.now,
  });
  const due: Array<{ candidate: WaitingLoopCandidate; wakeAt: Date }> = [];
  let invalid = 0;
  for (const candidate of candidates) {
    const checkpoint = parseCheckpoint(candidate.checkpoint);
    if (checkpoint.status === "invalid") {
      invalid += 1;
      continue;
    }
    if (checkpoint.status !== "timer" || checkpoint.wakeAt > input.now) continue;
    due.push({ candidate, wakeAt: checkpoint.wakeAt });
    if (due.length === input.limit) break;
  }

  let resumed = 0;
  let contended = 0;
  for (const dueWait of due) {
    const { candidate } = dueWait;
    try {
      await dependencies.completeWaitingNode({
        loopRunId: requiredText(candidate.loopRunId, "loopRunId", 96),
        nodeRunId: requiredText(candidate.nodeRunId, "nodeRunId", 96),
        nodeRunVersion: positiveInteger(candidate.nodeRunVersion, "nodeRunVersion"),
        attemptId: requiredText(candidate.attemptId, "attemptId", 128),
        attemptNo: positiveInteger(candidate.attemptNo, "attemptNo"),
        attemptVersion: positiveInteger(candidate.attemptVersion, "attemptVersion"),
        commandId: timerCommandId(candidate.attemptId, dueWait.wakeAt),
        waitingReason: "timer",
        result: {
          outcome: "success",
          output: candidate.inputSnapshot,
          artifactRefs: [],
          effectReceipts: [],
        },
        occurredAt: input.now,
        correlationId: `loop:${candidate.loopRunId}`,
      });
      resumed += 1;
    } catch (error) {
      if (errorCode(error) !== "stale_lease") throw error;
      contended += 1;
    }
  }

  return { scanned: candidates.length, due: due.length, resumed, contended, invalid };
}

function timerCommandId(attemptId: string, wakeAt: Date): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([attemptId, wakeAt.toISOString()]))
    .digest("hex");
  return `loop_timer:${digest}`;
}

type ParsedCheckpoint =
  | { status: "timer"; wakeAt: Date }
  | { status: "callback" }
  | { status: "invalid" };

function parseCheckpoint(value: unknown): ParsedCheckpoint {
  if (!isRecord(value)) return { status: "invalid" };
  if (value.waitingReason === "callback") return { status: "callback" };
  if (value.waitingReason !== "timer" || typeof value.wakeAt !== "string") return { status: "invalid" };
  const wakeAt = new Date(value.wakeAt);
  return Number.isFinite(wakeAt.getTime()) ? { status: "timer", wakeAt } : { status: "invalid" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value !== value.trim()) {
    throw validationError(`${name} is invalid`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) throw validationError(`${name} is invalid`);
  return value as number;
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}
