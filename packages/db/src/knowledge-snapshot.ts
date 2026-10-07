import { knowledgeDigest } from "./knowledge-reference";

export interface KnowledgeSourceSnapshot {
  observedAt: Date;
  sourceRefs: Array<Record<string, unknown>>;
  value: Record<string, unknown>;
}

export function parseKnowledgeSourceSnapshot(value: Record<string, unknown>): KnowledgeSourceSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError("Knowledge source snapshot must be an object");
  }
  if (Object.keys(value).length === 0) {
    throw validationError("Knowledge source snapshot is required");
  }
  const observedAt = new Date(String(value.observedAt ?? ""));
  if (Number.isNaN(observedAt.getTime())) {
    throw validationError("Knowledge source snapshot observedAt is invalid");
  }
  if (!Array.isArray(value.sourceRefs) || value.sourceRefs.length === 0) {
    throw validationError("Knowledge source snapshot sourceRefs are required");
  }
  const sourceRefs = value.sourceRefs.map((reference, index) => {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
      throw validationError(`Knowledge source snapshot reference ${index} is invalid`);
    }
    const record = reference as Record<string, unknown>;
    if (!nonEmptyString(record.kind) || !nonEmptyString(record.ref)) {
      throw validationError(`Knowledge source snapshot reference ${index} is incomplete`);
    }
    return record;
  });
  return { observedAt, sourceRefs, value };
}

export function knowledgeSourceSnapshotDigest(value: Record<string, unknown>): string {
  return knowledgeDigest("knowledge-job-snapshot", canonicalJson(value));
}

export function isKnowledgeSourceSnapshotFresh(
  snapshot: KnowledgeSourceSnapshot,
  now: Date,
  maximumAgeMs = 24 * 60 * 60 * 1_000,
): boolean {
  const age = now.getTime() - snapshot.observedAt.getTime();
  return age >= -5 * 60 * 1_000 && age <= maximumAgeMs;
}

export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(",")}}`;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}
