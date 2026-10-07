// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSettingsPanel } from "./project-settings-panel";

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

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ok: true, result: { templates: [], agentProfiles: [] } }), { status: 200 }))));
});

function renderPanel(overrides: Partial<ComponentProps<typeof ProjectSettingsPanel>> = {}) {
  return render(<ProjectSettingsPanel projectId="project_1" spaceId="space_1" shortCode="OLD" version={3} canEdit developmentTemplateKey={null} developmentTemplateVersion={null} developmentTemplateConfig={null} productionBranch={null} stagingBranch={null} releaseAgentProfileId={null} {...overrides} />);
}

describe("ProjectSettingsPanel", () => {
  it("renders the current short code", () => {
    renderPanel();
    expect((screen.getByLabelText("项目简称") as HTMLInputElement).value).toBe("OLD");
  });

  it("renders only the short-code form in the short-code settings domain", () => {
    renderPanel({ section: "short-code" });
    expect(screen.getByLabelText("项目简称")).toBeTruthy();
    expect(screen.queryByText("环境配置")).toBeNull();
    expect(screen.queryByText("开发模式")).toBeNull();
  });

  it("renders only environment metadata in the environment settings domain", () => {
    renderPanel({ section: "environment" });
    expect(screen.getByText("环境配置")).toBeTruthy();
    expect(screen.queryByLabelText("项目简称")).toBeNull();
    expect(screen.queryByText("开发模式")).toBeNull();
  });

  it("展示统一环境配置并保存执行端与缺失状态", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { version: 4, environmentConfigurationVersion: 2, configuration: { schemaVersion: 1, entries: [] } } }), { status: 200 }));
    renderPanel({ environmentConfiguration: { schemaVersion: 1, entries: [{ id: "0123456789abcdef0123456789abcdef", name: "OPENAI_API_KEY", purpose: "模型调用", executionTargets: ["worker"], sourceType: "humanthread", reference: "OPENAI_API_KEY", status: "missing", revision: 1 }] }, environmentConfigurationVersion: 1 });
    expect(screen.getByText("OPENAI_API_KEY")).toBeTruthy();
    expect(screen.getAllByText("待补充").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "保存环境配置" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/projects/project_1", expect.objectContaining({ body: expect.stringContaining("environmentConfiguration") }));
  });

  it("supports adding and editing an environment entry before saving", async () => {
    const user = userEvent.setup();
    renderPanel({ section: "environment" });

    await user.type(screen.getByLabelText("环境变量名"), "MCP_ENDPOINT");
    await user.type(screen.getByLabelText("配置用途"), "模型工具调用");
    await user.type(screen.getByLabelText("来源引用"), "MCP_ENDPOINT");
    await user.click(screen.getByRole("button", { name: "添加到列表" }));

    expect(screen.getByText("MCP_ENDPOINT")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "编辑 MCP_ENDPOINT" }));
    expect((screen.getByLabelText("环境变量名") as HTMLInputElement).value).toBe("MCP_ENDPOINT");
  });

  it("saves the code and refreshes the Project hub", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { version: 4 } }), { status: 200 }));
    renderPanel();
    const input = screen.getByLabelText("项目简称");
    await user.clear(input);
    await user.type(input, "ht");
    await user.click(screen.getByRole("button", { name: "保存简称" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/projects/project_1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ shortCode: "HT", expectedVersion: 3 }) }));
  });

  it("disables controls while the request is pending", async () => {
    const user = userEvent.setup();
    let resolveRequest!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
    renderPanel();
    await user.click(screen.getByRole("button", { name: "保存简称" }));
    expect((screen.getByLabelText("项目简称") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "保存中" }) as HTMLButtonElement).disabled).toBe(true);
    resolveRequest(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  it("keeps the entered value and shows API errors", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockImplementation((input) => Promise.resolve(String(input).includes("/api/development-templates")
      ? new Response(JSON.stringify({ ok: true, result: { templates: [], agentProfiles: [] } }), { status: 200 })
      : new Response(JSON.stringify({ ok: false, code: "validation_failed", error: "Project short code already exists in this Team" }), { status: 400 })));
    renderPanel();
    const input = screen.getByLabelText("项目简称");
    await user.clear(input);
    await user.type(input, "DUP");
    await user.click(screen.getByRole("button", { name: "保存简称" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Project short code already exists in this Team");
    expect((input as HTMLInputElement).value).toBe("DUP");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("requires confirmation before sending an explicit development template upgrade", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockImplementation((input) => Promise.resolve(String(input).includes("/api/development-templates")
      ? new Response(JSON.stringify({ ok: true, result: {
        templates: [
          { key: "branch-development", kind: "branch-development", name: "分支开发", version: 1, developmentLoopVersionId: "loop_task_v1", releaseLoopVersionId: "loop_release_v1" },
          { key: "custom_branch_abc", kind: "branch-development", name: "团队分支", version: 2, developmentLoopVersionId: "loop_task_v2", releaseLoopVersionId: "loop_release_v3" },
        ],
        loopVersions: [
          { id: "loop_task_v1", versionNumber: 1, loopDefinition: { id: "loop_task", name: "任务开发", scope: "project" }, graph: taskLoopGraph },
          { id: "loop_release_v1", versionNumber: 1, loopDefinition: { id: "loop_release", name: "里程碑发版", scope: "project" }, graph: releaseLoopGraph },
          { id: "loop_task_v2", versionNumber: 2, loopDefinition: { id: "loop_task", name: "任务开发", scope: "project" }, graph: taskLoopGraph },
          { id: "loop_release_v3", versionNumber: 3, loopDefinition: { id: "loop_release", name: "里程碑发版", scope: "project" }, graph: releaseLoopGraph },
        ],
        agentProfiles: [{ id: "profile_release", name: "Release", provider: "codex" }],
      } }), { status: 200 })
      : new Response(JSON.stringify({ ok: true, result: { version: 4 } }), { status: 200 })));
    renderPanel({ developmentTemplateKey: "branch-development", developmentTemplateVersion: 1, developmentTemplateConfig: { productionBranch: "main", stagingBranch: "staging", releaseAgentProfileId: "profile_release" }, productionBranch: "main", stagingBranch: "staging", releaseAgentProfileId: "profile_release", developmentLoopVersionId: "persisted_task_v9", releaseLoopVersionId: "persisted_release_v8" });
    const customTemplateOption = await screen.findByRole("option", { name: "团队分支" });
    await user.selectOptions(screen.getByLabelText("开发模式"), customTemplateOption);
    expect(await screen.findByText("创建任务分支")).toBeTruthy();
    expect(screen.getByText("人工批准生产发布")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "准备升级" }));
    expect(screen.getByText(/每个 Loop 始终使用其当前激活版本/u)).toBeTruthy();
    expect(screen.getByText("任务开发 Loop")).toBeTruthy();
    expect(screen.getByText("里程碑 Loop")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "确认升级" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/projects/project_1", expect.objectContaining({ body: JSON.stringify({ expectedVersion: 3, developmentTemplateUpgrade: { key: "custom_branch_abc", version: 2, config: { productionBranch: "main", stagingBranch: "staging", releaseAgentProfileId: "profile_release", taskBranchPattern: "{year}-{shortId}" } } }) }));
  });

  it("keeps a game development template with colons in its key selected for upgrade", async () => {
    const user = userEvent.setup();
    const gameTemplateKey = "space_space:company:company_1";
    vi.mocked(fetch).mockImplementation((input) => Promise.resolve(String(input).includes("/api/development-templates")
      ? new Response(JSON.stringify({ ok: true, result: {
        templates: [
          { key: "branch-development", kind: "branch-development", name: "分支开发", version: 4, developmentLoopVersionId: "loop_task_v4", releaseLoopVersionId: "loop_release_v2" },
          { key: gameTemplateKey, kind: "branch-development", name: "游戏开发", version: 1, developmentLoopVersionId: "loop_game_task_v1", releaseLoopVersionId: "loop_game_release_v1" },
        ],
        loopVersions: [
          { id: "loop_task_v4", versionNumber: 4, loopDefinition: { id: "loop_task", name: "任务开发", scope: "project" }, graph: taskLoopGraph },
          { id: "loop_release_v2", versionNumber: 2, loopDefinition: { id: "loop_release", name: "里程碑发版", scope: "project" }, graph: releaseLoopGraph },
          { id: "loop_game_task_v1", versionNumber: 1, loopDefinition: { id: "loop_game_task", name: "游戏任务", scope: "project" }, graph: taskLoopGraph },
          { id: "loop_game_release_v1", versionNumber: 1, loopDefinition: { id: "loop_game_release", name: "游戏发版", scope: "project" }, graph: releaseLoopGraph },
        ],
        agentProfiles: [{ id: "profile_release", name: "Release", provider: "codex" }],
      } }), { status: 200 })
      : new Response(JSON.stringify({ ok: true, result: { version: 4 } }), { status: 200 })));
    renderPanel({ developmentTemplateKey: "branch-development", developmentTemplateVersion: 4, developmentTemplateConfig: { productionBranch: "main", stagingBranch: "stage", releaseAgentProfileId: "profile_release" }, productionBranch: "main", stagingBranch: "stage", releaseAgentProfileId: "profile_release" });

    const gameOption = await screen.findByRole("option", { name: "游戏开发" });
    await user.selectOptions(screen.getByLabelText("开发模式"), gameOption);

    expect(screen.getByRole("region", { name: "已选 Loop 流程预览" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "准备升级" }));
    await user.click(screen.getByRole("button", { name: "确认升级" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/projects/project_1", expect.objectContaining({ body: JSON.stringify({ expectedVersion: 3, developmentTemplateUpgrade: { key: gameTemplateKey, version: 1, config: { productionBranch: "main", stagingBranch: "stage", releaseAgentProfileId: "profile_release", taskBranchPattern: "{year}-{shortId}" } } }) }));
  });
});
