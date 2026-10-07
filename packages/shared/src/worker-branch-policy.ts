import { z } from "zod";

const MAX_WORKER_BRANCH_LENGTH = 191;
const INVALID_BRANCH_CHARACTERS = /[\u0000-\u001f\u007f\s~^:?*\\[\]]/u;

/**
 * Checks a concrete Git branch name. Policy patterns are validated separately
 * and may contain `*`, but an assignment branch must never contain it.
 */
export function isValidWorkerBranchName(value: string): boolean {
  if (
    !value
    || value.length > MAX_WORKER_BRANCH_LENGTH
    || value !== value.trim()
    || value.startsWith("-")
    || value.startsWith("/")
    || value.endsWith("/")
    || value.startsWith(".")
    || value.endsWith(".")
    || value.includes("..")
    || value.includes("//")
    || value.includes("@{")
    || value.endsWith(".lock")
    || INVALID_BRANCH_CHARACTERS.test(value)
  ) return false;
  return value.split("/").every((part) => part !== "" && !part.startsWith(".") && !part.endsWith(".lock"));
}

/**
 * Policy entries are exact branch names or restricted full-string globs.
 * `*` is the only wildcard and is intentionally not arbitrary RegExp input.
 */
export function isWorkerBranchPattern(value: string): boolean {
  if (!value || value.length > MAX_WORKER_BRANCH_LENGTH || value !== value.trim()) return false;
  if (INVALID_BRANCH_CHARACTERS.test(value.replaceAll("*", ""))) return false;
  return isValidWorkerBranchName(value.replaceAll("*", "x"));
}

export const workerBranchPatternSchema = z.string().refine(
  isWorkerBranchPattern,
  "Worker branch policy entries must be exact branch names or full-string * patterns",
);

export function matchesWorkerBranchPattern(branch: string, pattern: string): boolean {
  if (!isValidWorkerBranchName(branch) || !isWorkerBranchPattern(pattern)) return false;
  if (!pattern.includes("*")) return branch === pattern;
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`, "u").test(branch);
}
