import { describe, expect, it, vi } from "vitest";

import {
  decideKnowledgeBatch,
  getKnowledgeEntry,
  listKnowledgeEntryVersions,
  listKnowledgeNeighborhood,
  publishKnowledgeBatch,
} from "./knowledge-entries";
import { knowledgeDigest, knowledgeId } from "./knowledge-reference";

const PROJECT_DIGEST = "b".repeat(32);
const BATCH_ID = "a".repeat(32);
const STABLE_KEY = "rule.release.gate";
const ENTRY_ID = knowledgeId("knowledge-entry", PROJECT_DIGEST, STABLE_KEY);
const ACTOR_DIGEST = knowledgeDigest("knowledge-actor", "user_1");

type Row = Record<string, unknown> & { id: string };

function applyUpdate(row: Row, data: Record<string, unknown>): Row {
  const next = { ...row };
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && !Array.isArray(value) && "increment" in value) {
      next[key] = Number(row[key] ?? 0) + Number((value as { increment: number }).increment);
    } else {
      next[key] = value;
    }
  }
  return next;
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      const condition = expected as Record<string, unknown>;
      if (Array.isArray(condition.in)) return condition.in.includes(row[key]);
      if (Array.isArray(condition.notIn)) return !condition.notIn.includes(row[key]);
      if ("not" in condition) return row[key] !== condition.not;
    }
    return row[key] === expected;
  });
}

function makeItem(overrides: Record<string, unknown> = {}): Row {
  return {
    id: "d".repeat(32),
    batchId: BATCH_ID,
    ordinal: 0,
    stableKey: STABLE_KEY,
    changeType: "create",
    sourceType: "task_completion",
    entryType: "rule",
    scope: "project",
    title: "发布门禁",
    summary: "必须全量测试",
    bodyMarkdown: "必须全量测试",
    confidence: 0.96,
    tags: ["release"],
    changeSummary: "新增发布门禁",
    evidence: [],
    relations: [],
    baseVersion: null,
    validFrom: null,
    validUntil: null,
    decision: "auto_publish",
    decisionReason: null,
    publishedVersion: null,
    ...overrides,
  };
}

function makeEntry(overrides: Record<string, unknown> = {}): Row {
  return {
    id: ENTRY_ID,
    projectDigest: PROJECT_DIGEST,
    stableKey: STABLE_KEY,
    entryType: "rule",
    scope: "project",
    status: "draft",
    latestVersion: 0,
    publishedVersion: null,
    title: "发布门禁",
    searchable: false,
    version: 1,
    createdAt: new Date("2026-09-20T00:00:00.000Z"),
    updatedAt: new Date("2026-09-20T00:00:00.000Z"),
    ...overrides,
  };
}

function makeVersion(version: number, overrides: Record<string, unknown> = {}): Row {
  return {
    id: knowledgeId("knowledge-entry-version", ENTRY_ID, String(version)),
    entryId: ENTRY_ID,
    version,
    status: "published",
    title: "发布门禁",
    summary: "必须全量测试",
    bodyMarkdown: "必须全量测试",
    entryType: "rule",
    scope: "project",
    tags: [],
    validFrom: null,
    validUntil: null,
    changeSummary: "必须全量测试",
    contentHash: knowledgeDigest("test-version", ENTRY_ID, String(version)),
    sourceRefs: [],
    batchItemId: "d".repeat(32),
    publishedByDigest: ACTOR_DIGEST,
    publishedAt: new Date("2026-09-20T00:00:00.000Z"),
    createdAt: new Date("2026-09-20T00:00:00.000Z"),
    ...overrides,
  };
}

function fixtureKnowledgeEntries(options: {
  batchStatus?: string;
  items?: Row[];
  entry?: Row | null;
  entries?: Row[];
  versions?: Row[];
} = {}) {
  const transactionOptions: Array<{ maxWait?: number; timeout?: number } | undefined> = [];
  const batches = new Map<string, Row>();
  const items = new Map<string, Row>();
  const entries = new Map<string, Row>();
  const versions = new Map<string, Row>();
  const relations = new Map<string, Row>();
  const receipts = new Map<string, Row>();
  const batch = {
    id: BATCH_ID,
    jobId: "job_1",
    projectDigest: PROJECT_DIGEST,
    submissionId: "e".repeat(32),
    templateDigest: "f".repeat(32),
    status: options.batchStatus ?? "policy_evaluating",
    failedStage: null,
    failureClass: null,
    progress: 10,
    processedChunks: 0,
    totalChunks: 0,
    retryCount: 0,
    receivedAt: new Date("2026-09-20T00:00:00.000Z"),
    completedAt: null,
    version: 1,
    createdAt: new Date("2026-09-20T00:00:00.000Z"),
    updatedAt: new Date("2026-09-20T00:00:00.000Z"),
  };
  batches.set(batch.id, batch);
  for (const item of options.items ?? [makeItem()]) items.set(item.id, item);
  if (options.entry) entries.set(options.entry.id, options.entry);
  for (const entry of options.entries ?? []) entries.set(entry.id, entry);
  for (const version of options.versions ?? []) versions.set(version.id, version);

  const knowledgeBatch = {
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (typeof where.id === "string") return batches.get(where.id) ?? null;
      const compound = where.jobId_submissionId as { jobId: string; submissionId: string } | undefined;
      if (!compound) return null;
      return Array.from(batches.values()).find((row) => (
        row.jobId === compound.jobId && row.submissionId === compound.submissionId
      )) ?? null;
    }),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const id = String(where.id);
      const row = batches.get(id);
      if (!row || !matches(row, where)) return { count: 0 };
      batches.set(id, applyUpdate(row, data));
      return { count: 1 };
    },
  };

  const knowledgeBatchItem = {
    findMany: async ({ where }: { where: Record<string, unknown> }) => (
      Array.from(items.values())
        .filter((row) => matches(row, where))
        .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    ),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const id = String(where.id);
      const row = items.get(id);
      if (!row || !matches(row, where)) return { count: 0 };
      items.set(id, applyUpdate(row, data));
      return { count: 1 };
    },
  };

  const knowledgeEntry = {
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (typeof where.id === "string") return entries.get(where.id) ?? null;
      const compound = where.projectDigest_stableKey as { projectDigest: string; stableKey: string } | undefined;
      if (!compound) return null;
      return Array.from(entries.values()).find((row) => (
        row.projectDigest === compound.projectDigest && row.stableKey === compound.stableKey
      )) ?? null;
    }),
    create: async ({ data }: { data: Row }) => {
      if (entries.has(data.id)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      entries.set(data.id, data);
      return data;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const id = String(where.id);
      const row = entries.get(id);
      if (!row || !matches(row, where)) return { count: 0 };
      entries.set(id, applyUpdate(row, data));
      return { count: 1 };
    },
  };

  const knowledgeEntryVersion = {
    create: async ({ data }: { data: Row }) => {
      if (versions.has(data.id)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      versions.set(data.id, data);
      return data;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const [id, row] of versions) {
        if (!matches(row, where)) continue;
        versions.set(id, applyUpdate(row, data));
        count += 1;
      }
      return { count };
    },
    findMany: async ({ where }: { where: Record<string, unknown> }) => (
      Array.from(versions.values())
        .filter((row) => matches(row, where))
        .sort((left, right) => Number(right.version) - Number(left.version))
    ),
  };

  const knowledgeRelation = {
    createMany: async ({ data }: { data: Row[] }) => {
      let count = 0;
      for (const row of data) {
        if (relations.has(row.id)) continue;
        relations.set(row.id, row);
        count += 1;
      }
      return { count };
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const [id, row] of relations) {
        if (!matches(row, where)) continue;
        relations.set(id, applyUpdate(row, data));
        count += 1;
      }
      return { count };
    },
    findMany: async ({ where }: { where: Record<string, unknown> }) => (
      Array.from(relations.values()).filter((row) => matches(row, where))
    ),
  };

  const commandReceipt = {
    findUnique: async ({ where }: { where: { id: string } }) => receipts.get(where.id) ?? null,
    createMany: async ({ data }: { data: Row[] }) => {
      let count = 0;
      for (const row of data) {
        if (receipts.has(row.id)) continue;
        receipts.set(row.id, row);
        count += 1;
      }
      return { count };
    },
  };

  const queryRaw = vi.fn(async (query: TemplateStringsArray, ...values: unknown[]) => {
    const sql = query.join("?");
    if (sql.includes("FROM KnowledgeBatch")) {
      const row = batches.get(String(values[0]));
      return row ? [row] : [];
    }
    if (sql.includes("FROM KnowledgeEntry")) {
      const row = Array.from(entries.values()).find((candidate) => (
        candidate.projectDigest === values[0] && candidate.stableKey === values[1]
      ));
      return row ? [row] : [];
    }
    return [];
  });

  const stores = {
    $queryRaw: queryRaw,
    knowledgeBatch,
    knowledgeBatchItem,
    knowledgeEntry,
    knowledgeEntryVersion,
    knowledgeRelation,
    commandReceipt,
  };

  let transactionQueue = Promise.resolve();
  const runTransaction = async <T>(
    callback: (store: typeof stores) => Promise<T> | T,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T> => {
    transactionOptions.push(options);
    let release!: () => void;
    const previous = transactionQueue;
    transactionQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    const snapshots = {
      batches: new Map(batches),
      items: new Map(items),
      entries: new Map(entries),
      versions: new Map(versions),
      relations: new Map(relations),
      receipts: new Map(receipts),
    };
    try {
      return await callback(stores);
    } catch (error) {
      restoreRows(batches, snapshots.batches);
      restoreRows(items, snapshots.items);
      restoreRows(entries, snapshots.entries);
      restoreRows(versions, snapshots.versions);
      restoreRows(relations, snapshots.relations);
      restoreRows(receipts, snapshots.receipts);
      throw error;
    } finally {
      release();
    }
  };

  return {
    batches,
    items,
    entries,
    versions,
    relations,
    receipts,
    queryRaw,
    transactionOptions,
    db: {
      ...stores,
      $transaction: runTransaction,
    },
  };
}

function restoreRows(target: Map<string, Row>, snapshot: Map<string, Row>): void {
  target.clear();
  for (const [id, row] of snapshot) target.set(id, row);
}

describe("knowledge entry publication lifecycle", () => {
  it("publishes a create item as immutable version one", async () => {
    const fixture = fixtureKnowledgeEntries();

    const result = await publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never);

    expect(result).toEqual({
      batchId: BATCH_ID,
      unresolvedItemIds: [],
      entries: [{
        entryId: ENTRY_ID,
        stableKey: STABLE_KEY,
        version: 1,
        status: "published",
      }],
    });
    expect(fixture.versions).toHaveLength(1);
    expect(Array.from(fixture.versions.values())[0]).toMatchObject({
      entryId: ENTRY_ID,
      version: 1,
      status: "published",
      bodyMarkdown: "必须全量测试",
      tags: ["release"],
      changeSummary: "新增发布门禁",
      batchItemId: "d".repeat(32),
      publishedByDigest: ACTOR_DIGEST,
    });
    expect(Array.from(fixture.entries.values())[0]).toMatchObject({
      latestVersion: 1,
      publishedVersion: 1,
      status: "published",
      searchable: false,
    });
    expect(Array.from(fixture.items.values())[0]).toMatchObject({ publishedVersion: 1 });
    expect(Array.from(fixture.batches.values())[0]).toMatchObject({ status: "archiving", progress: 45 });
    expect(fixture.transactionOptions).toContainEqual({ maxWait: 5_000, timeout: 30_000 });
  });

  it("uses full-row current reads for batch and entry locks", async () => {
    const fixture = fixtureKnowledgeEntries();

    await publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never);

    const lockSql = fixture.queryRaw.mock.calls.map(([query]) => query.join("?"));
    expect(lockSql.some((sql) => sql.includes("FROM KnowledgeBatch") && sql.includes("status") && sql.includes("FOR UPDATE"))).toBe(true);
    expect(lockSql.some((sql) => sql.includes("FROM KnowledgeEntry") && sql.includes("status") && sql.includes("FOR UPDATE"))).toBe(true);
    expect(fixture.db.knowledgeBatch.findUnique).not.toHaveBeenCalled();
    expect(fixture.db.knowledgeEntry.findUnique).not.toHaveBeenCalled();
  });

  it("acquires entry locks in stable stableKey order", async () => {
    const fixture = fixtureKnowledgeEntries({
      items: [
        makeItem({ id: "1".repeat(32), ordinal: 0, stableKey: "rule.z" }),
        makeItem({ id: "2".repeat(32), ordinal: 1, stableKey: "rule.a" }),
      ],
    });

    await publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never);

    const entryLockKeys = fixture.queryRaw.mock.calls
      .filter(([query]) => query.join("?").includes("FROM KnowledgeEntry"))
      .map(([, projectDigest, stableKey]) => [projectDigest, stableKey]);
    expect(entryLockKeys).toEqual([
      [PROJECT_DIGEST, "rule.a"],
      [PROJECT_DIGEST, "rule.z"],
    ]);
  });

  it("rejects a stale update without overwriting the latest version", async () => {
    const fixture = fixtureKnowledgeEntries({
      items: [makeItem({ changeType: "update", baseVersion: 2 })],
      entry: makeEntry({ latestVersion: 3, publishedVersion: 3, status: "published" }),
      versions: [makeVersion(1, { status: "superseded" }), makeVersion(2, { status: "superseded" }), makeVersion(3)],
    });

    await expect(publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never))
      .rejects.toMatchObject({ code: "version_conflict" });
    expect(fixture.versions).toHaveLength(3);
    expect(Array.from(fixture.batches.values())[0]?.status).toBe("policy_evaluating");
  });

  it("appends version two and preserves version one when updating", async () => {
    const fixture = fixtureKnowledgeEntries({
      items: [makeItem({ changeType: "update", baseVersion: 1, bodyMarkdown: "全量测试与构建" })],
      entry: makeEntry({ latestVersion: 1, publishedVersion: 1, status: "published", version: 2 }),
      versions: [makeVersion(1)],
    });

    const result = await publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never);

    expect(result.entries).toEqual([expect.objectContaining({ version: 2, status: "published" })]);
    expect(fixture.versions).toHaveLength(2);
    expect(fixture.versions.get(knowledgeId("knowledge-entry-version", ENTRY_ID, "1"))).toMatchObject({
      bodyMarkdown: "必须全量测试",
      status: "superseded",
    });
    expect(Array.from(fixture.versions.values()).find((row) => row.version === 2)).toMatchObject({
      bodyMarkdown: "全量测试与构建",
      status: "published",
    });
    expect(Array.from(fixture.entries.values())[0]).toMatchObject({ latestVersion: 2, publishedVersion: 2 });
  });

  it("deactivates stale outgoing relations when appending a new version", async () => {
    const oldRelationId = "9".repeat(32);
    const targetId = knowledgeId("knowledge-entry", PROJECT_DIGEST, "rule.target");
    const fixture = fixtureKnowledgeEntries({
      items: [makeItem({
        changeType: "update",
        baseVersion: 1,
        relations: [{ type: "constrains", targetKey: "rule.target", origin: "explicit", confidence: 1 }],
      })],
      entry: makeEntry({ latestVersion: 1, publishedVersion: 1, status: "published", version: 2 }),
      entries: [makeEntry({
        id: targetId,
        stableKey: "rule.target",
        latestVersion: 1,
        publishedVersion: 1,
        status: "published",
      })],
      versions: [makeVersion(1)],
    });
    fixture.relations.set(oldRelationId, {
      id: oldRelationId,
      projectDigest: PROJECT_DIGEST,
      fromEntryId: ENTRY_ID,
      fromVersion: 1,
      toStableKey: "rule.target",
      toEntryId: targetId,
      toVersion: 1,
      relationType: "constrains",
      origin: "explicit",
      confidence: 1,
      evidence: [],
      active: true,
      validFrom: null,
      validUntil: null,
      createdAt: new Date("2026-09-20T00:00:00.000Z"),
      updatedAt: new Date("2026-09-20T00:00:00.000Z"),
    });

    await publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never);

    expect(fixture.relations.get(oldRelationId)).toMatchObject({ active: false });
    expect(Array.from(fixture.relations.values()).find((row) => row.fromVersion === 2)).toMatchObject({
      active: true,
      relationType: "constrains",
    });
  });

  it("keeps an updated entry non-searchable until Stage 2 activates the new index", async () => {
    const fixture = fixtureKnowledgeEntries({
      items: [makeItem({ changeType: "update", baseVersion: 1, bodyMarkdown: "全量测试与构建" })],
      entry: makeEntry({
        latestVersion: 1,
        publishedVersion: 1,
        status: "published",
        searchable: false,
        version: 2,
      }),
      versions: [makeVersion(1)],
    });

    await publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never);

    expect(Array.from(fixture.entries.values())[0]).toMatchObject({ searchable: false });
  });

  it("rejects create when baseVersion is not null", async () => {
    const fixture = fixtureKnowledgeEntries({ items: [makeItem({ baseVersion: 1 })] });

    await expect(publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never))
      .rejects.toMatchObject({ code: "version_conflict" });
    expect(fixture.entries).toHaveLength(0);
    expect(fixture.versions).toHaveLength(0);
  });

  it.each(["supersede", "expire", "delete"] as const)(
    "rejects %s with a null baseVersion",
    async (changeType) => {
      const fixture = fixtureKnowledgeEntries({
        items: [makeItem({
          changeType,
          baseVersion: null,
          relations: changeType === "supersede"
            ? [{ type: "supersedes", targetKey: "rule.release.gate.v2", origin: "explicit", confidence: 1 }]
            : [],
        })],
        entry: makeEntry({ latestVersion: 1, publishedVersion: 1, status: "published", version: 2 }),
        entries: [makeEntry({
          id: knowledgeId("knowledge-entry", PROJECT_DIGEST, "rule.release.gate.v2"),
          stableKey: "rule.release.gate.v2",
          latestVersion: 1,
          publishedVersion: 1,
          status: "published",
        })],
        versions: [makeVersion(1)],
      });

      await expect(publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never))
        .rejects.toMatchObject({ code: "version_conflict" });
      expect(fixture.versions).toHaveLength(1);
    },
  );

  it.each(["supersede", "expire", "delete"] as const)(
    "rejects stale %s before appending a version",
    async (changeType) => {
      const fixture = fixtureKnowledgeEntries({
        items: [makeItem({
          changeType,
          baseVersion: 0,
          relations: changeType === "supersede"
            ? [{ type: "supersedes", targetKey: "rule.release.gate.v2", origin: "explicit", confidence: 1 }]
            : [],
        })],
        entry: makeEntry({ latestVersion: 1, publishedVersion: 1, status: "published", version: 2 }),
        entries: [makeEntry({
          id: knowledgeId("knowledge-entry", PROJECT_DIGEST, "rule.release.gate.v2"),
          stableKey: "rule.release.gate.v2",
          latestVersion: 1,
          publishedVersion: 1,
          status: "published",
        })],
        versions: [makeVersion(1)],
      });

      await expect(publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never))
        .rejects.toMatchObject({ code: "version_conflict" });
      expect(fixture.versions).toHaveLength(1);
    },
  );

  it.each([
    ["update", "draft"],
    ["update", "expired"],
    ["update", "superseded"],
    ["update", "deleted"],
    ["expire", "draft"],
    ["expire", "expired"],
    ["expire", "superseded"],
    ["expire", "deleted"],
    ["delete", "draft"],
    ["delete", "superseded"],
    ["supersede", "draft"],
    ["supersede", "expired"],
    ["supersede", "superseded"],
    ["supersede", "deleted"],
  ] as const)("rejects %s when the current entry is %s", async (changeType, status) => {
    const fixture = fixtureKnowledgeEntries({
      items: [makeItem({
        changeType,
        baseVersion: 1,
        relations: changeType === "supersede"
          ? [{ type: "supersedes", targetKey: "rule.release.gate.v2", origin: "explicit", confidence: 1 }]
          : [],
      })],
      entry: makeEntry({ latestVersion: 1, publishedVersion: 1, status, version: 2 }),
      versions: [makeVersion(1, { status })],
    });

    await expect(publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never))
      .rejects.toMatchObject({ code: "version_conflict" });
    expect(fixture.versions).toHaveLength(1);
    expect(Array.from(fixture.entries.values())[0]).toMatchObject({ status, latestVersion: 1 });
  });

  it("does not republish an already searchable batch", async () => {
    const fixture = fixtureKnowledgeEntries({
      batchStatus: "searchable",
      items: [makeItem({ publishedVersion: 1 })],
    });

    const first = await publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never);
    const duplicate = await publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never);

    expect(duplicate).toEqual(first);
    expect(fixture.versions).toHaveLength(0);
  });

  it.each([
    ["expire", "expired"],
    ["delete", "deleted"],
  ] as const)("appends a non-searchable version for %s", async (changeType, status) => {
    const fixture = fixtureKnowledgeEntries({
      items: [makeItem({ changeType, baseVersion: 1 })],
      entry: makeEntry({ latestVersion: 1, publishedVersion: 1, status: "published", version: 2 }),
      versions: [makeVersion(1)],
    });

    const result = await publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never);

    expect(result.entries).toEqual([expect.objectContaining({ version: 2, status })]);
    expect(Array.from(fixture.versions.values()).find((row) => row.version === 2)).toMatchObject({
      status,
      summary: "",
      bodyMarkdown: "",
    });
    expect(Array.from(fixture.entries.values())[0]).toMatchObject({
      latestVersion: 2,
      publishedVersion: null,
      status,
      searchable: false,
    });
  });

  it("deactivates incoming relations when the target leaves published", async () => {
    const incomingId = "8".repeat(32);
    const fixture = fixtureKnowledgeEntries({
      items: [makeItem({ changeType: "expire", baseVersion: 1 })],
      entry: makeEntry({ latestVersion: 1, publishedVersion: 1, status: "published", version: 2 }),
      versions: [makeVersion(1)],
    });
    fixture.relations.set(incomingId, {
      id: incomingId,
      projectDigest: PROJECT_DIGEST,
      fromEntryId: "7".repeat(32),
      fromVersion: 1,
      toStableKey: STABLE_KEY,
      toEntryId: ENTRY_ID,
      toVersion: 1,
      relationType: "depends_on",
      origin: "explicit",
      confidence: 1,
      evidence: [],
      active: true,
      validFrom: null,
      validUntil: null,
      createdAt: new Date("2026-09-20T00:00:00.000Z"),
      updatedAt: new Date("2026-09-20T00:00:00.000Z"),
    });

    await publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never);

    expect(fixture.relations.get(incomingId)).toMatchObject({ active: false });
  });

  it("appends a superseded version only when a replacement relation exists", async () => {
    const fixture = fixtureKnowledgeEntries({
      items: [makeItem({
        changeType: "supersede",
        baseVersion: 1,
        relations: [{ type: "supersedes", targetKey: "rule.release.gate.v2", origin: "explicit", confidence: 1 }],
      })],
      entry: makeEntry({ latestVersion: 1, publishedVersion: 1, status: "published", version: 2 }),
      entries: [makeEntry({
        id: knowledgeId("knowledge-entry", PROJECT_DIGEST, "rule.release.gate.v2"),
        stableKey: "rule.release.gate.v2",
        latestVersion: 1,
        publishedVersion: 1,
        status: "published",
      })],
      versions: [makeVersion(1)],
    });

    const result = await publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never);

    expect(result.entries).toEqual([expect.objectContaining({ version: 2, status: "superseded" })]);
    expect(Array.from(fixture.entries.values())[0]).toMatchObject({ latestVersion: 2, status: "superseded", searchable: false });
    expect(Array.from(fixture.relations.values())).toEqual([
      expect.objectContaining({
        fromEntryId: ENTRY_ID,
        fromVersion: 2,
        toStableKey: "rule.release.gate.v2",
        relationType: "supersedes",
      }),
    ]);
  });

  it("rejects a supersede item with no replacement relation", async () => {
    const fixture = fixtureKnowledgeEntries({
      items: [makeItem({ changeType: "supersede", baseVersion: 1 })],
      entry: makeEntry({ latestVersion: 1, publishedVersion: 1, status: "published", version: 2 }),
      versions: [makeVersion(1)],
    });

    await expect(publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never))
      .rejects.toMatchObject({ code: "validation_failed" });
    expect(fixture.versions).toHaveLength(1);
  });

  it("rejects a non-array relations payload before changing any batch state", async () => {
    const fixture = fixtureKnowledgeEntries({
      batchStatus: "review_required",
      items: [makeItem({ decision: "approve", relations: {} })],
    });

    await expect(decideKnowledgeBatch({
      batchId: BATCH_ID,
      actorDigest: ACTOR_DIGEST,
      commandId: "decision_relations_shape",
      decision: "approve",
    }, fixture as never)).rejects.toMatchObject({ code: "validation_failed" });
    expect(fixture.versions).toHaveLength(0);
    expect(Array.from(fixture.batches.values())[0]).toMatchObject({ status: "review_required" });
  });

  it("rejects an empty-object relations payload instead of publishing silently", async () => {
    const fixture = fixtureKnowledgeEntries({
      batchStatus: "review_required",
      items: [makeItem({ decision: "approve", relations: { depends_on: ["rule.other"] } })],
    });

    await expect(decideKnowledgeBatch({
      batchId: BATCH_ID,
      actorDigest: ACTOR_DIGEST,
      commandId: "decision_relations_object",
      decision: "approve",
    }, fixture as never)).rejects.toMatchObject({ code: "validation_failed" });
    expect(Array.from(fixture.batches.values())[0]).toMatchObject({ status: "review_required" });
  });

  it("rejects a supersede relation that is not typed supersedes", async () => {
    const fixture = fixtureKnowledgeEntries({
      items: [makeItem({
        changeType: "supersede",
        baseVersion: 1,
        relations: [{ type: "related_to", targetKey: "rule.release.gate.v2", origin: "explicit", confidence: 1 }],
      })],
      entry: makeEntry({ latestVersion: 1, publishedVersion: 1, status: "published", version: 2 }),
      entries: [makeEntry({
        id: knowledgeId("knowledge-entry", PROJECT_DIGEST, "rule.release.gate.v2"),
        stableKey: "rule.release.gate.v2",
        latestVersion: 1,
        publishedVersion: 1,
        status: "published",
      })],
      versions: [makeVersion(1)],
    });

    await expect(publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never))
      .rejects.toMatchObject({ code: "validation_failed" });
    expect(fixture.versions).toHaveLength(1);
  });

  it("rejects a supersede relation whose target does not exist", async () => {
    const fixture = fixtureKnowledgeEntries({
      items: [makeItem({
        changeType: "supersede",
        baseVersion: 1,
        relations: [{ type: "supersedes", targetKey: "rule.release.gate.v2", origin: "explicit", confidence: 1 }],
      })],
      entry: makeEntry({ latestVersion: 1, publishedVersion: 1, status: "published", version: 2 }),
      versions: [makeVersion(1)],
    });

    await expect(publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never))
      .rejects.toMatchObject({ code: "validation_failed" });
    expect(fixture.versions).toHaveLength(1);
  });

  it("rejects a supersede relation whose target is not published", async () => {
    const fixture = fixtureKnowledgeEntries({
      items: [makeItem({
        changeType: "supersede",
        baseVersion: 1,
        relations: [{ type: "supersedes", targetKey: "rule.release.gate.v2", origin: "explicit", confidence: 1 }],
      })],
      entry: makeEntry({ latestVersion: 1, publishedVersion: 1, status: "published", version: 2 }),
      entries: [makeEntry({
        id: knowledgeId("knowledge-entry", PROJECT_DIGEST, "rule.release.gate.v2"),
        stableKey: "rule.release.gate.v2",
        latestVersion: 1,
        publishedVersion: 1,
        status: "draft",
      })],
      versions: [makeVersion(1)],
    });

    await expect(publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never))
      .rejects.toMatchObject({ code: "validation_failed" });
    expect(fixture.versions).toHaveLength(1);
  });

  it("publishes only auto-publish and explicitly approved items", async () => {
    const autoItem = makeItem();
    const approvedItem = makeItem({ id: "1".repeat(32), ordinal: 1, stableKey: "rule.code.review", decision: "approve" });
    const pendingItem = makeItem({ id: "2".repeat(32), ordinal: 2, stableKey: "rule.manual.review", decision: "review_required" });
    const fixture = fixtureKnowledgeEntries({ items: [autoItem, approvedItem, pendingItem] });

    const result = await publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never);

    expect(result.entries.map((entry) => entry.stableKey)).toEqual(["rule.release.gate", "rule.code.review"]);
    expect(result.unresolvedItemIds).toEqual([pendingItem.id]);
    expect(fixture.versions).toHaveLength(2);
    expect(fixture.items.get(pendingItem.id)).toMatchObject({ publishedVersion: null });
    expect(Array.from(fixture.batches.values())[0]).toMatchObject({ status: "review_required" });
  });

  it("archives only after every item is explicitly approved or rejected", async () => {
    const fixture = fixtureKnowledgeEntries({
      batchStatus: "review_required",
      items: [
        makeItem({ id: "1".repeat(32), decision: "approve" }),
        makeItem({ id: "2".repeat(32), ordinal: 1, stableKey: "rule.manual.review", decision: "reject" }),
      ],
    });

    const result = await publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never);

    expect(result.unresolvedItemIds).toEqual([]);
    expect(Array.from(fixture.batches.values())[0]).toMatchObject({ status: "archiving", progress: 45 });
  });
});

describe("knowledge batch review decisions", () => {
  it("approves only selected review items and publishes their immutable versions", async () => {
    const selected = makeItem({ id: "1".repeat(32), decision: "review_required" });
    const untouched = makeItem({ id: "2".repeat(32), ordinal: 1, stableKey: "rule.manual.review", decision: "review_required" });
    const fixture = fixtureKnowledgeEntries({ batchStatus: "review_required", items: [selected, untouched] });

    const result = await decideKnowledgeBatch({
      batchId: BATCH_ID,
      actorDigest: ACTOR_DIGEST,
      commandId: "decision_1",
      decision: "approve",
      itemIds: [selected.id],
    }, fixture as never);

    expect(result.entries).toEqual([expect.objectContaining({ stableKey: STABLE_KEY, version: 1 })]);
    expect(result.unresolvedItemIds).toEqual([untouched.id]);
    expect(fixture.items.get(selected.id)).toMatchObject({ decision: "approve", publishedVersion: 1 });
    expect(fixture.items.get(untouched.id)).toMatchObject({ decision: "review_required", publishedVersion: null });
    expect(fixture.versions).toHaveLength(1);
    expect(Array.from(fixture.batches.values())[0]).toMatchObject({ status: "review_required" });
  });

  it("preserves an approved published item when a later rejection omits itemIds", async () => {
    const approved = makeItem({ id: "1".repeat(32), decision: "review_required" });
    const unresolved = makeItem({
      id: "2".repeat(32),
      ordinal: 1,
      stableKey: "rule.manual.review",
      decision: "review_required",
    });
    const fixture = fixtureKnowledgeEntries({
      batchStatus: "review_required",
      items: [approved, unresolved],
    });

    await decideKnowledgeBatch({
      batchId: BATCH_ID,
      actorDigest: ACTOR_DIGEST,
      commandId: "decision_partial_approve",
      decision: "approve",
      itemIds: [approved.id],
    }, fixture as never);

    const result = await decideKnowledgeBatch({
      batchId: BATCH_ID,
      actorDigest: ACTOR_DIGEST,
      commandId: "decision_final_reject",
      decision: "reject",
      reason: "剩余条目证据不足",
    }, fixture as never);

    expect(result.entries).toEqual([expect.objectContaining({
      entryId: ENTRY_ID,
      stableKey: STABLE_KEY,
      version: 1,
      status: "published",
    })]);
    expect(fixture.items.get(approved.id)).toMatchObject({
      decision: "approve",
      publishedVersion: 1,
    });
    expect(fixture.items.get(unresolved.id)).toMatchObject({
      decision: "reject",
      decisionReason: "剩余条目证据不足",
      publishedVersion: null,
    });
    expect(fixture.versions.get(knowledgeId("knowledge-entry-version", ENTRY_ID, "1"))).toMatchObject({
      status: "published",
    });
    expect(Array.from(fixture.entries.values())[0]).toMatchObject({
      status: "published",
      latestVersion: 1,
      publishedVersion: 1,
    });
    expect(Array.from(fixture.batches.values())[0]).toMatchObject({
      status: "archiving",
      progress: 45,
    });
  });

  it("rejects every unpublished auto-publish item when a policy batch rejects without itemIds", async () => {
    const first = makeItem({ id: "1".repeat(32) });
    const second = makeItem({
      id: "2".repeat(32),
      ordinal: 1,
      stableKey: "rule.manual.review",
    });
    const fixture = fixtureKnowledgeEntries({
      batchStatus: "policy_evaluating",
      items: [first, second],
    });

    const result = await decideKnowledgeBatch({
      batchId: BATCH_ID,
      actorDigest: ACTOR_DIGEST,
      commandId: "decision_policy_reject_all",
      decision: "reject",
      reason: "策略候选不再有效",
    }, fixture as never);

    expect(result).toEqual({ batchId: BATCH_ID, entries: [], unresolvedItemIds: [] });
    expect(fixture.items.get(first.id)).toMatchObject({
      decision: "reject",
      decisionReason: "策略候选不再有效",
      publishedVersion: null,
    });
    expect(fixture.items.get(second.id)).toMatchObject({
      decision: "reject",
      decisionReason: "策略候选不再有效",
      publishedVersion: null,
    });
    expect(fixture.versions).toHaveLength(0);
    expect(Array.from(fixture.batches.values())[0]).toMatchObject({
      status: "rejected",
      progress: 100,
    });
  });

  it("rejects explicitly selected unpublished auto-publish items in a policy batch", async () => {
    const selected = makeItem({ id: "1".repeat(32) });
    const second = makeItem({
      id: "2".repeat(32),
      ordinal: 1,
      stableKey: "rule.release.retained",
    });
    const fixture = fixtureKnowledgeEntries({
      batchStatus: "policy_evaluating",
      items: [selected, second],
    });

    const result = await decideKnowledgeBatch({
      batchId: BATCH_ID,
      actorDigest: ACTOR_DIGEST,
      commandId: "decision_policy_reject_selected",
      decision: "reject",
      itemIds: [selected.id, second.id],
      reason: "仅拒绝选定候选",
    }, fixture as never);

    expect(result).toEqual({ batchId: BATCH_ID, entries: [], unresolvedItemIds: [] });
    expect(fixture.items.get(selected.id)).toMatchObject({
      decision: "reject",
      publishedVersion: null,
    });
    expect(fixture.items.get(second.id)).toMatchObject({
      decision: "reject",
      publishedVersion: null,
    });
    expect(fixture.versions).toHaveLength(0);
    expect(Array.from(fixture.batches.values())[0]).toMatchObject({
      status: "rejected",
      progress: 100,
    });
  });

  it("fails a rejection request when no items are rejectable instead of publishing", async () => {
    const alreadyPublished = makeItem({
      id: "1".repeat(32),
      publishedVersion: 1,
    });
    const fixture = fixtureKnowledgeEntries({
      batchStatus: "policy_evaluating",
      items: [alreadyPublished],
      entry: makeEntry({ latestVersion: 1, publishedVersion: 1, status: "published", version: 2 }),
      versions: [makeVersion(1)],
    });

    await expect(decideKnowledgeBatch({
      batchId: BATCH_ID,
      actorDigest: ACTOR_DIGEST,
      commandId: "decision_policy_reject_none",
      decision: "reject",
      reason: "没有可拒绝候选",
    }, fixture as never)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.versions).toHaveLength(1);
    expect(fixture.items.get(alreadyPublished.id)).toMatchObject({
      decision: "auto_publish",
      publishedVersion: 1,
    });
    expect(Array.from(fixture.batches.values())[0]).toMatchObject({
      status: "policy_evaluating",
      progress: 10,
      version: 1,
    });
  });

  it("rejects an explicit rejection of an already published item without mutating it", async () => {
    const approved = makeItem({ id: "1".repeat(32), decision: "review_required" });
    const unresolved = makeItem({
      id: "2".repeat(32),
      ordinal: 1,
      stableKey: "rule.manual.review",
      decision: "review_required",
    });
    const fixture = fixtureKnowledgeEntries({
      batchStatus: "review_required",
      items: [approved, unresolved],
    });

    await decideKnowledgeBatch({
      batchId: BATCH_ID,
      actorDigest: ACTOR_DIGEST,
      commandId: "decision_approve_before_explicit_reject",
      decision: "approve",
      itemIds: [approved.id],
    }, fixture as never);

    await expect(decideKnowledgeBatch({
      batchId: BATCH_ID,
      actorDigest: ACTOR_DIGEST,
      commandId: "decision_reject_terminal",
      decision: "reject",
      itemIds: [approved.id],
      reason: "试图回退已发布决定",
    }, fixture as never)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.items.get(approved.id)).toMatchObject({
      decision: "approve",
      publishedVersion: 1,
    });
    expect(fixture.items.get(unresolved.id)).toMatchObject({
      decision: "review_required",
      publishedVersion: null,
    });
    expect(fixture.versions).toHaveLength(1);
    expect(Array.from(fixture.batches.values())[0]).toMatchObject({
      status: "review_required",
      progress: 10,
      version: 1,
    });
  });

  it("does not reject a batch when a rejected item still owns a published version", async () => {
    const corrupted = makeItem({
      id: "1".repeat(32),
      decision: "reject",
      decisionReason: "历史异常状态",
      publishedVersion: 1,
    });
    const fixture = fixtureKnowledgeEntries({
      batchStatus: "review_required",
      items: [corrupted],
      entry: makeEntry({ latestVersion: 1, publishedVersion: 1, status: "published", version: 2 }),
      versions: [makeVersion(1)],
    });

    await expect(publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never))
      .rejects.toMatchObject({ code: "version_conflict" });
    expect(fixture.items.get(corrupted.id)).toMatchObject({
      decision: "reject",
      publishedVersion: 1,
    });
    expect(Array.from(fixture.batches.values())[0]).toMatchObject({
      status: "review_required",
      progress: 10,
    });
    expect(fixture.versions).toHaveLength(1);
  });

  it("requires a reason for rejection and does not publish", async () => {
    const fixture = fixtureKnowledgeEntries({
      batchStatus: "review_required",
      items: [makeItem({ decision: "review_required" })],
    });

    await expect(decideKnowledgeBatch({
      batchId: BATCH_ID,
      actorDigest: ACTOR_DIGEST,
      commandId: "decision_reject_empty",
      decision: "reject",
      reason: "   ",
    }, fixture as never)).rejects.toMatchObject({ code: "validation_failed" });
    expect(fixture.versions).toHaveLength(0);
    expect(Array.from(fixture.batches.values())[0]?.status).toBe("review_required");
  });

  it("rejects selected items and does not publish", async () => {
    const selected = makeItem({ id: "1".repeat(32), decision: "review_required" });
    const fixture = fixtureKnowledgeEntries({ batchStatus: "review_required", items: [selected] });

    const result = await decideKnowledgeBatch({
      batchId: BATCH_ID,
      actorDigest: ACTOR_DIGEST,
      commandId: "decision_reject_1",
      decision: "reject",
      itemIds: [selected.id],
      reason: "来源证据不足",
    }, fixture as never);

    expect(result).toEqual({ batchId: BATCH_ID, entries: [], unresolvedItemIds: [] });
    expect(fixture.items.get(selected.id)).toMatchObject({ decision: "reject", decisionReason: "来源证据不足" });
    expect(Array.from(fixture.batches.values())[0]).toMatchObject({ status: "rejected", progress: 100 });
    expect(fixture.versions).toHaveLength(0);
  });

  it("rejects an invalid decision before changing the batch", async () => {
    const fixture = fixtureKnowledgeEntries({
      batchStatus: "review_required",
      items: [makeItem({ decision: "review_required" })],
    });

    await expect(decideKnowledgeBatch({
      batchId: BATCH_ID,
      actorDigest: ACTOR_DIGEST,
      commandId: "decision_invalid",
      decision: "invalid" as never,
    }, fixture as never)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.receipts).toHaveLength(0);
    expect(fixture.versions).toHaveLength(0);
    expect(Array.from(fixture.batches.values())[0]?.status).toBe("review_required");
  });

  it("serializes concurrent decisions so only the first one wins", async () => {
    const selected = makeItem({ id: "1".repeat(32), decision: "review_required" });
    const fixture = fixtureKnowledgeEntries({ batchStatus: "review_required", items: [selected] });

    const first = decideKnowledgeBatch({
      batchId: BATCH_ID,
      actorDigest: ACTOR_DIGEST,
      commandId: "decision_concurrent_approve",
      decision: "approve",
      itemIds: [selected.id],
    }, fixture as never);
    const second = decideKnowledgeBatch({
      batchId: BATCH_ID,
      actorDigest: ACTOR_DIGEST,
      commandId: "decision_concurrent_reject",
      decision: "reject",
      itemIds: [selected.id],
      reason: "并发拒绝",
    }, fixture as never);

    const [approved, rejected] = await Promise.allSettled([first, second]);

    expect(approved.status).toBe("fulfilled");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "conflict" }),
    });
    expect(fixture.versions).toHaveLength(1);
    expect(fixture.receipts).toHaveLength(1);
    expect(Array.from(fixture.batches.values())[0]).toMatchObject({ status: "archiving" });
  });

  it("replays a decision receipt without publishing or rejecting twice", async () => {
    const selected = makeItem({ id: "1".repeat(32), decision: "review_required" });
    const fixture = fixtureKnowledgeEntries({ batchStatus: "review_required", items: [selected] });
    const input = {
      batchId: BATCH_ID,
      actorDigest: ACTOR_DIGEST,
      commandId: "decision_replay",
      decision: "approve" as const,
      itemIds: [selected.id],
    };

    const first = await decideKnowledgeBatch(input, fixture as never);
    const replay = await decideKnowledgeBatch(input, fixture as never);

    expect(replay).toEqual(first);
    expect(fixture.versions).toHaveLength(1);
    expect(fixture.receipts).toHaveLength(1);
  });

  it("rolls back earlier publications when a later item conflicts", async () => {
    const first = makeItem({ id: "1".repeat(32), stableKey: "rule.first" });
    const second = makeItem({ id: "2".repeat(32), ordinal: 1, stableKey: "rule.conflict" });
    const fixture = fixtureKnowledgeEntries({
      items: [first, second],
      entries: [makeEntry({
        id: knowledgeId("knowledge-entry", PROJECT_DIGEST, "rule.conflict"),
        stableKey: "rule.conflict",
        latestVersion: 1,
        publishedVersion: 1,
        status: "published",
      })],
    });

    await expect(publishKnowledgeBatch(BATCH_ID, ACTOR_DIGEST, fixture as never))
      .rejects.toMatchObject({ code: "version_conflict" });

    expect(fixture.entries).toHaveLength(1);
    expect(fixture.versions).toHaveLength(0);
    expect(fixture.items.get(first.id)).toMatchObject({ publishedVersion: null });
    expect(Array.from(fixture.batches.values())[0]).toMatchObject({ status: "policy_evaluating", progress: 10 });
  });
});

describe("knowledge entry reads", () => {
  it("does not return relations whose opposite endpoint is no longer published", async () => {
    const targetId = knowledgeId("knowledge-entry", PROJECT_DIGEST, "rule.expired");
    const sourceId = knowledgeId("knowledge-entry", PROJECT_DIGEST, "rule.source");
    const fixture = fixtureKnowledgeEntries({
      entry: makeEntry({ latestVersion: 1, publishedVersion: 1, status: "published", version: 2 }),
      entries: [
        makeEntry({ id: targetId, stableKey: "rule.expired", status: "expired", publishedVersion: null }),
        makeEntry({ id: sourceId, stableKey: "rule.source", status: "published", publishedVersion: 1 }),
      ],
    });
    fixture.relations.set("1".repeat(32), {
      id: "1".repeat(32),
      projectDigest: PROJECT_DIGEST,
      fromEntryId: ENTRY_ID,
      fromVersion: 1,
      toStableKey: "rule.expired",
      toEntryId: targetId,
      toVersion: 1,
      relationType: "constrains",
      origin: "explicit",
      confidence: 1,
      evidence: [],
      active: true,
    });
    fixture.relations.set("2".repeat(32), {
      id: "2".repeat(32),
      projectDigest: PROJECT_DIGEST,
      fromEntryId: sourceId,
      fromVersion: 1,
      toStableKey: STABLE_KEY,
      toEntryId: ENTRY_ID,
      toVersion: 1,
      relationType: "depends_on",
      origin: "explicit",
      confidence: 1,
      evidence: [],
      active: true,
    });

    await expect(listKnowledgeNeighborhood(ENTRY_ID, fixture as never)).resolves.toEqual([
      expect.objectContaining({
        id: "2".repeat(32),
        direction: "incoming",
        relationType: "depends_on",
      }),
    ]);
  });

  it("returns the stable entry and newest-first immutable versions", async () => {
    const fixture = fixtureKnowledgeEntries({
      entry: makeEntry({ latestVersion: 2, publishedVersion: 2, status: "published", version: 3 }),
      versions: [makeVersion(1, { status: "superseded" }), makeVersion(2)],
    });

    await expect(getKnowledgeEntry(ENTRY_ID, fixture as never)).resolves.toMatchObject({
      id: ENTRY_ID,
      latestVersion: 2,
      status: "published",
    });
    await expect(listKnowledgeEntryVersions(ENTRY_ID, fixture as never)).resolves.toEqual([
      expect.objectContaining({ version: 2, status: "published" }),
      expect.objectContaining({ version: 1, status: "superseded" }),
    ]);
  });

  it("returns null for an unknown entry", async () => {
    const fixture = fixtureKnowledgeEntries();

    await expect(getKnowledgeEntry("f".repeat(32), fixture as never)).resolves.toBeNull();
  });
});
