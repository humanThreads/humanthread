import { describe, expect, it, vi } from "vitest";

import {
  decideKnowledgeCandidate,
  findKnowledgeCandidateConflicts,
  persistKnowledgeCandidate,
  publishKnowledgeCandidate,
} from "./knowledge-candidates";

function fixture() {
  const rows = new Map<string, Record<string, unknown>>();
  const knowledgeCandidate = {
    findUnique: vi.fn(async ({ where }: { where: Record<string, string> }) => {
      if (where.id) return rows.get(where.id) ?? null;
      return Array.from(rows.values()).find((row) => row.dedupeKey === where.dedupeKey) ?? null;
    }),
    findMany: vi.fn(async () => Array.from(rows.values())),
    createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
      const row = data[0]!;
      if (Array.from(rows.values()).some((current) => current.dedupeKey === row.dedupeKey)) return { count: 0 };
      rows.set(String(row.id), row);
      return { count: 1 };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = rows.get(String(where.id));
      if (!row) return { count: 0 };
      const allowed = Object.entries(where).every(([key, expected]) => {
        if (key === "id") return row.id === expected;
        if (expected && typeof expected === "object" && "in" in expected) {
          return (expected as { in: unknown[] }).in.includes(row[key]);
        }
        return row[key] === expected;
      });
      if (!allowed) return { count: 0 };
      rows.set(String(where.id), { ...row, ...data });
      return { count: 1 };
    }),
  };
  return {
    rows,
    db: {
      knowledgeCandidate,
      $transaction: async <T>(callback: (tx: { knowledgeCandidate: typeof knowledgeCandidate }) => Promise<T>) => callback({ knowledgeCandidate }),
    },
    createDocumentVersion: vi.fn(async () => ({ id: "doc_knowledge_1", version: 1 })),
  };
}

const input = {
  projectId: "project_1",
  title: "发布检查清单",
  safeContent: "发布前必须运行测试、类型检查和生产构建。",
  sourceRefs: [{
    loopRunId: "run_1",
    nodeRunId: "node_4",
    eventId: "event_8",
    artifactId: "artifact_2",
  }],
  confidence: 0.96,
  redactionResult: { status: "clean" },
  conflictResult: { status: "clear", conflicts: [] },
  extractorVersion: "loop-knowledge/v1",
  status: "review_required" as const,
};

describe("knowledge candidate persistence", () => {
  it("surfaces exact duplicates and same-title document conflicts", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "doc_duplicate", title: "发布检查清单", contentMarkdown: input.safeContent },
      { id: "doc_conflict", title: "发布检查清单", contentMarkdown: "旧流程允许跳过生产构建。" },
      { id: "doc_unrelated", title: "值班手册", contentMarkdown: "无关内容" },
    ]);

    const conflicts = await findKnowledgeCandidateConflicts({
      projectId: "project_1",
      title: "发布检查清单",
      safeContent: input.safeContent,
    }, { db: { document: { findMany } } } as never);

    expect(conflicts).toEqual([
      { documentId: "doc_duplicate", reason: "项目中已存在相同内容" },
      { documentId: "doc_conflict", reason: "同名项目文档包含不同内容" },
    ]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: "project_1", deletedAt: null },
    }));
  });

  it("deduplicates by project, content, and source fingerprint while preserving provenance", async () => {
    const dependencies = fixture();

    const first = await persistKnowledgeCandidate(input, dependencies as never);
    const duplicate = await persistKnowledgeCandidate(input, dependencies as never);

    expect(duplicate).toEqual(first);
    expect(first).toMatchObject({
      projectId: "project_1",
      sourceRefs: input.sourceRefs,
      status: "review_required",
    });
    expect(first.contentFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(dependencies.db.knowledgeCandidate.createMany).toHaveBeenCalledOnce();
  });

  it("publishes a reviewed candidate as one versioned project document exactly once", async () => {
    const dependencies = fixture();
    const candidate = await persistKnowledgeCandidate(input, dependencies as never);

    const first = await publishKnowledgeCandidate({
      candidateId: candidate.id,
      actorUserId: "reviewer_1",
    }, dependencies as never);
    const duplicate = await publishKnowledgeCandidate({
      candidateId: candidate.id,
      actorUserId: "reviewer_1",
    }, dependencies as never);

    expect(duplicate).toEqual(first);
    expect(first).toMatchObject({
      status: "published",
      publishedDocumentId: "doc_knowledge_1",
      publishedDocumentVersion: 1,
      reviewedByUserId: "reviewer_1",
    });
    expect(dependencies.createDocumentVersion).toHaveBeenCalledOnce();
    expect(dependencies.createDocumentVersion).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project_1",
      actorUserId: "reviewer_1",
      contentMarkdown: expect.stringContaining("Loop Run `run_1`"),
    }));
  });

  it("prevents rejection after publication has claimed the candidate", async () => {
    const dependencies = fixture();
    const candidate = await persistKnowledgeCandidate(input, dependencies as never);
    let releaseDocument!: (value: { id: string; version: number }) => void;
    dependencies.createDocumentVersion.mockImplementation(() => new Promise((resolve) => {
      releaseDocument = resolve;
    }));

    const publication = publishKnowledgeCandidate({
      candidateId: candidate.id,
      actorUserId: "reviewer_1",
    }, dependencies as never);
    await vi.waitFor(() => expect(dependencies.createDocumentVersion).toHaveBeenCalledOnce());

    await expect(decideKnowledgeCandidate({
      candidateId: candidate.id,
      actorUserId: "reviewer_2",
      decision: "reject",
      reason: "并发拒绝不应穿透发布领取",
    }, dependencies as never)).rejects.toMatchObject({ code: "version_conflict" });

    releaseDocument({ id: "doc_knowledge_1", version: 1 });
    await expect(publication).resolves.toMatchObject({ status: "published" });
  });

  it("records an explicit rejection without publishing a document", async () => {
    const dependencies = fixture();
    const candidate = await persistKnowledgeCandidate(input, dependencies as never);

    const rejected = await decideKnowledgeCandidate({
      candidateId: candidate.id,
      actorUserId: "reviewer_1",
      decision: "reject",
      reason: "与当前项目约定不一致",
    }, dependencies as never);

    expect(rejected).toMatchObject({
      status: "rejected",
      reviewedByUserId: "reviewer_1",
      reviewReason: "与当前项目约定不一致",
    });
    expect(dependencies.createDocumentVersion).not.toHaveBeenCalled();
  });
});
