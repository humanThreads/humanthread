export type LoopExecutionLogStream = "stdout" | "stderr" | "system";

export interface LoopExecutionLogEntry {
  id: string;
  loopRunId: string;
  nodeKey: string;
  stream: LoopExecutionLogStream;
  text: string;
  occurredAt: string;
}

type PendingLoopExecutionLogEntry = Omit<LoopExecutionLogEntry, "id" | "text"> & {
  text: string;
};

interface LoopExecutionLogBuffer {
  entries: LoopExecutionLogEntry[];
  bytes: number;
}

const EMPTY_ENTRIES: readonly LoopExecutionLogEntry[] = Object.freeze([]);
const MAX_CHUNK_LENGTH = 16_384;

export class LoopExecutionLogStore {
  private readonly buffers = new Map<string, LoopExecutionLogBuffer>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private sequence = 0;

  constructor(options: { maxEntries?: number; maxBytes?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 2_000;
    this.maxBytes = options.maxBytes ?? 1_048_576;
  }

  append(input: PendingLoopExecutionLogEntry): LoopExecutionLogEntry | null {
    const text = redactLoopExecutionLog(input.text.slice(0, MAX_CHUNK_LENGTH));
    if (!text) return null;
    const entry: LoopExecutionLogEntry = {
      ...input,
      id: `loop-log:${++this.sequence}`,
      text,
    };
    const current = this.buffers.get(input.loopRunId) ?? { entries: [], bytes: 0 };
    const entries = [...current.entries, entry];
    let bytes = current.bytes + byteLength(text);
    while (entries.length > this.maxEntries || bytes > this.maxBytes) {
      const removed = entries.shift();
      if (!removed) break;
      bytes -= byteLength(removed.text);
    }
    this.buffers.set(input.loopRunId, { entries, bytes });
    for (const listener of this.listeners.get(input.loopRunId) ?? []) {
      try {
        listener();
      } catch {
        // Observability must never interrupt Agent execution.
      }
    }
    return entry;
  }

  read(loopRunId: string): readonly LoopExecutionLogEntry[] {
    return this.buffers.get(loopRunId)?.entries ?? EMPTY_ENTRIES;
  }

  subscribe(loopRunId: string, listener: () => void): () => void {
    const listeners = this.listeners.get(loopRunId) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(loopRunId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(loopRunId);
    };
  }
}

export function redactLoopExecutionLog(value: string): string {
  return value
    .replace(/(authorization\s*:\s*)bearer\s+[^\s]+/giu, "$1Bearer [REDACTED]")
    .replace(/\bbearer\s+[^\s]+/giu, "Bearer [REDACTED]")
    .replace(
      /\b([A-Za-z0-9_]*(?:api[_-]?key|access[_-]?key|secret|password|token)[A-Za-z0-9_]*)\s*([:=])\s*(?:"[^"]*"|'[^']*'|[^\s]+)/giu,
      "$1$2[REDACTED]",
    );
}

const loopExecutionLogStore = new LoopExecutionLogStore();

export function appendLoopExecutionLog(input: PendingLoopExecutionLogEntry) {
  return loopExecutionLogStore.append(input);
}

export function readLoopExecutionLogs(loopRunId: string) {
  return loopExecutionLogStore.read(loopRunId);
}

export function subscribeLoopExecutionLogs(loopRunId: string, listener: () => void) {
  return loopExecutionLogStore.subscribe(loopRunId, listener);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
