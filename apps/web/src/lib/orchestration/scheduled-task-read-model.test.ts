import { describe, expect, it, vi } from "vitest";
import { scheduledTaskProjectDigest } from "@humanthread/db";
import {
  buildProjectScheduledTaskLoopOptions,
  buildProjectScheduledTaskTargetOptions,
  readProjectScheduledTaskDetail,
  readProjectScheduledTaskList,
  readProjectScheduledTaskRunView,
} from "./scheduled-task-read-model";

const scheduledTaskId = "a".repeat(32);
const runId = "b".repeat(32);
const projectDigest = scheduledTaskProjectDigest("project_1");

function readDependencies() {
  return {
    assertCanReadProject: vi.fn().mockResolvedValue({ projectId: "project_1", role: "viewer" }),
    loadTask: vi.fn().mockResolvedValue({
      id: scheduledTaskId,
      projectDigest,
      name: "每日巡检",
      status: "enabled",
      version: 3,
      cronExpression: "0 9 * * *",
      timezone: "Asia/Shanghai",
      contentMode: "platform",
      contentMarkdown: "# 当前正文",
      configurationSnapshot: { loopBindingId: "binding_1", loopScope: "project" },
      executionTargetSnapshot: { type: "linux_worker_pool", id: "pool_1", displayName: "巡检 Worker", provider: null },
    }),
    loadRuns: vi.fn().mockResolvedValue([{
      id: runId,
      status: "succeeded",
      triggerSource: "scheduled",
      triggeredAt: new Date("2026-09-22T01:00:00.000Z"),
      startedAt: new Date("2026-09-22T01:00:01.000Z"),
      finishedAt: new Date("2026-09-22T01:01:31.000Z"),
      taskSnapshot: { name: "每日巡检", version: 2 },
      contentSnapshot: null,
      executionTargetSnapshot: { type: "linux_worker_pool", id: "pool_1", displayName: "巡检 Worker", provider: null },
      loopRunReference: { id: "loop_run_1", engineKind: "graph_v1" },
      loopRun: { id: "loop_run_1", projectId: "project_1" },
    }]),
    readLoopRun: vi.fn().mockResolvedValue({
      run: { id: "loop_run_1", status: "completed" },
      nodes: [{
        nodeKey: "inspect",
        label: "检查",
        status: "completed",
        currentNodeRunId: "node_run_1",
        attempts: [{ result: { ok: true }, error: null }],
      }],
      activities: [],
    }),
  };
}

describe("project scheduled task read model", () => {
  it("returns run snapshots and the linked Loop projection", async () => {
    const result = await readProjectScheduledTaskDetail({
      userId: "user_1", projectId: "project_1", scheduledTaskId: "a".repeat(32),
      runId: "b".repeat(32),
    }, {
      assertCanReadProject: vi.fn().mockResolvedValue({ projectId: "project_1", role: "viewer" }),
      loadTask: vi.fn().mockResolvedValue({
        id: "a".repeat(32), status: "enabled", taskSnapshot: {}, executionTargetSnapshot: {},
      }),
      loadRuns: vi.fn().mockResolvedValue([{
        id: "b".repeat(32), status: "succeeded", taskSnapshot: { name: "每日巡检" },
        contentSnapshot: null, loopRunReference: { id: "loop_run_1" },
        loopRun: { id: "loop_run_1", projectId: "project_1" },
      }]),
      readLoopRun: vi.fn().mockResolvedValue({
        run: { id: "loop_run_1", status: "completed" },
        nodes: [{ nodeKey: "inspect", label: "检查", status: "completed", attempts: [] }],
        activities: [{ id: "event_1", kind: "loop.run.completed", summary: "完成" }],
      }),
    });
    expect(result?.selectedRun?.id).toBe("b".repeat(32));
    expect(result?.report.primaryArtifactRef).toBeNull();
    expect(result?.loopRun?.run.id).toBe("loop_run_1");
  });

  it("keeps list results project-scoped and omits run content snapshots", async () => {
    const loadTasks = vi.fn().mockResolvedValue([{
      id: scheduledTaskId,
      projectDigest,
      name: "每日巡检",
      status: "enabled",
      version: 2,
      cronExpression: "0 9 * * *",
      timezone: "Asia/Shanghai",
      contentMode: "platform",
      contentMarkdown: "# 当前正文",
      configurationSnapshot: { loopBindingId: "binding_1", loopScope: "project" },
      executionTargetSnapshot: { type: "linux_worker_pool", id: "pool_1", displayName: "巡检 Worker", provider: null },
      nextRunAt: "2026-09-23T01:00:00.000Z",
      contentSnapshot: "must-not-leak",
      runs: [{
        id: runId,
        status: "failed",
        triggeredAt: new Date("2026-09-22T01:00:00.000Z"),
        startedAt: new Date("2026-09-22T01:00:01.000Z"),
        finishedAt: new Date("2026-09-22T01:00:31.000Z"),
        executionTargetSnapshot: { type: "linux_worker_pool", id: "pool_1", displayName: "巡检 Worker", provider: null },
      }],
    }]);

    const result = await readProjectScheduledTaskList({ userId: "user_1", projectId: "project_1" }, {
      assertCanReadProject: vi.fn().mockResolvedValue({ projectId: "project_1", role: "maintainer" }),
      loadTasks,
      loadLoopOptions: vi.fn().mockResolvedValue([{ id: "binding_1", name: "项目巡检", scope: "project", versionNumber: 4 }]),
      loadTargetOptions: vi.fn().mockResolvedValue([]),
    });

    expect(result).toMatchObject({
      canEdit: true,
      tasks: [{
        id: scheduledTaskId,
        contentMarkdown: "# 当前正文",
        loopBinding: { id: "binding_1", name: "项目巡检", scope: "project", versionNumber: 4 },
        activeRun: null,
        latestRun: {
          id: runId,
          status: "failed",
          durationMs: 30_000,
          targetType: "linux_worker_pool",
        },
      }],
    });
    expect(result?.tasks[0]).not.toHaveProperty("contentSnapshot");
    expect(loadTasks).toHaveBeenCalledWith(expect.objectContaining({
      projectDigest: expect.stringMatching(/^[a-f0-9]{32}$/u),
    }));
  });

  it("loads the exact latest run when no run id is selected", async () => {
    const deps = readDependencies();
    deps.loadRuns.mockResolvedValue([{
      id: runId,
      status: "succeeded",
      triggerSource: "scheduled",
      triggeredAt: new Date("2026-09-22T01:00:00.000Z"),
      taskSnapshot: { name: "每日巡检" },
      executionTargetSnapshot: {},
      loopRunReference: { id: "loop_run_1" },
    }]);

    const result = await readProjectScheduledTaskDetail({
      userId: "user_1",
      projectId: "project_1",
      scheduledTaskId,
    }, {
      ...deps,
      loadRun: vi.fn().mockResolvedValue({
        id: runId,
        status: "succeeded",
        triggerSource: "scheduled",
        triggeredAt: new Date("2026-09-22T01:00:00.000Z"),
        taskSnapshot: { name: "每日巡检" },
        contentSnapshot: "# 历史正文",
        executionTargetSnapshot: {},
        loopRunReference: { id: "loop_run_1" },
      }),
    });

    expect(result?.selectedRun?.contentSnapshot).toBe("# 历史正文");
  });

  it("uses immutable run snapshots instead of the edited task configuration", async () => {
    const deps = readDependencies();
    deps.loadRuns.mockResolvedValue([{
      id: runId,
      status: "succeeded",
      triggerSource: "scheduled",
      triggeredAt: new Date("2026-09-22T01:00:00.000Z"),
      taskSnapshot: { name: "旧任务名", version: 2 },
      contentSnapshot: "# 旧正文",
      executionTargetSnapshot: {},
      loopRunReference: { id: "loop_run_1" },
    }]);

    const result = await readProjectScheduledTaskDetail({
      userId: "user_1",
      projectId: "project_1",
      scheduledTaskId,
      runId,
    }, deps);

    expect(result?.task.name).toBe("每日巡检");
    expect(result?.selectedRun).toMatchObject({
      taskSnapshot: { name: "旧任务名", version: 2 },
      contentSnapshot: "# 旧正文",
    });
  });

  it("merges artifacts into their Loop nodes and uses the report artifact as primary", async () => {
    const deps = readDependencies();
    deps.loadRuns.mockResolvedValue([]);
    deps.readLoopRun.mockResolvedValue({
      run: { id: "loop_run_1", status: "failed" },
      nodes: [
        {
          nodeKey: "inspect",
          label: "检查",
          status: "failed",
          currentNodeRunId: "node_run_1",
          attempts: [{ result: null, error: { code: "provider_error", message: "模型失败" } }],
        },
      ],
      activities: [],
    });
    const loadRun = vi.fn().mockResolvedValue({
      id: runId,
      status: "failed",
      triggerSource: "manual",
      triggeredAt: new Date("2026-09-22T01:00:00.000Z"),
      startedAt: new Date("2026-09-22T01:00:00.000Z"),
      finishedAt: new Date("2026-09-22T01:01:00.000Z"),
      taskSnapshot: { name: "每日巡检", version: 2 },
      contentSnapshot: null,
      executionTargetSnapshot: {},
      loopRunReference: { id: "loop_run_1", engineKind: "graph_v1" },
      loopRun: { id: "loop_run_1", projectId: "project_1" },
    });

    const result = await readProjectScheduledTaskRunView({
      userId: "user_1",
      projectId: "project_1",
      scheduledTaskId,
      runId,
    }, {
      ...deps,
      loadRun,
      loadArtifacts: vi.fn().mockResolvedValue([
        { id: "artifact_2", storageKey: "report.md", loopNodeRunId: "node_run_1" },
        { id: "artifact_1", storageKey: "detail.bin", loopNodeRunId: "node_run_1" },
      ]),
    });

    expect(loadRun).toHaveBeenCalledWith({ scheduledTaskId, runId });
    expect(result?.loopRun?.nodes[0]?.artifactRefs).toEqual(["report.md", "detail.bin"]);
    expect(result?.report).toMatchObject({
      status: "failed",
      durationMs: 60_000,
      completedNodes: 0,
      totalNodes: 1,
      failures: [{ nodeKey: "inspect", label: "检查", code: "provider_error", message: "模型失败" }],
      artifactRefs: ["report.md", "detail.bin"],
      primaryArtifactRef: "report.md",
    });
  });

  it("does not fabricate Loop nodes for a blocked run without a Loop Run", async () => {
    const readLoopRun = vi.fn();
    const result = await readProjectScheduledTaskRunView({
      userId: "user_1",
      projectId: "project_1",
      scheduledTaskId,
      runId,
    }, {
      assertCanReadProject: vi.fn().mockResolvedValue({ projectId: "project_1", role: "viewer" }),
      loadTask: vi.fn().mockResolvedValue({ id: scheduledTaskId, projectDigest, status: "enabled" }),
      loadRun: vi.fn().mockResolvedValue({
        id: runId,
        status: "blocked",
        triggerSource: "scheduled",
        triggeredAt: new Date("2026-09-22T01:00:00.000Z"),
        taskSnapshot: { name: "每日巡检" },
        contentSnapshot: null,
        executionTargetSnapshot: {},
        loopRunReference: null,
        failureCode: "task_content_missing",
        failureMessage: "任务正文缺失",
      }),
      readLoopRun,
    });

    expect(result?.loopRun).toBeNull();
    expect(result?.report).toMatchObject({
      status: "blocked",
      completedNodes: 0,
      totalNodes: 0,
      failures: [],
      primaryArtifactRef: null,
    });
    expect(readLoopRun).not.toHaveBeenCalled();
  });

  it("ignores a dangling loopRunReference when the authoritative Loop relation is absent", async () => {
    const readLoopRun = vi.fn();
    const result = await readProjectScheduledTaskRunView({
      userId: "user_1",
      projectId: "project_1",
      scheduledTaskId,
      runId,
    }, {
      assertCanReadProject: vi.fn().mockResolvedValue({ projectId: "project_1", role: "viewer" }),
      loadTask: vi.fn().mockResolvedValue({ id: scheduledTaskId, projectDigest, status: "enabled" }),
      loadRun: vi.fn().mockResolvedValue({
        id: runId,
        status: "failed",
        triggerSource: "scheduled",
        triggeredAt: new Date("2026-09-22T01:00:00.000Z"),
        taskSnapshot: { name: "每日巡检" },
        contentSnapshot: null,
        executionTargetSnapshot: {},
        loopRunReference: { id: "unrelated_loop_run", engineKind: "graph_v1" },
        loopRun: null,
        failureCode: "loop_run_creation_failed",
        failureMessage: "Loop Run creation failed",
      }),
      readLoopRun,
    });

    expect(result?.loopRun).toBeNull();
    expect(result?.run).toMatchObject({
      status: "failed",
      loopRunReference: null,
      failureCode: "loop_run_creation_failed",
      failureMessage: "Loop Run creation failed",
    });
    expect(JSON.stringify(result)).not.toContain("unrelated_loop_run");
    expect(readLoopRun).not.toHaveBeenCalled();
  });

  it("fails closed when the authoritative Loop Run belongs to another project", async () => {
    const readLoopRun = vi.fn().mockResolvedValue({
      run: { id: "loop_run_other", status: "completed" },
      nodes: [{ nodeKey: "leak", label: "Leak", status: "completed", attempts: [] }],
      activities: [],
    });
    const result = await readProjectScheduledTaskRunView({
      userId: "user_1",
      projectId: "project_1",
      scheduledTaskId,
      runId,
    }, {
      assertCanReadProject: vi.fn().mockResolvedValue({ projectId: "project_1", role: "viewer" }),
      loadTask: vi.fn().mockResolvedValue({ id: scheduledTaskId, projectDigest, status: "enabled" }),
      loadRun: vi.fn().mockResolvedValue({
        id: runId,
        status: "failed",
        triggerSource: "scheduled",
        triggeredAt: new Date("2026-09-22T01:00:00.000Z"),
        taskSnapshot: { name: "每日巡检" },
        contentSnapshot: null,
        executionTargetSnapshot: {},
        loopRunReference: { id: "loop_run_other", engineKind: "graph_v1" },
        loopRun: { id: "loop_run_other", projectId: "project_2" },
        failureCode: "loop_run_creation_failed",
        failureMessage: "Loop Run creation failed",
      }),
      readLoopRun,
    });

    expect(result?.loopRun).toBeNull();
    expect(result?.run.loopRunReference).toBeNull();
    expect(result?.report).toMatchObject({ status: "failed", totalNodes: 0 });
    expect(JSON.stringify(result)).not.toContain("loop_run_other");
    expect(JSON.stringify(result)).not.toContain("Leak");
    expect(readLoopRun).not.toHaveBeenCalled();
  });

  it("recursively aggregates child Loop failures, events and report artifacts", async () => {
    const childRunId = "c".repeat(32);
    const childNodeRunId = "node_child";
    const readLoopRun = vi.fn(async ({ loopRunId }: { loopRunId: string }) => loopRunId === "loop_run_1"
      ? {
        run: { id: "loop_run_1", status: "failed" },
        childRuns: [{ id: childRunId, parentNodeRunId: "node_parent", status: "failed" }],
        nodes: [{ nodeKey: "parent", label: "父节点", status: "completed", currentNodeRunId: "node_parent_run", attempts: [] }],
        edges: [],
        activities: [{ id: "root_event", cursor: 1, eventType: "loop.run.created", occurredAt: "2026-09-22T01:00:00.000Z", nodeKey: null, edgeId: null, summary: "根运行创建" }],
      }
      : {
        run: { id: childRunId, status: "failed" },
        childRuns: [{ id: "loop_run_1", parentNodeRunId: "child", status: "running" }],
        nodes: [{
          nodeKey: "child",
          label: "子节点",
          status: "failed",
          currentNodeRunId: childNodeRunId,
          attempts: [{ result: null, error: { code: "child_failed", message: "子任务失败" } }],
        }],
        edges: [],
        activities: [{ id: "child_event", cursor: 1, eventType: "loop.node.failed", occurredAt: "2026-09-22T01:01:00.000Z", nodeKey: "child", edgeId: null, summary: "子节点失败" }],
      });
    const loadArtifacts = vi.fn(async ({ loopRunId }: { loopRunId: string }) => loopRunId === childRunId
      ? [{ id: "artifact_1", storageKey: "reports/child.md", loopNodeRunId: childNodeRunId }]
      : []);

    const result = await readProjectScheduledTaskRunView({
      userId: "user_1",
      projectId: "project_1",
      scheduledTaskId,
      runId,
    }, {
      assertCanReadProject: vi.fn().mockResolvedValue({ projectId: "project_1", role: "viewer" }),
      loadTask: vi.fn().mockResolvedValue({ id: scheduledTaskId, projectDigest, status: "enabled" }),
      loadRun: vi.fn().mockResolvedValue({
        id: runId,
        status: "failed",
        triggerSource: "scheduled",
        triggeredAt: new Date("2026-09-22T01:00:00.000Z"),
        startedAt: new Date("2026-09-22T01:00:00.000Z"),
        finishedAt: new Date("2026-09-22T01:01:10.000Z"),
        taskSnapshot: { name: "每日巡检" },
        contentSnapshot: null,
        executionTargetSnapshot: {},
        loopRun: { id: "loop_run_1", projectId: "project_1" },
      }),
      readLoopRun: readLoopRun as never,
      loadArtifacts,
    });

    expect(result?.loopRun?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeKey: "parent", status: "completed" }),
      expect.objectContaining({ nodeKey: `${childRunId}:child`, status: "failed", artifactRefs: ["reports/child.md"] }),
    ]));
    expect(result?.loopRun?.activities.map((activity) => activity.summary)).toEqual(["根运行创建", "子节点失败"]);
    expect(result?.report.failures).toContainEqual(expect.objectContaining({ code: "child_failed" }));
    expect(result?.report.primaryArtifactRef).toBe("reports/child.md");
    expect(readLoopRun).toHaveBeenCalledTimes(2);
  });

  it("authorizes every entry point before loading project data", async () => {
    const listLoad = vi.fn();
    const detailLoad = vi.fn();
    const runLoad = vi.fn();
    const denied = Object.assign(new Error("denied"), { code: "project_access_denied" });

    await expect(readProjectScheduledTaskList({ userId: "user_1", projectId: "project_1" }, {
      assertCanReadProject: vi.fn().mockRejectedValue(denied),
      loadTasks: listLoad,
    })).rejects.toMatchObject({ code: "project_access_denied" });
    await expect(readProjectScheduledTaskDetail({
      userId: "user_1", projectId: "project_1", scheduledTaskId,
    }, {
      assertCanReadProject: vi.fn().mockRejectedValue(denied),
      loadTask: detailLoad,
    })).rejects.toMatchObject({ code: "project_access_denied" });
    await expect(readProjectScheduledTaskRunView({
      userId: "user_1", projectId: "project_1", scheduledTaskId, runId,
    }, {
      assertCanReadProject: vi.fn().mockRejectedValue(denied),
      loadTask: runLoad,
    })).rejects.toMatchObject({ code: "project_access_denied" });

    expect(listLoad).not.toHaveBeenCalled();
    expect(detailLoad).not.toHaveBeenCalled();
    expect(runLoad).not.toHaveBeenCalled();
  });

  it("fails closed for a scheduled task id from another project", async () => {
    const loadRuns = vi.fn();
    const loadRun = vi.fn();
    const deps = {
      assertCanReadProject: vi.fn().mockResolvedValue({ projectId: "project_1", role: "viewer" }),
      loadTask: vi.fn().mockResolvedValue(null),
    };

    await expect(readProjectScheduledTaskDetail({
      userId: "user_1", projectId: "project_1", scheduledTaskId, runId,
    }, { ...deps, loadRuns, loadRun })).resolves.toBeNull();
    await expect(readProjectScheduledTaskRunView({
      userId: "user_1", projectId: "project_1", scheduledTaskId, runId,
    }, { ...deps, loadRun })).resolves.toBeNull();

    expect(loadRuns).not.toHaveBeenCalled();
    expect(loadRun).not.toHaveBeenCalled();
  });
});

describe("project scheduled task option filtering", () => {
  it("excludes archived and unpublished Loop definitions", () => {
    const options = buildProjectScheduledTaskLoopOptions([
      {
        id: "binding_valid",
        status: "enabled",
        loopDefinition: { name: "有效 Loop", scope: "project", status: "published", latestPublishedVersion: { status: "published" } },
        activeVersion: { versionNumber: 3, status: "published" },
      },
      {
        id: "binding_archived",
        status: "enabled",
        loopDefinition: { name: "已归档 Loop", scope: "project", status: "archived", latestPublishedVersion: { status: "published" } },
        activeVersion: { versionNumber: 2, status: "published" },
      },
      {
        id: "binding_draft",
        status: "enabled",
        loopDefinition: { name: "未发布 Loop", scope: "task", status: "draft", latestPublishedVersion: { status: "draft" } },
        activeVersion: { versionNumber: 1, status: "draft" },
      },
      {
        id: "binding_active_draft",
        status: "enabled",
        loopDefinition: { name: "活动版本未发布", scope: "project", status: "published", latestPublishedVersion: { status: "published" } },
        activeVersion: { versionNumber: 4, status: "draft" },
      },
      {
        id: "binding_latest_draft",
        status: "enabled",
        loopDefinition: { name: "最新版本未发布", scope: "project", status: "published", latestPublishedVersion: { status: "draft" } },
        activeVersion: { versionNumber: 5, status: "published" },
      },
    ]);

    expect(options).toEqual([
      { id: "binding_valid", name: "有效 Loop", scope: "project", versionNumber: 3, targetOptions: [] },
    ]);
  });

  it("excludes archived and unpublished Loops from execution targets", () => {
    const binding = (id: string, definitionStatus: string, versionStatus: string) => ({
      id,
      status: "enabled",
      loopDefinition: {
        status: definitionStatus,
        latestPublishedVersion: { status: versionStatus },
      },
      activeVersion: { status: versionStatus },
      allowedAgentProfileIds: ["profile_codex"],
      allowedProviders: ["codex"],
      workerStageConfigurations: null,
    });
    const options = buildProjectScheduledTaskTargetOptions({
      project: { workerPoolId: null, loopBindings: [
        binding("binding_valid", "published", "published"),
        binding("binding_archived", "archived", "published"),
        binding("binding_draft", "draft", "draft"),
        binding("binding_active_draft", "published", "draft"),
      ] },
      agentProfiles: [{ id: "profile_codex", name: "Codex", provider: "codex" }],
      workerPools: [],
    });

    expect(options).toEqual([
      { type: "local_agent", id: "profile_codex", displayName: "本地 Agent · Codex", ready: true, reason: null, loopBindingIds: ["binding_valid"] },
    ]);
  });

  it("scopes execution targets to each selected Loop binding", async () => {
    const options = buildProjectScheduledTaskTargetOptions({
      project: { workerPoolId: null, loopBindings: [
        {
          id: "binding_a", status: "enabled",
          loopDefinition: { status: "published", latestPublishedVersion: { status: "published" } },
          activeVersion: { status: "published" },
          allowedAgentProfileIds: ["profile_codex"], allowedProviders: ["codex"], workerStageConfigurations: null,
        },
        {
          id: "binding_b", status: "enabled",
          loopDefinition: { status: "published", latestPublishedVersion: { status: "published" } },
          activeVersion: { status: "published" },
          allowedAgentProfileIds: ["profile_claude"], allowedProviders: ["claude"], workerStageConfigurations: null,
        },
      ] },
      agentProfiles: [
        { id: "profile_codex", name: "Codex", provider: "codex" },
        { id: "profile_claude", name: "Claude", provider: "claude" },
      ],
      workerPools: [],
    });
    expect(options).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "profile_codex", loopBindingIds: ["binding_a"] }),
      expect.objectContaining({ id: "profile_claude", loopBindingIds: ["binding_b"] }),
    ]));
  });
});
