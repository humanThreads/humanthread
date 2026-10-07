import { describe, expect, it } from "vitest";
import { evaluateApprovalRequirement } from "./approval";

describe("approval policy", () => {
  it.each(["scope_change", "unknown_tool", "dangerous_command", "merge", "release", "production", "budget_increase"])("requires approval for %s", (type) => {
    expect(evaluateApprovalRequirement({ requestedAction: { type }, effectivePolicy: { autoApprove: ["safe_check"] } })).toEqual({ required: true, type });
  });
  it("allows explicitly safe checks", () => {
    expect(evaluateApprovalRequirement({ requestedAction: { type: "safe_check" }, effectivePolicy: { autoApprove: ["safe_check"] } })).toEqual({ required: false });
  });
});
