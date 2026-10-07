import { describe, expect, it, vi } from "vitest";
import * as runtime from "./project-scheduled-task-runtime";
import {
  advanceDueScheduledTaskSchedule,
  createProjectScheduledTaskRunRecord,
  deferDueScheduledTaskSchedule,
  projectScheduledTaskRunStatus,
  projectScheduledTaskRunStatuses,
  recoverPreparingProjectScheduledTaskRuns,
  resolveScheduledTaskExecutionTargetReadiness,
  triggerProjectScheduledTaskRun,
} from "./project-scheduled-task-runtime";

const scheduledTaskId = "a".repeat(32);

function expectFailureCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error("Expected function to throw");
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

function baseTask(status = "inactive", overrides: Record<string, unknown> = {}) {
  return {
    id: scheduledTaskId,
    projectDigest: "b".repeat(32),
    status,
    version: 2,
    name: "每日巡检",
    description: "巡检",
    cronExpression: "0 9 * * *",
    timezone: "Asia/Shanghai",
    contentMode: "platform",
    contentMarkdown: "# 检查",
    executionTargetSnapshot: {
      type: "linux_worker_pool",
      id: "c".repeat(32),
      displayName: "巡检 Worker",
    },
    configurationSnapshot: {
      projectId: "project_1",
      loopBindingId: "binding_1",
      loopDefinitionId: "definition_1",
      loopVersionId: "version_1",
      loopScope: "project",
    },
    pendingScheduledFor: null,
    lastScheduledFor: null,
    nextRunAt: null,
    ...overrides,
  };
}

function taskBinding(overrides: Record<string, unknown> = {}) {
  return {
    id: "binding_1",
    projectId: "project_1",
    loopDefinitionId: "definition_1",
    activeVersionId: "version_1",
    status: "enabled",
    version: 2,
    bindingRole: null,
    createdByUserId: "user_1",
    triggerPolicy: { manual: true, taskEvents: [], milestoneEvents: [] },
    parameterOverrides: {},
    notificationPolicy: {},
    automationGrantIds: [],
    allowedAgentProfileIds: [],
    allowedProviders: [],
    workerPoolId: "c".repeat(32),
    workerRepositoryUrl: "https://example.com/repo.git",
    workerBranchPolicy: { allowedBranches: ["main"] },
    workerStageConfigurations: {
      inspect: { siteId: "d".repeat(32), model: "gpt-5", reasoningEffort: "medium" },
    },
    project: {
      workerPoolId: "c".repeat(32),
      workerRepositoryUrl: "https://example.com/repo.git",
      workerBranchPolicy: { allowedBranches: ["main"] },
    },
    activeVersion: {
      id: "version_1",
      status: "published",
      maxStages: 4,
      maxRepeatCount: 2,
      platformMaxTransitions: 8,
    },
    loopDefinition: {
      name: "巡检 Loop",
      scope: "project",
      latestPublishedVersion: {
        id: "version_1",
        status: "published",
        maxStages: 4,
        maxRepeatCount: 2,
        platformMaxTransitions: 8,
      },
    },
    ...overrides,
  };
}

function taskGraphVersions() {
  return [{
    loopDefinitionId: "definition_1",
    loopVersionId: "version_1",
    scope: "project" as const,
    graph: {
      schemaVersion: 1,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      limits: { maxStages: 2, maxRepeatCount: 1 },
      nodes: [
        { key: "start", label: "Start", type: "start" },
        { key: "end", label: "End", type: "end" },
      ],
      edges: [{ id: "start-end", source: "start", target: "end", kind: "normal", outcome: "success" }],
    },
  }];
}

function runtimeDependencies(status = "inactive", taskOverrides: Record<string, unknown> = {}) {
  return {
    assertCanWriteProject: vi.fn().mockResolvedValue({ projectId: "project_1", role: "maintainer" }),
    loadTask: vi.fn().mockResolvedValue(baseTask(status, taskOverrides)),
    countActiveRuns: vi.fn().mockResolvedValue(0),
    findByTriggerKey: vi.fn().mockResolvedValue(null),
    createRunWithActiveGuard: vi.fn(async ({ data }) => data),
    persistPreparationSnapshot: vi.fn().mockResolvedValue({ updated: true, version: 2 }),
    claimPreparingRun: vi.fn().mockResolvedValue({ claimed: true, version: 2 }),
    completeRun: vi.fn(async () => undefined),
    failRun: vi.fn(async () => undefined),
    createLoopRun: vi.fn().mockResolvedValue({ id: "loop_run_1", engineKind: "graph_v1" }),
    loadLoopRunReference: vi.fn().mockResolvedValue(null),
    loadBinding: vi.fn().mockResolvedValue(taskBinding()),
    loadPublishedVersions: vi.fn().mockResolvedValue(taskGraphVersions()),
    snapshotGrantRows: vi.fn().mockResolvedValue([]),
    resolveExecutionTarget: vi.fn().mockResolvedValue({
      target: { type: "linux_worker_pool", workerPoolId: "c".repeat(32), poolDisplayName: "巡检 Worker" },
      resolvedAt: "2026-09-22T01:00:00.000Z",
    }),
    listPreparingRuns: vi.fn().mockResolvedValue([]),
    now: () => new Date("2026-09-22T01:00:00.000Z"),
  };
}

function preparingRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "d".repeat(32),
    scheduledTaskId,
    triggerKey: "e".repeat(32),
    triggerSource: "manual",
    scheduledFor: null,
    triggeredAt: new Date("2026-09-22T00:59:00.000Z"),
    status: "preparing",
    version: 1,
    preparationLeaseToken: "f".repeat(32),
    preparationLeaseExpiresAt: new Date("2026-09-22T00:59:30.000Z"),
    preparationSnapshot: null,
    taskSnapshot: baseTask("enabled"),
    contentSnapshot: "# 检查",
    executionTargetSnapshot: baseTask("enabled").executionTargetSnapshot,
    loopRun: null,
    ...overrides,
  };
}

describe("project scheduled task runtime", () => {
  it("allows manual execution from inactive status and returns the persisted running status", async () => {
    const dependencies = runtimeDependencies("inactive");
    const result = await triggerProjectScheduledTaskRun({
      actorUserId: "user_1", projectId: "project_1", scheduledTaskId,
      commandId: "cmd_manual_1", triggerSource: "manual",
    }, dependencies as never);
    expect(result).toMatchObject({ status: "running", duplicate: false });
    expect(dependencies.createLoopRun).toHaveBeenCalledWith(expect.objectContaining({
      scheduledTaskRunId: expect.stringMatching(/^[a-f0-9]{32}$/u),
    }));
    expect(dependencies.completeRun).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "scheduled_task.run_created",
      loopRunReference: { id: "loop_run_1", engineKind: "graph_v1" },
      payload: expect.objectContaining({ status: "running" }),
    }));
  });

  it("rejects manual execution for disabled tasks", async () => {
    await expect(triggerProjectScheduledTaskRun({
      actorUserId: "user_1", projectId: "project_1", scheduledTaskId,
      commandId: "cmd_manual_1", triggerSource: "manual",
    }, runtimeDependencies("disabled") as never)).rejects.toMatchObject({ code: "policy_denied" });
  });

  it("returns the existing run status for a repeated manual command", async () => {
    const dependencies = runtimeDependencies("enabled");
    dependencies.findByTriggerKey.mockResolvedValue({ id: "e".repeat(32), status: "running" });
    await expect(triggerProjectScheduledTaskRun({
      actorUserId: "user_1", projectId: "project_1", scheduledTaskId,
      commandId: "cmd_manual_1", triggerSource: "manual",
    }, dependencies as never)).resolves.toMatchObject({ runId: "e".repeat(32), duplicate: true, status: "running" });
    expect(dependencies.createRunWithActiveGuard).not.toHaveBeenCalled();
  });

  it("copies platform content only to the run ledger and keeps the LoopRun input as a reference", async () => {
    const dependencies = runtimeDependencies("inactive");
    await triggerProjectScheduledTaskRun({
      actorUserId: "user_1", projectId: "project_1", scheduledTaskId,
      commandId: "cmd_manual_2", triggerSource: "manual",
    }, dependencies as never);

    expect(dependencies.createRunWithActiveGuard).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ contentSnapshot: "# 检查" }),
    }));
    const loopRunInput = dependencies.createLoopRun.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(loopRunInput.inputSnapshot).toEqual({
      scheduledTaskId,
      scheduledTaskRunId: expect.stringMatching(/^[a-f0-9]{32}$/u),
      scheduledTaskName: "每日巡检",
      contentMode: "platform",
      contentReference: { kind: "scheduled_task_run", id: expect.stringMatching(/^[a-f0-9]{32}$/u) },
    });
    expect(loopRunInput.inputSnapshot).not.toHaveProperty("contentMarkdown");
    expect(JSON.stringify(loopRunInput)).not.toContain("# 检查");
    const taskSnapshot = (dependencies.completeRun.mock.calls[0]?.[0] as { taskSnapshot: Record<string, unknown> }).taskSnapshot;
    expect(taskSnapshot).toMatchObject({
      loopName: "巡检 Loop",
      configurationSnapshot: { loopName: "巡检 Loop" },
    });
    expect(dependencies.completeRun.mock.calls[0]?.[0]).toMatchObject({
      executionTargetSnapshot: {
        type: "linux_worker_pool",
        id: "c".repeat(32),
        displayName: "巡检 Worker",
        provider: null,
      },
    });
  });

  it("forces a null content snapshot and reference for loop-managed content", async () => {
    const dependencies = runtimeDependencies("enabled", { contentMode: "loop_managed", contentMarkdown: null });
    await triggerProjectScheduledTaskRun({
      actorUserId: "user_1", projectId: "project_1", scheduledTaskId,
      commandId: "cmd_manual_3", triggerSource: "manual",
    }, dependencies as never);

    expect(dependencies.createRunWithActiveGuard).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ contentSnapshot: null }),
    }));
    const loopRunInput = dependencies.createLoopRun.mock.calls[0]?.[0] as Record<string, unknown>;
    expect((loopRunInput.inputSnapshot as Record<string, unknown>).contentReference).toBeNull();
  });

  it("fences normal LoopRun creation with the persisted preparation version and lease", async () => {
    const dependencies = runtimeDependencies("enabled");

    await triggerProjectScheduledTaskRun({
      actorUserId: "user_1",
      projectId: "project_1",
      scheduledTaskId,
      commandId: "cmd_manual_fence",
      triggerSource: "manual",
    }, dependencies as never);

    const persisted = dependencies.persistPreparationSnapshot.mock.calls[0]![0] as {
      runId: string;
      leaseToken: string;
    };
    expect(dependencies.createLoopRun).toHaveBeenCalledWith(expect.objectContaining({
      scheduledTaskPreparationFence: {
        scheduledTaskRunId: persisted.runId,
        expectedVersion: 2,
        leaseToken: persisted.leaseToken,
        now: new Date("2026-09-22T01:00:00.000Z"),
      },
    }));
  });

  it("blocks a platform task with missing content before creating a LoopRun", async () => {
    const dependencies = runtimeDependencies("enabled", { contentMode: "platform", contentMarkdown: "   " });
    await expect(triggerProjectScheduledTaskRun({
      actorUserId: "user_1", projectId: "project_1", scheduledTaskId,
      commandId: "cmd_manual_missing", triggerSource: "manual",
    }, dependencies as never)).rejects.toMatchObject({ code: "task_content_missing" });
    expect(dependencies.createRunWithActiveGuard).toHaveBeenCalled();
    expect(dependencies.createLoopRun).not.toHaveBeenCalled();
    expect(dependencies.failRun).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "task_content_missing",
      status: "blocked",
    }));
  });

  it("uses the serializable active-run guard when creating a ledger", async () => {
    const dependencies = runtimeDependencies("enabled");
    await triggerProjectScheduledTaskRun({
      actorUserId: "user_1", projectId: "project_1", scheduledTaskId,
      commandId: "cmd_manual_guard", triggerSource: "manual",
    }, dependencies as never);
    expect(dependencies.createRunWithActiveGuard).toHaveBeenCalledWith(expect.objectContaining({
      scheduledTaskId,
      data: expect.objectContaining({ status: "preparing" }),
    }));
  });

  it("recovers a ledger that was inserted before its deterministic LoopRun existed", async () => {
    const dependencies = runtimeDependencies("enabled");
    const ledger = await createProjectScheduledTaskRunRecord({
      scheduledTaskId,
      triggerKey: "e".repeat(32),
      triggerSource: "manual",
      triggeredAt: new Date("2026-09-22T00:58:00.000Z"),
      status: "preparing",
      taskSnapshot: baseTask("enabled"),
      contentSnapshot: "# 检查",
      executionTargetSnapshot: baseTask("enabled").executionTargetSnapshot,
    }, dependencies as never);
    dependencies.listPreparingRuns.mockResolvedValue([{
      id: ledger.runId,
      scheduledTaskId,
      triggerKey: "e".repeat(32),
      triggerSource: "manual",
      scheduledFor: null,
      triggeredAt: new Date("2026-09-22T00:58:00.000Z"),
      taskSnapshot: baseTask("enabled"),
      contentSnapshot: "# 检查",
      executionTargetSnapshot: baseTask("enabled").executionTargetSnapshot,
      loopRun: null,
    }]);

    await expect(recoverPreparingProjectScheduledTaskRuns({ limit: 10 }, dependencies as never))
      .resolves.toMatchObject({ scanned: 1, recovered: 1, failed: 0, errors: 0 });
    const claim = dependencies.claimPreparingRun.mock.calls[0]![0] as { leaseToken: string };
    expect(dependencies.createLoopRun).toHaveBeenCalledWith(expect.objectContaining({
      scheduledTaskRunId: ledger.runId,
      sourceEventId: "e".repeat(32),
      scheduledTaskPreparationFence: {
        scheduledTaskRunId: ledger.runId,
        expectedVersion: 2,
        leaseToken: claim.leaseToken,
        now: new Date("2026-09-22T01:00:00.000Z"),
      },
    }));
    expect(dependencies.completeRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: ledger.runId,
      loopRunReference: { id: "loop_run_1", engineKind: "graph_v1" },
    }));
  });

  it("does not recover a preparing run while its preparation lease is still live", async () => {
    const dependencies = runtimeDependencies("enabled");
    dependencies.listPreparingRuns.mockResolvedValue([preparingRun({
      triggeredAt: new Date("2026-09-22T00:59:50.000Z"),
      preparationLeaseExpiresAt: new Date("2026-09-22T01:01:00.000Z"),
    })]);

    await expect(recoverPreparingProjectScheduledTaskRuns({ limit: 10 }, dependencies as never))
      .resolves.toMatchObject({ scanned: 1, recovered: 0, failed: 0, errors: 0 });
    expect(dependencies.claimPreparingRun).not.toHaveBeenCalled();
    expect(dependencies.createLoopRun).not.toHaveBeenCalled();
    expect(dependencies.completeRun).not.toHaveBeenCalled();
  });

  it("lets exactly one racing recovery worker claim and finalize a stale preparing run", async () => {
    const dependencies = runtimeDependencies("enabled");
    let claimedToken: string | null = null;
    dependencies.claimPreparingRun.mockImplementation(async ({ leaseToken }) => {
      if (claimedToken !== null) return { claimed: false, version: null };
      claimedToken = leaseToken;
      return { claimed: true, version: 2 };
    });
    dependencies.listPreparingRuns.mockResolvedValue([preparingRun({
      triggeredAt: new Date("2026-09-22T00:58:00.000Z"),
      preparationLeaseExpiresAt: new Date("2026-09-22T00:58:30.000Z"),
    })]);
    dependencies.loadLoopRunReference.mockResolvedValue({
      id: "9".repeat(32),
      engineKind: "graph_v1",
      projectId: "project_1",
      scheduledTaskRunId: null,
      status: "running",
      finishedAt: null,
    });

    const results = await Promise.all([
      recoverPreparingProjectScheduledTaskRuns({ limit: 10 }, dependencies as never),
      recoverPreparingProjectScheduledTaskRuns({ limit: 10 }, dependencies as never),
    ]);

    expect(results.reduce((total, result) => total + result.recovered, 0)).toBe(1);
    expect(dependencies.claimPreparingRun).toHaveBeenCalledTimes(2);
    expect(dependencies.completeRun).toHaveBeenCalledTimes(1);
    expect(dependencies.createLoopRun).not.toHaveBeenCalled();
  });

  it("does not let a stale trigger create a LoopRun or overwrite a recovered lease", async () => {
    const dependencies = runtimeDependencies("enabled");
    dependencies.persistPreparationSnapshot.mockResolvedValue({ updated: false, version: 2 });

    await expect(triggerProjectScheduledTaskRun({
      actorUserId: "user_1",
      projectId: "project_1",
      scheduledTaskId,
      commandId: "cmd_stale_preparation",
      triggerSource: "manual",
    }, dependencies as never)).rejects.toMatchObject({ code: "preparation_lease_lost" });

    expect(dependencies.createLoopRun).not.toHaveBeenCalled();
    expect(dependencies.failRun).not.toHaveBeenCalled();
    expect(dependencies.completeRun).not.toHaveBeenCalled();
  });

  it("persists the frozen LoopRun input and resumes linking after completion fails", async () => {
    const dependencies = runtimeDependencies("enabled");
    dependencies.completeRun.mockRejectedValue(new Error("database unavailable"));

    await expect(triggerProjectScheduledTaskRun({
      actorUserId: "user_1",
      projectId: "project_1",
      scheduledTaskId,
      commandId: "cmd_resume_link",
      triggerSource: "manual",
    }, dependencies as never)).rejects.toThrow("database unavailable");

    expect(dependencies.persistPreparationSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      runId: expect.stringMatching(/^[a-f0-9]{32}$/u),
      leaseToken: expect.stringMatching(/^[a-f0-9]{32}$/u),
      snapshot: expect.objectContaining({
        loopRunInput: expect.objectContaining({ scheduledTaskRunId: expect.stringMatching(/^[a-f0-9]{32}$/u) }),
      }),
    }));
    expect(dependencies.failRun).not.toHaveBeenCalled();

    const stored = dependencies.persistPreparationSnapshot.mock.calls[0]![0] as {
      runId: string;
      leaseToken: string;
      snapshot: Record<string, unknown>;
    };
    dependencies.completeRun.mockReset().mockResolvedValue(undefined);
    dependencies.createLoopRun.mockClear();
    dependencies.listPreparingRuns.mockResolvedValue([preparingRun({
      id: stored.runId,
      triggerKey: stored.snapshot.loopRunInput.sourceEventId,
      version: 2,
      triggeredAt: new Date("2026-09-22T00:58:00.000Z"),
      preparationLeaseToken: stored.leaseToken,
      preparationLeaseExpiresAt: new Date("2026-09-22T00:58:30.000Z"),
      preparationSnapshot: stored.snapshot,
    })]);
    dependencies.loadLoopRunReference.mockResolvedValue({
      id: "8".repeat(32),
      engineKind: "graph_v1",
      projectId: "project_1",
      scheduledTaskRunId: stored.runId,
      status: "completed",
      finishedAt: new Date("2026-09-22T01:02:00.000Z"),
    });

    await expect(recoverPreparingProjectScheduledTaskRuns({ limit: 10 }, dependencies as never))
      .resolves.toMatchObject({ scanned: 1, recovered: 1, failed: 0, errors: 0 });
    expect(dependencies.createLoopRun).not.toHaveBeenCalled();
    expect(dependencies.failRun).not.toHaveBeenCalled();
    expect(dependencies.completeRun).toHaveBeenCalledWith(expect.objectContaining({
      loopRunReference: { id: "8".repeat(32), engineKind: "graph_v1" },
      status: "succeeded",
      finishedAt: new Date("2026-09-22T01:02:00.000Z"),
    }));
  });

  it("bounds stale recovery scans and terminalizes expired runs with a safe reason", async () => {
    const dependencies = runtimeDependencies("enabled");
    dependencies.listPreparingRuns.mockResolvedValue([preparingRun({
      triggeredAt: new Date("2026-09-22T00:58:00.000Z"),
      preparationLeaseExpiresAt: new Date("2026-09-22T00:58:30.000Z"),
    })]);
    dependencies.loadBinding.mockResolvedValue(null);

    await expect(recoverPreparingProjectScheduledTaskRuns({ limit: 10 }, dependencies as never))
      .resolves.toMatchObject({ scanned: 1, recovered: 0, failed: 1, errors: 0 });
    expect(dependencies.listPreparingRuns).toHaveBeenCalledWith({
      limit: 10,
      now: new Date("2026-09-22T01:00:00.000Z"),
      staleBefore: new Date("2026-09-22T00:59:30.000Z"),
    });
    expect(dependencies.claimPreparingRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: "d".repeat(32),
      expectedVersion: 1,
      staleBefore: new Date("2026-09-22T00:59:30.000Z"),
    }));
    expect(dependencies.failRun).toHaveBeenCalledWith(expect.objectContaining({
      status: "blocked",
      failureCode: "loop_binding_unavailable",
    }));
    expect(dependencies.createLoopRun).not.toHaveBeenCalled();
  });

  it("treats a blocked ledger with an active LoopRun as occupying the execution slot", () => {
    const occupies = (runtime as unknown as {
      scheduledTaskRunOccupiesActiveSlot?: (run: { status: string; loopRun: { status: string } | null }) => boolean;
    }).scheduledTaskRunOccupiesActiveSlot;
    expect(occupies).toBeTypeOf("function");
    expect(occupies!({ status: "blocked", loopRun: { status: "running" } })).toBe(true);
    expect(occupies!({ status: "blocked", loopRun: { status: "waiting" } })).toBe(true);
    expect(occupies!({ status: "blocked", loopRun: { status: "completed" } })).toBe(false);
  });

  it("cannot fail a run outside the expected preparing lease and version", async () => {
    const transition = (runtime as unknown as {
      transitionPreparingScheduledTaskRun?: (
        input: {
          runId: string;
          scheduledTaskId: string;
          expectedVersion: number;
          leaseToken: string;
          status: "running" | "succeeded" | "failed";
          finishedAt: Date;
        },
        db: {
          projectScheduledTaskRun: { updateMany: (input: unknown) => Promise<{ count: number }> };
          projectScheduledTaskEvent: { upsert: (input: unknown) => Promise<unknown> };
        },
      ) => Promise<boolean>;
    }).transitionPreparingScheduledTaskRun;
    expect(transition).toBeTypeOf("function");

    for (const status of ["running", "succeeded", "failed"] as const) {
      const updateMany = vi.fn().mockResolvedValue({ count: 0 });
      const upsert = vi.fn();
      const updated = await transition!({
        runId: "d".repeat(32),
        scheduledTaskId,
        expectedVersion: 3,
        leaseToken: "f".repeat(32),
        status,
        finishedAt: new Date("2026-09-22T01:00:00.000Z"),
      } as never, {
        projectScheduledTaskRun: { updateMany },
        projectScheduledTaskEvent: { upsert },
      });

      expect(updated).toBe(false);
      expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          id: "d".repeat(32),
          status: "preparing",
          version: 3,
          preparationLeaseToken: "f".repeat(32),
        }),
      }));
      expect(upsert).not.toHaveBeenCalled();
    }
  });

  it("retries a failed ledger completion without terminally closing the active LoopRun", async () => {
    const dependencies = runtimeDependencies("enabled");
    dependencies.completeRun
      .mockRejectedValueOnce(new Error("ledger write failed"))
      .mockResolvedValueOnce(undefined);

    await expect(triggerProjectScheduledTaskRun({
      actorUserId: "user_1",
      projectId: "project_1",
      scheduledTaskId,
      commandId: "cmd_complete_retry",
      triggerSource: "manual",
    }, dependencies as never)).resolves.toMatchObject({ status: "running", duplicate: false });

    expect(dependencies.completeRun).toHaveBeenCalledTimes(2);
    expect(dependencies.failRun).not.toHaveBeenCalled();
  });

  it("links an already-created deterministic LoopRun before resolving current binding state", async () => {
    const dependencies = runtimeDependencies("enabled");
    const ledger = await createProjectScheduledTaskRunRecord({
      scheduledTaskId,
      triggerKey: "e".repeat(32),
      triggerSource: "manual",
      triggeredAt: new Date("2026-09-22T00:58:00.000Z"),
      status: "preparing",
      taskSnapshot: baseTask("enabled"),
      contentSnapshot: "# 检查",
      executionTargetSnapshot: baseTask("enabled").executionTargetSnapshot,
    }, dependencies as never);
    dependencies.listPreparingRuns.mockResolvedValue([{
      id: ledger.runId,
      scheduledTaskId,
      triggerKey: "e".repeat(32),
      triggerSource: "manual",
      scheduledFor: null,
      triggeredAt: new Date("2026-09-22T00:58:00.000Z"),
      taskSnapshot: baseTask("enabled"),
      contentSnapshot: "# 检查",
      executionTargetSnapshot: baseTask("enabled").executionTargetSnapshot,
      loopRun: null,
    }]);
    dependencies.loadLoopRunReference.mockResolvedValue({
      id: "deterministic_loop_run",
      engineKind: "graph_v1",
      projectId: "project_1",
    });

    await expect(recoverPreparingProjectScheduledTaskRuns({ limit: 10 }, dependencies as never))
      .resolves.toMatchObject({ scanned: 1, recovered: 1, failed: 0, errors: 0 });
    expect(dependencies.loadBinding).not.toHaveBeenCalled();
    expect(dependencies.createLoopRun).not.toHaveBeenCalled();
    expect(dependencies.completeRun).toHaveBeenCalledWith(expect.objectContaining({
      loopRunReference: { id: "deterministic_loop_run", engineKind: "graph_v1" },
    }));
  });

  it("leaves an ambiguous completion for bounded recovery instead of failing a linked LoopRun", async () => {
    const dependencies = runtimeDependencies("enabled");
    dependencies.completeRun.mockRejectedValue(new Error("database unavailable"));

    await expect(triggerProjectScheduledTaskRun({
      actorUserId: "user_1",
      projectId: "project_1",
      scheduledTaskId,
      commandId: "cmd_complete_recovery",
      triggerSource: "manual",
    }, dependencies as never)).rejects.toThrow("database unavailable");
    expect(dependencies.failRun).not.toHaveBeenCalled();

    dependencies.createRunWithActiveGuard.mockRejectedValueOnce(
      Object.assign(new Error("Scheduled task already has an active run"), { code: "run_in_progress" }),
    );
    await expect(triggerProjectScheduledTaskRun({
      actorUserId: "user_1",
      projectId: "project_1",
      scheduledTaskId,
      commandId: "cmd_second_active",
      triggerSource: "manual",
    }, dependencies as never)).rejects.toMatchObject({ code: "run_in_progress" });
  });

  it("rejects a new run while another non-terminal run is active", async () => {
    const dependencies = runtimeDependencies("enabled");
    const runInProgressError = Object.assign(new Error("Scheduled task already has an active run"), { code: "run_in_progress" });
    dependencies.createRunWithActiveGuard.mockRejectedValue(runInProgressError);
    await expect(triggerProjectScheduledTaskRun({
      actorUserId: "user_1", projectId: "project_1", scheduledTaskId,
      commandId: "cmd_manual_4", triggerSource: "manual",
    }, dependencies as never)).rejects.toMatchObject({ code: "run_in_progress" });
    expect(dependencies.createLoopRun).not.toHaveBeenCalled();
  });

  it("replays an existing manual trigger before applying disabled-state policy", async () => {
    const dependencies = runtimeDependencies("disabled");
    dependencies.findByTriggerKey.mockResolvedValue({ id: "f".repeat(32), status: "succeeded" });

    await expect(triggerProjectScheduledTaskRun({
      actorUserId: "user_1",
      projectId: "project_1",
      scheduledTaskId,
      commandId: "cmd_manual_replay",
      triggerSource: "manual",
    }, dependencies as never)).resolves.toEqual({
      runId: "f".repeat(32),
      status: "succeeded",
      duplicate: true,
    });
    expect(dependencies.createRunWithActiveGuard).not.toHaveBeenCalled();
  });

  it("skips user authorization for scheduled triggers", async () => {
    const dependencies = runtimeDependencies("enabled");
    await triggerProjectScheduledTaskRun({
      projectId: "project_1", scheduledTaskId,
      commandId: "cmd_scheduled_1", triggerSource: "scheduled",
      scheduledFor: new Date("2026-09-22T01:00:00.000Z"),
    }, dependencies as never);

    expect(dependencies.assertCanWriteProject).not.toHaveBeenCalled();
    expect(dependencies.createLoopRun).toHaveBeenCalledWith(expect.objectContaining({
      triggerType: "scheduled",
    }));
  });

  it("reuses one automatic run when the same slot is reclassified from scheduled to catch_up", async () => {
    const dependencies = runtimeDependencies("enabled");
    const scheduledFor = new Date("2026-09-22T01:00:00.000Z");
    const scheduled = await triggerProjectScheduledTaskRun({
      projectId: "project_1",
      scheduledTaskId,
      commandId: "scheduled-due:slot",
      triggerSource: "scheduled",
      scheduledFor,
    }, dependencies as never);
    const firstWrite = dependencies.createRunWithActiveGuard.mock.calls[0]?.[0] as { data: { triggerKey: string } };
    dependencies.findByTriggerKey.mockResolvedValue({ id: scheduled.runId, status: scheduled.status });

    await expect(triggerProjectScheduledTaskRun({
      projectId: "project_1",
      scheduledTaskId,
      commandId: "catch-up-retry:slot",
      triggerSource: "catch_up",
      scheduledFor,
    }, dependencies as never)).resolves.toEqual({
      runId: scheduled.runId,
      status: scheduled.status,
      duplicate: true,
    });

    const secondWrite = dependencies.findByTriggerKey.mock.calls[1]?.[0] as { triggerKey: string };
    expect(secondWrite.triggerKey).toBe(firstWrite.data.triggerKey);
    expect(dependencies.createRunWithActiveGuard).toHaveBeenCalledOnce();
  });

  it("rejects an automatic trigger without a scheduled slot", async () => {
    const dependencies = runtimeDependencies("enabled");
    await expect(triggerProjectScheduledTaskRun({
      projectId: "project_1",
      scheduledTaskId,
      commandId: "scheduled-due:missing-slot",
      triggerSource: "scheduled",
    }, dependencies as never)).rejects.toMatchObject({ code: "validation_failed" });
    expect(dependencies.createRunWithActiveGuard).not.toHaveBeenCalled();
  });

  it("rejects a Local Agent target that is not allowed by the binding", async () => {
    const dependencies = runtimeDependencies("enabled", {
      executionTargetSnapshot: { type: "local_agent", id: "profile_claude", displayName: "Claude", provider: "claude" },
    });
    dependencies.loadBinding.mockResolvedValue(taskBinding({ allowedAgentProfileIds: ["profile_codex"], allowedProviders: ["codex"] }));
    dependencies.resolveExecutionTarget.mockResolvedValue({
      target: { type: "local_agent", agentProfileId: "profile_claude", profileDisplayName: "Claude", provider: "claude" },
      resolvedAt: "2026-09-22T01:00:00.000Z",
    });

    await expect(triggerProjectScheduledTaskRun({
      actorUserId: "user_1", projectId: "project_1", scheduledTaskId,
      commandId: "cmd_policy_agent", triggerSource: "manual",
    }, dependencies as never)).rejects.toMatchObject({ code: "validation_failed" });
    expect(dependencies.failRun).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "execution_target_invalid",
    }));
  });

  it("rejects a Worker Pool target that does not match the binding Worker configuration", async () => {
    const dependencies = runtimeDependencies("enabled");
    dependencies.loadBinding.mockResolvedValue(taskBinding({
      project: {
        workerPoolId: "e".repeat(32),
        workerRepositoryUrl: "https://example.com/repo.git",
        workerBranchPolicy: { allowedBranches: ["main"] },
      },
    }));
    dependencies.resolveExecutionTarget.mockResolvedValue({
      target: { type: "linux_worker_pool", workerPoolId: "c".repeat(32), poolDisplayName: "巡检 Worker" },
      resolvedAt: "2026-09-22T01:00:00.000Z",
    });

    await expect(triggerProjectScheduledTaskRun({
      actorUserId: "user_1", projectId: "project_1", scheduledTaskId,
      commandId: "cmd_policy_worker", triggerSource: "manual",
    }, dependencies as never)).rejects.toMatchObject({ code: "validation_failed" });
    expect(dependencies.failRun).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "execution_target_invalid",
    }));
  });

  it("records explicit blocked and failed statuses for invalid or unavailable execution targets", async () => {
    const invalid = runtimeDependencies("enabled");
    invalid.resolveExecutionTarget.mockRejectedValue(Object.assign(
      new Error("Selected execution target was revoked"),
      { code: "execution_target_invalid" },
    ));
    await expect(triggerProjectScheduledTaskRun({
      actorUserId: "user_1", projectId: "project_1", scheduledTaskId,
      commandId: "cmd_invalid_target", triggerSource: "manual",
    }, invalid as never)).rejects.toMatchObject({ code: "execution_target_invalid" });
    expect(invalid.failRun).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "execution_target_invalid",
      status: "blocked",
    }));

    const unavailable = runtimeDependencies("enabled");
    unavailable.resolveExecutionTarget.mockRejectedValue(Object.assign(
      new Error("Selected Local Agent is offline"),
      { code: "execution_target_unavailable" },
    ));
    await expect(triggerProjectScheduledTaskRun({
      actorUserId: "user_1", projectId: "project_1", scheduledTaskId,
      commandId: "cmd_unavailable_target", triggerSource: "manual",
    }, unavailable as never)).rejects.toMatchObject({ code: "execution_target_unavailable" });
    expect(unavailable.failRun).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "execution_target_unavailable",
      status: "failed",
    }));
  });

  it("classifies deleted, revoked, offline and full execution targets safely", () => {
    const base = {
      project: {
        spaceId: "space_1",
        ownerType: "personal" as const,
        ownerUserId: "user_1",
        companyId: null,
        workerPoolId: "c".repeat(32),
      },
      now: new Date("2026-09-22T01:00:00.000Z"),
    };
    expectFailureCode(() => resolveScheduledTaskExecutionTargetReadiness({
      ...base,
      target: { type: "local_agent", id: "profile_1", displayName: "Codex", provider: "codex" },
      profile: null,
    }), "execution_target_invalid");
    expectFailureCode(() => resolveScheduledTaskExecutionTargetReadiness({
      ...base,
      target: { type: "local_agent", id: "profile_1", displayName: "Codex", provider: "codex" },
      profile: { id: "profile_1", name: "Codex", provider: "codex", status: "active" },
      localWorkers: [],
    }), "execution_target_unavailable");
    expectFailureCode(() => resolveScheduledTaskExecutionTargetReadiness({
      ...base,
      target: { type: "linux_worker_pool", id: "c".repeat(32), displayName: "Worker", provider: null },
      pool: {
        id: "c".repeat(32), displayName: "Worker", status: "revoked", revokedAt: base.now,
        maxConcurrentRuns: 2, sessions: [],
      },
    }), "execution_target_invalid");
    expectFailureCode(() => resolveScheduledTaskExecutionTargetReadiness({
      ...base,
      target: { type: "linux_worker_pool", id: "c".repeat(32), displayName: "Worker", provider: null },
      pool: {
        id: "c".repeat(32), displayName: "Worker", status: "active", revokedAt: null,
        maxConcurrentRuns: 1,
        sessions: [{
          requestedConcurrency: 1,
          lastSeenAt: base.now,
          expiresAt: new Date("2026-09-22T01:02:00.000Z"),
          status: "active",
          revokedAt: null,
          linuxRuns: [{ id: "run_1", status: "running", leaseExpiresAt: new Date("2026-09-22T01:01:00.000Z") }],
        }],
      },
    }), "execution_target_unavailable");
  });

  it("counts only active runs with live leases against Worker Pool capacity", () => {
    const now = new Date("2026-09-22T01:00:00.000Z");
    const readiness = resolveScheduledTaskExecutionTargetReadiness({
      project: {
        spaceId: "space_1",
        ownerType: "personal",
        ownerUserId: "user_1",
        companyId: null,
        workerPoolId: "c".repeat(32),
      },
      target: { type: "linux_worker_pool", id: "c".repeat(32), displayName: "Worker", provider: null },
      pool: {
        id: "c".repeat(32),
        displayName: "Worker",
        status: "active",
        revokedAt: null,
        maxConcurrentRuns: 2,
        sessions: [{
          requestedConcurrency: 2,
          lastSeenAt: now,
          expiresAt: new Date("2026-09-22T01:02:00.000Z"),
          status: "active",
          revokedAt: null,
          linuxRuns: [
            { id: "completed", status: "succeeded", leaseExpiresAt: null },
            { id: "active", status: "running", leaseExpiresAt: new Date("2026-09-22T01:01:00.000Z") },
            { id: "expired", status: "running", leaseExpiresAt: new Date("2026-09-22T00:59:59.000Z") },
          ],
        }],
      },
      now,
    } as never);

    expect(readiness.target).toMatchObject({ type: "linux_worker_pool", workerPoolId: "c".repeat(32) });
  });

  it("allows a task-scoped root graph snapshot without a Task", async () => {
    const dependencies = runtimeDependencies("enabled", {
      configurationSnapshot: {
        projectId: "project_1",
        loopBindingId: "binding_1",
        loopDefinitionId: "definition_1",
        loopVersionId: "version_1",
        loopScope: "task",
      },
    });
    dependencies.loadBinding.mockResolvedValue(taskBinding({ loopDefinition: { scope: "task" } }));
    dependencies.loadPublishedVersions.mockResolvedValue([{
      loopDefinitionId: "definition_1",
      loopVersionId: "version_1",
      scope: "task",
      graph: taskGraphVersions()[0]!.graph,
    }]);

    await expect(triggerProjectScheduledTaskRun({
      actorUserId: "user_1", projectId: "project_1", scheduledTaskId,
      commandId: "cmd_task_root", triggerSource: "manual",
    }, dependencies as never)).resolves.toMatchObject({ status: "running", duplicate: false });
    const loopRunInput = dependencies.createLoopRun.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(loopRunInput).toMatchObject({ scheduledTaskRunId: expect.stringMatching(/^[a-f0-9]{32}$/u) });
    expect(loopRunInput).not.toHaveProperty("taskId");
    expect(loopRunInput.runGraphSnapshot).toMatchObject({ rootLoopVersionId: "version_1" });
  });

  it("blocks an archived Loop definition before creating a LoopRun", async () => {
    const dependencies = runtimeDependencies("enabled");
    dependencies.loadBinding.mockResolvedValue(taskBinding({
      loopDefinition: {
        name: "巡检 Loop",
        scope: "project",
        status: "archived",
        latestPublishedVersion: {
          id: "version_1",
          status: "published",
          maxStages: 4,
          maxRepeatCount: 2,
          platformMaxTransitions: 8,
        },
      },
    }));

    await expect(triggerProjectScheduledTaskRun({
      actorUserId: "user_1",
      projectId: "project_1",
      scheduledTaskId,
      commandId: "cmd_archived_loop",
      triggerSource: "manual",
    }, dependencies as never)).rejects.toMatchObject({ code: "loop_binding_unavailable" });

    expect(dependencies.createLoopRun).not.toHaveBeenCalled();
    expect(dependencies.failRun).toHaveBeenCalledWith(expect.objectContaining({
      status: "blocked",
      failureCode: "loop_binding_unavailable",
    }));
  });

  it("leaves a linked LoopRun recoverable when the ledger transition keeps failing", async () => {
    const dependencies = runtimeDependencies("enabled");
    const transitionError = new Error("event write failed");
    dependencies.completeRun.mockRejectedValue(transitionError);
    await expect(triggerProjectScheduledTaskRun({
      actorUserId: "user_1", projectId: "project_1", scheduledTaskId,
      commandId: "cmd_event_fail", triggerSource: "manual",
    }, dependencies as never)).rejects.toThrow("event write failed");
    expect(dependencies.completeRun).toHaveBeenCalledTimes(2);
    expect(dependencies.failRun).not.toHaveBeenCalled();
  });
});

describe("project scheduled task run status projection", () => {
  it("maps LoopRun lifecycle states to scheduled task run states", () => {
    expect(projectScheduledTaskRunStatus("pending")).toBe("running");
    expect(projectScheduledTaskRunStatus("running")).toBe("running");
    expect(projectScheduledTaskRunStatus("waiting")).toBe("waiting");
    expect(projectScheduledTaskRunStatus("paused")).toBe("waiting");
    expect(projectScheduledTaskRunStatus("completed")).toBe("succeeded");
    expect(projectScheduledTaskRunStatus("cancelled")).toBe("cancelled");
    expect(projectScheduledTaskRunStatus("failed")).toBe("failed");
    expect(projectScheduledTaskRunStatus("exhausted")).toBe("failed");
    expect(() => projectScheduledTaskRunStatus("unknown")).toThrow(/Unsupported LoopRun status/u);
  });

  it("preserves preparing ledgers without a LoopRun during projection", async () => {
    const updateRunStatus = vi.fn().mockResolvedValue(undefined);
    const result = await projectScheduledTaskRunStatuses({
      now: new Date("2026-09-22T04:00:00.000Z"),
      limit: 100,
      dependencies: {
        listNonTerminalRuns: vi.fn().mockResolvedValue([
          { id: "a".repeat(32), status: "preparing", loopRun: null },
        ]),
        updateRunStatus,
      },
    });

    expect(result).toEqual({ scanned: 1, terminalized: 0, errors: 0 });
    expect(updateRunStatus).not.toHaveBeenCalled();
  });

  it("terminalizes a non-terminal run only when its linked LoopRun is terminal", async () => {
    const updateRunStatus = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-09-22T04:00:00.000Z");
    const result = await projectScheduledTaskRunStatuses({
      now,
      limit: 100,
      dependencies: {
        listNonTerminalRuns: vi.fn().mockResolvedValue([
          { id: "a".repeat(32), status: "running", loopRun: { status: "completed" } },
          { id: "b".repeat(32), status: "running", loopRun: { status: "waiting" } },
        ]),
        updateRunStatus,
      },
    });

    expect(result).toEqual({ scanned: 2, terminalized: 1, errors: 0 });
    expect(updateRunStatus).toHaveBeenNthCalledWith(1, {
      runId: "a".repeat(32), status: "succeeded", finishedAt: now,
    });
    expect(updateRunStatus).toHaveBeenNthCalledWith(2, {
      runId: "b".repeat(32), status: "waiting", finishedAt: null,
    });
  });

  it("uses the LoopRun terminal finish time when available", async () => {
    const updateRunStatus = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-09-22T04:00:00.000Z");
    const finishedAt = new Date("2026-09-22T03:59:00.000Z");
    await projectScheduledTaskRunStatuses({
      now,
      limit: 100,
      dependencies: {
        listNonTerminalRuns: vi.fn().mockResolvedValue([
          { id: "a".repeat(32), status: "running", loopRun: { status: "failed", finishedAt } },
        ]),
        updateRunStatus,
      },
    });

    expect(updateRunStatus).toHaveBeenCalledWith({
      runId: "a".repeat(32), status: "failed", finishedAt,
    });
  });

  it("reports projection row errors without blocking the scan", async () => {
    const onProjectionError = vi.fn();
    const result = await projectScheduledTaskRunStatuses({
      now: new Date("2026-09-22T04:00:00.000Z"),
      limit: 100,
      dependencies: {
        listNonTerminalRuns: vi.fn().mockResolvedValue([
          { id: "a".repeat(32), status: "running", loopRun: { status: "mystery" } },
        ]),
        updateRunStatus: vi.fn(),
        onProjectionError,
      },
    });

    expect(result).toEqual({ scanned: 1, terminalized: 0, errors: 1 });
    expect(onProjectionError).toHaveBeenCalledWith({
      runId: "a".repeat(32), errorCode: "unsupported_loop_run_status",
    });
  });
});

describe("scheduled task schedule writes", () => {
  type ScheduleState = {
    nextRunAt: Date | null;
    pendingScheduledFor: Date | null;
    lastScheduledFor: Date | null;
  };

  function sameDateOrNull(left: unknown, right: Date | null): boolean {
    if (right === null) return left === null || left === undefined;
    if (!(left instanceof Date) && typeof left !== "string" && typeof left !== "number") return false;
    const date = left instanceof Date ? left : new Date(left);
    return Number.isFinite(date.valueOf()) && date.getTime() === right.getTime();
  }

  function asDate(value: unknown): Date | null {
    if (value === null || value === undefined) return null;
    return value instanceof Date ? value : new Date(String(value));
  }

  function makeScheduleDb(initial: ScheduleState) {
    const state: ScheduleState = { ...initial };
    const db = {
      state,
      async updateMany(input: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        if (input.where.id !== scheduledTaskId) return { count: 0 };
        if (isDateRange(input.where.nextRunAt)) {
          const minimum = asDate(input.where.nextRunAt.gte);
          if (minimum === null || state.nextRunAt === null || state.nextRunAt.getTime() < minimum.getTime()) {
            return { count: 0 };
          }
        } else if (!sameDateOrNull(input.where.nextRunAt, state.nextRunAt)) {
          return { count: 0 };
        }
        if (!sameDateOrNull(input.where.pendingScheduledFor, state.pendingScheduledFor)) return { count: 0 };
        if (!sameDateOrNull(input.where.lastScheduledFor, state.lastScheduledFor)) return { count: 0 };
        if ("nextRunAt" in input.data) state.nextRunAt = asDate(input.data.nextRunAt);
        if ("pendingScheduledFor" in input.data) state.pendingScheduledFor = asDate(input.data.pendingScheduledFor);
        if ("lastScheduledFor" in input.data) state.lastScheduledFor = asDate(input.data.lastScheduledFor);
        return { count: 1 };
      },
      async findUnique() {
        return { ...state };
      },
    };
    return db;
  }

  function isDateRange(value: unknown): value is { gte: unknown } {
    return value !== null && typeof value === "object" && "gte" in value;
  }

  function writeInput(overrides: Record<string, unknown> = {}) {
    return {
      scheduledTaskId,
      scheduledFor: new Date("2026-09-22T01:00:00.000Z"),
      nextRunAt: new Date("2026-09-22T02:00:00.000Z"),
      now: new Date("2026-09-22T01:00:00.000Z"),
      expectedNextRunAt: new Date("2026-09-22T01:00:00.000Z"),
      expectedPendingScheduledFor: null,
      expectedLastScheduledFor: null,
      ...overrides,
    } as Parameters<typeof advanceDueScheduledTaskSchedule>[1];
  }

  it("treats an out-of-order concurrent advance as idempotent without overwriting state", async () => {
    const db = makeScheduleDb({
      nextRunAt: new Date("2026-09-22T01:00:00.000Z"),
      pendingScheduledFor: null,
      lastScheduledFor: null,
    });

    const first = await advanceDueScheduledTaskSchedule(db as never, writeInput());
    expect(first).toEqual({ matched: true, alreadyAdvanced: false });

    const stale = await advanceDueScheduledTaskSchedule(db as never, writeInput());
    expect(stale).toEqual({ matched: false, alreadyAdvanced: true });
    expect(db.state.nextRunAt).toEqual(new Date("2026-09-22T02:00:00.000Z"));
    expect(db.state.lastScheduledFor).toEqual(new Date("2026-09-22T01:00:00.000Z"));
    expect(db.state.pendingScheduledFor).toBeNull();
  });

  it("keeps an old slot idempotent after a later slot has advanced", async () => {
    const db = makeScheduleDb({
      nextRunAt: new Date("2026-09-22T02:00:00.000Z"),
      pendingScheduledFor: null,
      lastScheduledFor: new Date("2026-09-22T01:00:00.000Z"),
    });

    const later = await advanceDueScheduledTaskSchedule(db as never, writeInput({
      scheduledFor: new Date("2026-09-22T02:00:00.000Z"),
      nextRunAt: new Date("2026-09-22T03:00:00.000Z"),
      expectedNextRunAt: new Date("2026-09-22T02:00:00.000Z"),
      expectedLastScheduledFor: new Date("2026-09-22T01:00:00.000Z"),
    }));
    expect(later).toEqual({ matched: true, alreadyAdvanced: false });

    const old = await advanceDueScheduledTaskSchedule(db as never, writeInput({
      scheduledFor: new Date("2026-09-22T01:00:00.000Z"),
      nextRunAt: new Date("2026-09-22T02:00:00.000Z"),
      expectedNextRunAt: new Date("2026-09-22T01:00:00.000Z"),
      expectedLastScheduledFor: null,
    }));
    expect(old).toEqual({ matched: false, alreadyAdvanced: true });
    expect(db.state.nextRunAt).toEqual(new Date("2026-09-22T03:00:00.000Z"));
  });

  it("does not replace a later pending slot with an earlier one", async () => {
    const db = makeScheduleDb({
      nextRunAt: new Date("2026-09-22T01:00:00.000Z"),
      pendingScheduledFor: null,
      lastScheduledFor: null,
    });

    const first = await deferDueScheduledTaskSchedule(db as never, writeInput({
      scheduledFor: new Date("2026-09-22T02:00:00.000Z"),
      nextRunAt: new Date("2026-09-22T03:00:00.000Z"),
    }));
    expect(first).toEqual({ matched: true, alreadyAdvanced: false });

    const stale = await deferDueScheduledTaskSchedule(db as never, writeInput({
      scheduledFor: new Date("2026-09-22T01:00:00.000Z"),
      nextRunAt: new Date("2026-09-22T02:00:00.000Z"),
    }));
    expect(stale).toEqual({ matched: false, alreadyAdvanced: false });
    expect(db.state.pendingScheduledFor).toEqual(new Date("2026-09-22T02:00:00.000Z"));
    expect(db.state.nextRunAt).toEqual(new Date("2026-09-22T03:00:00.000Z"));
  });

  it("finalizes a concurrent defer without regressing its advanced nextRunAt", async () => {
    const db = makeScheduleDb({
      nextRunAt: new Date("2026-09-22T01:00:00.000Z"),
      pendingScheduledFor: null,
      lastScheduledFor: null,
    });
    const deferred = await deferDueScheduledTaskSchedule(db as never, writeInput());
    expect(deferred).toEqual({ matched: true, alreadyAdvanced: false });

    const finalized = await advanceDueScheduledTaskSchedule(db as never, writeInput());

    expect(finalized).toEqual({ matched: true, alreadyAdvanced: false });
    expect(db.state.nextRunAt).toEqual(new Date("2026-09-22T02:00:00.000Z"));
    expect(db.state.pendingScheduledFor).toBeNull();
    expect(db.state.lastScheduledFor).toEqual(new Date("2026-09-22T01:00:00.000Z"));
  });
});
