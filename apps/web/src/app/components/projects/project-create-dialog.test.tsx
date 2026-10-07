// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectCenter } from "./project-center";
import { resolveLoopGroupSelection } from "./project-create-dialog";

const spaces = [
  { id: "space_personal", name: "个人空间", type: "personal" as const },
  { id: "space_company", name: "研发公司", type: "company" as const },
];
const managers = [
  { id: "user_1", name: "当前用户", spaceId: "space_personal" },
  { id: "user_1", name: "当前用户", spaceId: "space_company" },
  { id: "user_2", name: "项目经理", spaceId: "space_company" },
];

const taskLoopGraph = {
  schemaVersion: 1,
  inputSchema: {}, outputSchema: {}, limits: { maxStages: 8, maxRepeatCount: 2 },
  nodes: [{ key: "start", label: "开始开发", type: "start" }, { key: "branch", label: "创建任务分支", type: "end" }],
  edges: [{ id: "start_branch", source: "start", target: "branch", kind: "normal", outcome: "success" }],
};
const releaseLoopGraph = {
  schemaVersion: 1,
  inputSchema: {}, outputSchema: {}, limits: { maxStages: 8, maxRepeatCount: 2 },
  nodes: [{ key: "start", label: "开始发版", type: "start" }, { key: "approve", label: "人工批准生产发布", type: "human_gate", executionTarget: "platform" }],
  edges: [{ id: "start_approve", source: "start", target: "approve", kind: "normal", outcome: "success" }],
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_HUMANTHREAD_DEVELOPMENT_MODES", "false");
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("project creation", () => {
  it("resolves only available Loop presets and keeps a valid default", () => {
    expect(resolveLoopGroupSelection({
      presets: [{ key: "研发交付" }, { key: "测试回归" }],
      defaultSelection: { selectedPresetKeys: ["研发交付", "不存在"], defaultPresetKey: "不存在" },
    })).toEqual({ selectedPresetKeys: ["研发交付"], defaultPresetKey: "研发交付" });
  });

  it("links each project to its Loop settings", () => {
    render(<ProjectCenter projects={[{
      id: "project_1",
      spaceId: "space_company",
      spaceLabel: "研发公司",
      name: "HumanThread",
      objectiveExcerpt: "统一交付协作",
      owner: { id: "user_2", name: "项目经理" },
      status: "active",
      health: "healthy",
      stageProgress: { completed: 1, total: 2, percent: 50 },
      openTaskCount: 3,
      overdueTaskCount: 0,
      blockedTaskCount: 0,
      nextMilestone: null,
      updatedAt: new Date("2026-07-31T00:00:00.000Z"),
    }]} spaceLabel="研发公司" />);

    expect(screen.getByRole("link", { name: "Loop" }).getAttribute("href")).toBe("/projects/project_1/loops");
  });

  it.each(["新建项目", "创建项目"])("opens the project dialog from %s", async (label) => {
    const user = userEvent.setup();
    render(<ProjectCenter projects={[]} spaceLabel="研发公司" spaces={spaces} managers={managers} initialSpaceId="space_company" />);
    await user.click(screen.getByRole("button", { name: label }));
    expect(screen.getByRole("dialog", { name: "新建项目" })).toBeTruthy();
  });

  it("submits core project fields and navigates to the new hub", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { projectId: "project_new", version: 1 } }), { status: 201, headers: { "content-type": "application/json" } }));
    render(<ProjectCenter projects={[]} spaceLabel="研发公司" spaces={spaces} managers={managers} initialSpaceId="space_company" onProjectCreated={onCreated} />);
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    await user.type(screen.getByLabelText("项目名称"), "文档平台");
    await user.type(screen.getByLabelText("项目目标"), "统一知识交付");
    await user.selectOptions(screen.getByLabelText("项目负责人"), "user_2");
    await user.click(screen.getByRole("button", { name: "创建项目" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toMatchObject({
      spaceId: "space_company",
      name: "文档平台",
      objective: "统一知识交付",
      managerUserId: "user_2",
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ projectId: "project_new", version: 1 }));
  });

  it("loads and submits branch-development configuration when rollout is enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_HUMANTHREAD_DEVELOPMENT_MODES", "true");
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: {
          templates: [{ key: "branch-development", kind: "branch-development", name: "分支开发", version: 1 }],
          agentProfiles: [{ id: "profile_release", name: "Release Agent", provider: "codex" }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { projectId: "project_new", version: 1 } }), { status: 201, headers: { "content-type": "application/json" } }));

    render(<ProjectCenter projects={[]} spaceLabel="研发公司" spaces={spaces} managers={managers} initialSpaceId="space_company" />);
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    await screen.findByRole("option", { name: "分支开发" });
    await user.type(screen.getByLabelText("项目名称"), "Atlas");
    await user.type(screen.getByLabelText("项目目标"), "Ship Atlas");
    await user.selectOptions(screen.getByLabelText("开发模式"), "branch-development:1");
    await user.type(screen.getByLabelText("生产分支"), "main");
    await user.type(screen.getByLabelText("预发分支"), "staging");
    await user.selectOptions(screen.getByLabelText("发版 Agent"), "profile_release");
    await user.click(screen.getByRole("button", { name: "创建项目" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const request = vi.mocked(fetch).mock.calls.find((call) => call[0] === "/api/projects");
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
      developmentTemplateKey: "branch-development",
      developmentTemplateVersion: 1,
      developmentTemplateConfig: {
        productionBranch: "main",
        stagingBranch: "staging",
        releaseAgentProfileId: "profile_release",
      },
    });
  });

  it("shows branch configuration for a copied template by stable kind", async () => {
    vi.stubEnv("NEXT_PUBLIC_HUMANTHREAD_DEVELOPMENT_MODES", "true");
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: {
      templates: [{ key: "custom_branch_abc", kind: "branch-development", name: "团队分支", version: 2, origin: "space" }],
      agentProfiles: [{ id: "profile_release", name: "Release Agent", provider: "codex" }],
    } }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<ProjectCenter projects={[]} spaceLabel="研发公司" spaces={spaces} managers={managers} initialSpaceId="space_company" />);
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    await screen.findByRole("option", { name: "团队分支" });
    await user.selectOptions(screen.getByLabelText("开发模式"), "custom_branch_abc:2");
    expect(screen.getByLabelText("生产分支")).toBeTruthy();
    expect(screen.getByLabelText("预发分支")).toBeTruthy();
  });

  it("previews both persisted Loop version flows before project initialization", async () => {
    vi.stubEnv("NEXT_PUBLIC_HUMANTHREAD_DEVELOPMENT_MODES", "true");
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: {
      templates: [{ key: "custom_branch_abc", kind: "branch-development", name: "团队分支", version: 2, developmentLoopVersionId: "loop_task_v2", releaseLoopVersionId: "loop_release_v3" }],
      loopVersions: [
        { id: "loop_task_v2", versionNumber: 2, loopDefinition: { id: "loop_task", name: "任务开发", scope: "project" }, graph: taskLoopGraph },
        { id: "loop_release_v3", versionNumber: 3, loopDefinition: { id: "loop_release", name: "里程碑发版", scope: "project" }, graph: releaseLoopGraph },
      ],
      agentProfiles: [{ id: "profile_release", name: "Release Agent", provider: "codex" }],
    } }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<ProjectCenter projects={[]} spaceLabel="研发公司" spaces={spaces} managers={managers} initialSpaceId="space_company" />);
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    await screen.findByRole("option", { name: "团队分支" });
    await user.selectOptions(screen.getByLabelText("开发模式"), "custom_branch_abc:2");
    expect(await screen.findByText("创建任务分支")).toBeTruthy();
    expect(screen.getByText("人工批准生产发布")).toBeTruthy();
  });

  it("quickly applies the template default Loop group preset", async () => {
    vi.stubEnv("NEXT_PUBLIC_HUMANTHREAD_DEVELOPMENT_MODES", "true");
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: {
      templates: [{
        key: "branch-development", kind: "branch-development", name: "分支开发", version: 1,
        loopGroupConfig: {
          presets: [
            { key: "研发交付", taskLoopIds: ["task_v1"], defaultTaskLoopId: "project_v1", projectLoopIds: ["project_v1"], defaultProjectLoopId: "project_v1" },
            { key: "测试回归", taskLoopIds: ["task_test"], defaultTaskLoopId: "project_test", projectLoopIds: ["project_test"], defaultProjectLoopId: "project_test" },
          ],
          defaultSelection: { selectedPresetKeys: ["研发交付"], defaultPresetKey: "研发交付" },
        },
      }],
      agentProfiles: [{ id: "profile_release", name: "Release Agent", provider: "codex" }],
    } }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<ProjectCenter projects={[]} spaceLabel="研发公司" spaces={spaces} managers={managers} initialSpaceId="space_company" />);
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    await screen.findByRole("option", { name: "分支开发" });
    await user.selectOptions(screen.getByLabelText("开发模式"), "branch-development:1");
    const presets = screen.getByRole("listbox", { name: "项目 Loop 组预设" }) as HTMLSelectElement;
    await user.selectOptions(presets, ["研发交付", "测试回归"]);
    await user.click(screen.getByRole("button", { name: "快速应用默认预设" }));

    expect(Array.from(presets.selectedOptions, (option) => option.value)).toEqual(["研发交付"]);
    expect((screen.getByRole("combobox", { name: "项目默认 Loop 组预设" }) as HTMLSelectElement).value).toBe("研发交付");
  });

  it("closes without submitting when cancel is selected", async () => {
    const user = userEvent.setup();
    render(<ProjectCenter projects={[]} spaceLabel="研发公司" spaces={spaces} managers={managers} initialSpaceId="space_company" />);
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "新建项目" })).toBeNull();
  });
});
