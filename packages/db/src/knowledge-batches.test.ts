import { describe, expect, it, vi } from "vitest";

import {
  getKnowledgeBatchProjection,
  retryKnowledgeBatch,
  submitKnowledgeBatch,
} from "./knowledge-batches";
import {
  decideKnowledgeBatchForIngestion,
  submitKnowledgeBatchForIngestion,
} from "./knowledge-ingestion";
import { createKnowledgeJob } from "./knowledge-jobs";
import { knowledgeDigest, knowledgeId, knowledgeProjectDigest } from "./knowledge-reference";
import { knowledgeSourceSnapshotDigest } from "./knowledge-snapshot";

const PROJECT_DIGEST = knowledgeProjectDigest("project_1");
const TEMPLATE_VERSION_ID = "c".repeat(32);
const SOURCE_SNAPSHOT = {
  observedAt: "2026-09-20T11:00:00.000Z",
  sourceRefs: [{ kind: "task", sourceType: "task_completion", ref: "task:task_1" }],
};

function batchInput() {
  return {
    commandId: "command_submit_1",
    jobId: "job_1",
    submissionId: "submission_1",
    templateDigest: "a".repeat(32),
    sourceSnapshot: SOURCE_SNAPSHOT,
    items: [
      {
        stableKey: "rule.release.gate",
        changeType: "create",
        sourceType: "task_completion",
        entryType: "rule",
        scope: "project",
        title: "发布门禁",
        summary: "必须全量测试",
        bodyMarkdown: "必须全量测试",
        confidence: 0.96,
        tags: ["release", "quality"],
        changeSummary: "新增发布门禁",
        evidence: [{ kind: "task", sourceType: "task_completion", ref: "task:task_1" }],
        relations: [],
      },
      {
        stableKey: "decision.secret",
        changeType: "create",
        sourceType: "task_completion",
        entryType: "decision",
        scope: "project",
        title: "敏感决策",
        summary: "不得保留敏感内容",
        bodyMarkdown: "token=secret-value",
        confidence: 0.99,
        tags: [],
        changeSummary: "敏感候选",
        evidence: [{ kind: "task", sourceType: "task_completion", ref: "task:task_1" }],
        relations: [],
      },
    ],
  };
}

type StoredRow = Record<string, unknown> & { id: string };

function storedBatch(overrides: Record<string, unknown> = {}): StoredRow {
  const receivedAt = new Date("2026-09-20T00:00:00.000Z");
  return {
    id: "batch_1",
    jobId: "job_1",
    projectDigest: PROJECT_DIGEST,
    submissionId: knowledgeDigest("knowledge-submission", "submission_1"),
    templateDigest: "a".repeat(32),
    status: "received",
    failedStage: null,
    progress: 0,
    processedChunks: 0,
    totalChunks: 0,
    retryCount: 0,
    failureClass: null,
    failureMessage: null,
    version: 1,
    receivedAt,
    completedAt: null,
    createdAt: receivedAt,
    updatedAt: receivedAt,
    ...overrides,
  };
}

function fixtureBatchDb(options: { batch?: Record<string, unknown>; withJob?: boolean; withPolicy?: boolean } = {}) {
  const transactionOptions: Array<{ maxWait?: number; timeout?: number } | undefined> = [];
  const projects = new Map<string, StoredRow>([["project_1", { id: "project_1" }]]);
  const tasks = new Map<string, StoredRow>([["task_1", { id: "task_1", projectId: "project_1", archivedAt: null }]]);
  const documents = new Map<string, StoredRow>();
  const loopRuns = new Map<string, StoredRow>();
  const batches = new Map<string, StoredRow>();
  const items = new Map<string, StoredRow>();
  const entries = new Map<string, StoredRow>();
  const relations = new Map<string, StoredRow>();
  const versions = new Map<string, StoredRow>();
  const receipts = new Map<string, StoredRow>();
  const jobs = new Map<string, StoredRow>([
    ["job_1", {
      id: "job_1",
      projectDigest: PROJECT_DIGEST,
      taskId: knowledgeId("knowledge-task", "task_1"),
      mode: "task_completion",
      status: "awaiting_submission",
      templateVersionId: TEMPLATE_VERSION_ID,
      policyVersion: 1,
      dedupeKey: "knowledge-job:task_1",
      sourceSnapshot: SOURCE_SNAPSHOT,
      sourceSnapshotDigest: knowledgeSourceSnapshotDigest(SOURCE_SNAPSHOT),
      failureCode: null,
      failureMessage: null,
      version: 1,
      createdAt: new Date("2026-09-20T11:00:00.000Z"),
      updatedAt: new Date("2026-09-20T11:00:00.000Z"),
    }],
  ]);
  const policies = new Map<string, StoredRow>([
    [PROJECT_DIGEST, {
      id: "policy_1",
      projectDigest: PROJECT_DIGEST,
      autoPublishEnabled: true,
      minimumConfidence: 0.9,
      allowedSourceTypes: ["task_completion"],
      allowedEntryTypes: ["rule", "decision"],
      sourceTypeOverrides: [],
      allowAutomaticDelete: false,
      allowAutomaticExpire: false,
      allowAutomaticSupersede: true,
      version: 1,
    }],
  ]);
  const templateVersions = new Map<string, StoredRow>([[
    TEMPLATE_VERSION_ID,
    {
      id: TEMPLATE_VERSION_ID,
      version: 1,
      contentHash: "a".repeat(32),
      publishedAt: new Date("2026-09-20T10:00:00.000Z"),
      template: {
        id: "t".repeat(32),
        projectDigest: PROJECT_DIGEST,
        mode: "task_completion",
        status: "published",
      },
    },
  ]]);
  if (options.withJob === false) jobs.clear();
  if (options.withPolicy === false) policies.clear();
  if (options.batch) {
    const batch = storedBatch(options.batch);
    batches.set(batch.id, batch);
  }

  const knowledgeBatch = {
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (typeof where.id === "string") return batches.get(where.id) ?? null;
      const compound = where.jobId_submissionId as { jobId: string; submissionId: string } | undefined;
      if (!compound) return null;
      return Array.from(batches.values()).find((row) => (
        row.jobId === compound.jobId && row.submissionId === compound.submissionId
      )) ?? null;
    }),
    findUniqueOrThrow: vi.fn(async (args: { where: Record<string, unknown> }) => {
      const row = await knowledgeBatch.findUnique(args);
      if (!row) throw Object.assign(new Error("Knowledge batch not found"), { code: "P2025" });
      return row;
    }),
    createMany: vi.fn(async ({ data, skipDuplicates }: { data: StoredRow[]; skipDuplicates?: boolean }) => {
      let count = 0;
      for (const candidate of data) {
        const duplicate = batches.get(candidate.id) ?? Array.from(batches.values()).find((row) => (
          row.jobId === candidate.jobId && row.submissionId === candidate.submissionId
        ));
        if (duplicate) {
          if (skipDuplicates) continue;
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        batches.set(candidate.id, candidate);
        count += 1;
      }
      return { count };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = batches.get(String(where.id));
      if (!row || !matchesWhere(row, where)) return { count: 0 };
      batches.set(row.id, applyUpdate(row, data));
      return { count: 1 };
    }),
  };
  const knowledgeBatchItem = {
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => (
      Array.from(items.values())
        .filter((row) => matchesWhere(row, where))
        .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    )),
    createMany: vi.fn(async ({ data, skipDuplicates }: { data: StoredRow[]; skipDuplicates?: boolean }) => {
      let count = 0;
      for (const candidate of data) {
        const duplicate = Array.from(items.values()).some((row) => (
          row.batchId === candidate.batchId
          && row.stableKey === candidate.stableKey
          && row.changeType === candidate.changeType
        ));
        if (duplicate) {
          if (skipDuplicates) continue;
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        items.set(candidate.id, candidate);
        count += 1;
      }
      return { count };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = items.get(String(where.id));
      if (!row || !matchesWhere(row, where)) return { count: 0 };
      items.set(row.id, applyUpdate(row, data));
      return { count: 1 };
    }),
  };
  const knowledgeEntry = {
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (typeof where.id === "string") return entries.get(where.id) ?? null;
      const compound = where.projectDigest_stableKey as
        | { projectDigest: string; stableKey: string }
        | undefined;
      if (!compound) return null;
      return Array.from(entries.values()).find((row) => (
        row.projectDigest === compound.projectDigest && row.stableKey === compound.stableKey
      )) ?? null;
    }),
    create: vi.fn(async ({ data }: { data: StoredRow }) => {
      entries.set(data.id, data);
      return data;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = entries.get(String(where.id));
      if (!row || !matchesWhere(row, where)) return { count: 0 };
      entries.set(row.id, applyUpdate(row, data));
      return { count: 1 };
    }),
  };
  const knowledgeEntryVersion = {
    create: vi.fn(async ({ data }: { data: StoredRow }) => {
      versions.set(data.id, data);
      return data;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const [id, row] of versions) {
        if (!matchesWhere(row, where)) continue;
        versions.set(id, applyUpdate(row, data));
        count += 1;
      }
      return { count };
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => (
      Array.from(versions.values())
        .filter((row) => matchesWhere(row, where))
        .sort((left, right) => Number(right.version) - Number(left.version))
    )),
  };
  const knowledgeRelation = {
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => (
      Array.from(relations.values()).filter((row) => matchesWhere(row, where))
    )),
    createMany: vi.fn(async ({ data, skipDuplicates }: { data: StoredRow[]; skipDuplicates?: boolean }) => {
      let count = 0;
      for (const row of data) {
        if (relations.has(row.id)) {
          if (skipDuplicates) continue;
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        relations.set(row.id, row);
        count += 1;
      }
      return { count };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const [id, row] of relations) {
        if (!matchesWhere(row, where)) continue;
        relations.set(id, applyUpdate(row, data));
        count += 1;
      }
      return { count };
    }),
  };
  const commandReceipt = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => receipts.get(where.id) ?? null),
    createMany: vi.fn(async ({ data, skipDuplicates }: { data: StoredRow[]; skipDuplicates?: boolean }) => {
      let count = 0;
      for (const candidate of data) {
        if (receipts.has(candidate.id)) {
          if (skipDuplicates) continue;
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        receipts.set(candidate.id, candidate);
        count += 1;
      }
      return { count };
    }),
  };
  const queryRaw = vi.fn(async (query: readonly string[], ...values: unknown[]) => {
    const sql = query.join("?");
    if (sql.includes("KnowledgeJob") && sql.includes("FOR UPDATE")) {
      const id = String(values[0] ?? "");
      const job = jobs.get(id);
      return job ? [job] : [];
    }
    if (sql.includes("KnowledgeBatch") && sql.includes("FOR UPDATE")) {
      const row = sql.includes("WHERE id =")
        ? batches.get(String(values[0] ?? ""))
        : Array.from(batches.values()).find((candidate) => (
            candidate.jobId === values[0] && candidate.submissionId === values[1]
          ));
      return row ? [row] : [];
    }
    if (sql.includes("CommandReceipt") && sql.includes("FOR UPDATE")) {
      const receipt = receipts.get(String(values[0] ?? ""));
      return receipt ? [receipt] : [];
    }
    return [];
  });
  const stores = {
    $queryRaw: queryRaw,
    project: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => projects.get(where.id) ?? null),
    },
    task: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => tasks.get(where.id) ?? null),
    },
    document: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => documents.get(where.id) ?? null),
    },
    loopRun: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => loopRuns.get(where.id) ?? null),
    },
    knowledgeJob: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (typeof where.id === "string") return jobs.get(where.id) ?? null;
        if (typeof where.dedupeKey === "string") {
          return Array.from(jobs.values()).find((job) => job.dedupeKey === where.dedupeKey) ?? null;
        }
        return null;
      }),
      createMany: vi.fn(async ({ data, skipDuplicates }: { data: StoredRow[]; skipDuplicates?: boolean }) => {
        let count = 0;
        for (const candidate of data) {
          if (jobs.has(candidate.id)) {
            if (skipDuplicates) continue;
            throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
          }
          jobs.set(candidate.id, candidate);
          count += 1;
        }
        return { count };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = jobs.get(String(where.id));
        if (!row || !matchesWhere(row, where)) return { count: 0 };
        jobs.set(row.id, applyUpdate(row, data));
        return { count: 1 };
      }),
    },
    knowledgePolicy: {
      findUnique: vi.fn(async ({ where }: { where: { projectDigest: string } }) => policies.get(where.projectDigest) ?? null),
    },
    knowledgeTemplateVersion: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => templateVersions.get(where.id) ?? null),
    },
    knowledgeBatch,
    knowledgeBatchItem,
    knowledgeEntry,
    knowledgeEntryVersion,
    knowledgeRelation,
    commandReceipt,
  };
  return {
    batches,
    items,
    entries,
    relations,
    versions,
    jobs,
    policies,
    templateVersions,
    projects,
    tasks,
    documents,
    loopRuns,
    receipts,
    queryRaw,
    transactionOptions,
    db: {
      ...stores,
      $transaction: async <T>(
        callback: (tx: typeof stores) => Promise<T>,
        options?: { maxWait?: number; timeout?: number },
      ) => {
        transactionOptions.push(options);
        return callback(stores);
      },
    },
  };
}

function matchesWhere(row: StoredRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key.endsWith("_submissionId")) return true;
    if (expected && typeof expected === "object" && "in" in expected) {
      return (expected as { in: unknown[] }).in.includes(row[key]);
    }
    return row[key] === expected;
  });
}

function applyUpdate(row: StoredRow, data: Record<string, unknown>): StoredRow {
  const next = { ...row };
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && "increment" in value) {
      next[key] = Number(row[key] ?? 0) + Number((value as { increment: number }).increment);
    } else {
      next[key] = value;
    }
  }
  return next;
}

describe("knowledge batch persistence", () => {
  it("resolves source activity from platform records instead of caller status claims", async () => {
    const dependencies = fixtureBatchDb();
    const input = batchInput();
    input.items = [input.items[0]!];
    input.sourceSnapshot = {
      observedAt: "2026-09-20T11:00:00.000Z",
      sourceRefs: [{ kind: "task", sourceType: "task_completion", ref: "task:task_1", status: "active" }],
    };
    dependencies.jobs.set("job_1", {
      ...dependencies.jobs.get("job_1")!,
      sourceSnapshot: input.sourceSnapshot,
      sourceSnapshotDigest: knowledgeSourceSnapshotDigest(input.sourceSnapshot),
    });
    dependencies.tasks.set("task_1", { id: "task_1", projectId: "project_1", archivedAt: new Date("2026-09-20T11:30:00.000Z") });

    const result = await submitKnowledgeBatch(input, dependencies as never);

    expect(result.status).toBe("review_required");
    const item = Array.from(dependencies.items.values())[0]!;
    expect(item.decision).toBe("review_required");
    expect(String(item.decisionReason)).toContain("source_inactive");
  });

  it("is idempotent by job and hashed submission id while persisting item decisions", async () => {
    const dependencies = fixtureBatchDb();
    const input = batchInput();
    const now = () => new Date("2026-09-20T12:00:00.000Z");

    const first = await submitKnowledgeBatch(input, { ...dependencies, now } as never);
    const duplicate = await submitKnowledgeBatch(input, { ...dependencies, now } as never);

    const submissionId = knowledgeDigest("knowledge-submission", input.submissionId);
    const batchId = knowledgeId("knowledge-batch", input.jobId, submissionId);
    expect(first).toEqual({
      id: batchId,
      jobId: input.jobId,
      status: "review_required",
      failedStage: null,
      progress: 30,
      processedChunks: 0,
      totalChunks: 0,
      retryCount: 0,
      failureClass: null,
      failureMessage: null,
      receivedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    expect(duplicate).toEqual(first);
    expect(dependencies.db.knowledgeBatch.createMany).toHaveBeenCalledOnce();
    expect(dependencies.batches.size).toBe(1);
    expect(Array.from(dependencies.batches.values())[0]).toMatchObject({
      id: batchId,
      jobId: input.jobId,
      submissionId,
      status: "review_required",
      progress: 30,
    });
    expect(Array.from(dependencies.batches.values())[0]?.submissionId).not.toBe(input.submissionId);
    expect(Array.from(dependencies.items.values()).map((item) => item.decision)).toEqual([
      "auto_publish",
      "review_required",
    ]);
    expect(Array.from(dependencies.items.values())[0]).toMatchObject({
      tags: ["release", "quality"],
      changeSummary: "新增发布门禁",
    });
    expect(Array.from(dependencies.items.values())[1]).toMatchObject({
      bodyMarkdown: "token=[REDACTED]",
      decisionReason: expect.stringContaining("sensitive_content"),
    });
    expect(Array.from(dependencies.items.values()).map((item) => item.id)).toEqual([
      knowledgeId("knowledge-batch-item", batchId, "rule.release.gate", "create"),
      knowledgeId("knowledge-batch-item", batchId, "decision.secret", "create"),
    ]);
  });

  it("moves an all-auto-publish batch into policy evaluation", async () => {
    const dependencies = fixtureBatchDb();
    const input = batchInput();
    input.items = [input.items[0]!];

    await expect(submitKnowledgeBatch(input, {
      ...dependencies,
      now: () => new Date("2026-09-20T12:00:00.000Z"),
    } as never)).resolves.toMatchObject({
      status: "policy_evaluating",
      progress: 10,
    });
    expect(Array.from(dependencies.items.values()).map((item) => item.decision)).toEqual(["auto_publish"]);
    expect(dependencies.transactionOptions).toContainEqual({ maxWait: 5_000, timeout: 30_000 });
  });

  it("creates a Job and publishes an all-auto batch immutably into archiving", async () => {
    const dependencies = fixtureBatchDb({ withJob: false });
    const now = () => new Date("2026-09-20T12:00:00.000Z");
    const job = await createKnowledgeJob({
      projectId: "project_1",
      taskId: "task_1",
      mode: "task_completion",
      templateVersionId: TEMPLATE_VERSION_ID,
      dedupeIdentity: "task-completion:task_1",
      sourceSnapshot: SOURCE_SNAPSHOT,
    }, { db: dependencies.db as never, now });
    dependencies.jobs.set(job.id, { ...job as unknown as StoredRow, status: "awaiting_submission" });
    const input = batchInput();
    input.jobId = job.id;
    input.items = [input.items[0]!];

    const batch = await submitKnowledgeBatchForIngestion({
      ...input,
      actorDigest: "user_1",
    }, { db: dependencies.db as never, now });
    const replay = await submitKnowledgeBatchForIngestion({
      ...input,
      actorDigest: "user_1",
    }, { db: dependencies.db as never, now });

    expect(batch).toMatchObject({ status: "archiving", progress: 45 });
    expect(replay).toEqual(batch);
    expect(dependencies.entries).toHaveLength(1);
    expect(dependencies.versions).toHaveLength(1);
    expect(Array.from(dependencies.versions.values())[0]).toMatchObject({
      version: 1,
      status: "published",
      tags: ["release", "quality"],
      changeSummary: "新增发布门禁",
    });
    expect(Array.from(dependencies.batches.values())[0]).toMatchObject({
      status: "archiving",
      progress: 45,
      completedAt: null,
    });
  });

  it("keeps a review-required batch unarchived through the ingestion service", async () => {
    const dependencies = fixtureBatchDb({ withJob: false });
    const now = () => new Date("2026-09-20T12:00:00.000Z");
    const job = await createKnowledgeJob({
      projectId: "project_1",
      taskId: "task_1",
      mode: "task_completion",
      templateVersionId: TEMPLATE_VERSION_ID,
      dedupeIdentity: "task-completion:task_1",
      sourceSnapshot: SOURCE_SNAPSHOT,
    }, { db: dependencies.db as never, now });
    dependencies.jobs.set(job.id, { ...job as unknown as StoredRow, status: "awaiting_submission" });
    const input = batchInput();
    input.jobId = job.id;
    input.items = [{ ...input.items[0]!, evidence: [] }];

    await expect(submitKnowledgeBatchForIngestion({
      ...input,
      actorDigest: "user_1",
    }, { db: dependencies.db as never, now })).resolves.toMatchObject({
      status: "review_required",
      progress: 30,
    });
    expect(dependencies.entries).toHaveLength(0);
    expect(dependencies.versions).toHaveLength(0);
  });

  it("enqueues knowledge indexing when review approval publishes the final item", async () => {
    const dependencies = fixtureBatchDb({ withJob: false });
    const now = () => new Date("2026-09-20T12:00:00.000Z");
    const job = await createKnowledgeJob({
      projectId: "project_1",
      taskId: "task_1",
      mode: "task_completion",
      templateVersionId: TEMPLATE_VERSION_ID,
      dedupeIdentity: "task-completion:review-index",
      sourceSnapshot: SOURCE_SNAPSHOT,
    }, { db: dependencies.db as never, now });
    dependencies.jobs.set(job.id, { ...job as unknown as StoredRow, status: "awaiting_submission" });
    const input = batchInput();
    input.jobId = job.id;
    input.items = [{ ...input.items[0]!, evidence: [] }];

    const submitted = await submitKnowledgeBatchForIngestion({
      ...input,
      actorDigest: "user_1",
    }, { db: dependencies.db as never, now });
    expect(submitted.status).toBe("review_required");

    const enqueueIndex = vi.fn(async () => ({ id: "e".repeat(32) }));
    const approved = await decideKnowledgeBatchForIngestion({
      batchId: submitted.id,
      actorDigest: "user_1",
      commandId: "decision_final_approve",
      decision: "approve",
    }, {
      db: dependencies.db as never,
      now,
      enqueueIndex,
      embeddingProfileId: "f".repeat(32),
    });

    expect(approved.unresolvedItemIds).toEqual([]);
    expect(enqueueIndex).toHaveBeenCalledWith(expect.objectContaining({
      projectDigest: PROJECT_DIGEST,
      batchId: submitted.id,
    }));
  });

  it("does not enqueue knowledge indexing when review rejects every item", async () => {
    const dependencies = fixtureBatchDb();
    const input = batchInput();
    input.items = [{ ...input.items[0]!, evidence: [] }];
    const submitted = await submitKnowledgeBatch(input, {
      ...dependencies,
      now: () => new Date("2026-09-20T12:00:00.000Z"),
    } as never);
    expect(submitted.status).toBe("review_required");

    const enqueueIndex = vi.fn(async () => ({ id: "e".repeat(32) }));
    await decideKnowledgeBatchForIngestion({
      batchId: submitted.id,
      actorDigest: "user_1",
      commandId: "decision_final_reject",
      decision: "reject",
      reason: "证据不足",
    }, {
      db: dependencies.db as never,
      now: () => new Date("2026-09-20T12:00:00.000Z"),
      enqueueIndex,
      embeddingProfileId: "f".repeat(32),
    });

    expect(enqueueIndex).not.toHaveBeenCalled();
  });

  it("enqueues indexing when a final rejection archives earlier approved entries", async () => {
    const dependencies = fixtureBatchDb();
    const input = batchInput();
    input.items = [
      { ...input.items[0]!, evidence: [] },
      { ...input.items[1]!, stableKey: "decision.pending", evidence: [] },
    ];
    const submitted = await submitKnowledgeBatch(input, {
      ...dependencies,
      now: () => new Date("2026-09-20T12:00:00.000Z"),
    } as never);
    expect(submitted.status).toBe("review_required");

    const approvedItem = Array.from(dependencies.items.values())
      .find((item) => item.stableKey === "rule.release.gate")!;
    await decideKnowledgeBatchForIngestion({
      batchId: submitted.id,
      actorDigest: "user_1",
      commandId: "decision_partial_approve",
      decision: "approve",
      itemIds: [approvedItem.id],
    }, {
      db: dependencies.db as never,
      now: () => new Date("2026-09-20T12:00:00.000Z"),
      enqueueIndex: vi.fn(),
      embeddingProfileId: "f".repeat(32),
    });

    const enqueueIndex = vi.fn(async () => ({ id: "e".repeat(32) }));
    const result = await decideKnowledgeBatchForIngestion({
      batchId: submitted.id,
      actorDigest: "user_1",
      commandId: "decision_final_reject",
      decision: "reject",
      reason: "剩余条目证据不足",
    }, {
      db: dependencies.db as never,
      now: () => new Date("2026-09-20T12:00:00.000Z"),
      enqueueIndex,
      embeddingProfileId: "f".repeat(32),
    });

    expect(result.unresolvedItemIds).toEqual([]);
    expect(result.entries.length).toBeGreaterThan(0);
    expect(enqueueIndex).toHaveBeenCalledWith(expect.objectContaining({ batchId: submitted.id }));
  });

  it("persists validity windows for immutable entry versions", async () => {
    const dependencies = fixtureBatchDb();
    const input = batchInput();
    const validFrom = "2026-09-20T00:00:00.000Z";
    const validUntil = "2026-10-20T00:00:00.000Z";
    input.items = [{ ...input.items[0]!, validFrom, validUntil }];

    await submitKnowledgeBatch(input, dependencies as never);

    expect(Array.from(dependencies.items.values())[0]).toMatchObject({
      validFrom: new Date(validFrom),
      validUntil: new Date(validUntil),
    });
  });

  it("loads the template relation before validating Job submission ownership", async () => {
    const dependencies = fixtureBatchDb();
    const input = batchInput();
    input.items = [input.items[0]!];

    await submitKnowledgeBatch(input, dependencies as never);

    expect(dependencies.db.knowledgeTemplateVersion.findUnique).toHaveBeenCalledWith({
      where: { id: TEMPLATE_VERSION_ID },
      include: { template: true },
    });
  });

  it("derives gates server-side and rejects a Worker claim of clean provenance", async () => {
    const dependencies = fixtureBatchDb();
    const input = batchInput();
    input.items = [{
      ...input.items[0]!,
      evidence: [],
      provenanceComplete: true,
      redactionClean: true,
      conflictFree: true,
      sourceActive: true,
    } as never];

    await expect(submitKnowledgeBatch(input, dependencies as never))
      .resolves.toMatchObject({ status: "review_required", progress: 30 });
    expect(Array.from(dependencies.items.values())[0]).toMatchObject({
      decision: "review_required",
      decisionReason: expect.stringContaining("provenance_incomplete"),
    });
  });

  it("fails closed when the locked source snapshot is stale", async () => {
    const dependencies = fixtureBatchDb();
    const input = batchInput();
    input.items = [input.items[0]!];

    await expect(submitKnowledgeBatch(input, {
      ...dependencies,
      now: () => new Date("2026-09-22T12:00:00.000Z"),
    } as never)).resolves.toMatchObject({ status: "review_required", progress: 30 });
    expect(Array.from(dependencies.items.values())[0]).toMatchObject({
      decision: "review_required",
      decisionReason: expect.stringContaining("source_snapshot_stale"),
    });
  });

  it("derives source activity from platform records instead of Worker booleans", async () => {
    const dependencies = fixtureBatchDb();
    const sourceSnapshot = {
      ...SOURCE_SNAPSHOT,
      sourceRefs: [{ ...SOURCE_SNAPSHOT.sourceRefs[0]!, status: "active" }],
    };
    dependencies.jobs.set("job_1", {
      ...dependencies.jobs.get("job_1")!,
      sourceSnapshot,
      sourceSnapshotDigest: knowledgeSourceSnapshotDigest(sourceSnapshot),
    });
    const input = batchInput();
    input.sourceSnapshot = sourceSnapshot;
    dependencies.tasks.set("task_1", { id: "task_1", projectId: "project_1", archivedAt: new Date("2026-09-20T11:30:00.000Z") });
    input.items = [{
      ...input.items[0]!,
      sourceActive: true,
      conflictFree: true,
      provenanceComplete: true,
      redactionClean: true,
    } as never];

    await expect(submitKnowledgeBatch(input, dependencies as never))
      .resolves.toMatchObject({ status: "review_required" });
    expect(Array.from(dependencies.items.values())[0]).toMatchObject({
      decision: "review_required",
      decisionReason: expect.stringContaining("source_inactive"),
    });
  });

  it("rejects a source snapshot or template mismatch before creating a batch", async () => {
    const sourceMismatch = fixtureBatchDb();
    await expect(submitKnowledgeBatch({
      ...batchInput(),
      sourceSnapshot: {
        ...SOURCE_SNAPSHOT,
        sourceRefs: [{ kind: "task", sourceType: "task_completion", ref: "task:changed" }],
      },
    }, sourceMismatch as never)).rejects.toMatchObject({ code: "version_conflict" });
    expect(sourceMismatch.batches).toHaveLength(0);

    const templateMismatch = fixtureBatchDb();
    await expect(submitKnowledgeBatch({
      ...batchInput(),
      templateDigest: "f".repeat(32),
    }, templateMismatch as never)).rejects.toMatchObject({ code: "version_conflict" });
    expect(templateMismatch.batches).toHaveLength(0);
  });

  it.each([
    "queued",
    "ingesting",
    "searchable",
    "cancelled",
    "failed",
    "requires_manual_resubmit",
  ])("rejects submission from Job status %s", async (status) => {
    const dependencies = fixtureBatchDb();
    dependencies.jobs.set("job_1", { ...dependencies.jobs.get("job_1")!, status });

    await expect(submitKnowledgeBatch(batchInput(), dependencies as never))
      .rejects.toMatchObject({ code: "conflict" });
    expect(dependencies.batches).toHaveLength(0);
  });

  it("rejects a mismatched Job template or policy version", async () => {
    const templateDependencies = fixtureBatchDb();
    templateDependencies.jobs.set("job_1", {
      ...templateDependencies.jobs.get("job_1")!,
      templateVersionId: "f".repeat(32),
    });
    await expect(submitKnowledgeBatch(batchInput(), templateDependencies as never))
      .rejects.toMatchObject({ code: "version_conflict" });

    const policyDependencies = fixtureBatchDb();
    policyDependencies.jobs.set("job_1", {
      ...policyDependencies.jobs.get("job_1")!,
      policyVersion: 2,
    });
    await expect(submitKnowledgeBatch(batchInput(), policyDependencies as never))
      .rejects.toMatchObject({ code: "version_conflict" });
  });

  it("fails closed when an existing entry conflicts with a claimed-clean item", async () => {
    const dependencies = fixtureBatchDb();
    const input = batchInput();
    input.items = [input.items[0]!];
    dependencies.entries.set("e".repeat(32), {
      id: "e".repeat(32),
      projectDigest: PROJECT_DIGEST,
      stableKey: input.items[0]!.stableKey,
      status: "published",
      latestVersion: 1,
      publishedVersion: 1,
      version: 1,
    });

    await expect(submitKnowledgeBatch(input, dependencies as never))
      .resolves.toMatchObject({ status: "review_required" });
    expect(Array.from(dependencies.items.values())[0]).toMatchObject({
      decision: "review_required",
      decisionReason: expect.stringContaining("conflict_detected"),
    });
  });

  it("fails closed when the platform conflict check is unavailable", async () => {
    const dependencies = fixtureBatchDb();
    dependencies.db.knowledgeEntry.findUnique.mockRejectedValueOnce(
      new Error("conflict store unavailable"),
    );
    const input = batchInput();
    input.items = [input.items[0]!];

    await expect(submitKnowledgeBatch(input, dependencies as never))
      .resolves.toMatchObject({ status: "review_required" });
    expect(Array.from(dependencies.items.values())[0]).toMatchObject({
      decision: "review_required",
      decisionReason: expect.stringContaining("conflict_check_unavailable"),
    });
  });

  it("resolves exact source and type overrides before the project policy", async () => {
    const dependencies = fixtureBatchDb();
    const policy = dependencies.policies.get(PROJECT_DIGEST)!;
    dependencies.policies.set(PROJECT_DIGEST, {
      ...policy,
      sourceTypeOverrides: [{
        sourceType: "task_completion",
        entryType: "rule",
        autoPublishEnabled: false,
      }],
    });
    const input = batchInput();
    input.items = [input.items[0]!];

    await expect(submitKnowledgeBatch(input, dependencies as never))
      .resolves.toMatchObject({ status: "review_required" });
    expect(Array.from(dependencies.items.values())[0]).toMatchObject({
      decision: "review_required",
      decisionReason: expect.stringContaining("automation_disabled"),
    });
  });

  it("uses the platform safe policy when a project policy is unavailable", async () => {
    const dependencies = fixtureBatchDb({ withPolicy: false });
    const input = batchInput();
    input.items = [input.items[0]!];

    await expect(submitKnowledgeBatch(input, dependencies as never))
      .resolves.toMatchObject({ status: "review_required" });
    expect(Array.from(dependencies.items.values())[0]).toMatchObject({
      decision: "review_required",
      decisionReason: expect.stringContaining("automation_disabled"),
    });
  });

  it("bounds batch size and transaction execution", async () => {
    const dependencies = fixtureBatchDb();
    const input = batchInput();
    input.items = Array.from({ length: 501 }, (_, index) => ({
      ...input.items[0]!,
      stableKey: `rule.bounded.${index}`,
    }));

    await expect(submitKnowledgeBatch(input, dependencies as never))
      .rejects.toMatchObject({ code: "validation_failed" });
    expect(dependencies.queryRaw).not.toHaveBeenCalled();
  });

  it("replays the original batch when commandId is reused with a changed submission id", async () => {
    const dependencies = fixtureBatchDb();
    const input = batchInput();

    const first = await submitKnowledgeBatch(input, dependencies as never);
    const replay = await submitKnowledgeBatch({ ...input, submissionId: "submission_2" }, dependencies as never);

    expect(replay).toEqual(first);
    expect(dependencies.db.knowledgeBatch.createMany).toHaveBeenCalledOnce();
    expect(dependencies.batches.size).toBe(1);
    expect(dependencies.receipts.size).toBe(1);
    expect(dependencies.receipts.get(knowledgeId("knowledge-submit", input.jobId, input.commandId))).toMatchObject({
      status: "completed",
      result: { batchId: first.id },
    });
  });

  it("locks the knowledge job with a current read before command or batch state", async () => {
    const dependencies = fixtureBatchDb();

    await submitKnowledgeBatch(batchInput(), dependencies as never);

    expect(dependencies.queryRaw).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining("KnowledgeJob")]),
      "job_1",
    );
    const [jobLockCall, receiptReadCall] = dependencies.queryRaw.mock.invocationCallOrder;
    expect(jobLockCall).toBeLessThan(receiptReadCall!);
    expect(jobLockCall).toBeLessThan(dependencies.db.knowledgeBatch.findUnique.mock.invocationCallOrder[0]!);
    expect(dependencies.queryRaw.mock.calls[0]?.[0].join("?")).toContain("FOR UPDATE");
    expect(dependencies.queryRaw.mock.calls[0]?.[0].join("?")).toContain("sourceSnapshotDigest");
    expect(dependencies.queryRaw.mock.calls[0]?.[0].join("?")).toContain("templateVersionId");
    expect(dependencies.queryRaw.mock.calls[1]?.[0].join("?")).toContain("CommandReceipt");
  });

  it("rejects duplicate item keys before writing the batch", async () => {
    const dependencies = fixtureBatchDb();
    const input = batchInput();
    input.items = [input.items[0]!, input.items[0]!];

    await expect(submitKnowledgeBatch(input, dependencies as never))
      .rejects.toMatchObject({ code: "validation_failed" });
    expect(dependencies.batches.size).toBe(0);
    expect(dependencies.items.size).toBe(0);
    expect(dependencies.receipts.size).toBe(0);
  });

  it("rejects a non-array relations payload before persisting the batch", async () => {
    const dependencies = fixtureBatchDb();
    const input = batchInput();
    input.items = [{ ...input.items[0]!, relations: {} } as never];

    await expect(submitKnowledgeBatch(input, dependencies as never))
      .rejects.toMatchObject({ code: "validation_failed" });
    expect(dependencies.batches.size).toBe(0);
    expect(dependencies.items.size).toBe(0);
  });

  it("rejects a non-array evidence payload instead of silently dropping provenance", async () => {
    const dependencies = fixtureBatchDb();
    const input = batchInput();
    input.items = [{
      ...input.items[0]!,
      evidence: { taskId: "task_1", sourceRefs: ["SRC-A"] },
    } as never];

    await expect(submitKnowledgeBatch(input, dependencies as never))
      .rejects.toMatchObject({ code: "validation_failed" });
    expect(dependencies.batches.size).toBe(0);
  });

  it("returns the canonical batch when a concurrent submission wins the insert race", async () => {
    const dependencies = fixtureBatchDb();
    const input = batchInput();
    const submissionId = knowledgeDigest("knowledge-submission", input.submissionId);
    const batchId = knowledgeId("knowledge-batch", input.jobId, submissionId);
    const canonical = storedBatch({
      id: batchId,
      submissionId,
      status: "review_required",
      progress: 30,
    });
    dependencies.db.knowledgeBatch.createMany.mockImplementationOnce(async () => {
      dependencies.batches.set(canonical.id, canonical);
      return { count: 0 };
    });

    await expect(submitKnowledgeBatch(input, dependencies as never)).resolves.toMatchObject({
      id: batchId,
      status: "review_required",
      progress: 30,
    });
    expect(dependencies.db.knowledgeBatchItem.createMany).not.toHaveBeenCalled();
    expect(dependencies.items.size).toBe(0);
    expect(dependencies.queryRaw).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining("KnowledgeBatch")]),
      input.jobId,
      submissionId,
    );
  });

  it("returns an exact projection and null for an unknown batch", async () => {
    const dependencies = fixtureBatchDb({
      batch: {
        status: "chunking",
        progress: 52,
        processedChunks: 3,
        totalChunks: 9,
      },
    });

    const projection = await getKnowledgeBatchProjection("batch_1", dependencies as never);
    expect(projection).toEqual({
      id: "batch_1",
      jobId: "job_1",
      status: "chunking",
      failedStage: null,
      progress: 52,
      processedChunks: 3,
      totalChunks: 9,
      retryCount: 0,
      failureClass: null,
      failureMessage: null,
      receivedAt: new Date("2026-09-20T00:00:00.000Z"),
      updatedAt: new Date("2026-09-20T00:00:00.000Z"),
    });
    expect(Object.keys(projection!)).toEqual([
      "id",
      "jobId",
      "status",
      "failedStage",
      "progress",
      "processedChunks",
      "totalChunks",
      "retryCount",
      "failureClass",
      "failureMessage",
      "receivedAt",
      "updatedAt",
    ]);
    await expect(getKnowledgeBatchProjection("missing", dependencies as never)).resolves.toBeNull();
  });

  it("does not retry permanent failures", async () => {
    const dependencies = fixtureBatchDb({
      batch: { status: "failed", failureClass: "permanent", failureMessage: "template mismatch" },
    });

    await expect(retryKnowledgeBatch({ batchId: "batch_1", commandId: "retry_1" }, dependencies as never))
      .rejects.toMatchObject({ code: "permanent_failure" });
    expect(dependencies.db.knowledgeBatch.updateMany).not.toHaveBeenCalled();
    expect(dependencies.db.commandReceipt.createMany).not.toHaveBeenCalled();
  });

  it("retries a transient failure from its persisted embedding stage with a command receipt", async () => {
    const dependencies = fixtureBatchDb({
      batch: {
        status: "failed",
        failureClass: "transient",
        failureMessage: "embedding timeout",
        failedStage: "embedding",
        progress: 70,
        processedChunks: 4,
        totalChunks: 10,
        retryCount: 1,
        version: 7,
      },
    });

    const result = await retryKnowledgeBatch({ batchId: "batch_1", commandId: "retry_opaque_1" }, dependencies as never);

    expect(result).toEqual({
      id: "batch_1",
      jobId: "job_1",
      status: "embedding",
      failedStage: null,
      progress: 70,
      processedChunks: 4,
      totalChunks: 10,
      retryCount: 2,
      failureClass: null,
      failureMessage: null,
      receivedAt: new Date("2026-09-20T00:00:00.000Z"),
      updatedAt: expect.any(Date),
    });
    expect(dependencies.batches.get("batch_1")).toMatchObject({
      status: "embedding",
      failureClass: null,
      failureMessage: null,
      failedStage: null,
      retryCount: 2,
      version: 8,
    });
    expect(dependencies.db.knowledgeBatch.updateMany).toHaveBeenCalledWith({
      where: {
        id: "batch_1",
        status: "failed",
        failureClass: "transient",
        failedStage: "embedding",
        version: 7,
      },
      data: expect.objectContaining({
        retryCount: { increment: 1 },
        version: { increment: 1 },
        status: "embedding",
        failedStage: null,
        failureClass: null,
        failureMessage: null,
      }),
    });
    const receiptId = knowledgeId("knowledge-retry", "batch_1", "retry_opaque_1");
    expect(dependencies.receipts.get(receiptId)).toMatchObject({
      id: receiptId,
      aggregateType: "knowledge_batch",
      aggregateId: "batch_1",
      status: "completed",
      result: { batchId: "batch_1" },
    });
    expect(dependencies.queryRaw).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining("KnowledgeBatch")]),
      "batch_1",
    );
    const rawSql = dependencies.queryRaw.mock.calls.map(([query]) => query.join("?"));
    expect(rawSql.findIndex((sql) => sql.includes("KnowledgeBatch"))).toBeLessThan(
      rawSql.findIndex((sql) => sql.includes("CommandReceipt")),
    );
  });

  it("replays the winning receipt when a concurrent retry loses the claim", async () => {
    const dependencies = fixtureBatchDb({
      batch: {
        status: "failed",
        failureClass: "transient",
        failureMessage: "embedding timeout",
        failedStage: "embedding",
        progress: 70,
        processedChunks: 4,
        totalChunks: 10,
        retryCount: 1,
        version: 7,
      },
    });
    const receiptId = knowledgeId("knowledge-retry", "batch_1", "retry_raced_1");
    const winner = {
      id: receiptId,
      aggregateType: "knowledge_batch",
      aggregateId: "batch_1",
      status: "completed",
      result: { batchId: "batch_1" },
      createdAt: new Date("2026-09-20T00:01:00.000Z"),
      completedAt: new Date("2026-09-20T00:01:00.000Z"),
    };
    dependencies.db.commandReceipt.createMany.mockImplementationOnce(async () => {
      dependencies.receipts.set(receiptId, winner);
      dependencies.batches.set("batch_1", {
        ...dependencies.batches.get("batch_1")!,
        status: "embedding",
        failedStage: null,
        failureClass: null,
        failureMessage: null,
        retryCount: 2,
        version: 8,
      });
      return { count: 0 };
    });

    await expect(retryKnowledgeBatch({ batchId: "batch_1", commandId: "retry_raced_1" }, dependencies as never))
      .resolves.toMatchObject({
        id: "batch_1",
        status: "embedding",
        progress: 70,
        processedChunks: 4,
        totalChunks: 10,
      });
    expect(dependencies.db.knowledgeBatch.updateMany).not.toHaveBeenCalled();
    expect(dependencies.receipts.get(receiptId)).toEqual(winner);
    expect(dependencies.queryRaw).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining("CommandReceipt")]),
      receiptId,
    );
    expect(dependencies.queryRaw).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining("KnowledgeBatch")]),
      "batch_1",
    );
  });

  it("does not retry a transient failure without a persisted failed stage", async () => {
    const dependencies = fixtureBatchDb({
      batch: {
        status: "failed",
        failureClass: "transient",
        failureMessage: "embedding timeout",
        failedStage: null,
      },
    });

    await expect(retryKnowledgeBatch({ batchId: "batch_1", commandId: "retry_1" }, dependencies as never))
      .rejects.toMatchObject({ code: "failed_stage_missing" });
    expect(dependencies.db.knowledgeBatch.updateMany).not.toHaveBeenCalled();
    expect(dependencies.db.commandReceipt.createMany).not.toHaveBeenCalled();
  });
});
