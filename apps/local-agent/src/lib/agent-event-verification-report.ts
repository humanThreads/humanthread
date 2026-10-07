import {
  isSupportedLocalAgentEventType,
  validateAgentEventPayload,
} from "./agent-event-verification.ts";

export interface AgentEventVerificationRow {
  id: string;
  taskId: string;
  type: string;
  payload: unknown;
  createdAt: Date;
}

export interface SummarizeAgentEventVerificationInput {
  rows: AgentEventVerificationRow[];
  expectedTypes: string[] | null;
  latestOnly: boolean;
}

interface AgentEventVerificationResultItem {
  id: string;
  taskId: string;
  type: string;
  createdAt: string;
  valid: boolean;
  missingKeys: string[];
  payload?: unknown;
}

export interface AgentEventVerificationSummary {
  ok: boolean;
  total: number;
  invalidCount: number;
  missingExpectedTypes: string[];
  results: AgentEventVerificationResultItem[];
}

function pickRows(input: SummarizeAgentEventVerificationInput): AgentEventVerificationRow[] {
  if (!input.latestOnly) {
    return input.rows;
  }

  const latestByType = new Map<string, AgentEventVerificationRow>();

  for (const row of input.rows) {
    const current = latestByType.get(row.type);

    if (!current || row.createdAt.getTime() > current.createdAt.getTime()) {
      latestByType.set(row.type, row);
    }
  }

  return [...latestByType.values()].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  );
}

export function summarizeAgentEventVerification(
  input: SummarizeAgentEventVerificationInput,
): AgentEventVerificationSummary {
  const rows = pickRows(input);
  const results = rows.map((row) => {
    if (!isSupportedLocalAgentEventType(row.type)) {
      return {
        id: row.id,
        taskId: row.taskId,
        type: row.type,
        createdAt: row.createdAt.toISOString(),
        valid: false,
        missingKeys: ["unsupported_event_type"],
      };
    }

    const validation = validateAgentEventPayload(row.type, row.payload);

    return {
      id: row.id,
      taskId: row.taskId,
      type: row.type,
      createdAt: row.createdAt.toISOString(),
      valid: validation.valid,
      missingKeys: validation.missingKeys,
      payload: row.payload,
    };
  });

  const invalidCount = results.filter((item) => !item.valid).length;
  const matchedTypes = new Set(results.map((item) => item.type));
  const missingExpectedTypes = (input.expectedTypes ?? []).filter(
    (type) => !matchedTypes.has(type),
  );

  return {
    ok: invalidCount === 0 && missingExpectedTypes.length === 0,
    total: results.length,
    invalidCount,
    missingExpectedTypes,
    results,
  };
}
