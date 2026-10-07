import { describe, expect, it, vi } from "vitest";
import {
  assertCanDispatchTaskAgent,
  assertCanEditTask,
  assertCanGovernTask,
  assertCanManageTaskMembers,
  assertCanReadTask,
  buildAccessibleTaskWhere,
} from "./access";

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "task_1",
    visibility: "private",
    createdById: "user_creator",
    assigneeUserId: "user_assignee",
    space: {
      id: "space_company",
      type: "company",
      ownerUserId: null,
      status: "active",
      company: { members: [{ role: "member", status: "active" }] },
    },
    project: { members: [] },
    members: [{ userId: "user_follower", role: "follower" }],
    ...overrides,
  };
}

describe("task database access", () => {
  it("builds one Space-aware predicate for explicit, project, and company visibility", () => {
    const where = buildAccessibleTaskWhere({ userId: "user_1", spaceId: "space_1" });
    const serialized = JSON.stringify(where);

    expect(where).toMatchObject({ AND: expect.any(Array) });
    expect(serialized).toContain('"spaceId":"space_1"');
    expect(serialized).toContain('"createdById":"user_1"');
    expect(serialized).toContain('"assigneeUserId":"user_1"');
    expect(serialized).toContain('"visibility":"project"');
    expect(serialized).toContain('"visibility":"company"');
    expect(serialized).toContain('"company"');
    expect(serialized).toContain('"members"');
  });

  it("adds relation filters without replacing the authorization predicate", () => {
    const where = buildAccessibleTaskWhere({
      userId: "user_1",
      relation: "following",
      projectId: "project_1",
    });

    expect(JSON.stringify(where)).toContain('"role":"follower"');
    expect(JSON.stringify(where)).toContain('"projectId":"project_1"');
    expect(JSON.stringify(where)).toContain('"space"');
  });

  it("allows a follower to read but not edit a private task", async () => {
    const db = { task: { findUnique: vi.fn().mockResolvedValue(taskRow()) } };

    await expect(assertCanReadTask({ userId: "user_follower", taskId: "task_1", db }))
      .resolves.toMatchObject({ taskId: "task_1", role: "follower" });
    await expect(assertCanEditTask({ userId: "user_follower", taskId: "task_1", db }))
      .rejects.toMatchObject({ code: "task_access_denied" });
  });

  it("allows company admin governance without granting private content read", async () => {
    const row = taskRow({
      space: {
        ...taskRow().space,
        company: { members: [{ role: "admin", status: "active" }] },
      },
      members: [],
    });
    const db = { task: { findUnique: vi.fn().mockResolvedValue(row) } };

    await expect(assertCanReadTask({ userId: "user_admin", taskId: "task_1", db }))
      .rejects.toMatchObject({ code: "task_not_found" });
    await expect(assertCanGovernTask({ userId: "user_admin", taskId: "task_1", db }))
      .resolves.toMatchObject({ role: "company_admin" });
  });

  it("authorizes Agent dispatch from Task ownership without a Project", async () => {
    const db = {
      task: {
        findUnique: vi.fn().mockResolvedValue(taskRow({
          project: null,
          createdById: "user_creator",
        })),
      },
    };

    await expect(assertCanDispatchTaskAgent({
      userId: "user_creator",
      taskId: "task_1",
      db,
    })).resolves.toMatchObject({ role: "creator" });
  });

  it("allows the Task creator to manage collaborators", async () => {
    const db = { task: { findUnique: vi.fn().mockResolvedValue(taskRow()) } };

    await expect(assertCanManageTaskMembers({
      userId: "user_creator",
      taskId: "task_1",
      db,
    })).resolves.toMatchObject({ role: "creator" });
  });
});
