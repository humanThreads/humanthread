import { createHash } from "node:crypto";

import { prisma } from "./prisma";
import { KNOWLEDGE_GENERATION_MODES, type KnowledgeGenerationMode } from "./knowledge-generation";
import { knowledgeProjectDigest } from "./knowledge-reference";

export interface ProjectKnowledgeInitializationResult {
  policyId: string;
  templateId: string;
  templateVersionId: string;
  templateVersionIds: Record<KnowledgeGenerationMode, string>;
  created: boolean;
}

interface BuiltInKnowledgeTemplate {
  stableKey: string;
  name: string;
  mode: KnowledgeGenerationMode;
}

const BUILT_IN_KNOWLEDGE_TEMPLATES: readonly BuiltInKnowledgeTemplate[] = [
  { stableKey: "project-initialization", name: "项目知识初始化", mode: "project_initialization" },
  { stableKey: "task-completion", name: "任务完成知识归纳", mode: "task_completion" },
  { stableKey: "incremental-update", name: "定时知识增量更新", mode: "scheduled_update" },
  { stableKey: "manual-knowledge", name: "手工知识补交", mode: "manual_update" },
];

const BUILT_IN_TEMPLATE_BY_MODE = new Map(
  BUILT_IN_KNOWLEDGE_TEMPLATES.map((template) => [template.mode, template]),
);

export async function initializeProjectKnowledge(
  input: { projectId: string; actorUserId: string },
  db: {
    project: { findUnique(args: unknown): Promise<{ id: string; name: string; objective: string | null } | null> };
    knowledgePolicy: { findUnique(args: unknown): Promise<{ id: string } | null>; createMany(args: unknown): Promise<{ count: number }> };
    knowledgeTemplate: { findUnique(args: unknown): Promise<{ id: string } | null>; createMany(args: unknown): Promise<{ count: number }> };
    knowledgeTemplateVersion: { findUnique(args: unknown): Promise<{ id: string } | null>; createMany(args: unknown): Promise<{ count: number }> };
  } = prisma as never,
): Promise<ProjectKnowledgeInitializationResult> {
  const project = await db.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw notFound("Project not found");
  const projectDigest = knowledgeProjectDigest(project.id);
  const policyId = md5("knowledge-policy", projectDigest);
  const existingPolicy = await db.knowledgePolicy.findUnique({ where: { id: policyId } });
  const templates = await Promise.all(BUILT_IN_KNOWLEDGE_TEMPLATES.map(async (template) => {
    const templateId = builtInKnowledgeTemplateId(projectDigest, template.mode);
    const templateVersionId = builtInKnowledgeTemplateVersionId(templateId);
    const [existingTemplate, existingVersion] = await Promise.all([
      db.knowledgeTemplate.findUnique({ where: { id: templateId } }),
      db.knowledgeTemplateVersion.findUnique({ where: { id: templateVersionId } }),
    ]);
    return { ...template, templateId, templateVersionId, existingTemplate, existingVersion };
  }));
  const created = !existingPolicy || templates.some((template) => !template.existingTemplate || !template.existingVersion);
  if (created) {
    const now = new Date();
    if (!existingPolicy) {
      await db.knowledgePolicy.createMany({
        data: [{
          id: policyId,
          projectId: project.id,
          projectDigest,
          autoPublishEnabled: false,
          minimumConfidence: 0.9,
          allowedSourceTypes: [],
          allowedEntryTypes: [],
          sourceTypeOverrides: [],
          allowAutomaticDelete: false,
          allowAutomaticExpire: false,
          allowAutomaticSupersede: false,
          scheduleTimezone: "Asia/Shanghai",
          scheduleRule: null,
          fullRebuildEvery: 10,
          subscribeSpaceKnowledge: false,
          version: 1,
          createdAt: now,
          updatedAt: now,
        }],
        skipDuplicates: true,
      });
    }
    for (const template of templates) {
      if (!template.existingTemplate) {
        await db.knowledgeTemplate.createMany({
          data: [{
            id: template.templateId,
            projectDigest,
            stableKey: template.stableKey,
            name: template.name,
            mode: template.mode,
            status: "published",
            createdAt: now,
            updatedAt: now,
          }],
          skipDuplicates: true,
        });
      }
      if (!template.existingVersion) {
        const content = defaultKnowledgeTemplate(template.mode, project.name, project.objective ?? "");
        await db.knowledgeTemplateVersion.createMany({
          data: [{
            id: template.templateVersionId,
            templateId: template.templateId,
            version: 1,
            content,
            contentHash: md5("template-content", content),
            publishedAt: now,
            createdByDigest: md5("knowledge-template-creator", input.actorUserId),
            createdAt: now,
          }],
          skipDuplicates: true,
        });
      }
    }
  }
  const templateVersionIds = Object.fromEntries(
    templates.map((template) => [template.mode, template.templateVersionId]),
  ) as Record<KnowledgeGenerationMode, string>;
  return {
    policyId,
    templateId: templateVersionIds.project_initialization,
    templateVersionId: templateVersionIds.project_initialization,
    templateVersionIds,
    created,
  };
}

export function builtInKnowledgeTemplateId(projectDigest: string, mode: KnowledgeGenerationMode): string {
  const template = BUILT_IN_TEMPLATE_BY_MODE.get(mode);
  if (!template) throw new Error(`Unsupported knowledge generation mode: ${mode}`);
  return md5("knowledge-template", projectDigest, template.stableKey);
}

export function builtInKnowledgeTemplateVersionId(templateId: string): string {
  return md5("knowledge-template-version", templateId, "1");
}

export function defaultKnowledgeTemplate(
  mode: KnowledgeGenerationMode,
  projectName: string,
  objective: string,
): string {
  if (mode === "project_initialization") return defaultInitializationTemplate(projectName, objective);
  if (mode === "task_completion") {
    return `# 任务完成知识归纳模板\n\n## 项目\n\n- 名称：${projectName}\n- 目标：${objective}\n\n## 要求\n\n1. 归纳本次任务可证明的决策、经验、规则、接口、风险和流程。\n2. 每个条目提供来源、证据、置信度和稳定键。\n3. 只提交候选批次，不直接发布正式知识。\n`;
  }
  if (mode === "scheduled_update") {
    return `# 定时知识增量更新模板\n\n## 项目\n\n- 名称：${projectName}\n- 目标：${objective}\n\n## 要求\n\n1. 基于上次成功版本执行增量扫描。\n2. 提交新增、修改、替代、失效、删除、冲突和架构变化。\n3. 每个条目提供来源、证据、置信度和稳定键。\n4. 只提交候选批次，不直接发布正式知识。\n`;
  }
  return `# 手工知识补交模板\n\n## 项目\n\n- 名称：${projectName}\n- 目标：${objective}\n\n## 要求\n\n1. 支持用户或 MCP 客户端补交结构化知识。\n2. 覆盖领域规则、事实、决策、经验、接口、风险和流程。\n3. 每个条目提供来源、证据、置信度和稳定键。\n4. 只提交候选批次，不直接发布正式知识。\n`;
}

export function defaultInitializationTemplate(projectName: string, objective: string): string {
  return `# 项目知识初始化模板\n\n## 项目\n\n- 名称：${projectName}\n- 目标：${objective}\n\n## 要求\n\n1. 扫描项目结构、文档、配置和已有决策。\n2. 按规则、决策、经验、接口、术语、风险和流程分类。\n3. 每个条目提供来源、证据、置信度和稳定键。\n4. 推演节点关系、依赖、数据流、生命周期和关联文档。\n5. 只提交候选批次，不直接发布正式知识。\n`;
}

function md5(...parts: string[]): string {
  return createHash("md5").update(parts.join("\0")).digest("hex");
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: "not_found" });
}
