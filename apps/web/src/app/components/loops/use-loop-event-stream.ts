"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { PersistedLoopEvent } from "./loop-run-projection";

export type LoopEventStreamState = "connecting" | "connected" | "reconnecting";

export interface LoopEventRecord {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  sequence: number;
  occurredAt: string;
  payload: unknown;
}

export interface LoopEventBatchResponse {
  cursor: number;
  events: LoopEventRecord[];
}

export type LoopEventBatchFetcher = (
  loopRunId: string,
  cursor: number,
  signal?: AbortSignal,
) => Promise<LoopEventBatchResponse>;

export function useLoopEventStream({
  loopRunId,
  initialCursor,
  onEvents,
  onGap,
  fetchBatch = fetchLoopEventBatch,
  pollIntervalMs = 2_000,
}: {
  loopRunId: string;
  initialCursor: number;
  onEvents(events: PersistedLoopEvent[]): void | Promise<void>;
  onGap?(error: Error & { code: "cursor_gap" }): void | Promise<void>;
  fetchBatch?: LoopEventBatchFetcher;
  pollIntervalMs?: number;
}): { state: LoopEventStreamState; cursor: number } {
  const cursorRef = useRef(initialCursor);
  const [state, setState] = useState<LoopEventStreamState>("connecting");
  const [cursor, setCursor] = useState(initialCursor);

  const acceptEvents = useEffectEvent(onEvents);
  const reportGap = useEffectEvent(async (error: Error & { code: "cursor_gap" }) => {
    await onGap?.(error);
  });

  useEffect(() => {
    cursorRef.current = initialCursor;
  }, [initialCursor]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    async function poll() {
      const requestedCursor = cursorRef.current;
      try {
        const batch = await fetchBatch(loopRunId, requestedCursor, controller.signal);
        if (batch.cursor !== requestedCursor + batch.events.length) {
          throw cursorGap();
        }
        const accepted = batch.events.map((event, index) => ({
          ...event,
          cursor: requestedCursor + index + 1,
        }));
        if (accepted.length > 0) await acceptEvents(accepted);
        if (disposed) return;
        cursorRef.current = batch.cursor;
        setCursor(batch.cursor);
        setState("connected");
      } catch (cause) {
        if (disposed || controller.signal.aborted) return;
        if (isCursorGap(cause)) await reportGap(cause);
        if (!disposed) setState("reconnecting");
      } finally {
        if (!disposed) timer = setTimeout(poll, pollIntervalMs);
      }
    }

    void poll();
    return () => {
      disposed = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [fetchBatch, loopRunId, pollIntervalMs]);

  return { state, cursor: Math.max(cursor, initialCursor) };
}

export async function fetchLoopEventBatch(
  loopRunId: string,
  cursor: number,
  signal?: AbortSignal,
): Promise<LoopEventBatchResponse> {
  const response = await fetch(
    `/api/loop-runs/${encodeURIComponent(loopRunId)}/events?cursor=${cursor}`,
    { ...(signal ? { signal } : {}), headers: { accept: "application/json" } },
  );
  const body = await response.json() as {
    ok?: boolean;
    result?: LoopEventBatchResponse;
    error?: string;
  };
  if (!response.ok || !body.ok || !body.result) {
    throw new Error(body.error ?? "Loop 事件流连接失败");
  }
  return body.result;
}

function cursorGap(): Error & { code: "cursor_gap" } {
  return Object.assign(new Error("Loop event cursor gap"), { code: "cursor_gap" as const });
}

function isCursorGap(value: unknown): value is Error & { code: "cursor_gap" } {
  return value instanceof Error
    && "code" in value
    && (value as Error & { code?: unknown }).code === "cursor_gap";
}
