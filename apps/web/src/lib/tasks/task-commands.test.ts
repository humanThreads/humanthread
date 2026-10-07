import { describe, expect, it, vi } from "vitest";
import {
  acceptUserTask,
  addUserTaskBlocker,
  addUserTaskComment,
  addUserTaskLabel,
  addUserTaskMember,
  createUserTaskReminder,
  archiveUserTask,
  assignUserTask,
  changeUserTaskStatus,
  createUserTask,
  dispatchUserTaskToAgent,
  rejectUserTask,
  resolveUserTaskBlocker,
  removeUserTaskLabel,
  removeUserTaskReminder,
  restoreUserTask,
  submitUserTaskForReview,
  updateUserTaskContent,
  updateUserTaskFields,
  updateUserTaskSchedule,
} from "./task-commands";

function baseDependencies() {
  const taskWorkflowLinkCreate = vi.fn().mockResolvedValue({});
  return {
    loadActor: vi.fn().mockResolvedValue({ userId: "user_1", teamId: "team_1" }),
    loadSpace: vi.fn().mockResolvedValue({ id: "space_1", type: "personal", ownerUserId: "user_1", companyId: null }),
    loadProject: vi.fn().mockResolvedValue({ id: "project_1", spaceId: "space_1" }),
    loadProjectTaskFields: vi.fn().mockResolvedValue([]),
    loadProjectLoopBinding: vi.fn(),
    loadAgentProfile: vi.fn().mockResolvedValue({ id: "agent_profile_1", spaceId: "space_1", status: "active" }),
    isSpaceMember: vi.fn().mockResolvedValue(true),
    loadTask: vi.fn().mockResolvedValue({
      id: "task_1",
      spaceId: "space_1",
      projectId: "project_1",
      createdById: "user_1",
      assigneeUserId: "user_1",
      status: "todo",
      version: 1,
      acceptanceMode: "none",
      isBlocked: false,
    }),
    loadAcceptanceReadiness: vi.fn().mockResolvedValue({
      ready: false,
      requiredChecks: ["delivery"],
      missingChecks: ["delivery"],
      blockingChecks: [],
      policyErrors: [],
      latestEvidence: [],
    }),
    authorize: vi.fn().mockResolvedValue({ allowed: true, role: "assignee" }),
    execute: vi.fn().mockImplementation(async (input) => {
      const applied = await input.persist({ task: {
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      taskFieldValue: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      taskMember: {
        upsert: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      taskBlocker: {
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      taskWorkflowLink: { create: taskWorkflowLinkCreate },
      taskComment: { create: vi.fn().mockResolvedValue({}) },
      taskReminder: {
        create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      taskLabel: { findUnique: vi.fn().mockResolvedValue({ id: "label_1", spaceId: "space_1" }) },
      taskLabelAssignment: {
        upsert: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      } });
      return applied.result;
    }),
    taskWorkflowLinkCreate,
  };
}

describe("user task command service", () => {
  it("creates a title-only personal task without a Project or Workflow", async () => {
    const dependencies = baseDependencies();

    await expect(createUserTask({
      actor: { type: "user", id: "user_1" },
      commandId: "command_create",
      correlationId: "correlation_create",
      payload: { spaceId: "space_1", title: "整理登录验收项" },
    }, dependencies)).resolves.toMatchObject({
      taskId: "task:space_1:command_create",
      statusCategory: "todo",
      version: 1,
    });
    expect(dependencies.loadSpace).toHaveBeenCalledWith({ spaceId: "space_1" });
    expect(dependencies.execute).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task:space_1:command_create",
      eventType: "task.created",
    }));
    expect(dependencies.taskWorkflowLinkCreate).not.toHaveBeenCalled();
  });

  it("creates a recurring project Task with an enabled Loop binding", async () => {
    const dependencies = baseDependencies();
    dependencies.loadProjectLoopBinding.mockResolvedValue({ id: "binding_task", projectId: "project_1", bindingRole: "task_development", status: "enabled" });
    await expect(createUserTask({
      actor: { type: "user", id: "user_1" }, commandId: "command_create_schedule_loop", correlationId: "correlation_create_schedule_loop",
      payload: { spaceId: "space_1", projectId: "project_1", title: "每周巡检", recurrenceRule: "0 9 * * 1", loopBinding: { bindingId: "binding_task", bindingType: "task" } },
    }, dependencies)).resolves.toMatchObject({ taskId: expect.any(String), version: 1 });
    expect(dependencies.loadProjectLoopBinding).toHaveBeenCalledWith({ projectId: "project_1", bindingId: "binding_task", bindingType: "task" });
  });

  it("allocates a Project short id and persists typed custom fields", async () => {
    const dependencies = baseDependencies();
    dependencies.loadSpace.mockResolvedValue({ id: "space_company", type: "company", ownerUserId: null, companyId: "company_1" });
    dependencies.loadProject.mockResolvedValue({ id: "project_1", spaceId: "space_company", shortCode: "HT" });
    dependencies.loadProjectTaskFields = vi.fn().mockResolvedValue([{
      id: "field_owner", projectId: "project_1", key: "owner", name: "负责人", type: "user", required: true, options: null, sortOrder: 0, isActive: true,
    }]);
    const projectUpdate = vi.fn().mockResolvedValue({ id: "project_1", shortCode: "HT", nextTaskNumber: 100002 });
    const taskCreate = vi.fn().mockResolvedValue({});
    const fieldCreateMany = vi.fn().mockResolvedValue({ count: 1 });
    dependencies.execute.mockImplementationOnce(async (input) => {
      const applied = await input.persist({
        project: { update: projectUpdate },
        task: { create: taskCreate, updateMany: vi.fn() },
        taskFieldValue: { createMany: fieldCreateMany, deleteMany: vi.fn() },
      } as never);
      return applied.result;
    });

    await expect(createUserTask({
      actor: { type: "user", id: "user_1" },
      commandId: "command_project_identity",
      correlationId: "correlation_project_identity",
      payload: { spaceId: "space_company", projectId: "project_1", title: "整理项目字段", customFields: { owner: "user_2" } },
    }, dependencies)).resolves.toMatchObject({ taskNumber: 100001, shortId: "HT100001" });
    expect(projectUpdate).toHaveBeenCalled();
    expect(taskCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ taskNumber: 100001, shortId: "HT100001" }) }));
    expect(fieldCreateMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ fieldDefinitionId: "field_owner", userValue: "user_2" })] }));
  });

  it("rejects automated Task creation without an explicit valid acceptance policy", async () => {
    const dependencies = baseDependencies();

    await expect(createUserTask({
      actor: { type: "user", id: "user_1" },
      commandId: "command_create_automated_without_checks",
      correlationId: "correlation_create_automated_without_checks",
      payload: {
        spaceId: "space_1",
        projectId: "project_1",
        title: "Automated delivery",
        acceptanceMode: "automated",
      },
    }, dependencies)).rejects.toMatchObject({ code: "validation_failed" });
    expect(dependencies.execute).not.toHaveBeenCalled();
  });

  it("rejects automated Task creation outside a Project", async () => {
    const dependencies = baseDependencies();

    await expect(createUserTask({
      actor: { type: "user", id: "user_1" },
      commandId: "command_create_automated_without_project",
      correlationId: "correlation_create_automated_without_project",
      payload: {
        spaceId: "space_1",
        title: "Automated delivery",
        acceptanceMode: "automated",
        acceptancePolicy: { requiredChecks: ["delivery"] },
      },
    }, dependencies)).rejects.toMatchObject({ code: "validation_failed" });
    expect(dependencies.execute).not.toHaveBeenCalled();
  });

  it("keeps deterministic Task ids within the database column limit", async () => {
    const dependencies = baseDependencies();
    const spaceId = `space_${"s".repeat(90)}`;
    dependencies.loadSpace.mockResolvedValue({
      id: spaceId,
      type: "personal",
      ownerUserId: "user_1",
      companyId: null,
    });

    const result = await createUserTask({
      actor: { type: "user", id: "user_1" },
      commandId: `command_${"c".repeat(100)}`,
      correlationId: "correlation_long_id",
      payload: { spaceId, title: "Long identifier task" },
    }, dependencies);

    expect(result.taskId).toMatch(/^task:/u);
    expect(result.taskId.length).toBeLessThanOrEqual(96);
  });

  it("keeps relation and activity ids within their database limits", async () => {
    const dependencies = baseDependencies();
    const commandId = `command_${"c".repeat(120)}`;
    await addUserTaskComment({
      actor: { type: "user", id: "user_1" }, commandId, correlationId: "correlation_long_relation",
      taskId: "task_1", expectedVersion: 1, contentMarkdown: "proof",
    }, dependencies);
    const execution = dependencies.execute.mock.calls[0]?.[0];
    const persisted = await execution.persist({
      task: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      taskComment: { create: vi.fn().mockResolvedValue({}) },
    });
    expect(persisted.result.commentId.length).toBeLessThanOrEqual(96);
    expect(execution.activity.id.length).toBeLessThanOrEqual(128);
  });

  it("defaults company task visibility from project context", async () => {
    const dependencies = baseDependencies();
    dependencies.loadSpace.mockResolvedValue({ id: "space_company", type: "company", ownerUserId: null, companyId: "company_1" });
    dependencies.loadProject.mockResolvedValue({ id: "project_1", spaceId: "space_company" });
    const result = await createUserTask({
      actor: { type: "user", id: "user_1" },
      commandId: "command_company",
      correlationId: "correlation_company",
      payload: { spaceId: "space_company", projectId: "project_1", title: "补充部署说明" },
    }, dependencies);

    expect(result.visibility).toBe("project");
  });

  it("rejects a Project that belongs to another Space", async () => {
    const dependencies = baseDependencies();
    dependencies.loadProject.mockResolvedValue({ id: "project_1", spaceId: "space_other" });

    await expect(createUserTask({
      actor: { type: "user", id: "user_1" },
      commandId: "command_mismatch",
      correlationId: "correlation_mismatch",
      payload: {
        spaceId: "space_1",
        projectId: "project_1",
        title: "Invalid project task",
      },
    }, dependencies)).rejects.toMatchObject({ code: "validation_failed" });
    expect(dependencies.execute).not.toHaveBeenCalled();
  });

  it("rejects an initial assignee outside the Task Space", async () => {
    const dependencies = baseDependencies();
    dependencies.isSpaceMember.mockResolvedValue(false);

    await expect(createUserTask({
      actor: { type: "user", id: "user_1" },
      commandId: "command_external_assignee",
      correlationId: "correlation_external_assignee",
      payload: {
        spaceId: "space_1",
        title: "Invalid assignment",
        assigneeUserId: "user_external",
      },
    }, dependencies)).rejects.toMatchObject({ code: "validation_failed" });
    expect(dependencies.execute).not.toHaveBeenCalled();
  });

  it("creates an independent Workflow link only for explicit linkage", async () => {
    const dependencies = baseDependencies();

    await createUserTask({
      actor: { type: "user", id: "user_1" },
      commandId: "command_workflow_link",
      correlationId: "correlation_workflow_link",
      payload: {
        spaceId: "space_1",
        projectId: "project_1",
        title: "Linked task",
        workflowInstanceId: "workflow_1",
        stepTemplateId: "step_1",
      },
    }, dependencies);

    expect(dependencies.taskWorkflowLinkCreate).toHaveBeenCalledWith({
      data: {
        id: "workflow-link:command_workflow_link",
        taskId: "task:space_1:command_workflow_link",
        workflowInstanceId: "workflow_1",
        stepTemplateId: "step_1",
      },
    });
  });

  it("updates Markdown content without putting the content in event payload", async () => {
    const dependencies = baseDependencies();
    await expect(updateUserTaskContent({
      actor: { type: "user", id: "user_1" },
      commandId: "command_content",
      correlationId: "correlation_content",
      taskId: "task_1",
      expectedVersion: 1,
      contentMarkdown: "# 新验收标准",
    }, dependencies)).resolves.toMatchObject({ taskId: "task_1", version: 2 });

    const call = dependencies.execute.mock.calls[0]?.[0];
    expect(call.eventPayload).toEqual({ contentLength: "# 新验收标准".length });
    expect(call.eventPayload).not.toHaveProperty("contentMarkdown");
  });

  it("uses the user state machine and rejects a direct Agent completion", async () => {
    const dependencies = baseDependencies();
    dependencies.loadTask.mockResolvedValue({
      ...await dependencies.loadTask(),
      status: "in_progress",
      acceptanceMode: "none",
    });
    dependencies.authorize.mockResolvedValue({ allowed: true, role: "assignee" });

    await expect(changeUserTaskStatus({
      actor: { type: "agent", id: "agent_1", runId: "run_1" },
      commandId: "command_agent_complete",
      correlationId: "correlation_agent_complete",
      taskId: "task_1",
      expectedVersion: 1,
      command: "complete",
    }, dependencies)).rejects.toMatchObject({ code: "task_actor_cannot_complete" });
    expect(dependencies.execute).not.toHaveBeenCalled();
  });

  it("records provider candidate evidence on the review transition without exposing raw payload", async () => {
    const dependencies = baseDependencies();
    dependencies.loadTask.mockResolvedValue({
      ...await dependencies.loadTask(),
      status: "in_progress",
      acceptanceMode: "none",
      version: 7,
    });

    await changeUserTaskStatus({
      actor: { type: "user", id: "user_1" },
      commandId: "cli-candidate:task_1:7",
      correlationId: "legacy-task:task_1",
      taskId: "task_1",
      expectedVersion: 7,
      command: "submit_for_review",
      reason: "Tests and build passed",
      activity: {
        type: "cli_candidate_submitted",
        message: "Tests and build passed",
        payload: { exitCode: 0, durationSeconds: 300 },
      },
    }, dependencies);

    expect(dependencies.execute).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "task.submit_for_review",
      activity: expect.objectContaining({
        type: "cli_candidate_submitted",
        message: "Tests and build passed",
        payload: { exitCode: 0, durationSeconds: 300 },
      }),
    }));
  });

  it("assigns a Space member and adds a participant through versioned commands", async () => {
    const dependencies = baseDependencies();

    await expect(assignUserTask({
      actor: { type: "user", id: "user_1" },
      commandId: "command_assign",
      correlationId: "correlation_assign",
      taskId: "task_1",
      expectedVersion: 1,
      assigneeUserId: "user_2",
    }, dependencies)).resolves.toMatchObject({ assigneeUserId: "user_2", version: 2 });

    await expect(addUserTaskMember({
      actor: { type: "user", id: "user_1" },
      commandId: "command_participant",
      correlationId: "correlation_participant",
      taskId: "task_1",
      expectedVersion: 1,
      userId: "user_2",
      role: "participant",
    }, dependencies)).resolves.toMatchObject({ userId: "user_2", role: "participant", version: 2 });
    expect(dependencies.isSpaceMember).toHaveBeenCalledWith({ spaceId: "space_1", userId: "user_2" });
  });

  it("updates user-facing priority and project fields through one versioned command", async () => {
    const dependencies = baseDependencies();
    await expect(updateUserTaskFields({
      actor: { type: "user", id: "user_1" }, commandId: "command_fields", correlationId: "correlation_fields",
      taskId: "task_1", expectedVersion: 1, priority: 3, projectId: "project_1",
    }, dependencies)).resolves.toMatchObject({ taskId: "task_1", priority: 3, projectId: "project_1", version: 2 });
    expect(dependencies.loadProject).toHaveBeenCalledWith({ projectId: "project_1" });
  });

  it("updates a trimmed user-facing Task title through the same field command", async () => {
    const dependencies = baseDependencies();
    await expect(updateUserTaskFields({
      actor: { type: "user", id: "user_1" }, commandId: "command_title", correlationId: "correlation_title",
      taskId: "task_1", expectedVersion: 1, title: "  发布内部版本  ",
    }, dependencies)).resolves.toMatchObject({ taskId: "task_1", title: "发布内部版本", version: 2 });
  });

  it("updates Task schedule through the versioned command boundary", async () => {
    const dependencies = baseDependencies();
    await expect(updateUserTaskSchedule({
      actor: { type: "user", id: "user_1" }, commandId: "command_schedule", correlationId: "correlation_schedule",
      taskId: "task_1", expectedVersion: 1, startAt: null, dueAt: new Date("2026-07-25T09:00:00.000Z"),
    }, dependencies)).resolves.toMatchObject({ taskId: "task_1", version: 2 });
    expect(dependencies.authorize).toHaveBeenCalledWith(expect.objectContaining({ action: "edit_content" }));
  });

  it("binds a recurring Task to an enabled project Task Loop", async () => {
    const dependencies = baseDependencies();
    dependencies.loadProjectLoopBinding = vi.fn().mockResolvedValue({
      id: "binding_task", projectId: "project_1", bindingRole: "task_development", status: "enabled",
    });
    await expect(updateUserTaskSchedule({
      actor: { type: "user", id: "user_1" }, commandId: "command_schedule_loop", correlationId: "correlation_schedule_loop",
      taskId: "task_1", expectedVersion: 1, recurrenceRule: "0 9 * * 1", loopBinding: { bindingId: "binding_task", bindingType: "task" },
    }, dependencies)).resolves.toMatchObject({ taskId: "task_1", recurrenceRule: "0 9 * * 1", version: 2 });
    expect(dependencies.loadProjectLoopBinding).toHaveBeenCalledWith({ projectId: "project_1", bindingId: "binding_task", bindingType: "task" });
  });

  it("binds a recurring Task to an enabled project Loop", async () => {
    const dependencies = baseDependencies();
    dependencies.loadProjectLoopBinding = vi.fn().mockResolvedValue({
      id: "binding_project", projectId: "project_1", bindingRole: "milestone_release", status: "enabled",
    });
    await expect(updateUserTaskSchedule({
      actor: { type: "user", id: "user_1" }, commandId: "command_schedule_project_loop", correlationId: "correlation_schedule_project_loop",
      taskId: "task_1", expectedVersion: 1, recurrenceRule: "0 10 1 * *", loopBinding: { bindingId: "binding_project", bindingType: "project" },
    }, dependencies)).resolves.toMatchObject({ loopBinding: { bindingId: "binding_project", bindingType: "project" }, version: 2 });
  });

  it("rejects a recurring Task binding to a disabled or unrelated Loop", async () => {
    const dependencies = baseDependencies();
    dependencies.loadProjectLoopBinding = vi.fn().mockResolvedValue(null);
    await expect(updateUserTaskSchedule({
      actor: { type: "user", id: "user_1" }, commandId: "command_schedule_invalid_loop", correlationId: "correlation_schedule_invalid_loop",
      taskId: "task_1", expectedVersion: 1, recurrenceRule: "0 9 * * 1", loopBinding: { bindingId: "binding_other", bindingType: "task" },
    }, dependencies)).rejects.toMatchObject({ code: "validation_failed" });
    expect(dependencies.execute).not.toHaveBeenCalled();
  });

  it("clears a recurring Loop binding while retaining schedule updates", async () => {
    const dependencies = baseDependencies();
    await expect(updateUserTaskSchedule({
      actor: { type: "user", id: "user_1" }, commandId: "command_clear_loop", correlationId: "correlation_clear_loop",
      taskId: "task_1", expectedVersion: 1, recurrenceRule: null, loopBinding: null,
    }, dependencies)).resolves.toMatchObject({ recurrenceRule: null, loopBinding: null, version: 2 });
  });

  it("adds and resolves a blocker without replacing the lifecycle status", async () => {
    const dependencies = baseDependencies();

    await expect(addUserTaskBlocker({
      actor: { type: "user", id: "user_1" },
      commandId: "command_block",
      correlationId: "correlation_block",
      taskId: "task_1",
      expectedVersion: 1,
      reason: "等待安全审批",
    }, dependencies)).resolves.toMatchObject({ blockerId: "blocker:command_block", version: 2 });

    await expect(resolveUserTaskBlocker({
      actor: { type: "user", id: "user_1" },
      commandId: "command_unblock",
      correlationId: "correlation_unblock",
      taskId: "task_1",
      blockerId: "blocker:command_block",
      expectedVersion: 1,
    }, dependencies)).resolves.toMatchObject({ blockerId: "blocker:command_block", version: 2 });
  });

  it("submits, accepts, and rejects controlled work through the state machine", async () => {
    const dependencies = baseDependencies();
    dependencies.loadTask.mockResolvedValue({
      ...await dependencies.loadTask(),
      status: "in_progress",
      acceptanceMode: "human",
    });

    await expect(submitUserTaskForReview({
      actor: { type: "user", id: "user_1" },
      commandId: "command_review",
      correlationId: "correlation_review",
      taskId: "task_1",
      expectedVersion: 1,
    }, dependencies)).resolves.toMatchObject({ statusCategory: "in_review" });

    dependencies.loadTask.mockResolvedValue({
      ...await dependencies.loadTask(),
      status: "in_review",
    });
    await expect(acceptUserTask({
      actor: { type: "user", id: "user_1" },
      commandId: "command_accept",
      correlationId: "correlation_accept",
      taskId: "task_1",
      expectedVersion: 1,
    }, dependencies)).resolves.toMatchObject({ statusCategory: "completed" });
    await expect(rejectUserTask({
      actor: { type: "user", id: "user_1" },
      commandId: "command_reject",
      correlationId: "correlation_reject",
      taskId: "task_1",
      expectedVersion: 1,
      reason: "验收证据不完整",
    }, dependencies)).resolves.toMatchObject({ statusCategory: "in_progress" });
  });

  it("accepts automated work only after loading durable passing evidence", async () => {
    const dependencies = baseDependencies();
    dependencies.loadTask.mockResolvedValue({
      ...await dependencies.loadTask(),
      status: "in_review",
      acceptanceMode: "automated",
    });
    dependencies.loadAcceptanceReadiness.mockResolvedValue({
      ready: true,
      requiredChecks: ["delivery"],
      missingChecks: [],
      blockingChecks: [],
      policyErrors: [],
      latestEvidence: [{
        id: "evidence_delivery",
        checkKey: "delivery",
        status: "passed",
        summary: "Release verified",
        source: "mcp",
        finishedAt: "2026-08-01T09:00:00.000Z",
      }],
    });

    await expect(acceptUserTask({
      actor: { type: "user", id: "user_1" },
      commandId: "command_accept_automated",
      correlationId: "correlation_accept_automated",
      taskId: "task_1",
      expectedVersion: 1,
    }, dependencies as never)).resolves.toMatchObject({ statusCategory: "completed" });
    expect(dependencies.loadAcceptanceReadiness).toHaveBeenCalledWith({ taskId: "task_1" });
  });

  it("rejects automated acceptance when durable evidence is incomplete", async () => {
    const dependencies = baseDependencies();
    dependencies.loadTask.mockResolvedValue({
      ...await dependencies.loadTask(),
      status: "in_review",
      acceptanceMode: "automated",
    });

    await expect(changeUserTaskStatus({
      actor: { type: "user", id: "user_1" },
      commandId: "command_accept_without_evidence",
      correlationId: "correlation_accept_without_evidence",
      taskId: "task_1",
      expectedVersion: 1,
      command: "accept",
      acceptancePassed: true,
    } as never, dependencies as never)).rejects.toMatchObject({
      code: "task_acceptance_evidence_required",
      missingChecks: ["delivery"],
      blockingChecks: [],
    });
    expect(dependencies.execute).not.toHaveBeenCalled();
  });

  it("requires durable evidence for hybrid acceptance but not human acceptance", async () => {
    const hybrid = baseDependencies();
    hybrid.loadTask.mockResolvedValue({
      ...await hybrid.loadTask(),
      status: "in_review",
      acceptanceMode: "hybrid",
    });
    await expect(acceptUserTask({
      actor: { type: "user", id: "user_1" },
      commandId: "command_accept_hybrid",
      correlationId: "correlation_accept_hybrid",
      taskId: "task_1",
      expectedVersion: 1,
    }, hybrid as never)).rejects.toMatchObject({ code: "task_acceptance_evidence_required" });

    const human = baseDependencies();
    human.loadTask.mockResolvedValue({
      ...await human.loadTask(),
      status: "in_review",
      acceptanceMode: "human",
    });
    await expect(acceptUserTask({
      actor: { type: "user", id: "user_1" },
      commandId: "command_accept_human",
      correlationId: "correlation_accept_human",
      taskId: "task_1",
      expectedVersion: 1,
    }, human as never)).resolves.toMatchObject({ statusCategory: "completed" });
    expect(human.loadAcceptanceReadiness).not.toHaveBeenCalled();
  });

  it("archives and restores independently from business completion", async () => {
    const dependencies = baseDependencies();

    await expect(archiveUserTask({
      actor: { type: "user", id: "user_1" },
      commandId: "command_archive",
      correlationId: "correlation_archive",
      taskId: "task_1",
      expectedVersion: 1,
    }, dependencies)).resolves.toMatchObject({ archived: true, version: 2 });
    await expect(restoreUserTask({
      actor: { type: "user", id: "user_1" },
      commandId: "command_restore",
      correlationId: "correlation_restore",
      taskId: "task_1",
      expectedVersion: 1,
    }, dependencies)).resolves.toMatchObject({ archived: false, version: 2 });
  });

  it("requests Agent dispatch as a candidate execution relationship", async () => {
    const dependencies = baseDependencies();

    await expect(dispatchUserTaskToAgent({
      actor: { type: "user", id: "user_1" },
      commandId: "command_dispatch",
      correlationId: "correlation_dispatch",
      taskId: "task_1",
      expectedVersion: 1,
      agentProfileId: "agent_profile_1",
    }, dependencies)).resolves.toMatchObject({
      taskId: "task_1",
      version: 2,
      executionRelationship: {
        type: "agent_dispatch_candidate",
        id: "dispatch:command_dispatch",
        agentProfileId: "agent_profile_1",
      },
    });
    expect(dependencies.execute).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "task.agent_dispatch_requested",
    }));
  });

  it("rejects Agent dispatch across Space ownership boundaries", async () => {
    const dependencies = baseDependencies();
    dependencies.loadAgentProfile.mockResolvedValue({ id: "agent_other", spaceId: "space_other", status: "active" });
    await expect(dispatchUserTaskToAgent({
      actor: { type: "user", id: "user_1" }, commandId: "command_cross_space", correlationId: "correlation_cross_space",
      taskId: "task_1", expectedVersion: 1, agentProfileId: "agent_other",
    }, dependencies)).rejects.toMatchObject({ code: "validation_failed" });
    expect(dependencies.execute).not.toHaveBeenCalled();
  });

  it("adds a Markdown comment through Task comment authorization", async () => {
    const dependencies = baseDependencies();
    await expect(addUserTaskComment({
      actor: { type: "user", id: "user_1" },
      commandId: "command_comment",
      correlationId: "correlation_comment",
      taskId: "task_1",
      expectedVersion: 1,
      contentMarkdown: "**已验证** 登录流程",
    }, dependencies)).resolves.toMatchObject({ commentId: "comment:command_comment", version: 2 });
    expect(dependencies.authorize).toHaveBeenCalledWith(expect.objectContaining({ action: "comment" }));
  });

  it("creates and removes only the actor's reminder", async () => {
    const dependencies = baseDependencies();
    await expect(createUserTaskReminder({
      actor: { type: "user", id: "user_1" },
      commandId: "command_reminder",
      correlationId: "correlation_reminder",
      taskId: "task_1",
      expectedVersion: 1,
      remindAt: new Date("2026-07-24T01:00:00.000Z"),
    }, dependencies)).resolves.toMatchObject({ reminderId: "reminder:command_reminder", version: 2 });
    await expect(removeUserTaskReminder({
      actor: { type: "user", id: "user_1" },
      commandId: "command_reminder_remove",
      correlationId: "correlation_reminder_remove",
      taskId: "task_1",
      reminderId: "reminder:command_reminder",
      expectedVersion: 1,
    }, dependencies)).resolves.toMatchObject({ reminderId: "reminder:command_reminder", version: 2 });
  });

  it("assigns only a label from the Task Space", async () => {
    const dependencies = baseDependencies();
    await expect(addUserTaskLabel({
      actor: { type: "user", id: "user_1" },
      commandId: "command_label",
      correlationId: "correlation_label",
      taskId: "task_1",
      labelId: "label_1",
      expectedVersion: 1,
    }, dependencies)).resolves.toMatchObject({ labelId: "label_1", version: 2 });
    await expect(removeUserTaskLabel({
      actor: { type: "user", id: "user_1" },
      commandId: "command_label_remove",
      correlationId: "correlation_label_remove",
      taskId: "task_1",
      labelId: "label_1",
      expectedVersion: 1,
    }, dependencies)).resolves.toMatchObject({ labelId: "label_1", version: 2 });
  });
});
