import { describe, expect, it, vi } from "vitest";

import {
  listEligibleWorkflowParticipants,
  resolveWorkflowMentions,
} from "./workflow-interaction-participants";

const context = {
  loopRunId: "run_1",
  projectId: "project_1",
  projectManagerUserId: "user_manager",
  projectOwnerUserId: null,
  projectMembers: [
    { userId: "user_2", role: "contributor", status: "active", user: { name: "Li", avatarUrl: null, status: "active" } },
    { userId: "user_removed", role: "contributor", status: "inactive", user: { name: "Removed", avatarUrl: null, status: "active" } },
    { userId: "user_manager", role: "maintainer", status: "active", user: { name: "Manager", avatarUrl: "/manager.png", status: "active" } },
  ],
  task: {
    createdById: "user_creator",
    assigneeUserId: "user_2",
    createdBy: { name: "Creator", avatarUrl: null, status: "active" },
    assignee: { name: "Li", avatarUrl: null, status: "active" },
  },
};

describe("workflow interaction participants", () => {
  it("returns only current eligible participants matching the query", async () => {
    const assertCanReadProject = vi.fn().mockResolvedValue({ role: "viewer" });
    await expect(listEligibleWorkflowParticipants({
      userId: "user_1",
      loopRunId: "run_1",
      query: "li",
    }, {
      loadLoopRunContext: vi.fn().mockResolvedValue(context),
      assertCanReadProject,
    })).resolves.toEqual([{
      userId: "user_2",
      displayName: "Li",
      avatarUrl: null,
      relationship: "task_assignee",
    }]);
    expect(assertCanReadProject).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
  });

  it("deduplicates people and applies responsibility precedence", async () => {
    const participants = await listEligibleWorkflowParticipants({
      userId: "user_1",
      loopRunId: "run_1",
      query: "",
    }, {
      loadLoopRunContext: vi.fn().mockResolvedValue(context),
      assertCanReadProject: vi.fn().mockResolvedValue({ role: "viewer" }),
    });
    expect(participants.filter((item) => item.userId === "user_2")).toEqual([
      expect.objectContaining({ relationship: "task_assignee" }),
    ]);
    expect(participants).not.toEqual(expect.arrayContaining([expect.objectContaining({ userId: "user_removed" })]));
  });

  it("rejects an inactive member mentioned from a stale composer", async () => {
    await expect(resolveWorkflowMentions({
      projectId: "project_1",
      mentionedUserIds: ["user_2", "user_removed"],
      actorUserId: "user_1",
    }, {
      loadProjectMentionCandidates: vi.fn().mockResolvedValue([
        { userId: "user_2", memberStatus: "active", userStatus: "active" },
        { userId: "user_removed", memberStatus: "inactive", userStatus: "active" },
      ]),
    })).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("deduplicates eligible mention IDs", async () => {
    await expect(resolveWorkflowMentions({
      projectId: "project_1",
      mentionedUserIds: ["user_2", "user_2"],
      actorUserId: "user_1",
    }, {
      loadProjectMentionCandidates: vi.fn().mockResolvedValue([
        { userId: "user_2", memberStatus: "active", userStatus: "active" },
      ]),
    })).resolves.toEqual(["user_2"]);
  });
});
