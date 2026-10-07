import { describe, expect, it } from "vitest";
import { authorizeTaskAction } from "./task-policy";

function policyInput(overrides: Record<string, unknown> = {}) {
  return {
    actor: { type: "user" as const, id: "user_actor" },
    action: "read" as const,
    task: {
      spaceType: "company" as const,
      visibility: "private" as const,
      spaceOwnerUserId: null,
      creatorUserId: "user_creator",
      assigneeUserId: "user_assignee",
      members: [
        { userId: "user_participant", role: "participant" as const },
        { userId: "user_follower", role: "follower" as const },
      ],
    },
    memberships: {
      spaceActive: true,
      companyRole: "member",
      projectRole: null,
      projectActive: false,
    },
    ...overrides,
  };
}

describe("task policy", () => {
  it("allows explicit private-task collaborators according to their role", () => {
    expect(authorizeTaskAction(policyInput({ actor: { type: "user", id: "user_follower" } })))
      .toEqual({ allowed: true, role: "follower" });
    expect(authorizeTaskAction(policyInput({
      actor: { type: "user", id: "user_follower" },
      action: "comment",
    }))).toEqual({ allowed: true, role: "follower" });
    expect(authorizeTaskAction(policyInput({
      actor: { type: "user", id: "user_follower" },
      action: "edit_content",
    }))).toEqual({ allowed: false, reason: "task_role_denied" });
    expect(authorizeTaskAction(policyInput({
      actor: { type: "user", id: "user_participant" },
      action: "edit_content",
    }))).toEqual({ allowed: true, role: "participant" });
  });

  it("allows a task creator who is also the assignee to change status", () => {
    expect(authorizeTaskAction(policyInput({
      actor: { type: "user", id: "user_owner" },
      action: "change_status",
      task: {
        ...policyInput().task,
        creatorUserId: "user_owner",
        assigneeUserId: "user_owner",
      },
    }))).toEqual({ allowed: true, role: "creator" });
  });

  it("lets project members read project-visible tasks without granting edit", () => {
    const input = policyInput({
      task: { ...policyInput().task, visibility: "project" },
      memberships: { spaceActive: true, companyRole: "member", projectRole: "contributor", projectActive: true },
    });

    expect(authorizeTaskAction(input)).toEqual({ allowed: true, role: "project_member" });
    expect(authorizeTaskAction({ ...input, action: "edit_content" }))
      .toEqual({ allowed: false, reason: "task_role_denied" });
  });

  it("lets active company members read company-visible tasks", () => {
    const result = authorizeTaskAction(policyInput({
      task: { ...policyInput().task, visibility: "company" },
    }));

    expect(result).toEqual({ allowed: true, role: "company_member" });
  });

  it("allows company administrators to govern private tasks without reading content", () => {
    const input = policyInput({
      memberships: { spaceActive: true, companyRole: "admin", projectRole: null, projectActive: false },
    });

    expect(authorizeTaskAction(input)).toEqual({ allowed: false, reason: "task_not_visible" });
    expect(authorizeTaskAction({ ...input, action: "govern" }))
      .toEqual({ allowed: true, role: "company_admin" });
  });

  it("restricts personal tasks to the personal owner and explicit collaborators", () => {
    const input = policyInput({
      task: {
        ...policyInput().task,
        spaceType: "personal",
        visibility: "private",
        spaceOwnerUserId: "user_owner",
      },
      memberships: { spaceActive: true, companyRole: null, projectRole: null, projectActive: false },
    });

    expect(authorizeTaskAction(input)).toEqual({ allowed: false, reason: "task_not_visible" });
    expect(authorizeTaskAction({ ...input, actor: { type: "user", id: "user_owner" } }))
      .toEqual({ allowed: true, role: "space_owner" });
  });

  it("denies inactive Space members before checking task visibility", () => {
    expect(authorizeTaskAction(policyInput({
      memberships: { spaceActive: false, companyRole: "member", projectRole: null, projectActive: false },
    }))).toEqual({ allowed: false, reason: "space_access_denied" });
  });

  it("limits delegated Agent actors to explicitly granted actions", () => {
    const actor = {
      type: "agent" as const,
      id: "agent_codex",
      delegatedUserId: "user_assignee",
      allowedActions: ["read", "edit_content"] as const,
    };

    expect(authorizeTaskAction(policyInput({ actor, action: "edit_content" })))
      .toEqual({ allowed: true, role: "assignee" });
    expect(authorizeTaskAction(policyInput({ actor, action: "change_status" })))
      .toEqual({ allowed: false, reason: "delegated_action_denied" });
  });
});
