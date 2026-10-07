export const LOOP_OUTBOX_LIMITS = {
  maxRecords: 10_000,
  maxBytes: 50 * 1024 * 1024,
  criticalReserveBytes: 5 * 1024 * 1024,
} as const;

export type LoopOutboxPriority = "activity" | "critical";
export type LoopOutboxKind = "event" | "checkpoint" | "terminal_result" | "effect_receipt" | "route_decision" | "offline_stage_result";

export type LoopOutboxRecord = {
  id: string;
  assignmentId: string;
  leaseGeneration: number;
  sequence: number;
  priority: LoopOutboxPriority;
  kind: LoopOutboxKind;
  payload: unknown;
  byteSize: number;
  createdAt: string;
};

export type LoopOutboxCapacity = {
  canClaim: boolean;
  canAppendCritical: boolean;
  reason: "record_limit" | "critical_reserve" | "byte_limit" | null;
};

export interface LoopOutbox {
  enqueue(record: LoopOutboxRecord): Promise<void>;
  list(limit: number): Promise<LoopOutboxRecord[]>;
  pendingAssignmentIds?(): Promise<string[]>;
  acknowledge(ids: string[]): Promise<void>;
  capacity(incomingBytes?: number): Promise<LoopOutboxCapacity>;
}

export function calculateOutboxCapacity(input: {
  records: number;
  bytes: number;
  incomingBytes: number;
}): LoopOutboxCapacity {
  if (input.bytes + input.incomingBytes > LOOP_OUTBOX_LIMITS.maxBytes) {
    return { canClaim: false, canAppendCritical: false, reason: "byte_limit" };
  }
  if (input.records >= LOOP_OUTBOX_LIMITS.maxRecords) {
    return { canClaim: false, canAppendCritical: true, reason: "record_limit" };
  }
  if (
    input.bytes + input.incomingBytes
    > LOOP_OUTBOX_LIMITS.maxBytes - LOOP_OUTBOX_LIMITS.criticalReserveBytes
  ) {
    return { canClaim: false, canAppendCritical: true, reason: "critical_reserve" };
  }
  return { canClaim: true, canAppendCritical: true, reason: null };
}

export function calculateLoopOutboxRecordByteSize(
  record: Omit<LoopOutboxRecord, "byteSize">,
): number {
  return new TextEncoder().encode(JSON.stringify(record)).byteLength;
}

export async function flushLoopOutbox(input: {
  outbox: LoopOutbox;
  send(records: LoopOutboxRecord[]): Promise<{
    acknowledgedIds: string[];
    acceptedThroughSequence: number;
  }>;
}): Promise<void> {
  const records = await input.outbox.list(100);
  if (records.length === 0) return;
  const result = await input.send(records);
  await input.outbox.acknowledge(result.acknowledgedIds);
}
