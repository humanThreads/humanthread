import { describe, expect, it, vi } from "vitest";
import {
  LOOP_OUTBOX_LIMITS,
  calculateOutboxCapacity,
  flushLoopOutbox,
  type LoopOutbox,
  type LoopOutboxRecord,
} from "./loop-outbox";

const record = (overrides: Partial<LoopOutboxRecord> = {}): LoopOutboxRecord => ({
  id: "event_1",
  assignmentId: "assignment_1",
  leaseGeneration: 1,
  sequence: 1,
  priority: "activity",
  kind: "event",
  payload: { type: "tool.completed" },
  byteSize: 64,
  createdAt: "2026-07-30T08:00:00.000Z",
  ...overrides,
});

describe("Loop outbox capacity", () => {
  it("stops new claims at the record limit while retaining critical append capacity", () => {
    expect(calculateOutboxCapacity({
      records: LOOP_OUTBOX_LIMITS.maxRecords,
      bytes: 40 * 1024 * 1024,
      incomingBytes: 1,
    })).toEqual({
      canClaim: false,
      canAppendCritical: true,
      reason: "record_limit",
    });
  });

  it("reserves the final five MiB for terminal results and effect receipts", () => {
    expect(calculateOutboxCapacity({
      records: 100,
      bytes: LOOP_OUTBOX_LIMITS.maxBytes - LOOP_OUTBOX_LIMITS.criticalReserveBytes,
      incomingBytes: 1,
    })).toEqual({
      canClaim: false,
      canAppendCritical: true,
      reason: "critical_reserve",
    });
  });

  it("rejects every append once the total byte limit would be exceeded", () => {
    expect(calculateOutboxCapacity({
      records: 100,
      bytes: LOOP_OUTBOX_LIMITS.maxBytes,
      incomingBytes: 1,
    })).toEqual({
      canClaim: false,
      canAppendCritical: false,
      reason: "byte_limit",
    });
  });
});

describe("flushLoopOutbox", () => {
  it("removes only records explicitly acknowledged by the platform", async () => {
    const records = [record(), record({ id: "event_2", sequence: 2 })];
    const acknowledge = vi.fn().mockResolvedValue(undefined);
    const outbox: LoopOutbox = {
      enqueue: vi.fn(),
      list: vi.fn().mockResolvedValue(records),
      acknowledge,
      capacity: vi.fn(),
    };
    const send = vi.fn().mockResolvedValue({
      acknowledgedIds: ["event_1"],
      acceptedThroughSequence: 1,
    });

    await flushLoopOutbox({ outbox, send });

    expect(send).toHaveBeenCalledWith(records);
    expect(acknowledge).toHaveBeenCalledWith(["event_1"]);
  });

  it("does not call the platform for an empty outbox", async () => {
    const outbox: LoopOutbox = {
      enqueue: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      acknowledge: vi.fn(),
      capacity: vi.fn(),
    };
    const send = vi.fn();

    await flushLoopOutbox({ outbox, send });

    expect(send).not.toHaveBeenCalled();
  });
});
