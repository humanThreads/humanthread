import { describe, expect, it } from "vitest";
import {
  PROJECT_LOOP_SETTINGS_PAGE_TITLE,
  buildProjectLoopSettingsModel,
  dynamic,
} from "./page";

describe("Project Loop settings page", () => {
  it("is a dynamic project product route", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(PROJECT_LOOP_SETTINGS_PAGE_TITLE).toBe("项目 Loop 设置");
  });

  it("保留项目 Worker 资源中已保存的固定镜像", () => {
    const digest = `sha256:${"b".repeat(64)}`;

    const model = buildProjectLoopSettingsModel({
      project: {
        id: "project_1",
        name: "HumanThread",
        spaceId: "space_1",
        workerResource: {
          poolId: "a".repeat(32),
          repositoryUrl: "https://example.com/humanthread.git",
          branchPolicy: { allowedBranches: ["main"] },
          image: {
            repository: "registry.example.com/humanthread-worker",
            tag: "20260916-a",
            digest,
            resolvedAt: "2026-09-16T09:28:13.860Z",
          },
        },
      },
      definitions: [],
      bindings: [],
      grants: [],
      triggerTypes: [],
    });

    expect(model.project.workerResource?.image).toEqual({
      repository: "registry.example.com/humanthread-worker",
      tag: "20260916-a",
      digest,
      resolvedAt: "2026-09-16T09:28:13.860Z",
    });
  });

  it("normalizes published versions, limits, optional human gates, bindings, and grants", () => {
    expect(buildProjectLoopSettingsModel({
      project: { id: "project_1", name: "HumanThread", spaceId: "space_1" },
      definitions: [{
        id: "loop_1",
        name: "交付闭环",
        latestPublishedVersion: {
          id: "version_3",
          versionNumber: 3,
          graph: {
            schemaVersion: 1,
            inputSchema: { type: "object" },
            outputSchema: { type: "object" },
            limits: { maxStages: 8, maxRepeatCount: 2 },
            nodes: [
              { key: "start", label: "开始", type: "start" },
              {
                key: "agent",
                label: "执行",
                type: "agent_action",
                executionTarget: "either",
                promptTemplate: "执行任务",
                riskRequirements: { provider: "codex", tool: "git", commandCategory: "git" },
              },
              { key: "develop", label: "平台调度", type: "platform_action", executionTarget: "platform", action: "task_loop.invoke" },
              { key: "end", label: "结束", type: "end" },
            ],
            edges: [
              { id: "start-agent", source: "start", target: "agent", kind: "normal", outcome: "success" },
              { id: "agent-develop", source: "agent", target: "develop", kind: "normal", outcome: "success" },
              { id: "develop-end", source: "develop", target: "end", kind: "normal", outcome: "success" },
            ],
          },
        },
      }],
      bindings: [{
        id: "binding_1",
        loopDefinitionId: "loop_1",
        activeVersionId: "version_3",
        status: "enabled",
        version: 2,
        triggerPolicy: { manual: true, taskEvents: ["task.completed"] },
        automationGrantIds: ["grant_1"],
        workerPoolId: "a".repeat(32),
        workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
        workerBranchPolicy: { allowedBranches: ["main", "2026-HUMANTHR*"] },
        workerStageConfigurations: {
          agent: {
            siteId: "b".repeat(32),
            model: "gpt-5.2-codex",
            reasoningEffort: "high",
          },
        },
      }],
      grants: [{
        id: "grant_1",
        status: "active",
        permission: "workspace_full",
        workspaceBindingIds: ["workspace_1"],
        allowedRelativePathPrefixes: ["."],
        bindingIds: ["binding_1"],
        expiresAt: null,
        revokedAt: null,
      }],
      workspaceBindings: [{
        id: "workspace_1",
        localDeviceId: "device_1",
        status: "ready",
        configurationVersion: 2,
        localDevice: { name: "Alice MacBook" },
      }],
      triggerTypes: ["manual", "task_event"],
    })).toMatchObject({
      project: { id: "project_1", workspaceBindings: [{ id: "workspace_1", deviceName: "Alice MacBook" }] },
      definitions: [{ versions: [{
        id: "version_3",
        humanGateCount: 0,
        maxStages: 8,
        maxRepeatCount: 2,
        agentNodeKeys: ["agent"],
        grantScope: {
          nodeKeys: ["agent", "develop"],
          executionPlanes: ["local", "platform"],
          providers: ["codex"],
          tools: ["git"],
          commandCategories: ["git"],
          operationTypes: ["task_loop.invoke"],
        },
      }] }],
      bindings: [{
        id: "binding_1",
        version: 2,
        workerExecution: {
          poolId: "a".repeat(32),
          repositoryUrl: "https://github.com/humanthread/disaster.git",
          branchPolicy: { allowedBranches: ["main", "2026-HUMANTHR*"] },
          stageConfigurations: {
            agent: {
              siteId: "b".repeat(32),
              model: "gpt-5.2-codex",
              reasoningEffort: "high",
            },
          },
        },
      }],
      grants: [{ id: "grant_1", permission: "workspace_full" }],
      triggerTypes: ["manual", "task_event"],
    });
  });

  it("keeps an older version pinned by an existing binding", () => {
    const graph = {
      schemaVersion: 1,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      limits: { maxStages: 6, maxRepeatCount: 1 },
      nodes: [
        { key: "start", label: "开始", type: "start" },
        { key: "end", label: "结束", type: "end" },
      ],
      edges: [{ id: "start-end", source: "start", target: "end", kind: "normal", outcome: "success" }],
    };
    const result = buildProjectLoopSettingsModel({
      project: { id: "project_1", name: "HumanThread", spaceId: "space_1" },
      definitions: [{
        id: "loop_1",
        name: "交付闭环",
        latestPublishedVersion: { id: "version_3", versionNumber: 3, graph },
      }],
      bindings: [{
        id: "binding_1",
        loopDefinitionId: "loop_1",
        activeVersionId: "version_2",
        status: "enabled",
        version: 2,
        triggerPolicy: { manual: true, taskEvents: [] },
        automationGrantIds: [],
        activeVersion: { id: "version_2", versionNumber: 2, graph },
      }],
      grants: [],
      triggerTypes: ["manual", "task_event"],
    });

    expect(result.definitions[0]?.versions.map((version) => version.versionNumber)).toEqual([3, 2]);
  });

  it("projects development mode facts and the persisted Loop flow", () => {
    const result = buildProjectLoopSettingsModel({
      project: {
        id: "project_1",
        name: "HumanThread",
        spaceId: "space_1",
        developmentMode: {
          key: "branch-development",
          name: "分支开发",
          version: 1,
          productionBranch: "main",
          stagingBranch: "staging",
          releaseAgentProfileId: "profile_release",
          config: { taskBranchPattern: "{year}-{shortId}" },
          executionPolicy: { integrationMode: "local_merge_test_push" },
          triggerPolicy: { releaseTriggers: ["milestone.release_ready", "manual"] },
          developmentLoopVersionId: "version_task",
          releaseLoopVersionId: "version_release",
        },
      },
      definitions: [{
        id: "loop_task",
        name: "Branch Development: Task Development",
        description: "Develop one task",
        latestPublishedVersion: {
          id: "version_task",
          versionNumber: 1,
          graph: {
            schemaVersion: 1,
            inputSchema: { type: "object" },
            outputSchema: { type: "object" },
            limits: { maxStages: 5, maxRepeatCount: 1 },
            nodes: [
              { key: "start", type: "start", label: "Start" },
              { key: "develop", type: "agent_action", label: "Develop", executionTarget: "local", promptTemplate: "Commit to task branch" },
              { key: "end", type: "end", label: "Ready" },
            ],
            edges: [
              { id: "a", source: "start", target: "develop", kind: "normal", outcome: "success" },
              { id: "b", source: "develop", target: "end", kind: "normal", outcome: "success" },
            ],
          },
        },
      }],
      bindings: [],
      grants: [],
      triggerTypes: ["manual", "task_event"],
    });

    expect(result.project.developmentMode).toMatchObject({ name: "分支开发", stagingBranch: "staging" });
    expect(result.definitions[0]).toMatchObject({ role: "task_development", flow: [
      { label: "Start" },
      { label: "Develop", detail: "Commit to task branch" },
      { label: "Ready" },
    ] });
  });

  it("projects the persisted top-level Loop config without a development mode", () => {
    const loopGroupConfig = {
      taskLoopVersionIds: ["task_v1"],
      defaultTaskLoopVersionId: "project_task_v1",
      projectLoopVersionIds: ["project_task_v1", "project_release_v1"],
      defaultProjectLoopVersionId: "project_release_v1",
      selectedPresetKeys: ["项目自定义"],
      defaultPresetKey: "项目自定义",
    };

    const result = buildProjectLoopSettingsModel({
      project: {
        id: "project_1",
        name: "HumanThread",
        spaceId: "space_1",
        loopGroupConfig,
      },
      definitions: [],
      bindings: [],
      grants: [],
      triggerTypes: [],
    });

    expect(result.project.loopGroupConfig).toEqual(loopGroupConfig);
  });

  it("recognizes a development-template Loop from an older pinned version", () => {
    const graph = {
      schemaVersion: 1,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      limits: { maxStages: 5, maxRepeatCount: 1 },
      nodes: [
        { key: "start", type: "start", label: "Start" },
        { key: "develop", type: "agent_action", label: "Develop", executionTarget: "local", promptTemplate: "Develop" },
        { key: "end", type: "end", label: "End" },
      ],
      edges: [
        { id: "a", source: "start", target: "develop", kind: "normal", outcome: "success" },
        { id: "b", source: "develop", target: "end", kind: "normal", outcome: "success" },
      ],
    };
    const result = buildProjectLoopSettingsModel({
      project: {
        id: "project_1",
        name: "HumanThread",
        spaceId: "space_1",
        developmentMode: {
          key: "branch-development",
          name: "分支开发",
          developmentLoopVersionId: "version_task_old",
          releaseLoopVersionId: "version_release",
        },
      },
      definitions: [{
        id: "loop_task",
        name: "任务开发 Loop",
        latestPublishedVersion: { id: "version_task_latest", versionNumber: 3, graph },
      }],
      bindings: [{
        id: "binding_task",
        loopDefinitionId: "loop_task",
        activeVersionId: "version_task_old",
        status: "enabled",
        version: 1,
        triggerPolicy: { manual: true, taskEvents: [] },
        automationGrantIds: [],
        activeVersion: { id: "version_task_old", versionNumber: 2, graph },
      }],
      grants: [],
      triggerTypes: ["manual", "task_event"],
    });

    expect(result.definitions[0]).toMatchObject({ role: "task_development" });
  });
});
