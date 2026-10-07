import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { initializeWorkbenchProjectDevelopmentMode, upgradeWorkbenchProjectDevelopmentMode, updateWorkbenchProject, updateWorkbenchProjectEnvironmentConfiguration, updateWorkbenchProjectWorkerImageVersion } from "@/lib/workbench/workbench-project-commands";
import { PATCH } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));
vi.mock("@/lib/workbench/workbench-project-commands", () => ({ initializeWorkbenchProjectDevelopmentMode: vi.fn(), upgradeWorkbenchProjectDevelopmentMode: vi.fn(), updateWorkbenchProject: vi.fn(), updateWorkbenchProjectEnvironmentConfiguration: vi.fn(), updateWorkbenchProjectWorkerImageVersion: vi.fn() }));

describe("PATCH /api/projects/[projectId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_session", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  });

  it("更新统一项目环境配置", async () => {
    vi.mocked(updateWorkbenchProjectEnvironmentConfiguration).mockResolvedValue({ projectId: "project_1", version: 4, environmentConfigurationVersion: 2, configuration: { schemaVersion: 1, entries: [] } });
    const response = await PATCH(new Request("http://localhost/api/projects/project_1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: 3, environmentConfiguration: { schemaVersion: 1, entries: [] } }) }), { params: Promise.resolve({ projectId: "project_1" }) });
    expect(response.status).toBe(200);
    expect(updateWorkbenchProjectEnvironmentConfiguration).toHaveBeenCalledWith({ userId: "user_session", projectId: "project_1", expectedVersion: 3, configuration: { schemaVersion: 1, entries: [] } });
  });

  it("保存项目选择的 Worker 镜像目录版本", async () => {
    vi.mocked(updateWorkbenchProjectWorkerImageVersion).mockResolvedValue({ projectId: "project_1", version: 4, workerImageVersionId: "c".repeat(32) });
    const response = await PATCH(new Request("http://localhost/api/projects/project_1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: 3, workerImageVersionId: "c".repeat(32) }) }), { params: Promise.resolve({ projectId: "project_1" }) });
    expect(response.status).toBe(200);
    expect(updateWorkbenchProjectWorkerImageVersion).toHaveBeenCalledWith({ userId: "user_session", projectId: "project_1", expectedVersion: 3, workerImageVersionId: "c".repeat(32) });
  });

  it("updates a short code with the signed session actor", async () => {
    vi.mocked(updateWorkbenchProject).mockResolvedValue({ projectId: "project_1", shortCode: "HT", version: 4 });
    const response = await PATCH(new Request("http://localhost/api/projects/project_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "forged", shortCode: "ht", expectedVersion: 3 }),
    }), { params: Promise.resolve({ projectId: "project_1" }) });

    expect(response.status).toBe(200);
    expect(updateWorkbenchProject).toHaveBeenCalledWith({ userId: "user_session", projectId: "project_1", shortCode: "ht", expectedVersion: 3 });
  });

  it("maps duplicate short codes to a validation error", async () => {
    vi.mocked(updateWorkbenchProject).mockRejectedValue(Object.assign(new Error("Project short code already exists in this Team"), { code: "validation_failed" }));
    const response = await PATCH(new Request("http://localhost/api/projects/project_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shortCode: "HT", expectedVersion: 3 }),
    }), { params: Promise.resolve({ projectId: "project_1" }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, code: "validation_failed" });
  });

  it("rejects the legacy repositoryConfiguration PATCH branch", async () => {
    const response = await PATCH(new Request("http://localhost/api/projects/project_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion: 3,
        repositoryConfiguration: { repositoryUrl: "https://github.com/acme/repo.git", allowedBranches: ["main"] },
      }),
    }), { params: Promise.resolve({ projectId: "project_1" }) });

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "repository_configuration_moved" });
  });

  it("initializes a development mode for an existing project", async () => {
    vi.mocked(initializeWorkbenchProjectDevelopmentMode).mockResolvedValue({ projectId: "project_1", version: 4, developmentTemplateKey: "branch-development" });
    const response = await PATCH(new Request("http://localhost/api/projects/project_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion: 3,
        developmentTemplateKey: "branch-development",
        developmentTemplateVersion: 1,
        developmentTemplateConfig: { productionBranch: "main", stagingBranch: "staging", releaseAgentProfileId: "profile_release" },
      }),
    }), { params: Promise.resolve({ projectId: "project_1" }) });

    expect(response.status).toBe(200);
    expect(initializeWorkbenchProjectDevelopmentMode).toHaveBeenCalledWith({ userId: "user_session", projectId: "project_1", expectedVersion: 3, developmentTemplateKey: "branch-development", developmentTemplateVersion: 1, developmentTemplateConfig: { productionBranch: "main", stagingBranch: "staging", releaseAgentProfileId: "profile_release" } });
    expect(updateWorkbenchProject).not.toHaveBeenCalled();
  });

  it("accepts an explicit development template upgrade while keeping legacy PATCH bodies valid", async () => {
    vi.mocked(upgradeWorkbenchProjectDevelopmentMode).mockResolvedValue({ projectId: "project_1", version: 4, developmentTemplateKey: "custom_branch_abc" });
    const response = await PATCH(new Request("http://localhost/api/projects/project_1", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({
        expectedVersion: 3,
        developmentTemplateUpgrade: { key: "custom_branch_abc", version: 2, config: { productionBranch: "main", stagingBranch: "staging", releaseAgentProfileId: "profile_release" } },
      }),
    }), { params: Promise.resolve({ projectId: "project_1" }) });
    expect(response.status).toBe(200);
    expect(upgradeWorkbenchProjectDevelopmentMode).toHaveBeenCalledWith({ userId: "user_session", projectId: "project_1", expectedVersion: 3, developmentTemplateKey: "custom_branch_abc", developmentTemplateVersion: 2, developmentTemplateConfig: { productionBranch: "main", stagingBranch: "staging", releaseAgentProfileId: "profile_release" } });
  });

  it("maps a stale explicit template upgrade to 409", async () => {
    vi.mocked(upgradeWorkbenchProjectDevelopmentMode).mockRejectedValue(Object.assign(new Error("Project changed while upgrading development mode"), { code: "version_conflict" }));
    const response = await PATCH(new Request("http://localhost/api/projects/project_1", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: 2, developmentTemplateUpgrade: { key: "custom_branch_abc", version: 2, config: {} } }),
    }), { params: Promise.resolve({ projectId: "project_1" }) });
    expect(response.status).toBe(409);
  });

  it("returns field-level issues for invalid upgrade configuration from the command", async () => {
    vi.mocked(upgradeWorkbenchProjectDevelopmentMode).mockRejectedValue(Object.assign(
      new Error("Invalid branch-development configuration"),
      { code: "validation_failed", issues: [{ code: "custom", path: ["stagingBranch"], message: "Staging branch must differ from production branch" }] },
    ));
    const response = await PATCH(new Request("http://localhost/api/projects/project_1", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({
        expectedVersion: 3,
        developmentTemplateUpgrade: { key: "custom_branch_abc", version: 2, config: { productionBranch: "main", stagingBranch: "main", releaseAgentProfileId: "profile_release" } },
      }),
    }), { params: Promise.resolve({ projectId: "project_1" }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "validation_failed",
      issues: [expect.objectContaining({ path: ["stagingBranch"] })],
    });
  });

  it("returns JSON Schema field issues from the real upgrade command through PATCH", async () => {
    vi.stubEnv("HUMANTHREAD_DEVELOPMENT_MODES", "true");
    const { upgradeWorkbenchProjectDevelopmentMode: realUpgrade } = await vi.importActual<typeof import("../../../../lib/workbench/workbench-project-commands")>("../../../../lib/workbench/workbench-project-commands");
    vi.mocked(upgradeWorkbenchProjectDevelopmentMode).mockImplementation((input) => realUpgrade({
      ...input,
      dependencies: {
        assertCanWriteProject: vi.fn().mockResolvedValue({ role: "owner" }),
        getPublishedDevelopmentTemplate: vi.fn().mockResolvedValue({
          key: "custom_branch_abc", kind: "branch-development", version: 2, status: "published", origin: "space", spaceId: "space_1",
          projectConfigSchema: { type: "object", properties: { productionBranch: { type: "string", minLength: 3 } } }, taskFieldSchema: {},
          developmentLoopVersionId: "loop_task_v2", releaseLoopVersionId: "loop_release_v3", triggerPolicy: {}, executionPolicy: {},
        }),
        db: {
          project: { findFirst: vi.fn().mockResolvedValue({ id: "project_1", teamId: "team_1", spaceId: "space_1", shortCode: "AT", version: 3, developmentTemplateKey: "branch-development" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
          agentProfile: { findFirst: vi.fn().mockResolvedValue({ id: "profile_release" }) },
          loopVersion: { findMany: vi.fn().mockResolvedValue([{ id: "loop_task_v2", loopDefinitionId: "loop_task", status: "published", loopDefinition: { scope: "project" } }, { id: "loop_release_v3", loopDefinitionId: "loop_release", status: "published", loopDefinition: { scope: "project" } }]) },
          $transaction: vi.fn(async (callback) => callback({ project: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, projectLoopBinding: { upsert: vi.fn().mockResolvedValue({}) } })),
        },
      },
    }));
    const response = await PATCH(new Request("http://localhost/api/projects/project_1", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({
        expectedVersion: 3,
        developmentTemplateUpgrade: { key: "custom_branch_abc", version: 2, config: { productionBranch: "m", stagingBranch: "staging", releaseAgentProfileId: "profile_release" } },
      }),
    }), { params: Promise.resolve({ projectId: "project_1" }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "validation_failed", issues: [expect.objectContaining({ path: ["productionBranch"] })] });
    vi.unstubAllEnvs();
  }, 15_000);
});
