import { describe, expect, it, vi } from "vitest";
import { createWorkbenchProject, upgradeWorkbenchProjectDevelopmentMode, updateWorkbenchProject, updateWorkbenchProjectEnvironmentConfiguration, updateWorkbenchProjectLoopGroupConfig, updateWorkbenchProjectWorkerDeploymentConfiguration } from "./workbench-project-commands";

describe("createWorkbenchProject", () => {
  it("creates the project even when post-commit knowledge initialization fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const initializeKnowledge = vi.fn().mockRejectedValue(new Error("indexer unavailable"));
    const result = await createWorkbenchProject({
      userId: "user_1",
      spaceId: "space_1",
      name: "Knowledge",
      objective: "Initialize knowledge",
      managerUserId: "user_1",
      createId: () => "project_knowledge",
      dependencies: {
        initializeKnowledge,
        assertCanWriteSpace: vi.fn().mockResolvedValue({ role: "owner" }),
        db: {
          space: { findUnique: vi.fn().mockResolvedValue({ id: "space_1", type: "personal", companyId: null, ownerUserId: "user_1", status: "active" }) },
          user: { findUnique: vi.fn().mockResolvedValue({ id: "user_1", teamId: "team_1" }) },
          companyMember: { findFirst: vi.fn() },
          $transaction: vi.fn(async (callback) => callback({
            project: { create: vi.fn().mockResolvedValue({ id: "project_knowledge", version: 1 }) },
            projectMember: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
          })),
        },
      },
    });

    expect(result).toEqual({ projectId: "project_knowledge", version: 1 });
    expect(initializeKnowledge).toHaveBeenCalledWith({
      projectId: "project_knowledge",
      actorUserId: "user_1",
      projectName: "Knowledge",
      objective: "Initialize knowledge",
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("固化模板多选预设为项目独立的多成员 Loop 组并标记默认绑定", async () => {
    const projectCreate = vi.fn().mockResolvedValue({ id: "project_grouped", version: 1 });
    const projectLoopBindingCreateMany = vi.fn().mockResolvedValue({ count: 4 });
    const transaction = vi.fn(async (callback) => callback({
      project: { create: projectCreate },
      projectMember: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      projectLoopBinding: { createMany: projectLoopBindingCreateMany },
    }));
    const loopGroupConfig = {
      presets: [
        { key: "研发交付", taskLoopIds: ["loop_task_v1", "loop_task_v2"], defaultTaskLoopId: "loop_project_v1", projectLoopIds: ["loop_project_v1"], defaultProjectLoopId: "loop_project_v1" },
        { key: "测试回归", taskLoopIds: ["loop_task_v2", "loop_task_v3"], defaultTaskLoopId: "loop_project_v2", projectLoopIds: ["loop_project_v2"], defaultProjectLoopId: "loop_project_v2" },
      ],
      defaultSelection: { selectedPresetKeys: ["研发交付", "测试回归"], defaultPresetKey: "研发交付" },
    };

    await createWorkbenchProject({
      userId: "user_1", spaceId: "space_1", name: "Grouped", objective: "Use grouped loops", managerUserId: "user_1",
      developmentTemplateKey: "branch-development", developmentTemplateVersion: 1,
      developmentTemplateConfig: { productionBranch: "main", stagingBranch: "staging", releaseAgentProfileId: "profile_release" },
      createId: () => "project_grouped",
      dependencies: {
        developmentModesEnabled: true,
        assertCanWriteSpace: vi.fn().mockResolvedValue({ role: "owner" }),
        getPublishedDevelopmentTemplate: vi.fn().mockResolvedValue({
          id: "template_branch_v1", key: "branch-development", kind: "branch-development", name: "分支开发", version: 1, status: "published",
          projectConfigSchema: { type: "object" }, taskFieldSchema: {}, developmentLoopVersionId: "loop_task_v1", releaseLoopVersionId: "loop_project_v1",
          triggerPolicy: {}, executionPolicy: {}, loopGroupConfig,
        }),
        db: {
          space: { findUnique: vi.fn().mockResolvedValue({ id: "space_1", type: "personal", companyId: null, ownerUserId: "user_1", status: "active" }) },
          user: { findUnique: vi.fn().mockResolvedValue({ id: "user_1", teamId: "team_1" }) },
          companyMember: { findFirst: vi.fn() },
          agentProfile: { findFirst: vi.fn().mockResolvedValue({ id: "profile_release" }) },
          loopVersion: { findMany: vi.fn().mockResolvedValue([
            { id: "loop_task_v1", loopDefinitionId: "loop_task_1", status: "published", loopDefinition: { scope: "project" } },
            { id: "loop_task_v2", loopDefinitionId: "loop_task_2", status: "published", loopDefinition: { scope: "project" } },
            { id: "loop_task_v3", loopDefinitionId: "loop_task_3", status: "published", loopDefinition: { scope: "project" } },
            { id: "loop_project_v1", loopDefinitionId: "loop_project_1", status: "published", loopDefinition: { scope: "project" } },
            { id: "loop_project_v2", loopDefinitionId: "loop_project_2", status: "published", loopDefinition: { scope: "project" } },
          ]) },
          $transaction: transaction,
        },
      },
    });

    expect(projectCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        loopGroupConfig: {
          taskLoopVersionIds: ["loop_task_v1", "loop_task_v2", "loop_task_v3"],
          defaultTaskLoopVersionId: "loop_project_v1",
          projectLoopVersionIds: ["loop_project_v1", "loop_project_v2"],
          defaultProjectLoopVersionId: "loop_project_v1",
          selectedPresetKeys: ["研发交付", "测试回归"],
          defaultPresetKey: "研发交付",
        },
      }),
    }));
    expect(projectLoopBindingCreateMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ activeVersionId: "loop_task_v1", bindingRole: null }),
      expect.objectContaining({ activeVersionId: "loop_task_v2", bindingRole: null }),
      expect.objectContaining({ activeVersionId: "loop_task_v3", bindingRole: null }),
      expect.objectContaining({ activeVersionId: "loop_project_v1", bindingRole: "task_development" }),
      expect.objectContaining({ activeVersionId: "loop_project_v1", bindingRole: "milestone_release" }),
      expect.objectContaining({ activeVersionId: "loop_project_v2", bindingRole: null }),
    ] });
  });

  it("initializes a branch-development Project and both Loop bindings atomically", async () => {
    const projectCreate = vi.fn().mockResolvedValue({ id: "project_new", version: 1 });
    const projectLoopBindingCreateMany = vi.fn().mockResolvedValue({ count: 2 });
    const transaction = vi.fn(async (callback) => callback({
      project: { create: projectCreate },
      projectMember: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      projectLoopBinding: { createMany: projectLoopBindingCreateMany },
    }));
    const getPublishedDevelopmentTemplate = vi.fn().mockResolvedValue({
      id: "template_branch_v1",
      key: "branch-development",
      kind: "branch-development",
      name: "分支开发",
      version: 1,
      status: "published",
      projectConfigSchema: {
        type: "object",
        required: ["productionBranch", "stagingBranch", "releaseAgentProfileId"],
        properties: {
          productionBranch: { type: "string" },
          stagingBranch: { type: "string" },
          releaseAgentProfileId: { type: "string" },
        },
      },
      taskFieldSchema: {},
      developmentLoopVersionId: "loop_task_v1",
      releaseLoopVersionId: "loop_release_v1",
      triggerPolicy: { releaseTriggers: ["milestone.release_ready", "manual"] },
      executionPolicy: { productionApprovalRequired: true },
    });

    await createWorkbenchProject({
      userId: "user_1",
      spaceId: "space_1",
      name: "Atlas",
      objective: "Ship Atlas",
      managerUserId: "user_1",
      developmentTemplateKey: "branch-development",
      developmentTemplateVersion: 1,
      developmentTemplateConfig: {
        productionBranch: "main",
        stagingBranch: "staging",
        releaseAgentProfileId: "profile_release",
      },
      createId: () => "project_new",
      dependencies: {
        developmentModesEnabled: true,
        assertCanWriteSpace: vi.fn().mockResolvedValue({ role: "owner" }),
        getPublishedDevelopmentTemplate,
        db: {
          space: { findUnique: vi.fn().mockResolvedValue({ id: "space_1", type: "personal", companyId: null, ownerUserId: "user_1", status: "active" }) },
          user: { findUnique: vi.fn().mockResolvedValue({ id: "user_1", teamId: "team_1" }) },
          companyMember: { findFirst: vi.fn() },
          agentProfile: { findFirst: vi.fn().mockResolvedValue({ id: "profile_release" }) },
          loopVersion: { findMany: vi.fn().mockResolvedValue([
            { id: "loop_task_v1", loopDefinitionId: "loop_task", status: "published", loopDefinition: { scope: "project" } },
            { id: "loop_release_v1", loopDefinitionId: "loop_release", status: "published", loopDefinition: { scope: "project" } },
          ]) },
          $transaction: transaction,
        },
      },
    });

    expect(projectCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      developmentTemplateKey: "branch-development",
      developmentTemplateVersion: 1,
      productionBranch: "main",
      stagingBranch: "staging",
      releaseAgentProfileId: "profile_release",
    }) }));
    expect(projectLoopBindingCreateMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({
        bindingRole: null,
        activeVersionId: "loop_task_v1",
        allowedAgentProfileIds: ["profile_release"],
        allowedProviders: ["codex"],
        triggerPolicy: {
          manual: false,
          taskEvents: ["task.execution.requested"],
          milestoneEvents: [],
        },
      }),
      expect.objectContaining({ bindingRole: "task_development", activeVersionId: "loop_release_v1" }),
      expect.objectContaining({ bindingRole: "milestone_release", activeVersionId: "loop_release_v1" }),
    ] });
  });

  it("returns a command validation error when production and staging branches match", async () => {
    await expect(createWorkbenchProject({
      userId: "user_1",
      spaceId: "space_1",
      name: "Atlas",
      objective: "Ship Atlas",
      managerUserId: "user_1",
      developmentTemplateKey: "branch-development",
      developmentTemplateVersion: 1,
      developmentTemplateConfig: {
        productionBranch: "main",
        stagingBranch: "main",
        releaseAgentProfileId: "profile_release",
      },
      dependencies: {
        developmentModesEnabled: true,
        assertCanWriteSpace: vi.fn().mockResolvedValue({ role: "owner" }),
        getPublishedDevelopmentTemplate: vi.fn().mockResolvedValue({
          id: "template_branch_v1", key: "branch-development", kind: "branch-development", name: "分支开发", version: 1, status: "published",
          projectConfigSchema: {}, taskFieldSchema: {}, developmentLoopVersionId: "loop_task_v1", releaseLoopVersionId: "loop_release_v1",
          triggerPolicy: {}, executionPolicy: {},
        }),
        db: {
          space: { findUnique: vi.fn().mockResolvedValue({ id: "space_1", type: "personal", companyId: null, ownerUserId: "user_1", status: "active" }) },
          user: { findUnique: vi.fn().mockResolvedValue({ id: "user_1", teamId: "team_1" }) },
          companyMember: { findFirst: vi.fn() },
          $transaction: vi.fn(),
        },
      },
    })).rejects.toMatchObject({
      code: "validation_failed",
      issues: [expect.objectContaining({ path: ["stagingBranch"] })],
    });
  });

  it("returns field paths for JSON Schema configuration failures", async () => {
    await expect(createWorkbenchProject({
      userId: "user_1", spaceId: "space_1", name: "Atlas", objective: "Ship Atlas", managerUserId: "user_1",
      developmentTemplateKey: "custom_branch_abc", developmentTemplateVersion: 2,
      developmentTemplateConfig: { productionBranch: "m", stagingBranch: "staging", releaseAgentProfileId: "profile_release" },
      dependencies: {
        developmentModesEnabled: true,
        assertCanWriteSpace: vi.fn().mockResolvedValue({ role: "owner" }),
        getPublishedDevelopmentTemplate: vi.fn().mockResolvedValue({
          key: "custom_branch_abc", kind: "branch-development", version: 2, status: "published", spaceId: "space_1", origin: "space",
          projectConfigSchema: { type: "object", properties: { productionBranch: { type: "string", minLength: 3 } } }, taskFieldSchema: {},
          developmentLoopVersionId: "loop_task_v2", releaseLoopVersionId: "loop_release_v3", triggerPolicy: {}, executionPolicy: {},
        }),
        db: {
          space: { findUnique: vi.fn().mockResolvedValue({ id: "space_1", type: "personal", companyId: null, ownerUserId: "user_1", status: "active" }) },
          user: { findUnique: vi.fn().mockResolvedValue({ id: "user_1", teamId: "team_1" }) },
          companyMember: { findFirst: vi.fn() },
          $transaction: vi.fn(),
        },
      },
    })).rejects.toMatchObject({
      code: "validation_failed",
      issues: [expect.objectContaining({ path: ["productionBranch"], message: expect.any(String) })],
    });
  });

  it("validates a copied template by stable kind instead of its generated key", async () => {
    const projectCreate = vi.fn().mockResolvedValue({ id: "project_new", version: 1 });
    const getPublishedDevelopmentTemplate = vi.fn().mockResolvedValue({
      id: "template_copy_v1", key: "space_space_1_abc123", kind: "branch-development", name: "Copied",
      version: 1, status: "published", spaceId: "space_1", origin: "space", description: null,
      createdByUserId: "user_1", sourceTemplateId: "template_platform_v1", revision: 1,
      projectConfigSchema: { type: "object", required: ["productionBranch", "stagingBranch", "releaseAgentProfileId"], properties: { productionBranch: { type: "string" }, stagingBranch: { type: "string" }, releaseAgentProfileId: { type: "string" } } },
      taskFieldSchema: {}, developmentLoopVersionId: "loop_task_v1", releaseLoopVersionId: "loop_release_v1",
      triggerPolicy: {}, executionPolicy: {},
    });
    const transaction = vi.fn(async (callback) => callback({
      project: { create: projectCreate },
      projectMember: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      projectLoopBinding: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
    }));

    await expect(createWorkbenchProject({
      userId: "user_1", spaceId: "space_1", name: "Copied project", objective: "Use copied mode", managerUserId: "user_1",
      developmentTemplateKey: "space_space_1_abc123", developmentTemplateVersion: 1,
      developmentTemplateConfig: { productionBranch: "main", stagingBranch: "staging", releaseAgentProfileId: "profile_release" },
      dependencies: {
        developmentModesEnabled: true, assertCanWriteSpace: vi.fn().mockResolvedValue({ role: "owner" }), getPublishedDevelopmentTemplate,
        db: {
          space: { findUnique: vi.fn().mockResolvedValue({ id: "space_1", type: "personal", companyId: null, ownerUserId: "user_1", status: "active" }) },
          user: { findUnique: vi.fn().mockResolvedValue({ id: "user_1", teamId: "team_1" }) },
          companyMember: { findFirst: vi.fn() }, agentProfile: { findFirst: vi.fn().mockResolvedValue({ id: "profile_release" }) },
          loopVersion: { findMany: vi.fn().mockResolvedValue([{ id: "loop_task_v1", loopDefinitionId: "loop_task", status: "published", loopDefinition: { scope: "project" } }, { id: "loop_release_v1", loopDefinitionId: "loop_release", status: "published", loopDefinition: { scope: "project" } }]) },
          $transaction: transaction,
        },
      },
    })).resolves.toMatchObject({ projectId: "project_new" });
    expect(projectCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ developmentTemplateKey: "space_space_1_abc123" }) }));
  });

  it("rejects a published template whose Loop parent is not project-scoped", async () => {
    const projectCreate = vi.fn();
    await expect(createWorkbenchProject({
      userId: "user_1", spaceId: "space_1", name: "Atlas", objective: "Ship Atlas", managerUserId: "user_1",
      developmentTemplateKey: "branch-development", developmentTemplateVersion: 1,
      developmentTemplateConfig: { productionBranch: "main", stagingBranch: "staging", releaseAgentProfileId: "profile_release" },
      dependencies: {
        developmentModesEnabled: true,
        assertCanWriteSpace: vi.fn().mockResolvedValue({ role: "owner" }),
        getPublishedDevelopmentTemplate: vi.fn().mockResolvedValue({ key: "branch-development", kind: "branch-development", version: 1, status: "published", projectConfigSchema: {}, taskFieldSchema: {}, developmentLoopVersionId: "loop_task_v1", releaseLoopVersionId: "loop_release_v1", triggerPolicy: {}, executionPolicy: {} }),
        db: {
          space: { findUnique: vi.fn().mockResolvedValue({ id: "space_1", type: "personal", companyId: null, ownerUserId: "user_1", status: "active" }) },
          user: { findUnique: vi.fn().mockResolvedValue({ id: "user_1", teamId: "team_1" }) },
          companyMember: { findFirst: vi.fn() },
          agentProfile: { findFirst: vi.fn().mockResolvedValue({ id: "profile_release" }) },
          loopVersion: { findMany: vi.fn().mockResolvedValue([
            { id: "loop_task_v1", loopDefinitionId: "loop_task", status: "published", loopDefinition: { scope: "task" } },
            { id: "loop_release_v1", loopDefinitionId: "loop_release", status: "published", loopDefinition: { scope: "project" } },
          ]) },
          $transaction: vi.fn(async (callback) => callback({ project: { create: projectCreate }, projectMember: { createMany: vi.fn() }, projectLoopBinding: { createMany: vi.fn() } })),
        },
      },
    })).rejects.toMatchObject({ code: "validation_failed" });
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it("creates a Space-owned project and project memberships atomically", async () => {
    const assertCanWriteSpace = vi.fn().mockResolvedValue({ role: "member" });
    const findUnique = vi.fn().mockResolvedValue({
      id: "space_company",
      type: "company",
      companyId: "company_1",
      ownerUserId: null,
      status: "active",
    });
    const userFindUnique = vi.fn().mockResolvedValue({ id: "user_creator", teamId: "team_1" });
    const companyMemberFindFirst = vi.fn().mockResolvedValue({ id: "member_manager" });
    const projectCreate = vi.fn().mockResolvedValue({ id: "project_new", version: 1 });
    const projectMemberCreateMany = vi.fn().mockResolvedValue({ count: 2 });
    const transaction = vi.fn(async (callback) => callback({
      project: { create: projectCreate },
      projectMember: { createMany: projectMemberCreateMany },
    }));

    const result = await createWorkbenchProject({
      userId: "user_creator",
      spaceId: "space_company",
      name: "文档平台",
      objective: "完成团队文档平台升级",
      managerUserId: "user_manager",
      startAt: new Date("2026-07-23T00:00:00.000Z"),
      targetAt: new Date("2026-08-23T00:00:00.000Z"),
      createId: () => "project_new",
      dependencies: {
        assertCanWriteSpace,
        db: {
          space: { findUnique },
          user: { findUnique: userFindUnique },
          companyMember: { findFirst: companyMemberFindFirst },
          $transaction: transaction,
        },
      },
    });

    expect(assertCanWriteSpace).toHaveBeenCalledWith({ userId: "user_creator", spaceId: "space_company" });
    expect(projectCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "project_new",
        teamId: "team_1",
        spaceId: "space_company",
        ownerType: "company",
        companyId: "company_1",
        ownerUserId: null,
        visibility: "private",
        name: "文档平台",
        objective: "完成团队文档平台升级",
        managerUserId: "user_manager",
        orchestrationStatus: "draft",
      }),
      select: { id: true, version: true },
    });
    expect(projectMemberCreateMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ userId: "user_creator", role: "owner" }),
      expect.objectContaining({ userId: "user_manager", role: "maintainer" }),
    ] });
    expect(result).toEqual({ projectId: "project_new", version: 1 });
  });

  it("rejects a target date before the start date", async () => {
    await expect(createWorkbenchProject({
      userId: "user_1",
      spaceId: "space_1",
      name: "项目",
      objective: "目标",
      managerUserId: "user_1",
      startAt: new Date("2026-08-02T00:00:00.000Z"),
      targetAt: new Date("2026-08-01T00:00:00.000Z"),
    })).rejects.toThrow("Project target date must be after start date");
  });

  it("rejects assigning another user as manager of a personal Space project", async () => {
    const assertCanWriteSpace = vi.fn().mockResolvedValue({ role: "owner" });
    const projectCreate = vi.fn();

    await expect(createWorkbenchProject({
      userId: "user_owner",
      spaceId: "space_personal",
      name: "个人项目",
      objective: "整理个人交付事项",
      managerUserId: "user_other",
      dependencies: {
        assertCanWriteSpace,
        db: {
          space: { findUnique: vi.fn().mockResolvedValue({ id: "space_personal", type: "personal", companyId: null, ownerUserId: "user_owner", status: "active" }) },
          user: { findUnique: vi.fn().mockResolvedValue({ id: "user_owner", teamId: "team_1" }) },
          companyMember: { findFirst: vi.fn() },
          $transaction: vi.fn(async (callback) => callback({ project: { create: projectCreate }, projectMember: { createMany: vi.fn() } })),
        },
      },
    })).rejects.toThrow("Personal project manager must own the Space");

    expect(projectCreate).not.toHaveBeenCalled();
  });
});

describe("updateWorkbenchProjectLoopGroupConfig", () => {
  it("保存项目 Loop 组配置并递增项目版本", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const config = {
      taskLoopVersionIds: ["task_v1"], defaultTaskLoopVersionId: "project_v1",
      projectLoopVersionIds: ["project_v1"], defaultProjectLoopVersionId: "project_v1",
      selectedPresetKeys: ["研发交付"], defaultPresetKey: "研发交付",
      projectLoopNodeTaskLoopIds: { project_v1: { tasks: "task_v1" } },
    };
    await expect(updateWorkbenchProjectLoopGroupConfig({
      userId: "user_1", projectId: "project_1", expectedVersion: 2, configuration: config,
      dependencies: {
        assertCanWriteProject: vi.fn().mockResolvedValue({ role: "owner" }),
        db: { project: { findFirst: vi.fn().mockResolvedValue({ id: "project_1", version: 2 }), updateMany } },
      },
    })).resolves.toEqual({ projectId: "project_1", version: 3, loopGroupConfig: config });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "project_1", version: 2 }, data: { loopGroupConfig: config, version: { increment: 1 } } });
  });
});

describe("updateWorkbenchProject", () => {
  it("保存 Worker 部署配置并同步递增环境配置版本", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const configuration = {
      schemaVersion: 1,
      kubernetes: { namespace: "etl", persistentStorage: "30Gi", minReplicas: 2, maxReplicas: 5 },
      concurrency: 2,
      sessionJournalRetentionDays: 30,
      healthPort: 8080,
      capabilities: { workspace: true, files: true, commands: true },
    };
    await expect(updateWorkbenchProjectWorkerDeploymentConfiguration({
      userId: "user_1", projectId: "project_1", expectedVersion: 3, configuration,
      dependencies: { assertCanWriteProject: vi.fn().mockResolvedValue({}), db: { project: { findFirst: vi.fn().mockResolvedValue({ id: "project_1", version: 3, environmentConfigurationVersion: 6 }), updateMany } } },
    })).resolves.toMatchObject({ projectId: "project_1", version: 4, environmentConfigurationVersion: 7, configuration });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "project_1", version: 3 },
      data: expect.objectContaining({ workerDeploymentConfiguration: configuration, environmentConfigurationVersion: { increment: 1 }, version: { increment: 1 } }),
    }));
  });

  it("保存项目环境配置并递增项目配置版本，但不修改 Loop 版本", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await expect(updateWorkbenchProjectEnvironmentConfiguration({
      userId: "user_1", projectId: "project_1", expectedVersion: 3,
      configuration: { schemaVersion: 1, entries: [{ name: "OPENAI_API_KEY", purpose: "模型调用", executionTargets: ["worker"], sourceType: "humanthread", reference: "OPENAI_API_KEY", status: "missing", revision: 1 }] },
      dependencies: { assertCanWriteProject: vi.fn().mockResolvedValue({}), db: { project: { findFirst: vi.fn().mockResolvedValue({ id: "project_1", version: 3 }), updateMany } } },
    })).resolves.toMatchObject({ projectId: "project_1", version: 4, environmentConfigurationVersion: 2 });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "project_1", version: 3 }, data: expect.objectContaining({ version: { increment: 1 }, environmentConfigurationVersion: { increment: 1 } }) }));
    const data = updateMany.mock.calls[0]?.[0]?.data;
    expect(data.environmentConfiguration?.entries[0].id).toMatch(/^[a-f0-9]{32}$/u);
    expect(data).not.toHaveProperty("loopBindings");
  });

  it("upgrades a published custom template and upserts both fixed binding roles atomically", async () => {
    vi.stubEnv("HUMANTHREAD_DEVELOPMENT_MODES", "true");
    const projectUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const bindingUpsert = vi.fn()
      .mockResolvedValueOnce({ id: "binding:project_1:task_development", version: 2 })
      .mockResolvedValueOnce({ id: "binding:project_1:milestone_release", version: 2 });
    const transaction = vi.fn(async (callback) => callback({
      project: { updateMany: projectUpdateMany },
      projectLoopBinding: { upsert: bindingUpsert },
    }));
    const getPublishedDevelopmentTemplate = vi.fn().mockResolvedValue({
      key: "custom_branch_abc", kind: "branch-development", version: 2, status: "published", origin: "space", spaceId: "space_1",
      projectConfigSchema: { type: "object" }, taskFieldSchema: {}, developmentLoopVersionId: "loop_task_v2", releaseLoopVersionId: "loop_release_v3",
      triggerPolicy: {}, executionPolicy: {},
    });
    await expect(upgradeWorkbenchProjectDevelopmentMode({
      userId: "user_1", projectId: "project_1", expectedVersion: 3,
      developmentTemplateKey: "custom_branch_abc", developmentTemplateVersion: 2,
      developmentTemplateConfig: { productionBranch: "main", stagingBranch: "staging", releaseAgentProfileId: "profile_release" },
      dependencies: {
        assertCanWriteProject: vi.fn().mockResolvedValue({ role: "owner" }), getPublishedDevelopmentTemplate,
        db: {
          project: { findFirst: vi.fn().mockResolvedValue({ id: "project_1", teamId: "team_1", spaceId: "space_1", shortCode: "AT", version: 3, developmentTemplateKey: "branch-development" }), updateMany: projectUpdateMany },
          agentProfile: { findFirst: vi.fn().mockResolvedValue({ id: "profile_release" }) },
          loopVersion: { findMany: vi.fn().mockResolvedValue([{ id: "loop_task_v2", loopDefinitionId: "loop_task", status: "published", loopDefinition: { scope: "project" } }, { id: "loop_release_v3", loopDefinitionId: "loop_release", status: "published", loopDefinition: { scope: "project" } }]) },
          $transaction: transaction,
        },
      },
    })).resolves.toMatchObject({ projectId: "project_1", version: 4, developmentTemplateKey: "custom_branch_abc" });
    expect(getPublishedDevelopmentTemplate).toHaveBeenCalledWith({ key: "custom_branch_abc", version: 2, spaceId: "space_1" }, expect.anything());
    expect(bindingUpsert).toHaveBeenCalledTimes(3);
    expect(bindingUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId_bindingRole: { projectId: "project_1", bindingRole: "task_development" } },
      update: expect.objectContaining({
        activeVersionId: "loop_release_v3",
        allowedAgentProfileIds: ["profile_release"],
        allowedProviders: ["codex"],
        triggerPolicy: {
          manual: false,
          taskEvents: ["task.execution.requested"],
          milestoneEvents: [],
        },
      }),
    }));
    expect(bindingUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId_bindingRole: { projectId: "project_1", bindingRole: "milestone_release" } }, update: expect.objectContaining({ activeVersionId: "loop_release_v3" }) }));
    vi.unstubAllEnvs();
  });

  it("does not commit project or binding writes when the second upgrade binding fails", async () => {
    vi.stubEnv("HUMANTHREAD_DEVELOPMENT_MODES", "true");
    let committedProjectVersion = 3;
    const projectUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const bindingUpsert = vi.fn()
      .mockResolvedValueOnce({ id: "binding:project_1:task_development", version: 2 })
      .mockRejectedValueOnce(new Error("second binding failed"));
    const transaction = vi.fn(async (callback) => {
      let transactionProjectVersion = committedProjectVersion;
      const result = await callback({
        project: { updateMany: async (input: unknown) => { transactionProjectVersion = 4; return projectUpdateMany(input); } },
        projectLoopBinding: { upsert: bindingUpsert },
      });
      committedProjectVersion = transactionProjectVersion;
      return result;
    });
    await expect(upgradeWorkbenchProjectDevelopmentMode({
      userId: "user_1", projectId: "project_1", expectedVersion: 3, developmentTemplateKey: "custom_branch_abc", developmentTemplateVersion: 2,
      developmentTemplateConfig: { productionBranch: "main", stagingBranch: "staging", releaseAgentProfileId: "profile_release" },
      dependencies: {
        assertCanWriteProject: vi.fn().mockResolvedValue({}), getPublishedDevelopmentTemplate: vi.fn().mockResolvedValue({ key: "custom_branch_abc", kind: "branch-development", version: 2, status: "published", origin: "space", spaceId: "space_1", projectConfigSchema: { type: "object" }, taskFieldSchema: {}, developmentLoopVersionId: "loop_task_v2", releaseLoopVersionId: "loop_release_v3", triggerPolicy: {}, executionPolicy: {} }),
        db: { project: { findFirst: vi.fn().mockResolvedValue({ id: "project_1", teamId: "team_1", spaceId: "space_1", shortCode: "AT", version: 3, developmentTemplateKey: "branch-development" }), updateMany: projectUpdateMany }, agentProfile: { findFirst: vi.fn().mockResolvedValue({ id: "profile_release" }) }, loopVersion: { findMany: vi.fn().mockResolvedValue([{ id: "loop_task_v2", loopDefinitionId: "loop_task", status: "published", loopDefinition: { scope: "project" } }, { id: "loop_release_v3", loopDefinitionId: "loop_release", status: "published", loopDefinition: { scope: "project" } }]) }, $transaction: transaction },
      },
    })).rejects.toThrow("second binding failed");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(projectUpdateMany).toHaveBeenCalledTimes(1);
    expect(bindingUpsert).toHaveBeenCalledTimes(2);
    expect(committedProjectVersion).toBe(3);
    vi.unstubAllEnvs();
  });
  it("updates a Project short code with project write authorization and CAS", async () => {
    const assertCanWriteProject = vi.fn().mockResolvedValue({ role: "owner" });
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ id: "project_1", teamId: "team_1", shortCode: "OLD" })
      .mockResolvedValueOnce(null);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });

    await expect(updateWorkbenchProject({
      userId: "user_1",
      projectId: "project_1",
      shortCode: " ht ",
      expectedVersion: 3,
      dependencies: { assertCanWriteProject, db: { project: { findFirst, updateMany } } },
    })).resolves.toEqual({ projectId: "project_1", shortCode: "HT", version: 4 });
    expect(assertCanWriteProject).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "project_1", version: 3 },
      data: { shortCode: "HT", version: { increment: 1 } },
    });
  });

  it("rejects a duplicate Team short code", async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ id: "project_1", teamId: "team_1", shortCode: "OLD" })
      .mockResolvedValueOnce({ id: "project_2" });
    await expect(updateWorkbenchProject({
      userId: "user_1", projectId: "project_1", shortCode: "HT", expectedVersion: 1,
      dependencies: { assertCanWriteProject: vi.fn().mockResolvedValue({}), db: { project: { findFirst, updateMany: vi.fn() } } },
    })).rejects.toMatchObject({ code: "validation_failed" });
  });
});
