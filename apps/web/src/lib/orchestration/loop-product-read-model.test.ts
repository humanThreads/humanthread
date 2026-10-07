import { describe, expect, it, vi } from "vitest";
import {
  listLoopDefinitionsForUser,
  readLoopDefinitionEditor,
  readProjectLoopSettings,
} from "./loop-product-read-model";

const graph = {
  schemaVersion: 1,
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  limits: { maxStages: 2, maxRepeatCount: 1 },
  nodes: [
    { key: "start", label: "Start", type: "start" },
    { key: "end", label: "End", type: "end" },
  ],
  edges: [
    { id: "start-end", source: "start", target: "end", kind: "normal", outcome: "success" },
  ],
};

function dependencies() {
  return {
    assertCanReadSpace: vi.fn().mockResolvedValue({ role: "member" }),
    assertCanReadProject: vi.fn().mockResolvedValue({ role: "maintainer" }),
    listDefinitions: vi.fn().mockResolvedValue([{ id: "loop_visible", spaceId: "space_1" }]),
    readDefinitionAccess: vi.fn().mockResolvedValue({ id: "loop_visible", spaceId: "space_1" }),
    readDefinition: vi.fn().mockResolvedValue({
      id: "loop_visible",
      spaceId: "space_1",
      name: "Delivery Loop",
      draftGraph: graph,
      draftRevision: 3,
      versions: [{ id: "version_2", versionNumber: 2, status: "published" }],
      status: "draft",
    }),
    readDefinitionReferences: vi.fn().mockResolvedValue({
      versions: 0,
      bindings: 0,
      runs: 0,
      receipts: 0,
      grants: 0,
    }),
    readProject: vi.fn().mockResolvedValue({ id: "project_1", spaceId: "space_1", name: "HumanThread" }),
    listProjectBindings: vi.fn().mockResolvedValue([{ id: "binding_1" }]),
    listPublishableDefinitions: vi.fn().mockResolvedValue([{ id: "loop_visible" }]),
    listAutomationGrants: vi.fn().mockResolvedValue([{ id: "grant_1" }]),
    listAgentProfiles: vi.fn().mockResolvedValue([
      { id: "profile_codex", spaceId: "space_1", name: "Codex", provider: "codex", status: "active", capabilities: ["structured_result"] },
      { id: "profile_inactive", spaceId: "space_1", name: "Old", provider: "codex", status: "disabled", capabilities: [] },
    ]),
    listRuntimeProfiles: vi.fn().mockResolvedValue([
      { provider: "codex", status: "ready", capabilities: ["structured_result"] },
      { provider: "claude", status: "ready", capabilities: [] },
    ]),
    listWorkspaceBindings: vi.fn().mockResolvedValue([{
      id: "workspace_1",
      localDeviceId: "device_1",
      status: "ready",
      configurationVersion: 2,
      localDevice: { name: "Alice MacBook" },
    }]),
  };
}

describe("Loop product read models", () => {
  it("returns only definitions visible in the selected Space", async () => {
    const deps = dependencies();
    deps.listDefinitions.mockResolvedValue([
      { id: "loop_visible", spaceId: "space_1", status: "published" },
      { id: "loop_archived", spaceId: "space_1", status: "archived" },
    ]);

    const result = await listLoopDefinitionsForUser({
      userId: "user_1",
      spaceId: "space_1",
    }, deps);

    expect(result.map((definition) => definition.id)).toEqual(["loop_visible"]);
    expect(deps.assertCanReadSpace).toHaveBeenCalledWith({ userId: "user_1", spaceId: "space_1" });
    expect(deps.listDefinitions).toHaveBeenCalledWith({ spaceId: "space_1" });
  });

  it("returns a platform Loop as read-only without reading its system Space", async () => {
    const deps = dependencies();
    deps.readDefinitionAccess.mockResolvedValue({ id: "loop_platform", spaceId: "space_platform", origin: "platform" });
    deps.readDefinition.mockResolvedValue({
      id: "loop_platform",
      spaceId: "space_platform",
      name: "Platform release",
      draftGraph: graph,
      draftRevision: 1,
      versions: [],
      origin: "platform",
    });

    const result = await readLoopDefinitionEditor({ userId: "user_1", loopDefinitionId: "loop_platform" }, deps);

    expect(deps.assertCanReadSpace).not.toHaveBeenCalled();
    expect(result?.definition).toMatchObject({ origin: "platform", readOnly: true });
  });

  it("returns an authorized editor model with validation, versions, catalog, and caps", async () => {
    const deps = dependencies();

    const result = await readLoopDefinitionEditor({
      userId: "user_1",
      loopDefinitionId: "loop_visible",
    }, deps);

    expect(deps.assertCanReadSpace).toHaveBeenCalledWith({ userId: "user_1", spaceId: "space_1" });
    expect(result).toMatchObject({
      definition: { id: "loop_visible", name: "Delivery Loop" },
      draftRevision: 3,
      validation: { ok: true },
      versions: [{ id: "version_2", versionNumber: 2, status: "published" }],
      lifecycle: {
        canArchive: true,
        canDelete: true,
        referenceCount: 0,
        references: { versions: 0, bindings: 0, runs: 0, receipts: 0, grants: 0 },
      },
      platformCaps: { maxStages: 64, maxRepeatCount: 20, maxTransitions: 1024 },
    });
    expect(result?.nodeCatalog.map((node) => node.type)).toEqual([
      "start",
      "agent_action",
      "platform_action",
      "condition",
      "policy_gate",
      "human_gate",
      "wait_callback",
      "subloop_call",
      "end",
    ]);
    expect(deps.assertCanReadSpace.mock.invocationCallOrder[0]).toBeLessThan(
      deps.readDefinition.mock.invocationCallOrder[0] as number,
    );
  });

  it("returns published task Loop options when editing a project Loop", async () => {
    const deps = dependencies();
    deps.readDefinition.mockResolvedValue({
      id: "loop_visible",
      spaceId: "space_1",
      name: "Project Flow",
      scope: "project",
      draftGraph: graph,
      draftRevision: 3,
      versions: [{ id: "version_2", versionNumber: 2, status: "published" }],
      status: "draft",
    });
    deps.listDefinitions.mockResolvedValue([
      { id: "task_loop_1", spaceId: "space_1", name: "Gelsang Project Loop", scope: "task", origin: "space", status: "published", latestPublishedVersion: { id: "task_version_3", versionNumber: 3, status: "published" } },
      { id: "project_loop_2", spaceId: "space_1", name: "Other Project", scope: "project", origin: "space", status: "published", latestPublishedVersion: { id: "project_version_1", versionNumber: 1, status: "published" } },
    ]);
    const result = await readLoopDefinitionEditor({ userId: "user_1", loopDefinitionId: "loop_visible" }, deps);
    expect(result?.subloopOptions).toEqual([{
      definitionId: "task_loop_1",
      name: "Gelsang Project Loop",
      versions: [{ id: "task_version_3", versionNumber: 3 }],
    }]);
  });

  it("aggregates authorized Project bindings, publishable definitions, grants, and trigger types", async () => {
    const deps = dependencies();

    const result = await readProjectLoopSettings({
      userId: "user_1",
      projectId: "project_1",
    }, deps);

    expect(deps.assertCanReadProject).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
    expect(deps.listPublishableDefinitions).toHaveBeenCalledWith({ spaceId: "space_1" });
    expect(deps.listAutomationGrants).toHaveBeenCalledWith({
      actorUserId: "user_1",
      projectId: "project_1",
    });
    expect(result).toEqual({
      project: { id: "project_1", spaceId: "space_1", name: "HumanThread" },
      bindings: [{ id: "binding_1" }],
      definitions: [{ id: "loop_visible", scope: "task", origin: "space", readOnly: false }],
      grants: [{ id: "grant_1" }],
      agentProfiles: [{ id: "profile_codex", spaceId: "space_1", name: "Codex", provider: "codex", status: "active", capabilities: ["structured_result"] }],
      providerReadiness: [
        { provider: "codex", adapterRegistered: true, readyRuntimeCount: 1, available: true, reason: null },
        { provider: "claude", adapterRegistered: false, readyRuntimeCount: 1, available: false, reason: "尚未注册 Claude 执行适配器" },
      ],
      workspaceBindings: [{
        id: "workspace_1",
        deviceId: "device_1",
        deviceName: "Alice MacBook",
        status: "ready",
        configurationVersion: 2,
      }],
      triggerTypes: ["manual", "task_event"],
    });
  });

  it("keeps optional template metadata defensive for projects created before template metadata existed", async () => {
    const deps = dependencies();
    deps.readProject.mockResolvedValue({
      id: "project_1", spaceId: "space_1", name: "HumanThread",
      developmentTemplateKey: "custom_branch_abc", developmentTemplateVersion: 2,
      developmentTemplateConfig: { productionBranch: "main" },
      developmentTemplate: { name: "团队分支", kind: "branch-development", origin: "space", description: "团队固定发布流程", developmentLoopVersionId: "loop_task_v2", releaseLoopVersionId: "loop_release_v3", triggerPolicy: {}, executionPolicy: {} },
    });
    const result = await readProjectLoopSettings({ userId: "user_1", projectId: "project_1" }, deps);
    expect(result?.project.developmentMode).toMatchObject({ key: "custom_branch_abc", kind: "branch-development", origin: "space", description: "团队固定发布流程" });
  });

  it("uses the published template Loop group as the initial project workflow when project config is empty", async () => {
    const deps = dependencies();
    deps.readProject.mockResolvedValue({
      id: "project_1", spaceId: "space_1", name: "HumanThread",
      developmentTemplateKey: "branch-development", developmentTemplateVersion: 1,
      developmentTemplate: {
        name: "分支开发", kind: "branch-development", origin: "platform",
        developmentLoopVersionId: "project_task_v1", releaseLoopVersionId: "project_release_v1",
        loopGroupConfig: {
          presets: [{ key: "默认", taskLoopIds: ["task_v1"], defaultTaskLoopId: "project_task_v1", projectLoopIds: ["project_task_v1", "project_release_v1"], defaultProjectLoopId: "project_release_v1" }],
          defaultSelection: { selectedPresetKeys: ["默认"], defaultPresetKey: "默认" },
        },
      },
      loopGroupConfig: null,
    });

    const result = await readProjectLoopSettings({ userId: "user_1", projectId: "project_1" }, deps);

    expect(result?.project.developmentMode?.loopGroupConfig).toMatchObject({
      projectLoopVersionIds: ["project_task_v1", "project_release_v1"],
      taskLoopVersionIds: ["task_v1"],
      defaultTaskLoopVersionId: "project_task_v1",
      defaultProjectLoopVersionId: "project_release_v1",
      defaultPresetKey: "默认",
    });
  });

  it("returns the persisted project Loop config without a development template", async () => {
    const deps = dependencies();
    deps.readProject.mockResolvedValue({
      id: "project_1",
      spaceId: "space_1",
      name: "HumanThread",
      developmentTemplateKey: null,
      developmentTemplate: null,
      loopGroupConfig: {
        taskLoopVersionIds: ["task_v1"],
        defaultTaskLoopVersionId: "project_task_v1",
        projectLoopVersionIds: ["project_task_v1", "project_release_v1"],
        defaultProjectLoopVersionId: "project_release_v1",
        selectedPresetKeys: ["项目自定义"],
        defaultPresetKey: "项目自定义",
      },
    });

    const result = await readProjectLoopSettings({ userId: "user_1", projectId: "project_1" }, deps);

    expect(result?.project.loopGroupConfig).toEqual({
      taskLoopVersionIds: ["task_v1"],
      defaultTaskLoopVersionId: "project_task_v1",
      projectLoopVersionIds: ["project_task_v1", "project_release_v1"],
      defaultProjectLoopVersionId: "project_release_v1",
      selectedPresetKeys: ["项目自定义"],
      defaultPresetKey: "项目自定义",
    });
  });
});
