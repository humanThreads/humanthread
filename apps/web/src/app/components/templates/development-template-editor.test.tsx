// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevelopmentTemplateEditor } from "./development-template-editor";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const template = {
  id: "template_1", name: "分支开发", description: "先开发再发布", kind: "branch-development",
  version: 1, status: "draft", origin: "space", revision: 2,
  projectConfigSchema: { type: "object", properties: { productionBranch: { type: "string" } } },
  taskFieldSchema: { type: "object", properties: { taskBranch: { type: "string" } } },
  developmentLoopVersionId: "version_task", releaseLoopVersionId: "version_platform",
  triggerPolicy: { releaseTriggers: ["manual"], internalToken: "do-not-render" },
  executionPolicy: { integrationMode: "local_merge_test_push", accessKey: "do-not-render" },
  loopGroupConfig: {
    presets: [
      { key: "研发交付", taskLoopIds: ["version_task"], defaultTaskLoopId: "version_platform", projectLoopIds: ["version_platform", "version_space"], defaultProjectLoopId: "version_platform" },
    ],
    defaultSelection: { selectedPresetKeys: ["研发交付"], defaultPresetKey: "研发交付" },
  },
} as const;

const loops = [
  {
    id: "version_platform", versionNumber: 4, definition: { id: "loop_platform", name: "平台项目 Loop", scope: "project", origin: "platform", spaceId: null },
    status: "published", graph: { nodes: [{ key: "start", label: "开始", type: "start" }, { key: "build", label: "构建", type: "agent_action" }] },
  },
  {
    id: "version_space", versionNumber: 2, definition: { id: "loop_space", name: "团队项目 Loop", scope: "project", origin: "space", spaceId: "space_1" },
    status: "published", graph: { nodes: [{ key: "release", label: "发布", type: "platform_action" }] },
  },
  {
    id: "version_task", versionNumber: 1, definition: { id: "loop_task", name: "任务级 Loop", scope: "task", origin: "space", spaceId: "space_1" },
    status: "published", graph: { nodes: [{ key: "task", label: "任务", type: "agent_action" }] },
  },
] as const;

describe("DevelopmentTemplateEditor", () => {
  it("按作用域展示 Loop 复选框，并支持两个默认单选标记", async () => {
    const user = userEvent.setup();
    render(<DevelopmentTemplateEditor template={template} loops={loops} api={{ saveDraft: vi.fn(), copy: vi.fn() }} />);

    expect(screen.getByRole("group", { name: "任务 Loop 列表" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "项目 Loop 列表" })).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "任务级 Loop" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "平台项目 Loop" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: /默认任务 Loop.*平台项目 Loop/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: /默认里程碑 Loop.*平台项目 Loop/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("默认任务 Loop 图标")).toBeTruthy();
    expect(screen.getByLabelText("默认里程碑 Loop 图标")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /默认任务 Loop.*任务级 Loop/ })).toBeNull();

    await user.click(screen.getByRole("radio", { name: /默认里程碑 Loop.*团队项目 Loop/ }));
    await waitFor(() => expect((screen.getByRole("radio", { name: /默认里程碑 Loop.*团队项目 Loop/ }) as HTMLInputElement).checked).toBe(true));
  });

  it("保存时写入任务/项目 Loop 列表和两个默认值", async () => {
    const user = userEvent.setup();
    const saveDraft = vi.fn().mockResolvedValue({ revision: 3 });
    render(<DevelopmentTemplateEditor template={{ ...template, loopGroupConfig: null, developmentLoopVersionId: null, releaseLoopVersionId: null }} loops={loops} api={{ saveDraft, copy: vi.fn() }} />);

    await user.click(screen.getByRole("checkbox", { name: "任务级 Loop" }));
    await user.click(screen.getByRole("checkbox", { name: "平台项目 Loop" }));
    await user.click(screen.getByRole("checkbox", { name: "团队项目 Loop" }));
    await user.click(screen.getByRole("radio", { name: /默认任务 Loop.*平台项目 Loop/ }));
    await user.click(screen.getByRole("radio", { name: /默认里程碑 Loop.*团队项目 Loop/ }));
    await user.click(screen.getByRole("button", { name: "保存模板" }));

    expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      developmentLoopVersionId: "version_platform",
      releaseLoopVersionId: "version_space",
      loopGroupConfig: expect.objectContaining({
        presets: expect.arrayContaining([expect.objectContaining({
          taskLoopIds: ["version_task"],
          defaultTaskLoopId: "version_platform",
          projectLoopIds: ["version_platform", "version_space"],
          defaultProjectLoopId: "version_space",
        })]),
      }),
    }));
  });

  it("允许模板只关联项目级 Loop，不要求选择任务 Loop", async () => {
    const user = userEvent.setup();
    const saveDraft = vi.fn().mockResolvedValue({ revision: 3 });
    render(<DevelopmentTemplateEditor template={{ ...template, loopGroupConfig: null, developmentLoopVersionId: null, releaseLoopVersionId: null }} loops={loops} api={{ saveDraft, copy: vi.fn() }} />);

    await user.click(screen.getByRole("checkbox", { name: "平台项目 Loop" }));
    await user.click(screen.getByRole("radio", { name: /默认任务 Loop.*平台项目 Loop/ }));
    await user.click(screen.getByRole("radio", { name: /默认里程碑 Loop.*平台项目 Loop/ }));
    await user.click(screen.getByRole("button", { name: "保存模板" }));

    expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      developmentLoopVersionId: "version_platform",
      releaseLoopVersionId: "version_platform",
      loopGroupConfig: expect.objectContaining({
        presets: [expect.objectContaining({
          taskLoopIds: [],
          defaultTaskLoopId: "version_platform",
          projectLoopIds: ["version_platform"],
          defaultProjectLoopId: "version_platform",
        })],
      }),
    }));
  });

  it("修改已有预设时同步更新当前预设的 Loop 成员和默认值", async () => {
    const user = userEvent.setup();
    const saveDraft = vi.fn().mockResolvedValue({ revision: 3 });
    render(<DevelopmentTemplateEditor template={template} loops={loops} api={{ saveDraft, copy: vi.fn() }} />);

    await user.click(screen.getByRole("radio", { name: /默认里程碑 Loop.*团队项目 Loop/ }));
    await user.click(screen.getByRole("button", { name: "保存模板" }));

    expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      loopGroupConfig: expect.objectContaining({
        presets: [expect.objectContaining({ defaultProjectLoopId: "version_space" })],
      }),
      releaseLoopVersionId: "version_space",
    }));
  });

  it("平台模板保持只读并允许复制为自定义模板", () => {
    render(<DevelopmentTemplateEditor template={{ ...template, origin: "platform", status: "published" }} loops={loops} />);
    expect(screen.getAllByText("平台内置").length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "复制为自定义模板" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "保存模板" })).toBeNull();
    expect((screen.getByDisplayValue("分支开发") as HTMLInputElement).disabled).toBe(true);
  });

  it("已发布的自定义模板仍可编辑，且只显示保存模板操作", async () => {
    const user = userEvent.setup();
    const saveDraft = vi.fn().mockResolvedValue({ revision: 3 });
    render(<DevelopmentTemplateEditor template={{ ...template, status: "published" }} loops={loops} api={{ saveDraft, copy: vi.fn() }} />);

    await user.clear(screen.getByLabelText("名称"));
    await user.type(screen.getByLabelText("名称"), "可继续编辑");
    await user.click(screen.getByRole("button", { name: "保存模板" }));

    expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({ name: "可继续编辑" }));
    expect(screen.queryByRole("button", { name: "发布模板" })).toBeNull();
  });
});
