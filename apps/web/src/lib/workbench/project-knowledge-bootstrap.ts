import {
  createKnowledgeGenerationTask,
  initializeProjectKnowledge,
} from "@humanthread/db";

export async function initializeProjectKnowledgeAfterCreate(input: {
  projectId: string;
  actorUserId: string;
  projectName: string;
  objective: string;
  dependencies?: {
    initialize?: typeof initializeProjectKnowledge;
    createGenerationTask?: typeof createKnowledgeGenerationTask;
  };
}) {
  const initialize = input.dependencies?.initialize ?? initializeProjectKnowledge;
  const createGenerationTask = input.dependencies?.createGenerationTask ?? createKnowledgeGenerationTask;
  const initialized = await initialize({
    projectId: input.projectId,
    actorUserId: input.actorUserId,
  });
  const generated = await createGenerationTask({
    projectId: input.projectId,
    actorUserId: input.actorUserId,
    mode: "project_initialization",
    dedupeIdentity: `project-initialization:${input.projectId}`,
    templateVersionId: initialized.templateVersionId,
    sourceSnapshot: {
      observedAt: new Date().toISOString(),
      sourceRefs: [
        { kind: "document", sourceType: "project_initialization", ref: `project:${input.projectId}` },
      ],
    },
    title: `初始化项目知识库：${input.projectName}`,
    contentMarkdown: `# 项目知识初始化\n\n项目：${input.projectName}\n\n目标：${input.objective}\n\n请按项目初始化模板生成知识候选和架构视图。`,
  });
  return { ...initialized, ...generated };
}
