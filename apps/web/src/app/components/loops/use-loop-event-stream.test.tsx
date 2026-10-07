// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLoopEventStream, type LoopEventBatchResponse } from "./use-loop-event-stream";

afterEach(() => {
  vi.useRealTimers();
});

const persistedEvent = {
  id: "event_13",
  eventType: "loop.node.progressed",
  aggregateType: "loop_node",
  aggregateId: "node_work_1",
  sequence: 2,
  occurredAt: "2026-07-31T08:00:00.000Z",
  payload: { payloadSummary: "正在执行测试" },
};

describe("useLoopEventStream", () => {
  it("assigns contiguous accepted cursors instead of aggregate-local sequence", async () => {
    const onEvents = vi.fn();
    const fetchBatch = vi.fn().mockResolvedValue({ cursor: 13, events: [persistedEvent] } satisfies LoopEventBatchResponse);

    renderHook(() => useLoopEventStream({ loopRunId: "run_1", initialCursor: 12, fetchBatch, onEvents, pollIntervalMs: 60_000 }));

    await waitFor(() => expect(onEvents).toHaveBeenCalledWith([
      expect.objectContaining({ id: "event_13", cursor: 13, sequence: 2 }),
    ]));
  });

  it("reports a response cursor gap instead of accepting partial state", async () => {
    const onGap = vi.fn();
    const fetchBatch = vi.fn().mockResolvedValue({ cursor: 14, events: [persistedEvent] } satisfies LoopEventBatchResponse);

    renderHook(() => useLoopEventStream({ loopRunId: "run_1", initialCursor: 12, fetchBatch, onEvents: vi.fn(), onGap, pollIntervalMs: 60_000 }));

    await waitFor(() => expect(onGap).toHaveBeenCalledWith(expect.objectContaining({ code: "cursor_gap" })));
  });

  it("reconnects from the last accepted cursor", async () => {
    vi.useFakeTimers();
    const fetchBatch = vi.fn()
      .mockResolvedValueOnce({ cursor: 13, events: [persistedEvent] } satisfies LoopEventBatchResponse)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ cursor: 13, events: [] } satisfies LoopEventBatchResponse);

    renderHook(() => useLoopEventStream({ loopRunId: "run_1", initialCursor: 12, fetchBatch, onEvents: vi.fn(), pollIntervalMs: 100 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    expect(fetchBatch.mock.calls.map((call) => call[1])).toEqual([12, 13, 13]);
  });
});
