import { describe, expect, it } from "vitest";

import {
  isValidWorkerBranchName,
  matchesWorkerBranchPattern,
  workerBranchPatternSchema,
} from "./worker-branch-policy";

describe("worker branch policy", () => {
  it("matches exact names and full-string wildcard patterns", () => {
    expect(matchesWorkerBranchPattern("main", "main")).toBe(true);
    expect(matchesWorkerBranchPattern("staging", "main")).toBe(false);
    expect(matchesWorkerBranchPattern("2026-HUMANTHR1100008", "2026-HUMANTHR*")).toBe(true);
    expect(matchesWorkerBranchPattern("task/2026-HUMANTHR1100008", "task/*")).toBe(true);
    expect(matchesWorkerBranchPattern("2026-HT100023", "*-HT-*")).toBe(false);
    expect(matchesWorkerBranchPattern("2026-HT100023", "2026-HT*")).toBe(true);
  });

  it("does not interpret non-wildcard characters as regular expressions", () => {
    expect(matchesWorkerBranchPattern("feature/v1.2", "feature/v1.2")).toBe(true);
    expect(matchesWorkerBranchPattern("feature/v1x2", "feature/v1.2")).toBe(false);
    expect(matchesWorkerBranchPattern("feature/v1.2", "feature/*")).toBe(true);
  });

  it("accepts only bounded branch-safe policy values", () => {
    for (const pattern of ["main", "*-HT-*", "*", "task/*/candidate"]) {
      expect(workerBranchPatternSchema.safeParse(pattern).success).toBe(true);
    }
    for (const pattern of ["", " main", "main ", "feature name", "feature~name", "feature..name", "-main", "feature\\name"]) {
      expect(workerBranchPatternSchema.safeParse(pattern).success).toBe(false);
    }
  });

  it("rejects invalid concrete branch names before matching", () => {
    expect(isValidWorkerBranchName("main")).toBe(true);
    expect(isValidWorkerBranchName("task/2026-HUMANTHR1100008")).toBe(true);
    expect(isValidWorkerBranchName("feature name")).toBe(false);
    expect(isValidWorkerBranchName("feature*name")).toBe(false);
    expect(matchesWorkerBranchPattern("feature name", "*")).toBe(false);
  });
});
