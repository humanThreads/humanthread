import { describe, expect, it } from "vitest";

import { evaluateWorkflowInteractionPermission } from "./workflow-interaction-policy";

describe("workflow interaction permission policy", () => {
  it.each([
    ["viewer", "reply", false],
    ["task_collaborator", "reply", true],
    ["task_collaborator", "confirm", false],
    ["task_assignee", "confirm", true],
    ["task_creator", "confirm", true],
    ["project_admin", "confirm", true],
    ["release_approver", "release_decide", true],
    ["project_admin", "release_decide", true],
  ] as const)("evaluates %s %s", (role, action, allowed) => {
    expect(evaluateWorkflowInteractionPermission({ role, action, terminal: false }))
      .toMatchObject({ allowed });
  });

  it("makes every mutation read-only after the interaction or runtime becomes terminal", () => {
    expect(evaluateWorkflowInteractionPermission({
      role: "project_admin",
      action: "confirm",
      terminal: true,
    })).toEqual({ allowed: false, reason: "interaction_read_only" });
    expect(evaluateWorkflowInteractionPermission({
      role: "viewer",
      action: "view",
      terminal: true,
    })).toEqual({ allowed: true });
  });
});
