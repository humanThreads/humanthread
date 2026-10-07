import { describe, expect, it, vi } from "vitest";

import { createKnowledgeGenerationTask } from "./knowledge-generation";
import { knowledgeId, knowledgeProjectDigest } from "./knowledge-reference";

const PROJECT_DIGEST = knowledgeProjectDigest("project_1");
const TEMPLATE_ID = "a".repeat(32);
const NOW = new Date("2026-09-20T12:00:00.000Z");

function fixture() {
  const jobs = new Map<string, Record<string, unknown>>();
  const tasks = new Map<string, Record<string, unknown>>();
  const tx = {
    project: { findUnique: vi.fn(async () => ({ id: "project_1", spaceId: "space_1", teamId: "team_1" })) },
    knowledgeTemplateVersion: { findUnique: vi.fn(async () => ({ id: TEMPLATE_ID, template: { projectDigest: PROJECT_DIGEST, mode: "task_completion", status: "published" } })) },
    knowledgePolicy: { findUnique: vi.fn(async () => ({ projectDigest: PROJECT_DIGEST, version: 2 })) },
    knowledgeJob: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => jobs.get(where.id) ?? null),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        for (const row of data) jobs.set(String(row.id), row);
        return { count: data.length };
      }),
    },
    task: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        for (const row of data) tasks.set(String(row.id), row);
        return { count: data.length };
      }),
    },
    $transaction: async <T>(callback: (tx: never) => Promise<T>) => callback(tx as never),
  };
  return { jobs, tasks, db: tx };
}

function input() {
  return {
    projectId: "project_1",
    actorUserId: "user_1",
    mode: "task_completion" as const,
    dedupeIdentity: "task:task_1",
    templateVersionId: TEMPLATE_ID,
    sourceSnapshot: { observedAt: NOW.toISOString(), sourceRefs: [{ kind: "task", ref: "task:task_1" }] },
    title: "归纳任务知识",
    contentMarkdown: "按模板归纳本次任务。",
  };
}

describe("knowledge generation task", () => {
  it("creates linked deterministic Job and Task rows idempotently", async () => {
    const dependencies = fixture();
    const first = await createKnowledgeGenerationTask(input(), dependencies.db as never);
    const duplicate = await createKnowledgeGenerationTask(input(), dependencies.db as never);

    expect(first).toEqual({ jobId: knowledgeId("knowledge-job", PROJECT_DIGEST, "task_completion", "task:task_1"), taskId: knowledgeId("knowledge-generation-task", first.jobId), projectDigest: PROJECT_DIGEST, mode: "task_completion", duplicate: false });
    expect(duplicate.duplicate).toBe(true);
    expect(dependencies.jobs.size).toBe(1);
    expect(dependencies.tasks.size).toBe(1);
    expect(dependencies.tasks.get(first.taskId)).toMatchObject({ id: first.taskId, projectId: "project_1", taskType: "knowledge_generation" });
  });

  it("loads the template relation required to validate project and mode ownership", async () => {
    const dependencies = fixture();
    await createKnowledgeGenerationTask(input(), dependencies.db as never);
    expect(dependencies.db.knowledgeTemplateVersion.findUnique).toHaveBeenCalledWith({
      where: { id: TEMPLATE_ID },
      include: { template: true },
    });
  });

  it("rejects invalid template mode and requires a project space", async () => {
    const dependencies = fixture();
    dependencies.db.knowledgeTemplateVersion.findUnique.mockResolvedValue({ id: TEMPLATE_ID, template: { projectDigest: PROJECT_DIGEST, mode: "manual_update", status: "published" } });
    await expect(createKnowledgeGenerationTask(input(), dependencies.db as never)).rejects.toMatchObject({ code: "version_conflict" });
    dependencies.db.project.findUnique.mockResolvedValue({ id: "project_1", spaceId: null, teamId: "team_1" });
    await expect(createKnowledgeGenerationTask(input(), dependencies.db as never)).rejects.toMatchObject({ code: "not_found" });
  });
});
