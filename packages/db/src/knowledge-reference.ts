import { createHash } from "node:crypto";

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

export function knowledgeDigest(...parts: string[]): string {
  if (parts.length === 0) throw new Error("knowledgeDigest requires at least one part");
  return createHash("md5").update(parts.map((part) => required(part, "digest part")).join("\0")).digest("hex");
}

export function knowledgeId(namespace: string, ...parts: string[]): string {
  return knowledgeDigest(required(namespace, "namespace"), ...parts);
}

export function knowledgeProjectDigest(projectId: string): string {
  return knowledgeDigest("project", projectId);
}
