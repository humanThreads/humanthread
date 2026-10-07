import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { activateProject, archiveProject, completeProject, createTask, submitProjectPlan } from "./project-commands";

describe("project orchestration commands", () => {
  it("forwards the whole transaction delegate so the event appender keeps working", () => {
    // Regression: the delegate used to hand-pick models, and
    // `appendOrchestrationEvents` upserts `orchestrationAggregateSequence`.
    // Missing it made every lifecycle command fail *after* the project row was
    // already written, surfacing as the generic "Project lifecycle change
    // failed". Forwarding the transaction avoids that class of omission.
    const source = readFileSync(new URL("./project-commands.ts", import.meta.url), "utf8");
    expect(source).toContain("callback(tx as never)");
    expect(source).not.toContain("commandReceipt: tx.commandReceipt");
  });


  it("completes a draft project after the closer explicitly accepts open milestones", () => {
    const execute = vi.fn(async ({ result }) => result);

    return completeProject({
      projectId: "project_1",
      actor: { type: "user", id: "user_owner" },
      commandId: "cmd_complete_1",
      correlationId: "project:project_1",
      expectedVersion: 7,
      force: true,
      reason: "阶段目标已达成，剩余里程碑转后续项目",
    }, {
      authorize: vi.fn().mockResolvedValue(undefined),
      loadProject: vi.fn().mockResolvedValue({ id: "project_1", status: "draft", version: 7 }),
      listMilestones: vi.fn().mockResolvedValue([{ id: "m1", status: "planned" }]),
      execute,
    } as never).then((result) => {
      expect(result).toMatchObject({ status: "completed" });
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({
        eventType: "project.completed",
        payload: expect.objectContaining({ forced: true, reason: "阶段目标已达成，剩余里程碑转后续项目" }),
      }));
    });
  });

  it("refuses to complete while required milestones are open unless forced", async () => {
    const dependencies = {
      authorize: vi.fn().mockResolvedValue(undefined),
      loadProject: vi.fn().mockResolvedValue({ id: "project_1", status: "active", version: 3 }),
      listMilestones: vi.fn().mockResolvedValue([{ id: "m1", status: "active" }, { id: "m2", status: "completed" }]),
      execute: vi.fn(),
    };

    await expect(completeProject({
      projectId: "project_1",
      actor: { type: "user", id: "user_owner" },
      commandId: "cmd_complete_2",
      correlationId: "project:project_1",
      expectedVersion: 3,
    }, dependencies as never)).rejects.toMatchObject({ code: "validation_failed" });
    expect(dependencies.execute).not.toHaveBeenCalled();
  });

  it("refuses a forced completion without a reason", async () => {
    const dependencies = {
      authorize: vi.fn().mockResolvedValue(undefined),
      loadProject: vi.fn().mockResolvedValue({ id: "project_1", status: "active", version: 3 }),
      listMilestones: vi.fn().mockResolvedValue([{ id: "m1", status: "active" }]),
      execute: vi.fn(),
    };

    await expect(completeProject({
      projectId: "project_1",
      actor: { type: "user", id: "user_owner" },
      commandId: "cmd_complete_3",
      correlationId: "project:project_1",
      expectedVersion: 3,
      force: true,
    }, dependencies as never)).rejects.toMatchObject({ code: "validation_failed" });
    expect(dependencies.execute).not.toHaveBeenCalled();
  });

  it("treats cancelled milestones as resolved instead of open work", async () => {
    const execute = vi.fn(async ({ result }) => result);

    await expect(completeProject({
      projectId: "project_1",
      actor: { type: "user", id: "user_owner" },
      commandId: "cmd_complete_4",
      correlationId: "project:project_1",
      expectedVersion: 5,
    }, {
      authorize: vi.fn().mockResolvedValue(undefined),
      loadProject: vi.fn().mockResolvedValue({ id: "project_1", status: "active", version: 5 }),
      listMilestones: vi.fn().mockResolvedValue([
        { id: "m1", status: "completed" },
        { id: "m2", status: "cancelled" },
      ]),
      execute,
    } as never)).resolves.toMatchObject({ status: "completed" });

    // Cancelled scope is resolved scope: it must not force a reason out of the
    // person closing the project.
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ forced: false, openMilestoneCount: 0 }),
    }));
  });

  it("archives a completed project", async () => {
    const execute = vi.fn(async ({ result }) => result);

    await expect(archiveProject({
      projectId: "project_1",
      actor: { type: "user", id: "user_owner" },
      commandId: "cmd_archive_1",
      correlationId: "project:project_1",
      expectedVersion: 9,
    }, {
      authorize: vi.fn().mockResolvedValue(undefined),
      loadProject: vi.fn().mockResolvedValue({ id: "project_1", status: "completed", version: 9 }),
      listMilestones: vi.fn().mockResolvedValue([]),
      execute,
    } as never)).resolves.toMatchObject({ status: "archived" });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ eventType: "project.archived" }));
  });

  it("rejects activating a project whose plan has no required milestone", async () => {
    await expect(activateProject({
      projectId: "project_1",
      actor: { type: "user", id: "user_owner" },
      commandId: "cmd_1",
      correlationId: "project:project_1",
      expectedVersion: 2,
    }, {
      authorize: vi.fn().mockResolvedValue(undefined),
      loadProject: vi.fn().mockResolvedValue({ id: "project_1", status: "planned", version: 2 }),
      listMilestones: vi.fn().mockResolvedValue([]),
      execute: vi.fn(),
    })).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("submits a complete project plan through the idempotent executor", async () => {
    const execute = vi.fn(async ({ result }) => result);

    await expect(submitProjectPlan({
      projectId: "project_1",
      actor: { type: "user", id: "user_owner" },
      commandId: "cmd_2",
      correlationId: "project:project_1",
      expectedVersion: 1,
      payload: {
        objective: "Deliver orchestration",
        stages: [{ key: "delivery", name: "Delivery", milestones: [{ name: "MVP" }] }],
      },
    }, {
      authorize: vi.fn().mockResolvedValue(undefined),
      loadProject: vi.fn().mockResolvedValue({ id: "project_1", status: "draft", version: 1 }),
      listMilestones: vi.fn(),
      execute,
    })).resolves.toMatchObject({ projectId: "project_1", status: "planned", version: 2 });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      commandId: "cmd_2",
      actor: { type: "user", id: "user_owner" },
      eventType: "project.plan_submitted",
    }));
  });

  it("creates a project Agent task through the unified user task service", async () => {
    const createUserTask = vi.fn().mockResolvedValue({
      taskId: "task_1",
      statusCategory: "todo",
      visibility: "project",
      version: 1,
    });
    await expect(createTask({
      projectId: "project_1",
      actor: { type: "user", id: "user_owner" },
      commandId: "cmd_task_1",
      correlationId: "project:project_1",
      payload: {
        title: "Build lease kernel",
        objective: "Reject stale callbacks",
        milestoneId: "milestone_1",
        allowedPaths: ["packages/db/**"],
        requiredChecks: ["test", "typecheck"],
        maxAttempts: 4,
        timeoutMinutes: 60,
      },
    }, {
      loadProject: vi.fn().mockResolvedValue({ id: "project_1", spaceId: "space_company" }),
      createUserTask,
    })).resolves.toMatchObject({ taskId: "task_1", statusCategory: "todo" });
    expect(createUserTask).toHaveBeenCalledWith(expect.objectContaining({
      actor: { type: "user", id: "user_owner" },
      commandId: "cmd_task_1",
      payload: expect.objectContaining({
        spaceId: "space_company",
        projectId: "project_1",
        title: "Build lease kernel",
        contentMarkdown: "Reject stale callbacks",
        executionMode: "agent",
        acceptanceMode: "automated",
        scopePolicy: { allowedPaths: ["packages/db/**"] },
        acceptancePolicy: { requiredChecks: ["test", "typecheck"] },
        budgetPolicy: { maxAttempts: 4, timeoutMinutes: 60 },
      }),
    }));
  });

  it("rejects a project Agent task when any required acceptance check is malformed", async () => {
    const createUserTask = vi.fn();

    await expect(createTask({
      projectId: "project_1",
      actor: { type: "user", id: "user_owner" },
      commandId: "cmd_task_invalid_check",
      correlationId: "project:project_1",
      payload: {
        title: "Build lease kernel",
        objective: "Reject stale callbacks",
        allowedPaths: ["packages/db/**"],
        requiredChecks: ["test", "x".repeat(97)],
        maxAttempts: 4,
        timeoutMinutes: 60,
      },
    }, {
      loadProject: vi.fn().mockResolvedValue({ id: "project_1", spaceId: "space_company" }),
      createUserTask,
    })).rejects.toMatchObject({ code: "validation_failed" });
    expect(createUserTask).not.toHaveBeenCalled();
  });

  it("forwards legacy Workflow linkage only when explicitly supplied", async () => {
    const createUserTask = vi.fn().mockResolvedValue({ taskId: "task_1" });

    await createTask({
      projectId: "project_1",
      actor: { type: "user", id: "user_owner" },
      commandId: "cmd_task_linked",
      correlationId: "project:project_1",
      payload: {
        title: "Run linked automation",
        objective: "Keep the explicit Workflow relation",
        workflowInstanceId: "workflow_1",
        stepTemplateId: "step_1",
        allowedPaths: ["apps/web/**"],
        requiredChecks: ["test"],
        maxAttempts: 2,
        timeoutMinutes: 30,
      },
    }, {
      loadProject: vi.fn().mockResolvedValue({ id: "project_1", spaceId: "space_company" }),
      createUserTask,
    });

    expect(createUserTask).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        workflowInstanceId: "workflow_1",
        stepTemplateId: "step_1",
      }),
    }));
  });

  it("rejects project task creation when the Project has no migrated Space", async () => {
    const createUserTask = vi.fn();

    await expect(createTask({
      projectId: "project_legacy",
      actor: { type: "user", id: "user_owner" },
      commandId: "cmd_task_legacy",
      correlationId: "project:project_legacy",
      payload: {
        title: "Legacy project task",
        objective: "Must not create outside a Space",
        allowedPaths: ["apps/web/**"],
        requiredChecks: ["test"],
        maxAttempts: 2,
        timeoutMinutes: 30,
      },
    }, {
      loadProject: vi.fn().mockResolvedValue({ id: "project_legacy", spaceId: null }),
      createUserTask,
    })).rejects.toMatchObject({ code: "validation_failed" });
    expect(createUserTask).not.toHaveBeenCalled();
  });
});
