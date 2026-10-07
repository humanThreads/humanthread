export function evaluateAcceptance(input: { definitions: Array<{ id: string; required: boolean }>; results: Array<{ definitionId: string; status: "passed" | "failed" | "inconclusive" | "skipped" }>; candidate: unknown }) {
  const latest = new Map(input.results.map((result) => [result.definitionId, result]));
  const required = input.definitions.filter((definition) => definition.required);
  const evidenceGaps = required.filter((definition) => !latest.has(definition.id)).map((definition) => definition.id);
  if (evidenceGaps.length > 0 || !input.candidate) return { status: "inconclusive" as const, evidenceGaps };
  const failed = required.filter((definition) => latest.get(definition.id)?.status === "failed").map((definition) => definition.id);
  if (failed.length > 0) return { status: "fail" as const, evidenceGaps: failed };
  const inconclusive = required.filter((definition) => latest.get(definition.id)?.status !== "passed").map((definition) => definition.id);
  return inconclusive.length > 0 ? { status: "inconclusive" as const, evidenceGaps: inconclusive } : { status: "pass" as const, evidenceGaps: [] };
}

export type TaskAcceptanceEvidenceStatus = "passed" | "failed" | "inconclusive" | "skipped";

export interface TaskAcceptanceEvidenceResult {
  id: string;
  checkKey: string;
  status: TaskAcceptanceEvidenceStatus;
  summary: string;
  source: string;
  finishedAt: Date | string;
}

export interface TaskAcceptanceReadiness {
  ready: boolean;
  requiredChecks: string[];
  missingChecks: string[];
  blockingChecks: string[];
  policyErrors: string[];
  latestEvidence: Array<Omit<TaskAcceptanceEvidenceResult, "finishedAt"> & { finishedAt: string }>;
}

const LEGACY_REQUIRED_CHECK = "delivery";
const MAX_REQUIRED_CHECKS = 32;

function normalizeCheckKey(value: unknown) {
  if (typeof value !== "string") return null;
  const key = value.trim();
  return key && key.length <= 96 && !/[\u0000-\u001f\u007f]/u.test(key) ? key : null;
}

export function resolveRequiredAcceptanceChecks(policy: unknown): string[] {
  if (policy === null || policy === undefined) return [LEGACY_REQUIRED_CHECK];
  if (typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("invalid acceptance policy: acceptance policy must be an object");
  }
  if (!Object.prototype.hasOwnProperty.call(policy, "requiredChecks")) return [LEGACY_REQUIRED_CHECK];
  const values = (policy as { requiredChecks?: unknown }).requiredChecks;
  if (!Array.isArray(values)) {
    throw new Error("invalid acceptance policy: requiredChecks must be an array");
  }
  const invalidIndex = values.findIndex((value) => normalizeCheckKey(value) === null);
  if (invalidIndex >= 0 || values.length > MAX_REQUIRED_CHECKS) {
    const detail = invalidIndex >= 0
      ? `requiredChecks[${invalidIndex}] is invalid`
      : `requiredChecks exceeds ${MAX_REQUIRED_CHECKS} entries`;
    throw new Error(`invalid acceptance policy: ${detail}`);
  }
  const checks = [...new Set(values.map((value) => normalizeCheckKey(value) as string))];
  return checks.length > 0 ? checks : [LEGACY_REQUIRED_CHECK];
}

function inspectRequiredAcceptanceChecks(policy: unknown) {
  try {
    return { requiredChecks: resolveRequiredAcceptanceChecks(policy), policyErrors: [] as string[] };
  } catch (error) {
    const values = policy && typeof policy === "object" && !Array.isArray(policy)
      ? (policy as { requiredChecks?: unknown }).requiredChecks
      : undefined;
    const validChecks = Array.isArray(values)
      ? [...new Set(values.map(normalizeCheckKey).filter((value): value is string => value !== null))]
      : [];
    const message = error instanceof Error
      ? error.message.replace(/^invalid acceptance policy: /u, "")
      : "acceptance policy is invalid";
    return { requiredChecks: validChecks, policyErrors: [message] };
  }
}

function normalizedEvidence(result: TaskAcceptanceEvidenceResult) {
  const checkKey = normalizeCheckKey(result.checkKey);
  const timestamp = result.finishedAt instanceof Date
    ? result.finishedAt.getTime()
    : Date.parse(result.finishedAt);
  if (!checkKey || !Number.isFinite(timestamp)) return null;
  return {
    id: result.id,
    checkKey,
    status: result.status,
    summary: result.summary,
    source: result.source,
    finishedAt: new Date(timestamp).toISOString(),
    timestamp,
  };
}

export function evaluateTaskAcceptance(input: {
  policy: unknown;
  results: TaskAcceptanceEvidenceResult[];
}): TaskAcceptanceReadiness {
  const { requiredChecks, policyErrors } = inspectRequiredAcceptanceChecks(input.policy);
  const required = new Set(requiredChecks);
  const latest = new Map<string, ReturnType<typeof normalizedEvidence> & object>();
  for (const candidate of input.results.map(normalizedEvidence)) {
    if (!candidate || !required.has(candidate.checkKey)) continue;
    const current = latest.get(candidate.checkKey);
    if (!current
      || candidate.timestamp > current.timestamp
      || (candidate.timestamp === current.timestamp && candidate.id.localeCompare(current.id) > 0)) {
      latest.set(candidate.checkKey, candidate);
    }
  }
  const missingChecks = requiredChecks.filter((checkKey) => !latest.has(checkKey));
  const blockingChecks = requiredChecks.filter((checkKey) => {
    const evidence = latest.get(checkKey);
    return evidence !== undefined && evidence.status !== "passed";
  });
  const latestEvidence = requiredChecks.flatMap((checkKey) => {
    const evidence = latest.get(checkKey);
    if (!evidence) return [];
    const { timestamp: _timestamp, ...result } = evidence;
    return [result];
  });
  return {
    ready: policyErrors.length === 0 && missingChecks.length === 0 && blockingChecks.length === 0,
    requiredChecks,
    missingChecks,
    blockingChecks,
    policyErrors,
    latestEvidence,
  };
}
