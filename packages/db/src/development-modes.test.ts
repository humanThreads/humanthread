import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMilestoneReleaseSnapshot,
  getPublishedDevelopmentTemplate,
  listPublishedDevelopmentTemplates,
} from "./development-modes";

const createdAt = "2026-08-03T08:00:00.000Z";
const template = {
  id: "template_branch_v1",
  key: "branch-development",
  name: "Branch Development",
  version: 1,
  status: "published",
  spaceId: null,
  origin: "platform",
  kind: "branch-development",
  description: "Task branch development and milestone release",
  createdByUserId: "user_owner",
  sourceTemplateId: null,
  revision: 1,
  isPublic: false,
  publicAt: null,
  deletedAt: null,
  industryTags: [],
  starCount: 0,
  projectConfigSchema: { productionBranch: "main", stagingBranch: "staging" },
  taskFieldSchema: { taskBranch: { type: "branch" } },
  developmentLoopVersionId: "loop_task_v1",
  releaseLoopVersionId: "loop_release_v1",
  triggerPolicy: { triggers: ["milestone.release_ready", "manual"] },
  executionPolicy: { integrationMode: "local_merge_test_push" },
  createdAt: new Date("2026-08-03T08:00:00.000Z"),
  updatedAt: new Date("2026-08-03T08:00:00.000Z"),
};
const { createdAt: _createdAt, updatedAt: _updatedAt, ...templateDto } = template;

const snapshot = {
  projectId: "project_1",
  milestoneId: "milestone_1",
  milestoneVersion: 1,
  triggerType: "manual" as const,
  stagingBranch: "staging",
  tasks: [{
    taskId: "task_1",
    taskNumber: 100001,
    branch: "2026-HT100001",
    headCommit: "a".repeat(40),
    taskDocument: { documentId: "doc_task_1", version: 2 },
    knowledgeRefs: [{ path: "docs/knowledge/task-1.md", commit: "b".repeat(40) }],
    testReportRef: "report_task_1",
  }],
  stagingBaseCommit: "c".repeat(40),
  productionBaseCommit: "d".repeat(40),
  createdAt,
};

describe("development mode persistence", () => {
  let fixture: ReturnType<typeof createFixture>;

  beforeEach(() => {
    fixture = createFixture();
  });

  it("reads only published template versions", async () => {
    await expect(listPublishedDevelopmentTemplates({ spaceId: "space_1" }, fixture.dependencies)).resolves.toEqual([templateDto]);
    await expect(getPublishedDevelopmentTemplate({ key: "branch-development", version: 1, spaceId: "space_1" }, fixture.dependencies))
      .resolves.toEqual(templateDto);
    expect(fixture.db.projectDevelopmentTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [
        { spaceId: "space_1", status: { in: ["published"] }, deletedAt: null },
        { origin: "platform", status: "published", deletedAt: null },
      ] },
    }));
  });

  it("projects catalog DTO fields without leaking Prisma audit timestamps", async () => {
    const [result] = await listPublishedDevelopmentTemplates({ spaceId: "space_1" }, fixture.dependencies);

    expect(result).toEqual({
      id: "template_branch_v1",
      key: "branch-development",
      name: "Branch Development",
      version: 1,
      status: "published",
      spaceId: null,
      origin: "platform",
      kind: "branch-development",
      description: "Task branch development and milestone release",
      createdByUserId: "user_owner",
      sourceTemplateId: null,
      revision: 1,
      isPublic: false,
      publicAt: null,
      deletedAt: null,
      industryTags: [],
      starCount: 0,
      projectConfigSchema: { productionBranch: "main", stagingBranch: "staging" },
      taskFieldSchema: { taskBranch: { type: "branch" } },
      developmentLoopVersionId: "loop_task_v1",
      releaseLoopVersionId: "loop_release_v1",
      triggerPolicy: { triggers: ["milestone.release_ready", "manual"] },
      executionPolicy: { integrationMode: "local_merge_test_push" },
    });
    expect(result).not.toHaveProperty("createdAt");
    expect(result).not.toHaveProperty("updatedAt");
  });

  it("returns a fresh parsed value for an immutable published template", async () => {
    const first = await getPublishedDevelopmentTemplate({ key: "branch-development", version: 1, spaceId: "space_1" }, fixture.dependencies);
    if (!first) throw new Error("Expected template fixture");
    first.name = "Changed locally";

    await expect(getPublishedDevelopmentTemplate({ key: "branch-development", version: 1, spaceId: "space_1" }, fixture.dependencies))
      .resolves.toEqual(templateDto);
  });

  it("creates an immutable release snapshot and repeats idempotently", async () => {
    const first = await createMilestoneReleaseSnapshot({
      command: command("create_snapshot_1"),
      id: "snapshot_1",
      loopRunId: "run_1",
      ...snapshot,
    }, fixture.dependencies);
    const repeated = await createMilestoneReleaseSnapshot({
      command: command("create_snapshot_1"),
      id: "snapshot_1",
      loopRunId: "run_1",
      ...snapshot,
    }, fixture.dependencies);

    expect(first).toMatchObject({
      id: "snapshot_1",
      milestoneId: "milestone_1",
      tasks: [{ branch: "2026-HT100001", headCommit: "a".repeat(40) }],
    });
    expect(repeated).toEqual(first);
    expect(fixture.db.milestoneReleaseSnapshot.create).toHaveBeenCalledOnce();
  });

  it("derives a bounded stable snapshot ID from the LoopRun", async () => {
    await expect(createMilestoneReleaseSnapshot({
      command: command("create_snapshot_2"),
      loopRunId: "run_2",
      ...snapshot,
    }, fixture.dependencies)).resolves.toMatchObject({
      id: "release-snapshot:run_2",
      loopRunId: "run_2",
    });
  });

  it("rejects an attempt to overwrite an existing snapshot with different content", async () => {
    fixture.persistedSnapshot = { id: "snapshot_1", loopRunId: "run_1", checksum: "different", snapshot };
    await expect(createMilestoneReleaseSnapshot({
      command: command("create_snapshot_conflict"),
      id: "snapshot_1",
      loopRunId: "run_1",
      ...snapshot,
      milestoneVersion: 2,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });
  });
});

function createFixture() {
  let persistedSnapshot: any = null;
  const receipts = new Map<string, { status: string; result?: unknown }>();
  const db = {
    projectDevelopmentTemplate: {
      findMany: vi.fn(async () => [template]),
      findFirst: vi.fn(async () => template),
      findUnique: vi.fn(async ({ where }: any) => (where.id === template.id || (where.key_version?.key === template.key && where.key_version.version === template.version)) ? template : null),
    },
    milestoneReleaseSnapshot: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id) return persistedSnapshot?.id === where.id ? persistedSnapshot : null;
        if (where.loopRunId) return persistedSnapshot?.loopRunId === where.loopRunId ? persistedSnapshot : null;
        return null;
      }),
      create: vi.fn(async ({ data }: any) => {
        persistedSnapshot = { ...data, snapshot: data.snapshot };
        return persistedSnapshot;
      }),
    },
    commandReceipt: {
      findUnique: vi.fn(async ({ where }: any) => {
        const receipt = receipts.get(where.id);
        return receipt ? { id: where.id, result: receipt.result ?? null, status: receipt.status } : null;
      }),
      create: vi.fn(async ({ data }: any) => {
        receipts.set(data.id, { status: data.status });
      }),
      update: vi.fn(async ({ where, data }: any) => {
        receipts.set(where.id, { status: data.status, result: data.result });
      }),
    },
    orchestrationEvent: { createMany: vi.fn(async () => ({ count: 0 })) },
    outboxMessage: { createMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: async (callback: (tx: any) => Promise<unknown>) => callback(db),
  };
  return {
    db,
    get persistedSnapshot() { return persistedSnapshot; },
    set persistedSnapshot(value: any) { persistedSnapshot = value; },
    dependencies: { db },
  };
}

function command(commandId: string) {
  return {
    commandId,
    correlationId: `correlation_${commandId}`,
    actor: { type: "system" as const, id: "loop-engine" },
    payload: {},
    issuedAt: new Date(createdAt),
  };
}
