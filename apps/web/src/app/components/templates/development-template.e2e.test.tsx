// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectCreateDialog } from "../projects/project-create-dialog";
import { ProjectSettingsPanel } from "../projects/project-settings-panel";
import {
  DevelopmentTemplateEditor,
  type DevelopmentTemplateEditorTemplate,
  type DevelopmentTemplateLoopVersion,
} from "./development-template-editor";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const graph = (label: string) => ({
  schemaVersion: 1,
  inputSchema: {},
  outputSchema: {},
  limits: { maxStages: 8, maxRepeatCount: 2 },
  nodes: [
    { key: "start", label: "开始", type: "start" },
    { key: "work", label, type: "end" },
  ],
  edges: [{ id: "start_work", source: "start", target: "work", kind: "normal", outcome: "success" }],
});

const loop = (id: string, versionNumber: number, definitionId: string, name: string, scope: "task" | "project" = "project"): DevelopmentTemplateLoopVersion => ({
  id,
  versionNumber,
  status: "published",
  definition: { id: definitionId, name, scope, origin: "platform", spaceId: null },
  graph: { nodes: graph(`${name} v${versionNumber}`).nodes },
});

const platformTemplate: DevelopmentTemplateEditorTemplate = {
  id: "template_platform_v1",
  name: "分支开发",
  description: "任务分支开发和里程碑发版",
  kind: "branch-development",
  version: 1,
  status: "published",
  origin: "platform",
  revision: 1,
  projectConfigSchema: {},
  taskFieldSchema: {},
  developmentLoopVersionId: "loop_release_v3",
  releaseLoopVersionId: "loop_release_v3",
  triggerPolicy: {},
  executionPolicy: {},
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_HUMANTHREAD_DEVELOPMENT_MODES", "true");
});

describe("Development template lifecycle E2E", () => {
  it("keeps Project Loop versions pinned until an explicit atomic template upgrade", async () => {
    const user = userEvent.setup();
    const state = {
      templates: [] as DevelopmentTemplateEditorTemplate[],
      project: null as null | {
        id: string;
        version: number;
        templateKey: string;
        templateVersion: number;
        developmentLoopVersionId: string;
        releaseLoopVersionId: string;
      },
    };
    const loops = [
      loop("loop_task_v2", 2, "loop_task", "任务开发", "task"),
      loop("loop_release_v3", 3, "loop_release", "里程碑发版"),
      loop("loop_task_v4", 4, "loop_task", "任务开发", "task"),
      loop("loop_release_v5", 5, "loop_release", "里程碑发版"),
    ];

    render(<DevelopmentTemplateEditor template={platformTemplate} loops={loops} spaceId="space_1" api={{
      saveDraft: vi.fn(),
      copy: vi.fn(async () => {
        state.templates.push({
          ...platformTemplate,
          id: "custom_branch_v1",
          name: "团队分支",
          status: "draft",
          origin: "space",
          revision: 1,
          developmentLoopVersionId: null,
          releaseLoopVersionId: null,
          sourceTemplateId: platformTemplate.id,
        });
      }),
    }} />);
    await user.click(screen.getByRole("button", { name: "复制为自定义模板" }));
    await waitFor(() => expect(state.templates).toHaveLength(1));

    cleanup();
    const firstDraft = state.templates[0]!;
    render(<DevelopmentTemplateEditor template={firstDraft} loops={loops.slice(0, 2)} api={{
      copy: vi.fn(),
      saveDraft: vi.fn(async (input) => {
        firstDraft.developmentLoopVersionId = String(input.developmentLoopVersionId);
        firstDraft.releaseLoopVersionId = String(input.releaseLoopVersionId);
        firstDraft.revision = 2;
        return { revision: 2 };
      }),
    }} />);
    await user.click(screen.getByRole("checkbox", { name: "里程碑发版" }));
    await user.click(screen.getByRole("radio", { name: /默认任务 Loop：里程碑发版/ }));
    await user.click(screen.getByRole("radio", { name: /默认里程碑 Loop：里程碑发版/ }));
    await user.click(screen.getByRole("button", { name: "保存模板" }));
    expect((await screen.findByRole("alert")).textContent).toContain("模板已保存");
    expect(firstDraft).toMatchObject({
      status: "draft",
      developmentLoopVersionId: "loop_release_v3",
      releaseLoopVersionId: "loop_release_v3",
    });

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/development-templates")) {
        return json({ ok: true, result: templateCatalog(state.templates, loops) });
      }
      if (url === "/api/projects" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { developmentTemplateKey: string; developmentTemplateVersion: number };
        state.project = {
          id: "project_1",
          version: 1,
          templateKey: body.developmentTemplateKey,
          templateVersion: body.developmentTemplateVersion,
          developmentLoopVersionId: "loop_task_v2",
          releaseLoopVersionId: "loop_release_v3",
        };
        return json({ ok: true, result: { projectId: "project_1", version: 1 } }, 201);
      }
      if (url === "/api/projects/project_1" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { developmentTemplateUpgrade: { key: string; version: number } };
        const selected = state.templates.find((template) => template.id === `${body.developmentTemplateUpgrade.key}_v${body.developmentTemplateUpgrade.version}`)!;
        state.project = {
          ...state.project!,
          version: state.project!.version + 1,
          templateKey: body.developmentTemplateUpgrade.key,
          templateVersion: body.developmentTemplateUpgrade.version,
          developmentLoopVersionId: selected.developmentLoopVersionId!,
          releaseLoopVersionId: selected.releaseLoopVersionId!,
        };
        return json({ ok: true, result: { version: state.project.version } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    cleanup();
    render(<ProjectCreateDialog
      open
      spaces={[{ id: "space_1", name: "Gelsang", type: "company" }]}
      managers={[{ id: "user_1", name: "Gelsang", spaceId: "space_1" }]}
      onOpenChange={vi.fn()}
      onCreated={vi.fn()}
    />);
    await screen.findByRole("option", { name: "团队分支" });
    await user.type(screen.getByLabelText("项目名称"), "HumanThread");
    await user.type(screen.getByLabelText("项目目标"), "交付开发模板");
    await user.selectOptions(screen.getByLabelText("开发模式"), "custom_branch:1");
    await user.type(screen.getByLabelText("生产分支"), "main");
    await user.type(screen.getByLabelText("预发分支"), "staging");
    await user.selectOptions(screen.getByLabelText("发版 Agent"), "profile_release");
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    await waitFor(() => expect(state.project).toMatchObject({
      templateVersion: 1,
      developmentLoopVersionId: "loop_task_v2",
      releaseLoopVersionId: "loop_release_v3",
    }));

    state.templates.push({
      ...firstDraft,
      id: "custom_branch_v2",
      version: 2,
      revision: 1,
      developmentLoopVersionId: "loop_task_v4",
      releaseLoopVersionId: "loop_release_v5",
    });
    expect(state.project).toMatchObject({
      templateVersion: 1,
      developmentLoopVersionId: "loop_task_v2",
      releaseLoopVersionId: "loop_release_v3",
    });

    cleanup();
    render(<ProjectSettingsPanel
      projectId="project_1"
      spaceId="space_1"
      shortCode="HT"
      version={state.project!.version}
      canEdit
      developmentTemplateKey={state.project!.templateKey}
      developmentTemplateVersion={state.project!.templateVersion}
      developmentTemplateConfig={{ productionBranch: "main", stagingBranch: "staging", releaseAgentProfileId: "profile_release" }}
      productionBranch="main"
      stagingBranch="staging"
      releaseAgentProfileId="profile_release"
      developmentLoopVersionId={state.project!.developmentLoopVersionId}
      releaseLoopVersionId={state.project!.releaseLoopVersionId}
    />);
    expect(await screen.findAllByRole("option", { name: "团队分支" })).toHaveLength(2);
    await user.selectOptions(screen.getByLabelText("开发模式"), JSON.stringify(["custom_branch", 2]));
    await user.click(screen.getByRole("button", { name: "准备升级" }));
    expect(screen.getByText(/每个 Loop 始终使用其当前激活版本/u)).toBeTruthy();
    expect(state.project).toMatchObject({ developmentLoopVersionId: "loop_task_v2", releaseLoopVersionId: "loop_release_v3" });
    await user.click(screen.getByRole("button", { name: "确认升级" }));
    await waitFor(() => expect(state.project).toMatchObject({
      templateVersion: 2,
      developmentLoopVersionId: "loop_task_v4",
      releaseLoopVersionId: "loop_release_v5",
    }));
  }, 15_000);
});

function templateCatalog(templates: DevelopmentTemplateEditorTemplate[], loops: DevelopmentTemplateLoopVersion[]) {
  return {
    templates: templates.filter((template) => template.status !== "deprecated").map((template) => ({
      key: template.id.replace(/_v\d+$/u, ""),
      kind: template.kind,
      name: template.name,
      version: template.version,
      developmentLoopVersionId: template.developmentLoopVersionId,
      releaseLoopVersionId: template.releaseLoopVersionId,
    })),
    loopVersions: loops.map((version) => ({
      id: version.id,
      versionNumber: version.versionNumber,
      definition: version.definition,
      graph: graph(`${version.definition.name} v${version.versionNumber}`),
    })),
    agentProfiles: [{ id: "profile_release", name: "Release", provider: "codex" }],
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
