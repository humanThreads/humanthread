import { describe, expect, it, vi } from "vitest";
import {
  changeProjectScheduledTaskStatus,
  createProjectScheduledTask,
  updateProjectScheduledTask,
} from "./project-scheduled-task-commands";
import {
  projectScheduledTaskId,
  scheduledTaskProjectDigest,
} from "./project-scheduled-task-identity";

const projectId = "project_1";
const userId = "user_1";
const projectDigest = scheduledTaskProjectDigest(projectId);

function taskFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "a".repeat(32),
    projectDigest,
    status: "enabled",
    version: 4,
    name: "旧名称",
    description: "",
    cronExpression: "0 9 * * *",
    timezone: "Asia/Shanghai",
    contentMode: "platform",
    contentMarkdown: "# 旧",
    loopBindingDigest: "c".repeat(32),
    executionTargetDigest: "d".repeat(32),
    configurationSnapshot: { loopBindingId: "binding_1", loopScope: "project", loopVersionId: "version_1" },
    executionTargetSnapshot: {
      type: "linux_worker_pool",
      id: "a".repeat(32),
      displayName: "巡检 Worker",
      provider: null,
    },
    pendingScheduledFor: null,
    lastScheduledFor: null,
    nextRunAt: null,
    ...overrides,
  };
}

function commandDependencies(overrides: Record<string, unknown> = {}) {
  const dependencies: Record<string, any> = {
    assertCanWriteProject: vi.fn().mockResolvedValue({ projectId, role: "maintainer" }),
    loadBinding: vi.fn().mockResolvedValue({
      id: "binding_1", projectId, status: "enabled",
      loopDefinitionId: "definition_1", activeVersionId: "version_1",
      allowedAgentProfileIds: [],
      allowedProviders: [],
      workerPoolId: "a".repeat(32),
      workerStageConfigurations: { inspect: { siteId: "b".repeat(32), model: "gpt-5" } },
      loopDefinition: { scope: "project", status: "published", latestPublishedVersion: { status: "published" } },
      activeVersion: { status: "published" },
    }),
    loadTarget: vi.fn().mockResolvedValue({ type: "linux_worker_pool", id: "a".repeat(32), displayName: "巡检 Worker", provider: null }),
    loadTask: vi.fn(async () => null),
    loadEvent: vi.fn(async () => null),
    createTask: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    updateTask: vi.fn(async ({ where, data }: { where: { id: string; version: number }; data: Record<string, unknown> }) => ({ id: where.id, version: data.version, ...data })),
    createEvent: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
  };
  dependencies.executeCommand = vi.fn(async (fn: (operations: Record<string, any>) => Promise<unknown>) => fn({
    createTask: dependencies.createTask,
    updateTask: dependencies.updateTask,
    createEvent: dependencies.createEvent,
  }));
  Object.assign(dependencies, overrides);
  return dependencies;
}

function replayEvent(result: { id: string; status: string; version: number; nextRunAt: string | null }, commandId: string) {
  return {
    id: "e".repeat(32),
    scheduledTaskId: result.id,
    eventType: "scheduled_task.updated",
    actorDigest: "a".repeat(32),
    payload: { ...result, commandId },
    occurredAt: new Date("2026-09-22T00:00:00.000Z"),
  };
}

const createInput = {
  actorUserId: userId,
  projectId,
  commandId: "cmd_1",
  name: "每日巡检",
  description: "",
  loopBindingId: "binding_1",
  cronExpression: "0 9 * * *",
  timezone: "Asia/Shanghai",
  contentMode: "platform" as const,
  contentMarkdown: "# 检查",
  executionTarget: { type: "linux_worker_pool" as const, workerPoolId: "a".repeat(32) },
};

describe("project scheduled task commands", () => {
  it("creates a new task in inactive status", async () => {
    const dependencies = commandDependencies();
    const result = await createProjectScheduledTask(createInput, dependencies as never);

    expect(result).toMatchObject({ status: "inactive", version: 1, nextRunAt: null });
    expect(dependencies.createTask).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "inactive", contentMarkdown: "# 检查" }),
    }));
  });

  it("keeps status unchanged when editing configuration", async () => {
    const dependencies = commandDependencies({
      loadTask: vi.fn().mockResolvedValue(taskFixture({ status: "enabled", version: 4 })),
    });
    await updateProjectScheduledTask({
      actorUserId: userId, projectId, scheduledTaskId: "a".repeat(32), commandId: "cmd_2", expectedVersion: 4,
      name: "新名称",
    }, dependencies as never);
    expect(dependencies.updateTask).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: "新名称", status: "enabled", version: 5 }),
    }));
    expect(dependencies.updateTask.mock.calls[0]?.[0].data).not.toHaveProperty("nextRunAt");
  });

  it("restores a disabled task to inactive instead of enabled", async () => {
    const dependencies = commandDependencies({
      loadTask: vi.fn().mockResolvedValue(taskFixture({ status: "disabled", version: 2 })),
    });
    const result = await changeProjectScheduledTaskStatus({
      actorUserId: userId, projectId, scheduledTaskId: "a".repeat(32), commandId: "cmd_3", expectedVersion: 2,
      command: "restore",
    }, dependencies as never);
    expect(result).toMatchObject({ status: "inactive", nextRunAt: null });
  });

  it("rejects a stale update with a version conflict", async () => {
    const dependencies = commandDependencies({
      loadTask: vi.fn().mockResolvedValue(taskFixture({ status: "enabled", version: 4 })),
    });
    await expect(updateProjectScheduledTask({
      actorUserId: userId, projectId, scheduledTaskId: "a".repeat(32), commandId: "cmd_2", expectedVersion: 3,
      name: "新名称",
    }, dependencies as never)).rejects.toMatchObject({ code: "version_conflict" });
    expect(dependencies.updateTask).not.toHaveBeenCalled();
  });

  it("forces loop-managed content to null and rejects supplied platform markdown", async () => {
    const dependencies = commandDependencies({
      loadTask: vi.fn().mockResolvedValue(taskFixture({ status: "enabled", version: 4 })),
    });
    await updateProjectScheduledTask({
      actorUserId: userId, projectId, scheduledTaskId: "a".repeat(32), commandId: "cmd_loop", expectedVersion: 4,
      contentMode: "loop_managed",
    }, dependencies as never);
    expect(dependencies.updateTask).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ contentMode: "loop_managed", contentMarkdown: null }),
    }));

    await expect(updateProjectScheduledTask({
      actorUserId: userId, projectId, scheduledTaskId: "a".repeat(32), commandId: "cmd_bad", expectedVersion: 4,
      contentMode: "loop_managed", contentMarkdown: "不应保存",
    }, dependencies as never)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("requires platform content", async () => {
    const dependencies = commandDependencies({
      loadTask: vi.fn().mockResolvedValue(taskFixture({ status: "enabled", version: 4, contentMarkdown: "" })),
    });
    await expect(updateProjectScheduledTask({
      actorUserId: userId, projectId, scheduledTaskId: "a".repeat(32), commandId: "cmd_empty", expectedVersion: 4,
      name: "新名称",
    }, dependencies as never)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects an invalid execution target or Loop binding", async () => {
    const dependencies = commandDependencies({
      loadTask: vi.fn().mockResolvedValue(taskFixture({ status: "enabled", version: 4 })),
      loadBinding: vi.fn().mockResolvedValue(null),
      loadTarget: vi.fn().mockResolvedValue(null),
    });

    await expect(updateProjectScheduledTask({
      actorUserId: userId, projectId, scheduledTaskId: "a".repeat(32), commandId: "cmd_target", expectedVersion: 4,
      executionTarget: { type: "linux_worker_pool", workerPoolId: "a".repeat(32) },
    }, dependencies as never)).rejects.toMatchObject({ code: "validation_failed" });

    await expect(updateProjectScheduledTask({
      actorUserId: userId, projectId, scheduledTaskId: "a".repeat(32), commandId: "cmd_binding", expectedVersion: 4,
      loopBindingId: "binding_missing",
    }, dependencies as never)).rejects.toMatchObject({ code: "not_found" });
  });

  it("computes a strictly future next run when enabling", async () => {
    const dependencies = commandDependencies({
      loadTask: vi.fn().mockResolvedValue(taskFixture({ status: "inactive", version: 2 })),
    });
    const before = new Date();
    const result = await changeProjectScheduledTaskStatus({
      actorUserId: userId, projectId, scheduledTaskId: "a".repeat(32), commandId: "cmd_enable", expectedVersion: 2,
      command: "enable",
    }, dependencies as never);
    expect(result.status).toBe("enabled");
    expect(new Date(result.nextRunAt as string).getTime()).toBeGreaterThan(before.getTime());
    expect(dependencies.updateTask).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "enabled", nextRunAt: expect.any(Date) }),
    }));
  });

  it("recomputes the next run only when scheduling configuration changes", async () => {
    const dependencies = commandDependencies({
      loadTask: vi.fn().mockResolvedValue(taskFixture({ status: "enabled", version: 4, nextRunAt: new Date("2026-09-23T01:00:00.000Z") })),
    });
    const before = new Date();
    const result = await updateProjectScheduledTask({
      actorUserId: userId, projectId, scheduledTaskId: "a".repeat(32), commandId: "cmd_schedule", expectedVersion: 4,
      cronExpression: "0 10 * * *",
    }, dependencies as never);
    expect(result.nextRunAt).not.toBeNull();
    expect(new Date(result.nextRunAt as string).getTime()).toBeGreaterThan(before.getTime());
    expect(dependencies.updateTask).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        cronExpression: "0 10 * * *",
        nextRunAt: expect.any(Date),
        pendingScheduledFor: null,
      }),
    }));
  });

  it("preserves the pending schedule anchor for name, description, content, Loop and target edits", async () => {
    const pendingScheduledFor = new Date("2026-09-23T01:00:00.000Z");
    const nextRunAt = new Date("2026-09-24T01:00:00.000Z");
    const dependencies = commandDependencies({
      loadTask: vi.fn().mockResolvedValue(taskFixture({
        status: "enabled",
        version: 4,
        nextRunAt,
        pendingScheduledFor,
        executionTargetSnapshot: {
          type: "linux_worker_pool",
          id: "a".repeat(32),
          displayName: "巡检 Worker",
          provider: null,
        },
      })),
    });

    const result = await updateProjectScheduledTask({
      actorUserId: userId,
      projectId,
      scheduledTaskId: "a".repeat(32),
      commandId: "cmd_non_schedule",
      expectedVersion: 4,
      name: "新名称",
      description: "新说明",
      contentMode: "platform",
      contentMarkdown: "# 新正文",
      executionTarget: { type: "linux_worker_pool", workerPoolId: "a".repeat(32) },
    }, dependencies as never);

    expect(result.nextRunAt).toBe(nextRunAt.toISOString());
    const data = dependencies.updateTask.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty("nextRunAt");
    expect(data).not.toHaveProperty("pendingScheduledFor");
  });

  it("clears the obsolete pending anchor when the timezone changes", async () => {
    const dependencies = commandDependencies({
      loadTask: vi.fn().mockResolvedValue(taskFixture({
        status: "enabled",
        version: 4,
        nextRunAt: new Date("2026-09-24T01:00:00.000Z"),
        pendingScheduledFor: new Date("2026-09-23T01:00:00.000Z"),
      })),
    });

    await updateProjectScheduledTask({
      actorUserId: userId,
      projectId,
      scheduledTaskId: "a".repeat(32),
      commandId: "cmd_timezone",
      expectedVersion: 4,
      timezone: "UTC",
    }, dependencies as never);

    expect(dependencies.updateTask).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        timezone: "UTC",
        nextRunAt: expect.any(Date),
        pendingScheduledFor: null,
      }),
    }));
  });

  it("rejects archived Loop definitions on create and update", async () => {
    const archivedBinding = {
      id: "binding_1", projectId, status: "enabled",
      loopDefinitionId: "definition_1", activeVersionId: "version_1",
      allowedAgentProfileIds: [],
      allowedProviders: [],
      workerPoolId: "a".repeat(32),
      workerStageConfigurations: { inspect: { siteId: "b".repeat(32), model: "gpt-5" } },
      loopDefinition: { scope: "project", status: "archived", latestPublishedVersion: { status: "published" } },
      activeVersion: { status: "published" },
    };
    const createDependencies = commandDependencies({ loadBinding: vi.fn().mockResolvedValue(archivedBinding) });
    await expect(createProjectScheduledTask(createInput, createDependencies as never))
      .rejects.toMatchObject({ code: "not_found" });

    const updateDependencies = commandDependencies({
      loadTask: vi.fn().mockResolvedValue(taskFixture({ status: "enabled", version: 4 })),
      loadBinding: vi.fn().mockResolvedValue(archivedBinding),
    });
    await expect(updateProjectScheduledTask({
      actorUserId: userId,
      projectId,
      scheduledTaskId: "a".repeat(32),
      commandId: "cmd_archived",
      expectedVersion: 4,
      loopBindingId: "binding_1",
    }, updateDependencies as never)).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects a Local Agent target outside the selected binding policy", async () => {
    const dependencies = commandDependencies({
      loadTarget: vi.fn().mockResolvedValue({ type: "local_agent", id: "agent_1", displayName: "Claude", provider: "claude" }),
    });
    await expect(createProjectScheduledTask({
      ...createInput,
      executionTarget: { type: "local_agent", agentProfileId: "agent_1" },
    }, dependencies as never)).rejects.toMatchObject({ code: "validation_failed" });
    expect(dependencies.createTask).not.toHaveBeenCalled();
  });

  it("rejects a Worker Pool target that does not match the selected binding", async () => {
    const dependencies = commandDependencies({
      loadBinding: vi.fn().mockResolvedValue({
        id: "binding_1", projectId, status: "enabled",
        loopDefinitionId: "definition_1", activeVersionId: "version_1",
        allowedAgentProfileIds: [],
        allowedProviders: [],
        workerPoolId: "b".repeat(32),
        workerStageConfigurations: { inspect: { siteId: "c".repeat(32), model: "gpt-5" } },
        loopDefinition: { scope: "project", status: "published", latestPublishedVersion: { status: "published" } },
        activeVersion: { status: "published" },
      }),
    });
    await expect(createProjectScheduledTask(createInput, dependencies as never))
      .rejects.toMatchObject({ code: "validation_failed" });
    expect(dependencies.createTask).not.toHaveBeenCalled();
  });

  it("clears scheduling state when deactivating or disabling", async () => {
    const dependencies = commandDependencies({
      loadTask: vi.fn().mockResolvedValue(taskFixture({
        status: "enabled", version: 2,
        nextRunAt: new Date("2026-09-23T01:00:00.000Z"),
        pendingScheduledFor: new Date("2026-09-23T01:00:00.000Z"),
      })),
    });
    const result = await changeProjectScheduledTaskStatus({
      actorUserId: userId, projectId, scheduledTaskId: "a".repeat(32), commandId: "cmd_disable", expectedVersion: 2,
      command: "disable",
    }, dependencies as never);
    expect(result).toMatchObject({ status: "disabled", nextRunAt: null });
    expect(dependencies.updateTask).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "disabled", nextRunAt: null, pendingScheduledFor: null }),
    }));
  });

  it("accepts project and task scoped bindings on create", async () => {
    const projectDependencies = commandDependencies();
    await createProjectScheduledTask(createInput, projectDependencies as never);
    expect(projectDependencies.createTask).toHaveBeenCalledTimes(1);

    const taskDependencies = commandDependencies({
      loadBinding: vi.fn().mockResolvedValue({
        id: "binding_1", projectId, status: "enabled",
        loopDefinitionId: "definition_1", activeVersionId: "version_1",
        allowedAgentProfileIds: [],
        allowedProviders: [],
        workerPoolId: "a".repeat(32),
        workerStageConfigurations: { inspect: { siteId: "b".repeat(32), model: "gpt-5" } },
        loopDefinition: { scope: "task", status: "published", latestPublishedVersion: { status: "published" } },
        activeVersion: { status: "published" },
      }),
    });
    await createProjectScheduledTask(createInput, taskDependencies as never);
    expect(taskDependencies.createTask).toHaveBeenCalledTimes(1);
    expect(taskDependencies.createTask.mock.calls[0]?.[0].data.configurationSnapshot).toMatchObject({ loopScope: "task" });
  });

  it("accepts a task scoped binding on update", async () => {
    const dependencies = commandDependencies({
      loadTask: vi.fn().mockResolvedValue(taskFixture({ status: "enabled", version: 4 })),
      loadBinding: vi.fn().mockResolvedValue({
        id: "binding_task", projectId, status: "enabled",
        loopDefinitionId: "definition_2", activeVersionId: "version_2",
        allowedAgentProfileIds: [],
        allowedProviders: [],
        workerPoolId: "a".repeat(32),
        workerStageConfigurations: { inspect: { siteId: "b".repeat(32), model: "gpt-5" } },
        loopDefinition: { scope: "task", status: "published", latestPublishedVersion: { status: "published" } },
        activeVersion: { status: "published" },
      }),
    });
    await updateProjectScheduledTask({
      actorUserId: userId, projectId, scheduledTaskId: "a".repeat(32), commandId: "cmd_scope", expectedVersion: 4,
      loopBindingId: "binding_task",
    }, dependencies as never);
    expect(dependencies.updateTask).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ configurationSnapshot: expect.objectContaining({ loopScope: "task" }) }),
    }));
  });

  it("replays a recorded create result without a second mutation", async () => {
    const id = projectScheduledTaskId(projectId, "cmd_1");
    const recorded = { id, status: "inactive", version: 1, nextRunAt: null };
    const dependencies = commandDependencies({
      loadEvent: vi.fn().mockResolvedValue(replayEvent(recorded, "cmd_1")),
    });
    const result = await createProjectScheduledTask(createInput, dependencies as never);
    expect(result).toEqual(recorded);
    expect(dependencies.createTask).not.toHaveBeenCalled();
  });

  it("returns the existing task when a create command has no event yet", async () => {
    const id = projectScheduledTaskId(projectId, "cmd_1");
    const dependencies = commandDependencies({
      loadEvent: vi.fn(async () => null),
      loadTask: vi.fn().mockResolvedValue({ id, projectDigest, status: "enabled", version: 3, nextRunAt: new Date("2026-09-23T01:00:00.000Z") }),
    });
    const result = await createProjectScheduledTask(createInput, dependencies as never);
    expect(result).toMatchObject({ id, status: "enabled", version: 3 });
    expect(dependencies.createTask).not.toHaveBeenCalled();
  });

  it("replays an update result without a second mutation or version conflict", async () => {
    const recorded = { id: "a".repeat(32), status: "enabled", version: 5, nextRunAt: null };
    const dependencies = commandDependencies({
      loadEvent: vi.fn().mockResolvedValue(replayEvent(recorded, "cmd_2")),
      loadTask: vi.fn().mockResolvedValue(taskFixture({ status: "enabled", version: 9 })),
    });
    const result = await updateProjectScheduledTask({
      actorUserId: userId, projectId, scheduledTaskId: "a".repeat(32), commandId: "cmd_2", expectedVersion: 4,
      name: "新名称",
    }, dependencies as never);
    expect(result).toEqual(recorded);
    expect(dependencies.updateTask).not.toHaveBeenCalled();
  });

  it("does not replay an update across project ownership boundaries", async () => {
    const recorded = { id: "a".repeat(32), status: "enabled", version: 5, nextRunAt: null };
    const dependencies = commandDependencies({
      loadEvent: vi.fn().mockResolvedValue(replayEvent(recorded, "cmd_cross_project")),
      loadTask: vi.fn().mockResolvedValue(taskFixture({ projectDigest: "f".repeat(32), version: 9 })),
    });

    await expect(updateProjectScheduledTask({
      actorUserId: userId,
      projectId,
      scheduledTaskId: "a".repeat(32),
      commandId: "cmd_cross_project",
      expectedVersion: 4,
      name: "新名称",
    }, dependencies as never)).rejects.toMatchObject({ code: "not_found" });
    expect(dependencies.updateTask).not.toHaveBeenCalled();
  });

  it("replays a status result without a second mutation", async () => {
    const recorded = { id: "a".repeat(32), status: "inactive", version: 3, nextRunAt: null };
    const dependencies = commandDependencies({
      loadEvent: vi.fn().mockResolvedValue(replayEvent(recorded, "cmd_3")),
      loadTask: vi.fn().mockResolvedValue(taskFixture({ status: "enabled", version: 9 })),
    });
    const result = await changeProjectScheduledTaskStatus({
      actorUserId: userId, projectId, scheduledTaskId: "a".repeat(32), commandId: "cmd_3", expectedVersion: 9,
      command: "restore",
    }, dependencies as never);
    expect(result).toEqual(recorded);
    expect(dependencies.updateTask).not.toHaveBeenCalled();
  });

  it("does not replay a status command across project ownership boundaries", async () => {
    const recorded = { id: "a".repeat(32), status: "inactive", version: 3, nextRunAt: null };
    const dependencies = commandDependencies({
      loadEvent: vi.fn().mockResolvedValue(replayEvent(recorded, "cmd_cross_status")),
      loadTask: vi.fn().mockResolvedValue(taskFixture({ projectDigest: "f".repeat(32), version: 9 })),
    });

    await expect(changeProjectScheduledTaskStatus({
      actorUserId: userId,
      projectId,
      scheduledTaskId: "a".repeat(32),
      commandId: "cmd_cross_status",
      expectedVersion: 9,
      command: "restore",
    }, dependencies as never)).rejects.toMatchObject({ code: "not_found" });
    expect(dependencies.updateTask).not.toHaveBeenCalled();
  });

  it("does not replay a different commandId", async () => {
    const dependencies = commandDependencies({
      loadEvent: vi.fn(async ({ commandId }: { commandId: string }) => commandId === "cmd_old"
        ? replayEvent({ id: "a".repeat(32), status: "enabled", version: 5, nextRunAt: null }, "cmd_old")
        : null),
      loadTask: vi.fn().mockResolvedValue(taskFixture({ status: "enabled", version: 4 })),
    });
    await updateProjectScheduledTask({
      actorUserId: userId, projectId, scheduledTaskId: "a".repeat(32), commandId: "cmd_new", expectedVersion: 4,
      name: "新名称",
    }, dependencies as never);
    expect(dependencies.updateTask).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed cron on create", async () => {
    const dependencies = commandDependencies();
    await expect(createProjectScheduledTask({
      ...createInput,
      cronExpression: "not a cron",
    }, dependencies as never)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects malformed cron on an inactive update", async () => {
    const dependencies = commandDependencies({
      loadTask: vi.fn().mockResolvedValue(taskFixture({ status: "inactive", version: 2 })),
    });
    await expect(updateProjectScheduledTask({
      actorUserId: userId, projectId, scheduledTaskId: "a".repeat(32), commandId: "cmd_badcron", expectedVersion: 2,
      cronExpression: "bad",
    }, dependencies as never)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects malformed cron on a disabled update", async () => {
    const dependencies = commandDependencies({
      loadTask: vi.fn().mockResolvedValue(taskFixture({ status: "disabled", version: 2 })),
    });
    await expect(updateProjectScheduledTask({
      actorUserId: userId, projectId, scheduledTaskId: "a".repeat(32), commandId: "cmd_badcron", expectedVersion: 2,
      cronExpression: "0 9",
    }, dependencies as never)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rolls back the task write when event creation fails", async () => {
    const committed: unknown[] = [];
    const dependencies = commandDependencies({
      executeCommand: vi.fn(async (fn: (operations: Record<string, any>) => Promise<unknown>) => {
        const pending: unknown[] = [];
        const operations = {
          createTask: async ({ data }: { data: unknown }) => { pending.push(data); return data; },
          updateTask: async ({ where, data }: { where: unknown; data: unknown }) => { pending.push({ where, data }); return { count: 1 }; },
          createEvent: async () => { throw new Error("event write failed"); },
        };
        try {
          const result = await fn(operations);
          committed.push(...pending);
          return result;
        } catch (error) {
          throw error;
        }
      }),
    });

    await expect(createProjectScheduledTask(createInput, dependencies as never)).rejects.toThrow("event write failed");
    expect(committed).toHaveLength(0);
  });

  it("raises version_conflict when the optimistic write matches zero rows", async () => {
    const dependencies = commandDependencies({
      loadTask: vi.fn().mockResolvedValue(taskFixture({ status: "enabled", version: 4 })),
      updateTask: vi.fn().mockResolvedValue({ count: 0 }),
    });
    await expect(updateProjectScheduledTask({
      actorUserId: userId, projectId, scheduledTaskId: "a".repeat(32), commandId: "cmd_conflict", expectedVersion: 4,
      name: "新名称",
    }, dependencies as never)).rejects.toMatchObject({ code: "version_conflict" });
    expect(dependencies.createEvent).not.toHaveBeenCalled();
  });

  it("rejects a task owned by another project", async () => {
    const dependencies = commandDependencies({
      loadTask: vi.fn().mockResolvedValue(taskFixture({ projectDigest: "f".repeat(32), version: 4 })),
    });
    await expect(updateProjectScheduledTask({
      actorUserId: userId, projectId, scheduledTaskId: "a".repeat(32), commandId: "cmd_other", expectedVersion: 4,
      name: "新名称",
    }, dependencies as never)).rejects.toMatchObject({ code: "not_found" });
  });
});
