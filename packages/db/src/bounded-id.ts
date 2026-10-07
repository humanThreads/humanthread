import { createHash } from "node:crypto";

const PERSISTENCE_ID_MAX_LENGTH = 128;

export function boundedPersistenceId(
  prefix: string,
  parts: readonly string[],
  maxLength = PERSISTENCE_ID_MAX_LENGTH,
): string {
  const readable = `${prefix}:${parts.join(":")}`;
  if (readable.length <= maxLength) return readable;
  const digest = createHash("sha256").update(parts.join("\0")).digest("hex");
  return `${prefix}:${digest}`;
}

export function derivedPersistenceId(parts: readonly string[]): string {
  return createHash("md5").update(parts.join("\0")).digest("hex");
}

export function buildCompanyMembershipId(companyId: string, userId: string): string {
  return derivedPersistenceId(["company-member", companyId, userId]);
}
