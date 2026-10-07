import { describe, expect, it } from "vitest";
import { validateExecutionPolicy } from "./scope-policy";

describe("validateExecutionPolicy", () => {
  it("rejects commands outside approved path and tool scope", () => {
    expect(validateExecutionPolicy({ taskScope: { allowedPaths: ["apps/web/**"], allowedTools: ["test"] }, profilePolicy: { allowedPaths: ["**"], allowedTools: ["test", "git"] }, approvalGrants: [], requested: { path: "prisma/schema.prisma", tool: "write" } })).toEqual({ ok: false, code: "policy_denied", approvalType: "scope_change" });
  });
  it("allows an intersected in-scope operation", () => {
    expect(validateExecutionPolicy({ taskScope: { allowedPaths: ["apps/web/**"], allowedTools: ["test"] }, profilePolicy: { allowedPaths: ["apps/**"], allowedTools: ["test", "git"] }, approvalGrants: [], requested: { path: "apps/web/src/page.tsx", tool: "test" } })).toEqual({ ok: true });
  });
});
