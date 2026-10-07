// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProjectLoopBindings,
  fingerprintAutomationGrantForBrowser,
  requestJson,
  type ProjectLoopSettingsModel,
} from "./project-loop-bindings";
import type { AutomationGrantDraft } from "./automation-grant-dialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const model = {
  project: {
    id: "project_1",
    version: 1,
    name: "HumanThread",
    spaceId: "space_1",
    workspaceBindings: [{
      id: "workspace_1",
      deviceId: "device_1",
      deviceName: "Alice MacBook",
      status: "ready",
      configurationVersion: 2,
    }],
  },
  definitions: [{
    id: "loop_1",
    name: "交付闭环",
    scope: "project",
    versions: [{
      id: "version_3",
      versionNumber: 3,
      humanGateCount: 0,
      maxStages: 8,
      maxRepeatCount: 2,
      agentNodeKeys: ["agent"],
    }],
  }],
  bindings: [],
  agentProfiles: [{ id: "profile_codex", name: "Codex Delivery", provider: "codex", capabilities: ["structured_result"] }],
  providerReadiness: [
    { provider: "codex", adapterRegistered: true, readyRuntimeCount: 1, available: true, reason: null },
    { provider: "claude", adapterRegistered: false, readyRuntimeCount: 1, available: false, reason: "尚未注册 Claude 执行适配器" },
  ],
  grants: [],
  triggerTypes: ["manual", "task_event"],
} satisfies ProjectLoopSettingsModel;

describe("ProjectLoopBindings", () => {
  it("hides shared Worker resources in the workflow-only settings domain", () => {
    render(<ProjectLoopBindings variant="workflow" model={{
      project: { id: "project_1", name: "项目", spaceId: "space_1", version: 1, workspaceBindings: [] },
      definitions: [], bindings: [], agentProfiles: [], providerReadiness: [], grants: [], triggerTypes: ["manual"],
    }} />);

    expect(screen.queryByText("项目 Linux Worker 资源")).toBeNull();
  });
  it("preserves a non-JSON 404 response as a typed request failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 })));

    await expect(requestJson("/api/automation-grants", "GET")).rejects.toMatchObject({
      message: "Loop 请求失败",
      status: 404,
    });
  });

  it("uses the unified project Loop configuration instead of the legacy duplicate sections", () => {
    render(<ProjectLoopBindings model={{
      ...model,
      definitions: [
        { ...model.definitions[0]!, scope: "project" },
        { ...model.definitions[0]!, id: "task_loop_1", name: "Gelsang Project Loop", scope: "task" },
      ],
    }} api={{ saveBinding: vi.fn(), trigger: vi.fn(), createGrant: vi.fn(), revokeGrant: vi.fn() }} />);

    expect(screen.getByText("开发模式说明")).toBeTruthy();
    expect(screen.queryByText("项目级 Loop 与任务级 Loop 映射")).toBeNull();
    expect(screen.queryByText("可用任务级 Loop")).toBeNull();
    expect(screen.getByRole("option", { name: /Gelsang Project Loop/u })).toBeTruthy();
  });

  it("allows editing project and task Loop selections with node mappings", async () => {
    const user = userEvent.setup();
    const saveLoopGroupConfig = vi.fn().mockResolvedValue({ projectId: "project_1", version: 3 });
    const projectVersion = {
      id: "project_version_1",
      versionNumber: 1,
      humanGateCount: 0,
      maxStages: 4,
      maxRepeatCount: 1,
      agentNodeKeys: [],
      flow: [{ key: "tasks", label: "任务节点", type: "subloop_call", detail: null, outcomes: [] }],
    };
    const taskVersion = { ...projectVersion, id: "task_version_1", flow: [{ key: "work", label: "执行", type: "agent_action", detail: null, outcomes: [] }] };
    render(<ProjectLoopBindings model={{
      ...model,
      project: {
        ...model.project,
        version: 2,
        developmentMode: {
          key: "branch-development", name: "分支开发", version: 1, origin: "platform", kind: "branch-development",
          config: {}, executionPolicy: {}, triggerPolicy: {}, productionBranch: "main", stagingBranch: "staging", releaseAgentProfileId: null,
          developmentLoopVersionId: "task_version_1", releaseLoopVersionId: "project_version_1",
          loopGroupConfig: {
            taskLoopVersionIds: ["task_version_1"], defaultTaskLoopVersionId: "project_version_1",
            projectLoopVersionIds: ["project_version_1"], defaultProjectLoopVersionId: "project_version_1",
            selectedPresetKeys: ["研发交付"], defaultPresetKey: "研发交付", projectLoopNodeTaskLoopIds: {},
          },
        },
      },
      definitions: [
        { id: "project_definition_1", name: "里程碑 Loop", scope: "project", versions: [projectVersion] },
        { id: "task_definition_1", name: "任务 Loop", scope: "task", versions: [taskVersion] },
      ],
    }} api={{ saveBinding: vi.fn(), trigger: vi.fn(), createGrant: vi.fn(), revokeGrant: vi.fn(), saveLoopGroupConfig }} />);

    expect(screen.getByRole("group", { name: "项目 Loop 列表" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "任务 Loop 列表" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "默认任务 Loop：里程碑 Loop" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "默认里程碑 Loop：里程碑 Loop" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /默认任务 Loop：任务 Loop/u })).toBeNull();
    expect(screen.queryByRole("radio", { name: /默认里程碑 Loop：任务 Loop/u })).toBeNull();
    const mapping = screen.getByRole("combobox", { name: "里程碑 Loop：任务节点" });
    await user.selectOptions(mapping, "task_version_1");
    await user.click(screen.getByRole("button", { name: "保存项目 Loop 配置" }));
    await waitFor(() => expect(saveLoopGroupConfig).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 2,
      config: expect.objectContaining({
        defaultTaskLoopVersionId: "project_version_1",
        defaultProjectLoopVersionId: "project_version_1",
        projectLoopNodeTaskLoopIds: { project_version_1: { tasks: "task_version_1" } },
      }),
    })));
  });

  it("uses the project version returned by the previous Loop configuration save", async () => {
    const user = userEvent.setup();
    const saveLoopGroupConfig = vi.fn()
      .mockResolvedValueOnce({ projectId: "project_1", version: 3 })
      .mockResolvedValueOnce({ projectId: "project_1", version: 4 });
    const firstProjectVersion = {
      id: "project_version_1",
      versionNumber: 1,
      humanGateCount: 0,
      maxStages: 4,
      maxRepeatCount: 1,
      agentNodeKeys: [],
    };
    const secondProjectVersion = { ...firstProjectVersion, id: "project_version_2" };
    const taskVersion = { ...firstProjectVersion, id: "task_version_1" };
    render(<ProjectLoopBindings model={{
      ...model,
      project: {
        ...model.project,
        version: 2,
        developmentMode: {
          key: "branch-development", name: "分支开发", version: 1, origin: "platform", kind: "branch-development",
          config: {}, executionPolicy: {}, triggerPolicy: {}, productionBranch: "main", stagingBranch: "staging", releaseAgentProfileId: null,
          developmentLoopVersionId: "project_version_1", releaseLoopVersionId: "project_version_2",
          loopGroupConfig: {
            taskLoopVersionIds: ["task_version_1"], defaultTaskLoopVersionId: "project_version_1",
            projectLoopVersionIds: ["project_version_1", "project_version_2"], defaultProjectLoopVersionId: "project_version_2",
            selectedPresetKeys: ["研发交付"], defaultPresetKey: "研发交付", projectLoopNodeTaskLoopIds: {},
          },
        },
      },
      definitions: [
        { id: "project_definition_1", name: "项目 Loop A", scope: "project", versions: [firstProjectVersion] },
        { id: "project_definition_2", name: "项目 Loop B", scope: "project", versions: [secondProjectVersion] },
        { id: "task_definition_1", name: "任务 Loop", scope: "task", versions: [taskVersion] },
      ],
    }} api={{ saveBinding: vi.fn(), trigger: vi.fn(), createGrant: vi.fn(), revokeGrant: vi.fn(), saveLoopGroupConfig }} />);

    const secondLoop = screen.getByRole("checkbox", { name: "项目 Loop B" });
    await user.click(secondLoop);
    await user.click(screen.getByRole("button", { name: "保存项目 Loop 配置" }));
    await waitFor(() => expect(saveLoopGroupConfig).toHaveBeenCalledTimes(1));

    await user.click(secondLoop);
    await user.click(screen.getByRole("button", { name: "保存项目 Loop 配置" }));
    await waitFor(() => expect(saveLoopGroupConfig).toHaveBeenCalledTimes(2));

    expect(saveLoopGroupConfig.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ expectedVersion: 2 }));
    expect(saveLoopGroupConfig.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ expectedVersion: 3 }));
  });

  it("restores the persisted project Loop config without a development template", () => {
    const projectVersion = (id: string) => ({
      id,
      versionNumber: 1,
      humanGateCount: 0,
      maxStages: 4,
      maxRepeatCount: 1,
      agentNodeKeys: [],
    });
    render(<ProjectLoopBindings variant="workflow" model={{
      ...model,
      project: {
        ...model.project,
        loopGroupConfig: {
          taskLoopVersionIds: ["task_version_2"],
          defaultTaskLoopVersionId: "project_version_2",
          projectLoopVersionIds: ["project_version_2", "project_version_3"],
          defaultProjectLoopVersionId: "project_version_3",
          selectedPresetKeys: ["项目自定义"],
          defaultPresetKey: "项目自定义",
          projectLoopNodeTaskLoopIds: {},
        },
      },
      definitions: [
        { id: "project_definition_1", name: "项目 Loop A", scope: "project", versions: [projectVersion("project_version_1")] },
        { id: "project_definition_2", name: "项目 Loop B", scope: "project", versions: [projectVersion("project_version_2")] },
        { id: "project_definition_3", name: "项目 Loop C", scope: "project", versions: [projectVersion("project_version_3")] },
        { id: "task_definition_1", name: "任务 Loop A", scope: "task", versions: [projectVersion("task_version_1")] },
        { id: "task_definition_2", name: "任务 Loop B", scope: "task", versions: [projectVersion("task_version_2")] },
      ],
    }} api={{ saveBinding: vi.fn(), trigger: vi.fn(), createGrant: vi.fn(), revokeGrant: vi.fn(), saveLoopGroupConfig: vi.fn() }} />);

    expect((screen.getByRole("checkbox", { name: "项目 Loop A" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "项目 Loop B" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "项目 Loop C" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "任务 Loop A" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "任务 Loop B" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "默认任务 Loop：项目 Loop B" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "默认里程碑 Loop：项目 Loop C" }) as HTMLInputElement).checked).toBe(true);
  });

  it("saves a project-level-only Loop configuration with no task Loops", async () => {
    const user = userEvent.setup();
    const saveLoopGroupConfig = vi.fn().mockResolvedValue({ projectId: "project_1", version: 2 });
    render(<ProjectLoopBindings variant="workflow" model={{
      ...model,
      project: {
        ...model.project,
        loopGroupConfig: {
          taskLoopVersionIds: [],
          defaultTaskLoopVersionId: "version_3",
          projectLoopVersionIds: ["version_3"],
          defaultProjectLoopVersionId: "version_3",
          selectedPresetKeys: ["纯项目级流程"],
          defaultPresetKey: "纯项目级流程",
          projectLoopNodeTaskLoopIds: {},
        },
      },
      definitions: [model.definitions[0]!],
    }} api={{ saveBinding: vi.fn(), trigger: vi.fn(), createGrant: vi.fn(), revokeGrant: vi.fn(), saveLoopGroupConfig }} />);

    const save = screen.getByRole("button", { name: "保存项目 Loop 配置" });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    await user.click(save);

    await waitFor(() => expect(saveLoopGroupConfig).toHaveBeenCalledOnce());
    expect(saveLoopGroupConfig).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        taskLoopVersionIds: [],
        defaultTaskLoopVersionId: "version_3",
        projectLoopVersionIds: ["version_3"],
        projectLoopNodeTaskLoopIds: {},
      }),
    }));
  });

  it("only unbinds an enabled Task-scoped binding after confirmation", async () => {
    const user = userEvent.setup();
    const api = {
      saveBinding: vi.fn(),
      trigger: vi.fn(),
      createGrant: vi.fn(),
      revokeGrant: vi.fn(),
      unbindTaskLoop: vi.fn().mockResolvedValue({ id: "binding_task_1", status: "disabled", version: 3 }),
    };
    render(<ProjectLoopBindings model={{
      ...model,
      definitions: [
        { ...model.definitions[0]!, id: "loop_task", name: "Gelsang Project Loop", scope: "task" },
        { ...model.definitions[0]!, id: "loop_project", name: "Task Development", scope: "project" },
      ],
      bindings: [
        {
          id: "binding_task_1",
          loopDefinitionId: "loop_task",
          activeVersionId: "version_3",
          status: "enabled",
          version: 2,
          triggerPolicy: { manual: true, taskEvents: [] },
          automationGrantIds: [],
        },
        {
          id: "binding_project_1",
          loopDefinitionId: "loop_project",
          activeVersionId: "version_3",
          status: "enabled",
          version: 4,
          triggerPolicy: { manual: true, taskEvents: [] },
          automationGrantIds: [],
        },
      ],
    }} api={api} />);

    expect(screen.getAllByRole("button", { name: "解绑" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "解绑" }));
    expect(api.unbindTaskLoop).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "解绑任务 Loop" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "确认解绑" }));

    await waitFor(() => expect(api.unbindTaskLoop).toHaveBeenCalledWith("binding_task_1", 2));
    expect(screen.queryByRole("button", { name: "解绑" })).toBeNull();
    expect(screen.getByText("任务 Loop 已解绑")).toBeTruthy();
  });

  it("does not expose unbind for disabled Task bindings or Project bindings", () => {
    render(<ProjectLoopBindings model={{
      ...model,
      definitions: [
        { ...model.definitions[0]!, id: "loop_task", scope: "task" },
        { ...model.definitions[0]!, id: "loop_project", scope: "project" },
      ],
      bindings: [
        {
          id: "binding_task_disabled",
          loopDefinitionId: "loop_task",
          activeVersionId: "version_3",
          status: "disabled",
          version: 3,
          triggerPolicy: { manual: true, taskEvents: [] },
          automationGrantIds: [],
        },
        {
          id: "binding_project_enabled",
          loopDefinitionId: "loop_project",
          activeVersionId: "version_3",
          status: "enabled",
          version: 1,
          triggerPolicy: { manual: true, taskEvents: [] },
          automationGrantIds: [],
        },
      ],
    }} api={{ saveBinding: vi.fn(), trigger: vi.fn(), createGrant: vi.fn(), revokeGrant: vi.fn(), unbindTaskLoop: vi.fn() }} />);

    expect(screen.queryByRole("button", { name: "解绑" })).toBeNull();
  });

  it("does not show disabled bindings in the Project Loop inventory", () => {
    render(<ProjectLoopBindings model={{
      ...model,
      bindings: [{
        id: "binding_disabled",
        loopDefinitionId: "loop_1",
        activeVersionId: "version_3",
        status: "disabled",
        version: 3,
        triggerPolicy: { manual: true, taskEvents: [] },
        automationGrantIds: [],
      }],
    }} api={{ saveBinding: vi.fn(), trigger: vi.fn(), createGrant: vi.fn(), revokeGrant: vi.fn() }} />);

    expect(screen.queryByText("已停用")).toBeNull();
    expect(screen.getByText("当前项目没有已启用的 Loop 绑定。")).toBeTruthy();
  });

  it("explains that active Task Loop Runs must stop before unbinding", async () => {
    const user = userEvent.setup();
    const api = {
      saveBinding: vi.fn(),
      trigger: vi.fn(),
      createGrant: vi.fn(),
      revokeGrant: vi.fn(),
      unbindTaskLoop: vi.fn().mockRejectedValue(Object.assign(
        new Error("Task Loop binding has active Runs"),
        { status: 409 },
      )),
    };
    render(<ProjectLoopBindings model={{
      ...model,
      definitions: [{ ...model.definitions[0]!, scope: "task" }],
      bindings: [{
        id: "binding_task_1",
        loopDefinitionId: "loop_1",
        activeVersionId: "version_3",
        status: "enabled",
        version: 2,
        triggerPolicy: { manual: true, taskEvents: [] },
        automationGrantIds: [],
      }],
    }} api={api} />);

    await user.click(screen.getByRole("button", { name: "解绑" }));
    await user.click(screen.getByRole("button", { name: "确认解绑" }));

    expect((await screen.findByRole("alert")).textContent).toContain("请先停止正在运行的任务 Loop");
    expect(screen.getByRole("button", { name: "解绑" })).toBeTruthy();
  });

  it("binds a published version without triggering a Run", async () => {
    const user = userEvent.setup();
    const api = {
      saveBinding: vi.fn().mockResolvedValue({ id: "binding_1", version: 1 }),
      saveWorkerResource: vi.fn().mockResolvedValue({ projectId: "project_1", version: 2 }),
      trigger: vi.fn().mockResolvedValue({ id: "run_1" }),
      createGrant: vi.fn(),
      revokeGrant: vi.fn(),
    };
    render(<ProjectLoopBindings model={model} api={api} />);

    await user.selectOptions(screen.getByLabelText("Loop"), "loop_1");
    await user.selectOptions(screen.getByLabelText("版本"), "version_3");
    await user.click(screen.getByRole("button", { name: "保存绑定" }));

    expect(api.saveBinding).toHaveBeenCalledOnce();
    expect(api.saveBinding).toHaveBeenCalledWith(expect.objectContaining({
      loopDefinitionId: "loop_1",
      activeVersionId: "version_3",
    }));
    expect(api.trigger).not.toHaveBeenCalled();
    expect(screen.getByText("人工确认节点 0（可选）")).toBeTruthy();
  });

  it("lists template root Loops and their referenced task SubLoops in the version binding selector", () => {
    render(<ProjectLoopBindings model={{
      ...model,
      project: {
        ...model.project,
        developmentMode: {
          key: "branch-development",
          name: "分支开发",
          version: 1,
          productionBranch: "main",
          stagingBranch: "staging",
          releaseAgentProfileId: null,
          config: {},
          executionPolicy: {},
          triggerPolicy: {},
          developmentLoopVersionId: "version_task",
          releaseLoopVersionId: "version_release",
        },
      },
      definitions: [
        { ...model.definitions[0]!, id: "loop_task", name: "任务开发 Loop", role: "task_development", versions: [{ ...model.definitions[0]!.versions[0]!, id: "version_task", subloopDefinitionIds: ["task_subloop"] }] },
        { ...model.definitions[0]!, id: "loop_release", name: "里程碑 Loop", role: "milestone_release", versions: [{ ...model.definitions[0]!.versions[0]!, id: "version_release" }] },
        { ...model.definitions[0]!, id: "task_subloop", name: "Gelsang Project Loop", scope: "task" },
        { ...model.definitions[0]!, id: "loop_unrelated", name: "通用 Loop" },
      ],
    }} api={{ saveBinding: vi.fn(), trigger: vi.fn(), createGrant: vi.fn(), revokeGrant: vi.fn() }} />);

    const selector = screen.getByLabelText("Loop") as HTMLSelectElement;
    expect(Array.from(selector.options).map((option) => option.value)).toEqual(["loop_task", "loop_release", "task_subloop"]);
    expect(screen.getByRole("option", { name: /Gelsang Project Loop/u })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /通用 Loop/u })).toBeNull();
  });

  it("keeps the version selector scoped to template-reachable task SubLoops", () => {
    render(<ProjectLoopBindings model={{
      ...model,
      project: {
        ...model.project,
        developmentMode: {
          key: "branch-development",
          name: "分支开发",
          version: 1,
          productionBranch: "main",
          stagingBranch: "staging",
          releaseAgentProfileId: null,
          developmentLoopVersionId: "version_task",
          releaseLoopVersionId: "version_release",
          config: {},
          executionPolicy: {},
          triggerPolicy: {},
        },
      },
      definitions: [
        { ...model.definitions[0]!, id: "loop_task", role: "task_development", versions: [{ ...model.definitions[0]!.versions[0]!, id: "version_task", subloopDefinitionIds: ["task_subloop"] }] },
        { ...model.definitions[0]!, id: "loop_release", role: "milestone_release", versions: [{ ...model.definitions[0]!.versions[0]!, id: "version_release" }] },
        { ...model.definitions[0]!, id: "task_subloop", name: "Gelsang Project Loop", scope: "task" },
        { ...model.definitions[0]!, id: "other_task", name: "无关任务 Loop", scope: "task" },
        { ...model.definitions[0]!, id: "other_project", name: "无关项目 Loop", scope: "project" },
      ],
    }} api={{ saveBinding: vi.fn(), trigger: vi.fn(), createGrant: vi.fn(), revokeGrant: vi.fn() }} />);

    const selector = screen.getByLabelText("Loop") as HTMLSelectElement;
    expect(Array.from(selector.options).map((option) => option.value)).toEqual(["loop_task", "loop_release", "task_subloop"]);
    expect(screen.getByRole("option", { name: /Gelsang Project Loop/u })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /无关任务 Loop/u })).toBeNull();
    expect(screen.queryByRole("option", { name: /无关项目 Loop/u })).toBeNull();
    expect(screen.queryByText("项目级 Loop 与任务级 Loop 映射")).toBeNull();
    expect(screen.queryByText("可用任务级 Loop")).toBeNull();
  });

  it("persists the selected logical profile and executable provider", async () => {
    const user = userEvent.setup();
    const api = { saveBinding: vi.fn(), trigger: vi.fn(), createGrant: vi.fn(), revokeGrant: vi.fn() };
    render(<ProjectLoopBindings model={model} api={api} />);

    await user.selectOptions(screen.getByLabelText("Agent Profile"), "profile_codex");
    await user.click(screen.getByRole("checkbox", { name: "Codex" }));
    await user.click(screen.getByRole("button", { name: "保存绑定" }));

    expect(api.saveBinding).toHaveBeenCalledWith(expect.objectContaining({
      allowedAgentProfileIds: ["profile_codex"],
      allowedProviders: ["codex"],
    }));
    expect(screen.getByText("尚未注册 Claude 执行适配器")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Claude" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("saves an explicit Linux Worker configuration for every Agent node", async () => {
    const user = userEvent.setup();
    const api = {
      saveBinding: vi.fn().mockResolvedValue({ id: "binding_1", version: 1 }),
      saveWorkerResource: vi.fn().mockResolvedValue({ projectId: "project_1", version: 2 }),
      trigger: vi.fn(),
      createGrant: vi.fn(),
      revokeGrant: vi.fn(),
      loadWorkerExecutionOptions: vi.fn().mockResolvedValue({
        pools: [{ id: "a".repeat(32), displayName: "disaster-gpu", status: "active" }],
        sites: [{ id: "b".repeat(32), name: "Delivery Codex", endpoint: "https://codex.example.com/v1", status: "active" }],
      }),
    };
    render(<ProjectLoopBindings model={model} api={api} />);

    await waitFor(() => expect(api.loadWorkerExecutionOptions).toHaveBeenCalledOnce());
    await user.click(screen.getByRole("checkbox", { name: "Linux Worker" }));
    await user.selectOptions(screen.getByLabelText("项目 Worker Pool"), "a".repeat(32));
    await user.type(screen.getByLabelText("项目仓库 URL"), "https://github.com/humanthread/disaster.git");
    await user.type(screen.getByLabelText("项目允许分支"), "main staging dev");
    await user.click(screen.getByRole("button", { name: "保存项目资源" }));
    await user.click(screen.getByRole("button", { name: "保存项目资源" }));
    await user.selectOptions(screen.getByLabelText("agent · 模型站点"), "b".repeat(32));
    await user.type(screen.getByLabelText("agent · 模型"), "gpt-5.2-codex");
    await user.selectOptions(screen.getByLabelText("agent · 推理强度"), "high");
    await user.click(screen.getByRole("button", { name: "保存绑定" }));

    expect(api.saveWorkerResource).toHaveBeenCalledWith(expect.objectContaining({
      poolId: "a".repeat(32), repositoryUrl: "https://github.com/humanthread/disaster.git", branchPolicy: { allowedBranches: ["main", "staging", "dev"] },
    }));
    expect(api.saveWorkerResource.mock.calls.map(([input]) => input.expectedVersion)).toEqual([1, 2]);
    expect(screen.getByText("项目 Linux Worker 资源已保存；后续运行将使用新配置。")).toBeTruthy();
    expect(api.saveBinding).toHaveBeenCalledWith(expect.objectContaining({
      workerStageConfigurations: {
        agent: { siteId: "b".repeat(32), model: "gpt-5.2-codex", reasoningEffort: "high", requireGitDelivery: false },
      },
    }));
  }, 15_000);

  it("preserves an existing Linux Worker configuration when the binding is saved again", async () => {
    const user = userEvent.setup();
    const workerExecution = {
      poolId: "a".repeat(32),
      repositoryUrl: "https://github.com/humanthread/disaster.git",
      branchPolicy: { allowedBranches: ["main"] },
      stageConfigurations: {
        agent: { siteId: "b".repeat(32), model: "gpt-5.2-codex", reasoningEffort: "high" as const, requireGitDelivery: false },
      },
    };
    const api = {
      saveBinding: vi.fn().mockResolvedValue({ id: "binding_1", version: 2 }),
      saveWorkerResource: vi.fn().mockResolvedValue({ projectId: "project_1", version: 2 }),
      trigger: vi.fn(),
      createGrant: vi.fn(),
      revokeGrant: vi.fn(),
      loadWorkerExecutionOptions: vi.fn().mockResolvedValue({
        pools: [{ id: "a".repeat(32), displayName: "disaster-gpu", status: "active" }],
        sites: [{ id: "b".repeat(32), name: "Delivery Codex", endpoint: "https://codex.example.com/v1", status: "active" }],
      }),
    };
    render(<ProjectLoopBindings model={{
      ...model,
      project: { ...model.project, workerResource: { poolId: workerExecution.poolId, repositoryUrl: workerExecution.repositoryUrl, branchPolicy: workerExecution.branchPolicy } },
      bindings: [{
        id: "binding_1",
        loopDefinitionId: "loop_1",
        activeVersionId: "version_3",
        status: "enabled",
        version: 1,
        triggerPolicy: { manual: true, taskEvents: [] },
        automationGrantIds: [],
        workerExecution,
      }],
    }} api={api} />);

    await waitFor(() => expect(api.loadWorkerExecutionOptions).toHaveBeenCalledOnce());
    expect((screen.getByLabelText("项目 Worker Pool") as HTMLSelectElement).value).toBe(workerExecution.poolId);
    expect((screen.getByLabelText("agent · 模型") as HTMLInputElement).value).toBe("gpt-5.2-codex");
    await user.click(screen.getByRole("button", { name: "保存绑定" }));

    expect(api.saveBinding).toHaveBeenCalledWith(expect.objectContaining({
      workerStageConfigurations: workerExecution.stageConfigurations,
    }));
  });

  it("refreshes a stale binding version and retries the save once", async () => {
    const user = userEvent.setup();
    const api = {
      saveBinding: vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error("Aggregate changed while processing command: loop_command_old"), { status: 409 }))
        .mockResolvedValueOnce({ id: "binding_1", version: 4 }),
      readBindingVersion: vi.fn().mockResolvedValue(3),
      trigger: vi.fn(),
      createGrant: vi.fn(),
      revokeGrant: vi.fn(),
    };
    render(<ProjectLoopBindings model={{
      ...model,
      bindings: [{
        id: "binding_1",
        loopDefinitionId: "loop_1",
        activeVersionId: "version_3",
        status: "enabled",
        version: 2,
        triggerPolicy: { manual: true, taskEvents: [] },
        automationGrantIds: [],
      }],
    }} api={api} />);

    await user.click(screen.getByRole("button", { name: "保存绑定" }));

    await waitFor(() => expect(api.saveBinding).toHaveBeenCalledTimes(2));
    expect(api.readBindingVersion).toHaveBeenCalledWith("loop_1");
    expect(api.saveBinding.mock.calls.at(1)?.[0]).toEqual(expect.objectContaining({ expectedVersion: 3 }));
    expect(screen.getByText("绑定已保存；保存操作不会创建运行")).toBeTruthy();
  });

  it("turns a stale binding conflict into an actionable refresh message", async () => {
    const user = userEvent.setup();
    const api = {
      saveBinding: vi.fn().mockRejectedValue(Object.assign(new Error("Aggregate changed while processing command: loop_command_old"), { status: 409 })),
      trigger: vi.fn(),
      createGrant: vi.fn(),
      revokeGrant: vi.fn(),
    };
    render(<ProjectLoopBindings model={{
      ...model,
      bindings: [{
        id: "binding_1",
        loopDefinitionId: "loop_1",
        activeVersionId: "version_3",
        status: "enabled",
        version: 2,
        triggerPolicy: { manual: true, taskEvents: [] },
        automationGrantIds: [],
      }],
    }} api={api} />);

    await user.click(screen.getByRole("button", { name: "保存绑定" }));

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(alerts.some((alert) => alert.textContent?.includes("绑定已被更新，请刷新页面后重试"))).toBe(true);
    }, { timeout: 10_000 });
    expect(screen.getAllByRole("alert").every((alert) => !alert.textContent?.includes("loop_command_old"))).toBe(true);
  }, 15_000);

  it("allows binding Codex before this user has a ready local runtime", async () => {
    const user = userEvent.setup();
    const api = { saveBinding: vi.fn(), trigger: vi.fn(), createGrant: vi.fn(), revokeGrant: vi.fn() };
    render(<ProjectLoopBindings model={{
      ...model,
      providerReadiness: [
        {
          provider: "codex",
          adapterRegistered: true,
          readyRuntimeCount: 0,
          available: false,
          reason: "当前用户没有就绪的 Codex 运行时",
        },
        {
          provider: "claude",
          adapterRegistered: false,
          readyRuntimeCount: 0,
          available: false,
          reason: "尚未注册 Claude 执行适配器",
        },
      ],
    }} api={api} />);

    await user.selectOptions(screen.getByLabelText("Agent Profile"), "profile_codex");
    expect((screen.getByRole("checkbox", { name: "Codex" }) as HTMLInputElement).disabled).toBe(false);
    await user.click(screen.getByRole("checkbox", { name: "Codex" }));
    await user.click(screen.getByRole("button", { name: "保存绑定" }));

    expect(api.saveBinding).toHaveBeenCalledWith(expect.objectContaining({
      allowedAgentProfileIds: ["profile_codex"],
      allowedProviders: ["codex"],
    }));
    expect(screen.getByText("当前用户没有就绪的 Codex 运行时")).toBeTruthy();
  });

  it("does not expose manual execution in the bound Loop inventory", () => {
    const api = {
      saveBinding: vi.fn(),
      trigger: vi.fn(),
      createGrant: vi.fn(),
      revokeGrant: vi.fn(),
    };
    render(<ProjectLoopBindings model={{
      ...model,
      bindings: [{
        id: "binding_1",
        loopDefinitionId: "loop_1",
        activeVersionId: "version_3",
        status: "enabled",
        version: 1,
        triggerPolicy: { manual: true, taskEvents: [] },
        automationGrantIds: [],
      }],
    }} api={api} />);

    expect(screen.queryByRole("button", { name: "立即运行" })).toBeNull();
    expect(api.trigger).not.toHaveBeenCalled();
  });

  it("routes Task-scoped bindings through Task details", () => {
    const api = { saveBinding: vi.fn(), trigger: vi.fn(), createGrant: vi.fn(), revokeGrant: vi.fn() };
    render(<ProjectLoopBindings model={{
      ...model,
      definitions: [{ ...model.definitions[0]!, name: "Gelsang Project Loop", scope: "task" }],
      bindings: [{
        id: "binding_task_1",
        loopDefinitionId: "loop_1",
        activeVersionId: "version_3",
        status: "enabled",
        version: 1,
        triggerPolicy: { manual: true, taskEvents: [] },
        automationGrantIds: [],
      }],
    }} api={api} />);

    expect(screen.getByText("任务级")).toBeTruthy();
    expect(screen.getByText("从任务详情的“启动任务 Loop”进入运行。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "立即运行" })).toBeNull();
  });

  it("initially selects the version pinned by an existing binding", () => {
    render(<ProjectLoopBindings model={{
      ...model,
      definitions: [{
        ...model.definitions[0]!,
        versions: [
          { id: "version_3", versionNumber: 3, humanGateCount: 0, maxStages: 8, maxRepeatCount: 2, agentNodeKeys: ["agent"] },
          { id: "version_2", versionNumber: 2, humanGateCount: 0, maxStages: 6, maxRepeatCount: 1, agentNodeKeys: ["agent"] },
        ],
      }],
      bindings: [{
        id: "binding_1",
        loopDefinitionId: "loop_1",
        activeVersionId: "version_2",
        status: "enabled",
        version: 2,
        triggerPolicy: { manual: true, taskEvents: [] },
        automationGrantIds: [],
      }],
    }} api={{ saveBinding: vi.fn(), trigger: vi.fn(), createGrant: vi.fn(), revokeGrant: vi.fn() }} />);

    expect((screen.getByLabelText("版本") as HTMLSelectElement).value).toBe("version_2");
  });

  it("explains the configured development mode and renders both Loop flows", () => {
    render(<ProjectLoopBindings model={{
      ...model,
      project: {
        ...model.project,
        developmentMode: {
          key: "branch-development",
          name: "分支开发",
          version: 1,
          productionBranch: "main",
          stagingBranch: "staging",
          releaseAgentProfileId: "profile_release",
          config: { taskBranchPattern: "{year}-{shortId}" },
          executionPolicy: { taskBranchBase: "staging", productionApprovalRequired: true },
          triggerPolicy: { releaseTriggers: ["milestone.release_ready", "manual"] },
          developmentLoopVersionId: "version_task",
          releaseLoopVersionId: "version_release",
        },
      },
      definitions: [
        { ...model.definitions[0]!, id: "loop_task", name: "Task Loop", role: "task_development", flow: [{ key: "start", label: "Start", type: "start", detail: null, outcomes: [] }, { key: "end", label: "Task branch ready", type: "end", detail: null, outcomes: [] }] },
        { ...model.definitions[0]!, id: "loop_release", name: "Release Loop", role: "milestone_release", flow: [{ key: "approval", label: "Approve production release", type: "human_gate", detail: "Approve evidence", outcomes: ["pass", "reject"] }] },
      ],
    }} api={{ saveBinding: vi.fn(), trigger: vi.fn(), createGrant: vi.fn(), revokeGrant: vi.fn() }} />);

    expect(screen.getByText("当前模式：分支开发")).toBeTruthy();
    expect(screen.getByText("任务开发 Loop")).toBeTruthy();
    expect(screen.getByText("里程碑 Loop")).toBeTruthy();
    expect(screen.getByText("通过：继续发布 · 拒绝：结束本次发版")).toBeTruthy();
  });

  it("selects a Workspace grant without crashing and includes it in the binding save", async () => {
    const user = userEvent.setup();
    const api = { saveBinding: vi.fn(), trigger: vi.fn(), createGrant: vi.fn(), revokeGrant: vi.fn() };
    render(<ProjectLoopBindings model={{
      ...model,
      grants: [{
        id: "grant_1",
        status: "active",
        permission: "workspace_full",
        workspaceBindingIds: ["workspace_1"],
        allowedRelativePathPrefixes: ["."],
        bindingIds: [],
        expiresAt: null,
        revokedAt: null,
      }],
    }} api={api} />);

    const grantCheckbox = screen.getByRole("checkbox", { name: "Workspace 完全权限 · grant_1" });
    await user.click(grantCheckbox);
    expect((grantCheckbox as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByRole("button", { name: "保存绑定" }));

    expect(api.saveBinding).toHaveBeenCalledWith(expect.objectContaining({
      automationGrantIds: ["grant_1"],
    }));
  });

  it("drops revoked Grant IDs before saving a replacement active Grant", async () => {
    const user = userEvent.setup();
    const api = { saveBinding: vi.fn(), trigger: vi.fn(), createGrant: vi.fn(), revokeGrant: vi.fn() };
    render(<ProjectLoopBindings model={{
      ...model,
      bindings: [{
        id: "binding_1",
        loopDefinitionId: "loop_1",
        activeVersionId: "version_3",
        status: "enabled",
        version: 2,
        triggerPolicy: { manual: true, taskEvents: [] },
        automationGrantIds: ["grant_revoked"],
      }],
      grants: [{
        id: "grant_revoked",
        status: "revoked",
        permission: "workspace_full",
        workspaceBindingIds: ["workspace_1"],
        allowedRelativePathPrefixes: ["."],
        bindingIds: ["binding_1"],
        expiresAt: null,
        revokedAt: "2026-08-06T16:29:55.931Z",
      }, {
        id: "grant_active",
        status: "active",
        permission: "workspace_full",
        workspaceBindingIds: ["workspace_1"],
        allowedRelativePathPrefixes: ["."],
        bindingIds: ["binding_1"],
        expiresAt: null,
        revokedAt: null,
      }],
    }} api={api} />);

    await user.click(screen.getByRole("checkbox", { name: "Workspace 完全权限 · grant_active" }));
    await user.click(screen.getByRole("button", { name: "保存绑定" }));

    expect(api.saveBinding).toHaveBeenCalledWith(expect.objectContaining({
      automationGrantIds: ["grant_active"],
    }));
  });

  it("does not show revoked Grants in the Project Loop grant inventory", () => {
    render(<ProjectLoopBindings model={{
      ...model,
      grants: [{
        id: "grant_revoked",
        status: "revoked",
        permission: "workspace_full",
        workspaceBindingIds: ["workspace_1"],
        allowedRelativePathPrefixes: ["."],
        bindingIds: [],
        expiresAt: null,
        revokedAt: "2026-08-06T16:29:55.931Z",
      }],
    }} api={{ saveBinding: vi.fn(), trigger: vi.fn(), createGrant: vi.fn(), revokeGrant: vi.fn() }} />);

    expect(screen.queryByText("已撤销")).toBeNull();
    expect(screen.getByText("当前项目没有有效的自动化授权。")).toBeTruthy();
  });

  it("does not retain checkbox events across batched Workspace grant updates", () => {
    render(<ProjectLoopBindings model={{
      ...model,
      grants: [{
        id: "grant_1",
        status: "active",
        permission: "workspace_full",
        workspaceBindingIds: ["workspace_1"],
        allowedRelativePathPrefixes: ["."],
        bindingIds: [],
        expiresAt: null,
        revokedAt: null,
      }],
    }} api={{ saveBinding: vi.fn(), trigger: vi.fn(), createGrant: vi.fn(), revokeGrant: vi.fn() }} />);
    const grantCheckbox = screen.getByRole("checkbox", { name: "Workspace 完全权限 · grant_1" }) as HTMLInputElement;

    expect(() => act(() => {
      grantCheckbox.click();
      grantCheckbox.click();
    })).not.toThrow();

    expect(grantCheckbox.checked).toBe(false);
  });

  it("changes the confirmation fingerprint when the binding scope changes", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const grant = {
      id: "grant_1",
      spaceId: "space_1",
      projectId: "project_1",
      bindingIds: ["binding_1"],
      nodeKeys: [],
      executionPlanes: ["local"],
      deviceIds: [],
      workerIds: [],
      agentProfileIds: [],
      providers: ["codex"],
      permission: "workspace_full",
      workspaceBindingIds: ["workspace_1"],
      allowedRelativePathPrefixes: ["."],
      tools: ["filesystem", "shell"],
      commandCategories: ["build", "test"],
      operationTypes: ["workspace.read", "workspace.write"],
      networkTargets: [],
      recipients: [],
      credentialRefs: [],
      allowProduction: false,
      limits: { maxConcurrency: 1, maxDurationMs: 60_000, maxTokens: 1_000, maxCostUsd: 1, maxToolCalls: 100 },
      policyVersion: "loop_policy_v1",
      status: "active",
      confirmedAt: "2026-07-31T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      revokedAt: null,
    } satisfies AutomationGrantDraft;

    const confirmed = await fingerprintAutomationGrantForBrowser(grant);
    const expanded = await fingerprintAutomationGrantForBrowser({ ...grant, bindingIds: ["binding_1", "binding_2"] });

    expect(confirmed).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(expanded).not.toBe(confirmed);
  });

  it("renders device Workspace labels instead of server-side paths", () => {
    render(<ProjectLoopBindings model={{
      ...model,
      grants: [{
        id: "grant_1",
        status: "active",
        permission: "workspace_full",
        workspaceBindingIds: ["workspace_1"],
        allowedRelativePathPrefixes: ["."],
        bindingIds: [],
        expiresAt: null,
        revokedAt: null,
      }],
    }} api={{ saveBinding: vi.fn(), trigger: vi.fn(), createGrant: vi.fn(), revokeGrant: vi.fn() }} />);

    expect(screen.getByText("Alice MacBook · 项目根目录")).toBeTruthy();
    expect(document.body.textContent).not.toContain("/work/");
  });
});
