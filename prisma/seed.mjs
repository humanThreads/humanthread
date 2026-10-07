import "dotenv/config";
import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";
import {
  BRANCH_DEVELOPMENT_TEMPLATES,
  PLATFORM_LOOP_DEFINITIONS,
  PLATFORM_LOOP_SPACE_ID,
  buildPlatformLoopVersionWriteData,
  applyBranchDevelopmentV3Upgrade,
  applyBranchDevelopmentV4Upgrade,
  planBranchDevelopmentV3Upgrade,
  planBranchDevelopmentV4Upgrade,
  upgradeGelsangBindingsToV3,
} from "./development-mode-seed-data.mjs";

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run prisma seed.");
}

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(databaseUrl),
});

const DEFAULT_AGENT_API_TOKEN = "token_123";
const INITIAL_USER_PASSWORD = process.env.HUMANTHREAD_INITIAL_USER_PASSWORD?.trim();
const DEVELOPMENT_MODE_PUBLISHED_AT = new Date("2026-08-03T00:00:00.000Z");

function hashAgentToken(token) {
  return createHash("sha256").update(token.trim()).digest("hex");
}

function hashPassword(password) {
  const normalizedPassword = password?.trim();

  if (!normalizedPassword) {
    return null;
  }

  const iterations = 210000;
  const salt = randomBytes(16).toString("base64url");
  const hash = pbkdf2Sync(
    normalizedPassword,
    salt,
    iterations,
    32,
    "sha256",
  ).toString("base64url");

  return `pbkdf2-sha256$${iterations}$${salt}$${hash}`;
}

async function main() {
  await prisma.team.upsert({
    where: { id: "team_1" },
    update: {
      name: "HumanThread Team",
    },
    create: {
      id: "team_1",
      name: "HumanThread Team",
    },
  });

  const adminUser = await prisma.user.upsert({
    where: { id: "user_owner" },
    update: {
      teamId: "team_1",
      name: "alice",
      email: "alice@example.com",
      status: "active",
      isSiteAdmin: false,
      ...(INITIAL_USER_PASSWORD
        ? { passwordHash: hashPassword(INITIAL_USER_PASSWORD) }
        : {}),
      agentApiTokenHash: hashAgentToken(DEFAULT_AGENT_API_TOKEN),
    },
    create: {
      id: "user_owner",
      teamId: "team_1",
      name: "alice",
      email: "alice@example.com",
      status: "active",
      isSiteAdmin: false,
      passwordHash: hashPassword(INITIAL_USER_PASSWORD ?? "humanthread-dev-only"),
      agentApiTokenHash: hashAgentToken(DEFAULT_AGENT_API_TOKEN),
    },
  });

  await prisma.user.upsert({
    where: { email: "alice@example.com" },
    update: {
      teamId: "team_1",
      name: "alice",
      status: "active",
      isSiteAdmin: true,
    },
    create: {
      id: "user_admin_alice",
      teamId: "team_1",
      name: "alice",
      email: "alice@example.com",
      status: "active",
      isSiteAdmin: true,
      passwordHash: hashPassword(INITIAL_USER_PASSWORD ?? "humanthread-dev-only"),
      agentApiTokenHash: hashAgentToken(DEFAULT_AGENT_API_TOKEN),
    },
  });

  await prisma.siteSetting.upsert({
    where: { key: "siteBaseUrl" },
    update: {},
    create: {
      key: "siteBaseUrl",
      value: process.env.HUMANTHREAD_SITE_BASE_URL?.trim() || "http://localhost:3000",
    },
  });

  await prisma.company.upsert({
    where: { id: "company_1" },
    update: {
      name: "HumanThread Company",
      slug: "humanthread",
      status: "active",
    },
    create: {
      id: "company_1",
      name: "HumanThread Company",
      slug: "humanthread",
      status: "active",
    },
  });

  await prisma.space.upsert({
    where: { ownerUserId: "user_owner" },
    update: {
      name: "alice 的个人空间",
      status: "active",
    },
    create: {
      id: "space:personal:user_owner",
      type: "personal",
      ownerUserId: "user_owner",
      companyId: null,
      name: "alice 的个人空间",
      status: "active",
    },
  });

  await prisma.space.upsert({
    where: { companyId: "company_1" },
    update: {
      name: "HumanThread Company",
      status: "active",
    },
    create: {
      id: "space:company:company_1",
      type: "company",
      ownerUserId: null,
      companyId: "company_1",
      name: "HumanThread Company",
      status: "active",
    },
  });

  await prisma.space.upsert({
    where: { id: PLATFORM_LOOP_SPACE_ID },
    update: {
      type: "system",
      ownerUserId: null,
      companyId: null,
      name: "HumanThread Platform",
      status: "active",
    },
    create: {
      id: PLATFORM_LOOP_SPACE_ID,
      type: "system",
      ownerUserId: null,
      companyId: null,
      name: "HumanThread Platform",
      status: "active",
    },
  });

  for (const loop of PLATFORM_LOOP_DEFINITIONS) {
    const versionData = buildPlatformLoopVersionWriteData(loop);
    await prisma.loopDefinition.upsert({
      where: { id: loop.definitionId },
      update: {
        spaceId: loop.spaceId,
        ownerUserId: loop.ownerUserId,
        scope: loop.scope,
        origin: loop.origin,
        name: loop.name,
        description: loop.description,
        draftGraph: loop.graph,
        status: "published",
      },
      create: {
        id: loop.definitionId,
        spaceId: loop.spaceId,
        name: loop.name,
        description: loop.description,
        ownerUserId: loop.ownerUserId,
        draftGraph: loop.graph,
        draftRevision: 2,
        status: "published",
        scope: loop.scope,
        origin: loop.origin,
      },
    });
    await prisma.loopVersion.upsert({
      where: { id: loop.versionId },
      update: versionData,
      create: {
        id: loop.versionId,
        loopDefinitionId: loop.definitionId,
        ...versionData,
        publishedAt: DEVELOPMENT_MODE_PUBLISHED_AT,
      },
    });
    if (loop.latest !== false) {
      await prisma.loopDefinition.updateMany({
        where: {
          id: loop.definitionId,
          OR: [
            { latestPublishedVersionId: null },
            ...((loop.previousLatestVersionIds ?? []).length > 0
              ? [{ latestPublishedVersionId: { in: loop.previousLatestVersionIds } }]
              : []),
          ],
        },
        data: { latestPublishedVersionId: loop.versionId, status: "published" },
      });
    }
  }

  for (const template of BRANCH_DEVELOPMENT_TEMPLATES) {
    await prisma.projectDevelopmentTemplate.upsert({
      where: { key_version: { key: template.key, version: template.version } },
      update: {
        spaceId: template.spaceId,
        origin: template.origin,
        kind: template.kind,
        description: template.description,
        createdByUserId: template.createdByUserId,
        sourceTemplateId: template.sourceTemplateId,
        revision: template.revision,
        projectConfigSchema: template.projectConfigSchema,
        taskFieldSchema: template.taskFieldSchema,
        developmentLoopVersionId: template.developmentLoopVersionId,
        releaseLoopVersionId: template.releaseLoopVersionId,
        triggerPolicy: template.triggerPolicy,
        executionPolicy: template.executionPolicy,
        status: template.status,
      },
      create: template,
    });
  }

  await upgradeGelsangBindingsToV3(prisma);

  const branchDevelopmentProjects = await prisma.project.findMany({
    where: { developmentTemplateKey: "branch-development", developmentTemplateVersion: 2 },
    select: {
      id: true,
      developmentTemplateKey: true,
      developmentTemplateVersion: true,
      loopBindings: {
        where: { bindingRole: "task_development" },
        select: { id: true, bindingRole: true, loopDefinitionId: true, activeVersionId: true },
      },
    },
  });
  for (const project of branchDevelopmentProjects) {
    const upgrade = planBranchDevelopmentV3Upgrade(project);
    if (!upgrade) continue;
    await prisma.$transaction((tx) => applyBranchDevelopmentV3Upgrade(tx, upgrade));
  }

  const branchDevelopmentV3Projects = await prisma.project.findMany({
    where: { developmentTemplateKey: "branch-development", developmentTemplateVersion: 3 },
    select: {
      id: true,
      developmentTemplateKey: true,
      developmentTemplateVersion: true,
      loopBindings: {
        where: { bindingRole: "task_development" },
        select: { id: true, bindingRole: true, loopDefinitionId: true, activeVersionId: true },
      },
    },
  });
  for (const project of branchDevelopmentV3Projects) {
    const upgrade = planBranchDevelopmentV4Upgrade(project);
    if (!upgrade) continue;
    await prisma.$transaction((tx) => applyBranchDevelopmentV4Upgrade(tx, upgrade));
  }

  await prisma.space.upsert({
    where: { ownerUserId: adminUser.id },
    update: {
      name: "alice 的个人空间",
      status: "active",
    },
    create: {
      id: `space:personal:${adminUser.id}`,
      type: "personal",
      ownerUserId: adminUser.id,
      companyId: null,
      name: "alice 的个人空间",
      status: "active",
    },
  });

  await prisma.project.upsert({
    where: { id: "project_1" },
    update: {
      teamId: "team_1",
      spaceId: "space:company:company_1",
      ownerType: "company",
      companyId: "company_1",
      ownerUserId: null,
      visibility: "private",
      name: "HumanThread",
      description: "HumanThread 主项目",
      orchestrationStatus: "active",
      objective: "Build and operate the HumanThread agent project control plane.",
      managerUserId: "user_owner",
      localPath: "/Users/alice/IdeaProjects/humanThread",
      defaultCommand: "codex",
    },
    create: {
      id: "project_1",
      teamId: "team_1",
      spaceId: "space:company:company_1",
      ownerType: "company",
      companyId: "company_1",
      ownerUserId: null,
      visibility: "private",
      name: "HumanThread",
      description: "HumanThread 主项目",
      orchestrationStatus: "active",
      objective: "Build and operate the HumanThread agent project control plane.",
      managerUserId: "user_owner",
      localPath: "/Users/alice/IdeaProjects/humanThread",
      defaultCommand: "codex",
    },
  });

  await prisma.projectStage.upsert({
    where: { projectId_key: { projectId: "project_1", key: "legacy_delivery" } },
    update: { name: "Legacy Delivery", status: "active", sortOrder: 0 },
    create: {
      id: "stage:legacy:project_1",
      projectId: "project_1",
      key: "legacy_delivery",
      name: "Legacy Delivery",
      status: "active",
      sortOrder: 0,
      entryCriteria: {},
      exitCriteria: {},
    },
  });

  await prisma.milestone.upsert({
    where: { id: "milestone:legacy:project_1" },
    update: { name: "Legacy Backlog", status: "active" },
    create: {
      id: "milestone:legacy:project_1",
      projectId: "project_1",
      stageId: "stage:legacy:project_1",
      name: "Legacy Backlog",
      status: "active",
      requiredCheckPolicy: {},
    },
  });

  await prisma.companyMember.upsert({
    where: {
      companyId_userId: {
        companyId: "company_1",
        userId: "user_owner",
      },
    },
    update: {
      role: "owner",
      status: "active",
    },
    create: {
      id: "company_1:user_owner",
      companyId: "company_1",
      userId: "user_owner",
      role: "owner",
      status: "active",
    },
  });

  await prisma.projectMember.upsert({
    where: {
      projectId_userId: {
        projectId: "project_1",
        userId: "user_owner",
      },
    },
    update: {
      role: "owner",
      status: "active",
    },
    create: {
      id: "project_1:user_owner",
      projectId: "project_1",
      userId: "user_owner",
      role: "owner",
      status: "active",
    },
  });

  await prisma.document.upsert({
    where: {
      containerKey_path: {
        containerKey: "project:project_1",
        path: "README.md",
      },
    },
    update: {
      spaceId: "space:company:company_1",
      projectId: "project_1",
      containerKey: "project:project_1",
      title: "README",
      updatedById: "user_owner",
    },
    create: {
      id: "doc_project_1_readme",
      spaceId: "space:company:company_1",
      projectId: "project_1",
      containerKey: "project:project_1",
      title: "README",
      path: "README.md",
      contentMarkdown: "# HumanThread\n\n项目知识库入口。",
      version: 1,
      createdById: "user_owner",
      updatedById: "user_owner",
      revisions: {
        create: {
          id: "doc_project_1_readme:v1",
          version: 1,
          contentMarkdown: "# HumanThread\n\n项目知识库入口。",
          createdById: "user_owner",
          source: "system",
        },
      },
    },
  });

  await prisma.workflowTemplate.upsert({
    where: { id: "template_dev_v1" },
    update: {
      teamId: "team_1",
      name: "AI 辅助开发任务",
      version: 1,
      firstStepKey: "confirm_requirement",
      isActive: true,
    },
    create: {
      id: "template_dev_v1",
      teamId: "team_1",
      name: "AI 辅助开发任务",
      version: 1,
      firstStepKey: "confirm_requirement",
      isActive: true,
    },
  });

  await prisma.workflowStepTemplate.upsert({
    where: {
      workflowTemplateId_key: {
        workflowTemplateId: "template_dev_v1",
        key: "confirm_requirement",
      },
    },
    update: {
      title: "确认需求",
      description: "确认需求边界、约束和验收标准。",
      executorType: "human",
      nextStepKey: "run_cli",
    },
    create: {
      id: "step_confirm_requirement",
      workflowTemplateId: "template_dev_v1",
      key: "confirm_requirement",
      title: "确认需求",
      description: "确认需求边界、约束和验收标准。",
      executorType: "human",
      nextStepKey: "run_cli",
    },
  });

  await prisma.workflowStepTemplate.upsert({
    where: {
      workflowTemplateId_key: {
        workflowTemplateId: "template_dev_v1",
        key: "run_cli",
      },
    },
    update: {
      title: "运行 Claude/Codex",
      description: "在本地启动 CLI 执行开发任务。",
      executorType: "human",
      nextStepKey: "review_result",
    },
    create: {
      id: "step_run_cli",
      workflowTemplateId: "template_dev_v1",
      key: "run_cli",
      title: "运行 Claude/Codex",
      description: "在本地启动 CLI 执行开发任务。",
      executorType: "human",
      nextStepKey: "review_result",
    },
  });

  await prisma.workflowStepTemplate.upsert({
    where: {
      workflowTemplateId_key: {
        workflowTemplateId: "template_dev_v1",
        key: "review_result",
      },
    },
    update: {
      title: "人工验收结果",
      description: "检查结果是否满足验收标准。",
      executorType: "human",
      nextStepKey: null,
    },
    create: {
      id: "step_review_result",
      workflowTemplateId: "template_dev_v1",
      key: "review_result",
      title: "人工验收结果",
      description: "检查结果是否满足验收标准。",
      executorType: "human",
      nextStepKey: null,
    },
  });

  await prisma.matterType.upsert({
    where: { id: "matter_dev" },
    update: {
      teamId: "team_1",
      name: "开发任务",
      description: "AI 辅助开发流程",
      workflowTemplateId: "template_dev_v1",
    },
    create: {
      id: "matter_dev",
      teamId: "team_1",
      name: "开发任务",
      description: "AI 辅助开发流程",
      workflowTemplateId: "template_dev_v1",
    },
  });

  console.log(`seed_ready agent_token=${DEFAULT_AGENT_API_TOKEN}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
