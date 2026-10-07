import type { CodexAppServerState } from "./providers/codex-app-server-client";

export type CodexHeartbeatDiagnostic = {
  status: "healthy" | "degraded" | "failed" | "unknown";
  lastSuccessAt: number | null;
  leaseExpiresAt: number | null;
  errorCode?: string;
};

export type CodexAppServerDiagnostic = {
  processKey: string;
  generation: number;
  pid: number;
  bindingFingerprint: string;
  model: string | null;
  reasoningEffort: string | null;
  transport: "stdio";
  status: string;
  lastNotificationAt: number | null;
  lastNotificationMethod?: string;
  pendingRequestCount: number;
  stderrSummary: string | null;
  lastErrorCode: string | null;
  threadId?: string;
  turnId?: string;
  heartbeat?: CodexHeartbeatDiagnostic;
  outbox?: "online" | "degraded" | "offline" | "unknown";
  reconnectCount: number;
  lastRequestLatencyBucket?: "lt_100ms" | "lt_500ms" | "lt_2s" | "gte_2s";
};

export type CodexAppServerDiagnosticInput = {
  state: CodexAppServerState | null;
  threadId?: unknown;
  turnId?: unknown;
  lastNotificationMethod?: unknown;
  heartbeat?: unknown;
  outbox?: unknown;
  reconnectCount?: unknown;
  lastRequestLatencyMs?: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function boundedInteger(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, max)
    : fallback;
}

function sanitizeDiagnosticText(value: unknown): string | null {
  const text = boundedString(value, 1_024);
  if (!text) return null;
  const sanitized = text
    .replace(/(?:[A-Za-z]:\\|\/)(?:[^\s"']+[\\/])*[^\s"']*/gu, "[local path]")
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/giu, "$1=[redacted]")
    .slice(0, 512);
  return sanitized || null;
}

function diagnosticHeartbeat(value: unknown): CodexHeartbeatDiagnostic | undefined {
  const input = record(value);
  if (!input) return undefined;
  const candidate = input.status;
  const status = candidate === "healthy" || candidate === "degraded" || candidate === "failed"
    ? candidate
    : "unknown";
  const lastSuccessAt = typeof input.lastSuccessAt === "number" && Number.isSafeInteger(input.lastSuccessAt) && input.lastSuccessAt >= 0
    ? input.lastSuccessAt
    : null;
  const leaseExpiresAt = typeof input.leaseExpiresAt === "number" && Number.isSafeInteger(input.leaseExpiresAt) && input.leaseExpiresAt >= 0
    ? input.leaseExpiresAt
    : null;
  const errorCode = boundedString(input.errorCode, 64);
  return {
    status,
    lastSuccessAt,
    leaseExpiresAt,
    ...(errorCode && /^[a-z0-9_]{1,64}$/u.test(errorCode) ? { errorCode } : {}),
  };
}

function diagnosticOutbox(value: unknown): NonNullable<CodexAppServerDiagnostic["outbox"]> {
  return value === "online" || value === "degraded" || value === "offline" ? value : "unknown";
}

function latencyBucket(value: unknown): CodexAppServerDiagnostic["lastRequestLatencyBucket"] {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  if (value < 100) return "lt_100ms";
  if (value < 500) return "lt_500ms";
  if (value < 2_000) return "lt_2s";
  return "gte_2s";
}

/**
 * Project the in-memory app-server state into an allowlisted, UI-safe shape.
 * Unknown fields are intentionally ignored so credentials and prompts cannot
 * enter the local diagnostics channel through a future caller.
 */
export function projectCodexAppServerDiagnostic(
  input: CodexAppServerDiagnosticInput,
): CodexAppServerDiagnostic {
  const state = input.state;
  const threadId = boundedString(input.threadId, 256);
  const turnId = boundedString(input.turnId, 256);
  const lastNotificationMethod = boundedString(input.lastNotificationMethod, 128);
  const heartbeat = diagnosticHeartbeat(input.heartbeat);
  const latency = latencyBucket(input.lastRequestLatencyMs);
  const result: CodexAppServerDiagnostic = {
    processKey: boundedString(state?.processKey, 128) ?? "unknown",
    generation: boundedInteger(state?.generation, 0, Number.MAX_SAFE_INTEGER),
    pid: boundedInteger(state?.pid, 0, Number.MAX_SAFE_INTEGER),
    bindingFingerprint: /^[a-f0-9]{64}$/u.test(state?.bindingFingerprint ?? "")
      ? state?.bindingFingerprint ?? ""
      : "unknown",
    model: boundedString(state?.model, 512),
    reasoningEffort: boundedString(state?.reasoningEffort, 32),
    transport: "stdio",
    status: boundedString(state?.status, 64) ?? "unavailable",
    lastNotificationAt: typeof state?.lastNotificationAt === "number" && Number.isSafeInteger(state.lastNotificationAt) && state.lastNotificationAt >= 0
      ? state.lastNotificationAt
      : null,
    pendingRequestCount: boundedInteger(state?.pendingRequestCount, 0, 10_000),
    stderrSummary: sanitizeDiagnosticText(state?.stderrSummary),
    lastErrorCode: boundedString(state?.lastErrorCode, 64),
    reconnectCount: boundedInteger(input.reconnectCount, 0, 100_000),
    ...(lastNotificationMethod ? { lastNotificationMethod } : {}),
    ...(threadId ? { threadId } : {}),
    ...(turnId ? { turnId } : {}),
  };
  if (heartbeat) result.heartbeat = heartbeat;
  if (input.outbox !== undefined) result.outbox = diagnosticOutbox(input.outbox);
  if (latency) result.lastRequestLatencyBucket = latency;
  return result;
}
