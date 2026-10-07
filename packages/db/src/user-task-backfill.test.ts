import { describe, expect, it } from "vitest";
import {
  planUserTaskBackfill,
  summarizeUserTaskBackfill,
} from "../../../prisma/user-task-backfill-plan.mjs";

function legacyTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task_1",
    title: "需求确认",
    description: "确认登录改造范围",
    status: "pending",
    spaceId: null,
    createdById: null,
    statusCategory: null,
    visibility: null,
    contentMarkdown: null,
    acceptanceMode: null,
    executionMode: "human",
    acceptancePolicy: null,
    project: {
      id: "project_1",
      space: { id: "space_company", type: "company" },
    },
    workflowInstance: {
      id: "workflow_1",
      title: "完成登录改造",
      createdById: "user_creator",
    },
    stepTemplate: { title: "需求确认" },
    events: [],
    blockers: [],
    ...overrides,
  };
}

describe("user task backfill", () => {
  it("backfills stable user task fields from legacy project and workflow context", () => {
    const plan = planUserTaskBackfill({ tasks: [legacyTask()] });

    expect(plan.tasks).toEqual([
      {
        taskId: "task_1",
        spaceId: "space_company",
        createdById: "user_creator",
        statusCategory: "todo",
        visibility: "project",
        contentMarkdown: "确认登录改造范围",
        acceptanceMode: "none",
        title: "完成登录改造",
      },
    ]);
    expect(plan.blockers).toEqual([]);
    expect(plan.errors).toEqual([]);
    expect(summarizeUserTaskBackfill(plan)).toEqual({
      processed: 1,
      migrated: 1,
      blockers: 0,
      skipped: 0,
      errors: 0,
    });
  });

  it("maps a blocked legacy task to in-progress plus one deterministic blocker", () => {
    const plan = planUserTaskBackfill({
      tasks: [
        legacyTask({
          status: "blocked",
          events: [
            {
              actorUserId: "user_owner",
              message: "等待安全评审",
              createdAt: new Date("2026-07-20T02:00:00.000Z"),
            },
          ],
        }),
      ],
    });

    expect(plan.tasks[0]).toEqual(
      expect.objectContaining({ statusCategory: "in_progress" }),
    );
    expect(plan.blockers).toEqual([
      {
        id: "task-blocker:legacy:task_1",
        taskId: "task_1",
        reason: "等待安全评审",
        status: "active",
        createdById: "user_owner",
        createdAt: new Date("2026-07-20T02:00:00.000Z"),
      },
    ]);
  });

  it("keeps meaningful task titles and uses the earliest user event as creator fallback", () => {
    const plan = planUserTaskBackfill({
      tasks: [
        legacyTask({
          title: "修复 OAuth 回调循环",
          workflowInstance: { id: "workflow_1", title: "登录改造", createdById: null },
          events: [
            { actorUserId: "user_later", message: null, createdAt: new Date("2026-07-20T03:00:00.000Z") },
            { actorUserId: "user_first", message: null, createdAt: new Date("2026-07-20T01:00:00.000Z") },
          ],
        }),
      ],
    });

    expect(plan.tasks[0]).toEqual(
      expect.objectContaining({
        title: "修复 OAuth 回调循环",
        createdById: "user_first",
      }),
    );
  });

  it("skips a fully migrated task without creating a duplicate blocker", () => {
    const plan = planUserTaskBackfill({
      tasks: [
        legacyTask({
          spaceId: "space_company",
          createdById: "user_creator",
          statusCategory: "in_progress",
          visibility: "project",
          contentMarkdown: "确认登录改造范围",
          acceptanceMode: "none",
          blockers: [{ id: "task-blocker:legacy:task_1" }],
          status: "blocked",
        }),
      ],
    });

    expect(plan.tasks).toEqual([]);
    expect(plan.blockers).toEqual([]);
    expect(plan.skipped).toBe(1);
  });

  it("reports missing space and creator provenance instead of guessing", () => {
    const plan = planUserTaskBackfill({
      tasks: [
        legacyTask({
          project: { id: "project_1", space: null },
          workflowInstance: { id: "workflow_1", title: "登录改造", createdById: null },
          events: [],
        }),
      ],
    });

    expect(plan.tasks).toEqual([]);
    expect(plan.errors).toEqual([
      { taskId: "task_1", code: "missing_space" },
      { taskId: "task_1", code: "missing_creator" },
    ]);
  });

  it.each([
    ["ready", "todo"],
    ["follow_up", "todo"],
    ["active", "in_progress"],
    ["running", "in_progress"],
    ["interrupted", "in_progress"],
    ["verifying", "in_review"],
    ["waiting_approval", "in_review"],
    ["completed", "completed"],
    ["cancelled", "cancelled"],
  ])("maps legacy status %s to %s", (status, category) => {
    const plan = planUserTaskBackfill({ tasks: [legacyTask({ status })] });

    expect(plan.tasks[0]?.statusCategory).toBe(category);
  });
});
