import { describe, expect, it, vi } from "vitest";
import { dispatchMcpTaskTool } from "./task-tools";

describe("MCP Task tools", () => {
  it("lists Tasks through the shared visibility-filtered read model", async () => {
    const getTaskCollection = vi.fn().mockResolvedValue({ listRows: [{ id: "task_1", title: "安全发布" }], total: 1 });
    const result = await dispatchMcpTaskTool({
      tool: "list_tasks",
      actorUserId: "user_1",
      arguments: { spaceId: "space_1", relation: "assigned", status: ["todo"] },
    }, { getTaskCollection });

    expect(result).toEqual({
      tasks: [{ id: "task_1", title: "安全发布" }],
      total: 1,
      keyGuide: expect.objectContaining({ taskId: "tasks[].id", expectedVersion: "tasks[].version", dueAt: "tasks[].dueAt" }),
    });
    expect(getTaskCollection).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_1", spaceId: "space_1" }));
  });

  it("forwards an exact business short id to the shared query", async () => {
    const getTaskCollection = vi.fn().mockResolvedValue({ listRows: [], total: 0 });
    await dispatchMcpTaskTool({
      tool: "list_tasks", actorUserId: "user_1",
      arguments: { shortId: "HT100001" },
    }, { getTaskCollection });
    expect(getTaskCollection).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ shortId: "HT100001" }) }));
  });

  it("hides inaccessible private Tasks", async () => {
    await expect(dispatchMcpTaskTool({
      tool: "get_task", actorUserId: "user_1", arguments: { taskId: "task_private" },
    }, { getTaskDetailView: vi.fn().mockResolvedValue(null) })).rejects.toMatchObject({ code: "task_not_found" });
  });

  it("points get_task callers to keys inside the returned task object", async () => {
    const detail = {
      task: {
        id: "task_1",
        shortId: "HT100001",
        version: 4,
        startAt: new Date("2026-08-18T01:00:00.000Z"),
        dueAt: new Date("2026-08-20T10:00:00.000Z"),
      },
      capabilities: { edit: true },
    };

    const result = await dispatchMcpTaskTool({
      tool: "get_task",
      actorUserId: "user_1",
      arguments: { taskId: "task_1" },
    }, { getTaskDetailView: vi.fn().mockResolvedValue(detail) } as never);

    expect(result).toEqual({
      detail,
      keyGuide: expect.objectContaining({
        taskId: "detail.task.id",
        shortId: "detail.task.shortId",
        expectedVersion: "detail.task.version",
        projectId: "detail.task.project.id",
        assigneeUserId: "detail.task.assignee.id",
        memberUserId: "detail.task.members[].user.id",
        blockerId: "detail.task.blockers[].id",
        reminderId: "detail.task.reminders[].id",
        labelId: "detail.task.labelAssignments[].label.id",
        commentId: "detail.task.comments[].id",
        attachmentId: "detail.task.attachments[].id",
        childTaskId: "detail.task.childTasks[].id",
        predecessorDependencyId: "detail.task.predecessorDependencies[].id",
        successorDependencyId: "detail.task.successorDependencies[].id",
        documentId: "detail.task.documentLinks[].document.id",
        agentRunId: "detail.task.agentRuns[].id",
        loopRunId: "detail.task.loopRuns[].id",
        startAt: "detail.task.startAt",
        dueAt: "detail.task.dueAt",
      }),
    });
  });

  it("creates and updates the same Markdown contract as Web", async () => {
    const createUserTask = vi.fn().mockResolvedValue({ taskId: "task_1", version: 1 });
    const updateUserTaskContent = vi.fn().mockResolvedValue({ taskId: "task_1", version: 2 });
    await dispatchMcpTaskTool({
      tool: "create_task", actorUserId: "user_1",
      arguments: { commandId: "cmd_create", spaceId: "space_1", title: "安全发布", contentMarkdown: "# 验收" },
    }, { createUserTask });
    await dispatchMcpTaskTool({
      tool: "update_task", actorUserId: "user_1",
      arguments: { commandId: "cmd_update", taskId: "task_1", expectedVersion: 1, contentMarkdown: "# 验收\n\n- [x] 完成" },
    }, { updateUserTaskContent });

    expect(createUserTask).toHaveBeenCalledWith(expect.objectContaining({
      actor: { type: "user", id: "user_1" }, payload: expect.objectContaining({ contentMarkdown: "# 验收" }),
    }));
    expect(updateUserTaskContent).toHaveBeenCalledWith(expect.objectContaining({ contentMarkdown: "# 验收\n\n- [x] 完成", expectedVersion: 1 }));
  });

  it("creates a Task with explicit schedule and roadmap linkage", async () => {
    const createUserTask = vi.fn().mockResolvedValue({ taskId: "task_1", version: 1 });
    await dispatchMcpTaskTool({
      tool: "create_task",
      actorUserId: "user_1",
      arguments: {
        commandId: "cmd_create_schedule",
        spaceId: "space_1",
        projectId: "project_1",
        milestoneId: "milestone_1",
        title: "发布客户端",
        priority: 2,
        startAt: "2026-08-18T01:00:00.000Z",
        dueAt: "2026-08-20T10:00:00.000Z",
      },
    } as never, { createUserTask });

    expect(createUserTask).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        milestoneId: "milestone_1",
        priority: 2,
        startAt: new Date("2026-08-18T01:00:00.000Z"),
        dueAt: new Date("2026-08-20T10:00:00.000Z"),
      }),
    }));
  });

  it("exposes dedicated cancellation and schedule mutations", async () => {
    const changeUserTaskStatus = vi.fn().mockResolvedValue({ taskId: "task_1", statusCategory: "cancelled", version: 5 });
    const updateUserTaskSchedule = vi.fn().mockResolvedValue({ taskId: "task_1", dueAt: null, version: 6 });
    await dispatchMcpTaskTool({
      tool: "cancel_task",
      actorUserId: "user_1",
      arguments: { commandId: "cmd_cancel", taskId: "task_1", expectedVersion: 4, reason: "需求撤销" },
    }, { changeUserTaskStatus });
    await dispatchMcpTaskTool({
      tool: "update_task_schedule",
      actorUserId: "user_1",
      arguments: { commandId: "cmd_due", taskId: "task_1", expectedVersion: 5, dueAt: null },
    }, { updateUserTaskSchedule });

    expect(changeUserTaskStatus).toHaveBeenCalledWith(expect.objectContaining({ command: "cancel", reason: "需求撤销" }));
    expect(updateUserTaskSchedule).toHaveBeenCalledWith(expect.objectContaining({ dueAt: null }));
  });

  it("accepts direct schedule fields and short IDs without requiring an internal command ID", async () => {
    const getTaskDetailView = vi.fn().mockResolvedValue({
      task: { id: "task_1", shortId: "HT100001", version: 7 },
      capabilities: { edit: true },
    });
    const updateUserTaskSchedule = vi.fn().mockResolvedValue({ taskId: "task_1", version: 8 });
    const changeUserTaskStatus = vi.fn().mockResolvedValue({ taskId: "task_1", statusCategory: "cancelled", version: 8 });

    await dispatchMcpTaskTool({
      tool: "update_task",
      actorUserId: "user_1",
      arguments: {
        shortId: "HT100001",
        expectedVersion: 7,
        dueAt: "2026-08-31T12:00:00.000Z",
      },
    } as never, { getTaskDetailView, updateUserTaskSchedule });
    await dispatchMcpTaskTool({
      tool: "cancel_task",
      actorUserId: "user_1",
      arguments: {
        shortId: "HT100001",
        expectedVersion: 8,
        reason: "停止交付",
      },
    } as never, { getTaskDetailView, changeUserTaskStatus });

    expect(getTaskDetailView).toHaveBeenCalledWith({ userId: "user_1", shortId: "HT100001" });
    expect(updateUserTaskSchedule).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task_1",
      expectedVersion: 7,
      dueAt: new Date("2026-08-31T12:00:00.000Z"),
      commandId: expect.any(String),
    }));
    expect(changeUserTaskStatus).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task_1",
      expectedVersion: 8,
      command: "cancel",
      commandId: expect.any(String),
    }));
  });

  it("updates typed custom fields through the task command", async () => {
    const updateUserTaskFields = vi.fn().mockResolvedValue({ taskId: "task_1", version: 3 });
    await dispatchMcpTaskTool({
      tool: "update_task", actorUserId: "user_1",
      arguments: { commandId: "cmd_fields", taskId: "task_1", expectedVersion: 2, customFields: { owner: "user_2" } },
    }, { updateUserTaskFields });
    expect(updateUserTaskFields).toHaveBeenCalledWith(expect.objectContaining({ customFields: { owner: "user_2" }, expectedVersion: 2 }));
  });

  it("updates Task title, priority, and Project using canonical field keys", async () => {
    const updateUserTaskFields = vi.fn().mockResolvedValue({ taskId: "task_1", version: 3 });
    await dispatchMcpTaskTool({
      tool: "update_task",
      actorUserId: "user_1",
      arguments: {
        commandId: "cmd_fields",
        taskId: "task_1",
        expectedVersion: 2,
        title: "明确标题",
        priority: 3,
        projectId: "project_2",
      },
    } as never, { updateUserTaskFields });
    expect(updateUserTaskFields).toHaveBeenCalledWith(expect.objectContaining({
      title: "明确标题",
      priority: 3,
      projectId: "project_2",
    }));
  });

  it("assigns Tasks and manages collaborators through explicit tools", async () => {
    const assignUserTask = vi.fn().mockResolvedValue({ taskId: "task_1", assigneeUserId: "user_2", version: 3 });
    const addUserTaskMember = vi.fn().mockResolvedValue({ taskId: "task_1", userId: "user_3", version: 4 });
    const removeUserTaskMember = vi.fn().mockResolvedValue({ taskId: "task_1", userId: "user_3", version: 5 });
    await dispatchMcpTaskTool({
      tool: "assign_task", actorUserId: "user_1",
      arguments: { commandId: "cmd_assign", taskId: "task_1", expectedVersion: 2, assigneeUserId: "user_2" },
    } as never, { assignUserTask } as never);
    await dispatchMcpTaskTool({
      tool: "manage_task_member", actorUserId: "user_1",
      arguments: { commandId: "cmd_member_add", taskId: "task_1", expectedVersion: 3, action: "add", userId: "user_3", role: "participant" },
    } as never, { addUserTaskMember } as never);
    await dispatchMcpTaskTool({
      tool: "manage_task_member", actorUserId: "user_1",
      arguments: { commandId: "cmd_member_remove", taskId: "task_1", expectedVersion: 4, action: "remove", userId: "user_3" },
    } as never, { removeUserTaskMember } as never);

    expect(assignUserTask).toHaveBeenCalledWith(expect.objectContaining({ assigneeUserId: "user_2" }));
    expect(addUserTaskMember).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_3", role: "participant" }));
    expect(removeUserTaskMember).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_3" }));
  });

  it("manages blockers, archival, reminders, and labels with returned relationship keys", async () => {
    const addUserTaskBlocker = vi.fn().mockResolvedValue({ taskId: "task_1", blockerId: "blocker_1", version: 3 });
    const archiveUserTask = vi.fn().mockResolvedValue({ taskId: "task_1", archived: true, version: 4 });
    const createUserTaskReminder = vi.fn().mockResolvedValue({ taskId: "task_1", reminderId: "reminder_1", version: 5 });
    const addUserTaskLabel = vi.fn().mockResolvedValue({ taskId: "task_1", labelId: "label_1", version: 6 });
    await dispatchMcpTaskTool({
      tool: "manage_task_blocker", actorUserId: "user_1",
      arguments: { commandId: "cmd_block", taskId: "task_1", expectedVersion: 2, action: "add", reason: "依赖未完成" },
    } as never, { addUserTaskBlocker } as never);
    await dispatchMcpTaskTool({
      tool: "set_task_archived", actorUserId: "user_1",
      arguments: { commandId: "cmd_archive", taskId: "task_1", expectedVersion: 3, archived: true },
    } as never, { archiveUserTask } as never);
    await dispatchMcpTaskTool({
      tool: "manage_task_reminder", actorUserId: "user_1",
      arguments: { commandId: "cmd_reminder", taskId: "task_1", expectedVersion: 4, action: "create", remindAt: "2026-08-20T09:00:00.000Z" },
    } as never, { createUserTaskReminder } as never);
    await dispatchMcpTaskTool({
      tool: "manage_task_label", actorUserId: "user_1",
      arguments: { commandId: "cmd_label", taskId: "task_1", expectedVersion: 5, action: "add", labelId: "label_1" },
    } as never, { addUserTaskLabel } as never);

    expect(addUserTaskBlocker).toHaveBeenCalledWith(expect.objectContaining({ reason: "依赖未完成" }));
    expect(archiveUserTask).toHaveBeenCalled();
    expect(createUserTaskReminder).toHaveBeenCalledWith(expect.objectContaining({ remindAt: new Date("2026-08-20T09:00:00.000Z") }));
    expect(addUserTaskLabel).toHaveBeenCalledWith(expect.objectContaining({ labelId: "label_1" }));
  });

  it("lists Space labels with the canonical label ID key", async () => {
    const listTaskLabelDefinitions = vi.fn().mockResolvedValue([{ id: "label_1", name: "发布", color: "#0969da" }]);
    const result = await dispatchMcpTaskTool({
      tool: "list_task_labels",
      actorUserId: "user_1",
      arguments: { spaceId: "space_1" },
    } as never, { listTaskLabelDefinitions } as never);

    expect(result).toEqual({
      labels: [{ id: "label_1", name: "发布", color: "#0969da" }],
      keyGuide: { labelId: "labels[].id" },
    });
  });

  it("lists active Agent Profiles with the ID needed for dispatch", async () => {
    const listTaskAgentProfiles = vi.fn().mockResolvedValue([{ id: "agent_1", name: "Codex", provider: "openai" }]);
    const result = await dispatchMcpTaskTool({
      tool: "list_task_agent_profiles",
      actorUserId: "user_1",
      arguments: { taskId: "task_1" },
    }, { listTaskAgentProfiles } as never);

    expect(listTaskAgentProfiles).toHaveBeenCalledWith({ userId: "user_1", taskId: "task_1" });
    expect(result).toEqual({
      agentProfiles: [{ id: "agent_1", name: "Codex", provider: "openai" }],
      keyGuide: { agentProfileId: "agentProfiles[].id" },
    });
  });

  it("propagates optimistic conflicts", async () => {
    await expect(dispatchMcpTaskTool({
      tool: "update_task", actorUserId: "user_1",
      arguments: { commandId: "cmd_update", taskId: "task_1", expectedVersion: 1, contentMarkdown: "stale" },
    }, { updateUserTaskContent: vi.fn().mockRejectedValue(Object.assign(new Error("stale"), { code: "version_conflict" })) }))
      .rejects.toMatchObject({ code: "version_conflict" });
  });

  it("submits acceptance evidence with MCP provenance and the credential actor", async () => {
    const submitTaskAcceptanceEvidence = vi.fn().mockResolvedValue({
      taskId: "task_1",
      evidenceId: "evidence_1",
      version: 5,
      readiness: { ready: true },
    });
    const result = await dispatchMcpTaskTool({
      tool: "submit_task_acceptance_evidence",
      actorUserId: "user_1",
      arguments: {
        commandId: "cmd_evidence_1",
        taskId: "task_1",
        expectedVersion: 4,
        checkKey: "delivery",
        status: "passed",
        summary: "正式环境验收通过",
        evidenceMarkdown: "image@sha256:abc",
        startedAt: new Date("2026-08-01T09:00:00.000Z"),
        finishedAt: new Date("2026-08-01T09:05:00.000Z"),
      },
    }, { submitTaskAcceptanceEvidence });

    expect(result).toMatchObject({ result: { evidenceId: "evidence_1", readiness: { ready: true } } });
    expect(submitTaskAcceptanceEvidence).toHaveBeenCalledWith({
      actor: { type: "user", id: "user_1" },
      source: "mcp",
      commandId: "cmd_evidence_1",
      correlationId: "mcp:task:task_1",
      taskId: "task_1",
      expectedVersion: 4,
      checkKey: "delivery",
      status: "passed",
      summary: "正式环境验收通过",
      evidenceMarkdown: "image@sha256:abc",
      startedAt: new Date("2026-08-01T09:00:00.000Z"),
      finishedAt: new Date("2026-08-01T09:05:00.000Z"),
    });
  });

  it("never forwards acceptancePassed from a status request", async () => {
    const changeUserTaskStatus = vi.fn().mockResolvedValue({ taskId: "task_1", version: 5 });
    await dispatchMcpTaskTool({
      tool: "change_task_status",
      actorUserId: "user_1",
      arguments: {
        commandId: "cmd_accept",
        taskId: "task_1",
        expectedVersion: 4,
        command: "accept",
        acceptancePassed: true,
      },
    } as never, { changeUserTaskStatus });

    expect(changeUserTaskStatus).toHaveBeenCalledWith({
      actor: { type: "user", id: "user_1" },
      commandId: "cmd_accept",
      correlationId: "mcp:task:task_1",
      taskId: "task_1",
      expectedVersion: 4,
      command: "accept",
    });
  });

  it("dispatches an Agent candidate without completing the business Task", async () => {
    const dispatchUserTaskToAgent = vi.fn().mockResolvedValue({
      taskId: "task_1", version: 4,
      executionRelationship: { type: "agent_dispatch_candidate", id: "dispatch_1", agentProfileId: "agent_1" },
    });
    const result = await dispatchMcpTaskTool({
      tool: "dispatch_task_to_agent", actorUserId: "user_1",
      arguments: { commandId: "cmd_dispatch", taskId: "task_1", expectedVersion: 3, agentProfileId: "agent_1" },
    }, { dispatchUserTaskToAgent });
    expect(result).toMatchObject({ result: { executionRelationship: { type: "agent_dispatch_candidate" } } });
    expect(result).not.toHaveProperty("result.statusCategory", "completed");
  });

  it("assigns a Task branch without accepting a caller-provided name", async () => {
    const assignTaskBranch = vi.fn().mockResolvedValue({ taskId: "task_1", taskBranch: "2026-HT100023", version: 4 });
    await dispatchMcpTaskTool({
      tool: "assign_task_branch",
      actorUserId: "user_1",
      arguments: { commandId: "cmd_branch", taskId: "task_1", expectedVersion: 3 },
    }, { assignTaskBranch });

    expect(assignTaskBranch).toHaveBeenCalledWith({
      actor: { type: "user", id: "user_1" },
      commandId: "cmd_branch",
      correlationId: "mcp:task:task_1",
      taskId: "task_1",
      expectedVersion: 3,
    });
  });
});
