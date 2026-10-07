import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertCanReadProject, assertCanReadSpace, listDevelopmentTemplatesForSpace, prisma } from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { createDevelopmentTemplateDraft } from "@/lib/templates/development-template-commands";
import { GET, POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));
vi.mock("@humanthread/db", () => ({
  assertCanReadProject: vi.fn(), assertCanReadSpace: vi.fn(),
  assertCanWriteSpace: vi.fn(), listDevelopmentTemplatesForSpace: vi.fn(),
  prisma: {
    agentProfile: { findMany: vi.fn() },
    loopVersion: { findMany: vi.fn() },
    projectLoopBinding: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/templates/development-template-commands", () => ({ createDevelopmentTemplateDraft: vi.fn() }));

describe("GET /api/development-templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("HUMANTHREAD_DEVELOPMENT_MODES", "true");
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    vi.mocked(assertCanReadSpace).mockResolvedValue({ spaceId: "space_1", role: "member" });
    vi.mocked(assertCanReadProject).mockResolvedValue({ projectId: "project_1", role: "member" });
    vi.mocked(listDevelopmentTemplatesForSpace).mockResolvedValue([{
      id: "template_branch_v1",
      key: "branch-development",
      name: "分支开发",
      version: 1,
      status: "published",
      spaceId: null,
      origin: "platform",
      kind: "branch-development",
      description: "任务分支开发和里程碑发布",
      createdByUserId: null,
      sourceTemplateId: null,
      revision: 1,
      projectConfigSchema: {},
      taskFieldSchema: {},
      developmentLoopVersionId: "loop_task_v1",
      releaseLoopVersionId: "loop_release_v1",
      triggerPolicy: {},
      executionPolicy: {},
    }]);
    vi.mocked(prisma.agentProfile.findMany).mockResolvedValue([{
      id: "profile_release",
      name: "Release Agent",
      provider: "codex",
    }] as never);
    vi.mocked(prisma.projectLoopBinding.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.loopVersion.findMany).mockResolvedValue([
      { id: "loop_task_v1", versionNumber: 1, status: "published", graph: {}, loopDefinition: { id: "loop_task", name: "任务开发", scope: "project", origin: "platform", spaceId: null } },
      { id: "loop_task_draft", versionNumber: 2, status: "draft", graph: {}, loopDefinition: { id: "loop_task", name: "任务开发", scope: "project", origin: "platform", spaceId: null } },
      { id: "loop_task_task_scope", versionNumber: 2, status: "published", graph: {}, loopDefinition: { id: "loop_task_task", name: "任务开发", scope: "task", origin: "platform", spaceId: null } },
      { id: "loop_space_other", versionNumber: 2, status: "published", graph: {}, loopDefinition: { id: "loop_space_other", name: "其他空间", scope: "project", origin: "space", spaceId: "space_other" } },
    ] as never);
    vi.mocked(createDevelopmentTemplateDraft).mockResolvedValue({ id: "template_new", key: "space_1_new", version: 1, status: "draft" } as never);
  });

  it("lists published templates and active AgentProfiles in the selected Space", async () => {
    const response = await GET(new Request("http://localhost/api/development-templates?spaceId=space_1"));

    expect(response.status).toBe(200);
    expect(assertCanReadSpace).toHaveBeenCalledWith({ userId: "user_1", spaceId: "space_1" });
    expect(prisma.agentProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { spaceId: "space_1", status: "active" },
    }));
    expect(listDevelopmentTemplatesForSpace).toHaveBeenCalledWith({ spaceId: "space_1", statuses: ["draft", "published"] });
    expect(await response.json()).toMatchObject({
      ok: true,
      result: {
        templates: [{ key: "branch-development", version: 1 }],
        agentProfiles: [{ id: "profile_release", provider: "codex" }],
      },
    });
    expect(prisma.loopVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "published" }),
      select: expect.objectContaining({ graph: true }),
    }));
  });

  it("returns only accessible published project-scoped Loop versions with a canonical definition field", async () => {
    vi.mocked(listDevelopmentTemplatesForSpace).mockResolvedValue([{
      id: "template_branch_v1", key: "branch-development", name: "分支开发", version: 1, status: "published", spaceId: null, origin: "platform", kind: "branch-development", description: null, createdByUserId: null, sourceTemplateId: null, revision: 1, projectConfigSchema: {}, taskFieldSchema: {}, developmentLoopVersionId: "loop_task_v1", releaseLoopVersionId: "loop_space_other", triggerPolicy: {}, executionPolicy: {},
    }]);
    vi.mocked(prisma.loopVersion.findMany).mockResolvedValue([
      { id: "loop_task_v1", versionNumber: 1, status: "published", graph: { schemaVersion: 1, inputSchema: {}, outputSchema: {}, limits: { maxStages: 1, maxRepeatCount: 1 }, nodes: [{ key: "start", label: "开始", type: "start" }, { key: "end", label: "结束", type: "end" }], edges: [{ id: "start_end", source: "start", target: "end", kind: "normal", outcome: "success" }] }, loopDefinition: { id: "loop_task", name: "任务开发", scope: "project", origin: "platform", spaceId: null } },
      { id: "loop_space_other", versionNumber: 1, status: "published", graph: {}, loopDefinition: { id: "loop_other", name: "其他空间", scope: "project", origin: "space", spaceId: "space_other" } },
    ] as never);
    const response = await GET(new Request("http://localhost/api/development-templates?spaceId=space_1"));
    const body = await response.json();
    expect(body.result.loopVersions).toEqual([
      expect.objectContaining({ id: "loop_task_v1", definition: expect.objectContaining({ id: "loop_task", scope: "project" }) }),
    ]);
    expect(body.result.loopVersions).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "loop_space_other" })]));
  });

  it("scopes persisted Project Loop bindings to the selected Space", async () => {
    await GET(new Request("http://localhost/api/development-templates?spaceId=space_1&projectId=project_1"));

    expect(assertCanReadProject).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
    expect(prisma.projectLoopBinding.findMany).toHaveBeenCalledWith({
      where: {
        projectId: "project_1",
        project: { spaceId: "space_1" },
      },
      select: { activeVersionId: true },
    });
  });

  it("loads every Loop version referenced by selected template presets", async () => {
    vi.mocked(listDevelopmentTemplatesForSpace).mockResolvedValue([{
      id: "template_grouped", key: "grouped", name: "组合预设", version: 1, status: "published", spaceId: "space_1", origin: "space", kind: "branch-development", description: null, createdByUserId: "user_1", sourceTemplateId: null, revision: 1, projectConfigSchema: {}, taskFieldSchema: {}, developmentLoopVersionId: "loop_task_v1", releaseLoopVersionId: "loop_project_v1", triggerPolicy: {}, executionPolicy: {},
      loopGroupConfig: {
        presets: [
          { key: "研发", taskLoopIds: ["loop_task_v1", "loop_task_v2"], defaultTaskLoopId: "loop_project_v1", projectLoopIds: ["loop_project_v1"], defaultProjectLoopId: "loop_project_v1" },
          { key: "测试", taskLoopIds: ["loop_task_v3"], defaultTaskLoopId: "loop_project_v2", projectLoopIds: ["loop_project_v2"], defaultProjectLoopId: "loop_project_v2" },
        ],
        defaultSelection: { selectedPresetKeys: ["研发", "测试"], defaultPresetKey: "研发" },
      },
    }]);
    vi.mocked(prisma.loopVersion.findMany).mockResolvedValue([] as never);

    await GET(new Request("http://localhost/api/development-templates?spaceId=space_1"));

    expect(prisma.loopVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: expect.arrayContaining(["loop_task_v2", "loop_task_v3", "loop_project_v2"]) } }),
    }));
  });

  it("does not expose templates while the rollout flag is disabled", async () => {
    vi.stubEnv("HUMANTHREAD_DEVELOPMENT_MODES", "false");
    const response = await GET(new Request("http://localhost/api/development-templates?spaceId=space_1"));
    expect(response.status).toBe(404);
    expect(listDevelopmentTemplatesForSpace).not.toHaveBeenCalled();
  });

  it("creates a blank Space draft with an explicit command", async () => {
    const response = await POST(new Request("http://localhost/api/development-templates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "create_1", spaceId: "space_1", name: "Delivery" }) }));
    expect(response.status).toBe(201);
    expect(createDevelopmentTemplateDraft).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: "user_1", commandId: "create_1", spaceId: "space_1" }));
  });
});
