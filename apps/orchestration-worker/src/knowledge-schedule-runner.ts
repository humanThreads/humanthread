import { createKnowledgeGenerationTask, prisma } from "@humanthread/db";
import { calculateNextKnowledgeSchedule } from "@humanthread/orchestration-core";

export async function runDueKnowledgeSchedules(input: {
  now: Date;
  limit?: number;
  templateVersionId?: string;
  dependencies?: {
    listPolicies?: typeof listKnowledgePolicies;
    createTask?: typeof createKnowledgeGenerationTask;
  };
}): Promise<{ created: number; skipped: number }> {
  const templateVersionId = input.templateVersionId?.trim() ?? process.env.HUMANTHREAD_KNOWLEDGE_TEMPLATE_VERSION_ID?.trim();
  if (!templateVersionId) return { created: 0, skipped: 0 };
  const limit = input.limit ?? 100;
  const policies = await (input.dependencies?.listPolicies ?? listKnowledgePolicies)(limit);
  let created = 0;
  let skipped = 0;
  for (const policy of policies) {
    if (!policy.scheduleRule || !policy.projectId) {
      skipped += 1;
      continue;
    }
    const schedule = calculateNextKnowledgeSchedule({
      projectDigest: policy.projectDigest,
      rule: policy.scheduleRule,
      timezone: policy.scheduleTimezone,
      now: input.now,
    });
    if (!schedule.due) {
      skipped += 1;
      continue;
    }
    const result = await (input.dependencies?.createTask ?? createKnowledgeGenerationTask)({
      projectId: policy.projectId,
      actorUserId: "system",
      mode: "scheduled_update",
      dedupeIdentity: schedule.dedupeKey,
      templateVersionId,
      sourceSnapshot: {
        observedAt: input.now.toISOString(),
        sourceRefs: [{ kind: "document", sourceType: "scheduled_update", ref: `policy:${policy.projectDigest}` }],
      },
      title: "项目知识定期更新",
      contentMarkdown: "按项目知识模板扫描增量变化并提交候选。",
    });
    created += result.duplicate ? 0 : 1;
  }
  return { created, skipped };
}

async function listKnowledgePolicies(limit: number) {
  return prisma.knowledgePolicy.findMany({
    where: { scheduleRule: { not: null } },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { projectDigest: true, projectId: true, scheduleRule: true, scheduleTimezone: true },
  });
}
