import { createHash } from "node:crypto";
import { resumeLoopCallback } from "@humanthread/db";

interface LoopCallbackDependencies {
  now(): Date;
  completeWaitingNode(input: {
    loopRunId: string;
    callbackId: string;
    commandId: string;
    secretHash: string;
    result: {
      outcome: "success";
      output: unknown;
      artifactRefs: [];
      effectReceipts: [];
    };
    occurredAt: Date;
    correlationId: string;
    actor: { type: "system"; id: "loop-callback" };
  }): Promise<{ completed: boolean; duplicate: boolean }>;
}

const DEFAULTS: LoopCallbackDependencies = {
  now: () => new Date(),
  completeWaitingNode: (input) => resumeLoopCallback(input),
};

const MAX_CALLBACK_PAYLOAD_BYTES = 64 * 1_024;

export async function completeLoopCallback(
  input: {
    loopRunId: string;
    callbackId: string;
    commandId: string;
    secret: string;
    payload: unknown;
  },
  dependencies: LoopCallbackDependencies = DEFAULTS,
): Promise<{ completed: boolean; duplicate: boolean }> {
  const loopRunId = requiredText(input.loopRunId, "LoopRun id", 96);
  const callbackId = requiredText(input.callbackId, "Callback id", 128);
  const commandId = requiredText(input.commandId, "Callback command id", 128);
  if (typeof input.secret !== "string" || input.secret.length === 0 || input.secret.length > 4_096) {
    throw validationError("Callback secret is invalid");
  }
  let serializedPayload: string | undefined;
  try {
    serializedPayload = JSON.stringify(input.payload);
  } catch {
    throw validationError("Callback payload is invalid");
  }
  if (
    serializedPayload === undefined
    || new TextEncoder().encode(serializedPayload).byteLength > MAX_CALLBACK_PAYLOAD_BYTES
  ) throw validationError("Callback payload is too large");
  const occurredAt = dependencies.now();
  if (!Number.isFinite(occurredAt.getTime())) throw validationError("Callback time is invalid");
  return dependencies.completeWaitingNode({
    loopRunId,
    callbackId,
    commandId,
    secretHash: createHash("sha256").update(input.secret).digest("hex"),
    result: { outcome: "success", output: input.payload, artifactRefs: [], effectReceipts: [] },
    occurredAt,
    correlationId: `loop:${loopRunId}`,
    actor: { type: "system", id: "loop-callback" },
  });
}

function requiredText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value !== value.trim()) {
    throw validationError(`${name} is invalid`);
  }
  return value;
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}
