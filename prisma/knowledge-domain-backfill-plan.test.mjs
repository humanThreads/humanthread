import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { planKnowledgeDomainBackfill } from "./knowledge-domain-backfill-plan.mjs";

const DATE = new Date("2026-09-20T00:00:00Z");

function md5(...parts) {
  return createHash("md5").update(parts.join("\0")).digest("hex");
}

function publishedCandidate(overrides = {}) {
  return {
    id: "candidate_1",
    projectId: "project_1",
    title: "发布门禁",
    contentSummary: "必须全量测试",
    status: "published",
    publishedDocumentId: "doc_1",
    publishedDocumentVersion: 2,
    loopRunId: "run_1",
    confidence: 0.96,
    sourceReferences: { references: [{ loopRunId: "run_1" }] },
    createdAt: DATE,
    ...overrides,
  };
}

function publishedDocument(overrides = {}) {
  return {
    id: "doc_1",
    projectId: "project_1",
    path: "知识库/Loop/doc_1.md",
    contentMarkdown: "必须全量测试",
    version: 2,
    ...overrides,
  };
}

describe("planKnowledgeDomainBackfill", () => {
  it("maps published candidates to version-one knowledge entries", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [publishedCandidate()],
      documents: [publishedDocument()],
    });

    expect(plan.errors).toEqual([]);
    expect(plan.entries).toHaveLength(1);
    expect(plan.versions[0]).toMatchObject({
      version: 1,
      status: "published",
      publishedAt: DATE,
    });
    expect(plan.jobs).toHaveLength(1);
    expect(plan.batches[0]).toMatchObject({
      jobId: plan.jobs[0].id,
      status: "archiving",
      progress: 45,
      completedAt: null,
    });
  });

  it("fails the plan when a published candidate has no Document", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [publishedCandidate({ publishedDocumentId: "missing", publishedDocumentVersion: 1 })],
      documents: [],
    });

    expect(plan.errors).toEqual([
      expect.objectContaining({ code: "published_document_missing", candidateId: "candidate_1" }),
    ]);
  });

  it("creates one default policy for every project", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }, { id: "project_2" }],
      candidates: [],
      documents: [],
    });

    expect(plan.errors).toEqual([]);
    expect(plan.policies).toHaveLength(2);
    expect(plan.policies).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^[a-f0-9]{32}$/u),
        projectDigest: expect.stringMatching(/^[a-f0-9]{32}$/u),
        autoPublishEnabled: false,
        minimumConfidence: 0.9,
        allowedSourceTypes: [],
        allowedEntryTypes: [],
        allowAutomaticDelete: false,
        allowAutomaticExpire: false,
        allowAutomaticSupersede: false,
      }),
      expect.objectContaining({
        id: expect.stringMatching(/^[a-f0-9]{32}$/u),
        projectDigest: expect.stringMatching(/^[a-f0-9]{32}$/u),
      }),
    ]);
  });

  it("maps candidate and review-required rows to review batches", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [
        publishedCandidate({ id: "candidate_candidate", status: "candidate", publishedDocumentId: null, publishedDocumentVersion: null }),
        publishedCandidate({ id: "candidate_review", status: "review_required", publishedDocumentId: null, publishedDocumentVersion: null }),
      ],
      documents: [],
    });

    expect(plan.errors).toEqual([]);
    expect(plan.batches.map((batch) => batch.status)).toEqual(["review_required", "review_required"]);
    expect(plan.items.map((item) => item.decision)).toEqual(["review_required", "review_required"]);
    expect(plan.entries).toEqual([]);
    expect(plan.versions).toEqual([]);
  });

  it("maps rejected rows to rejected batch items without entries", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [publishedCandidate({
        status: "rejected",
        publishedDocumentId: null,
        publishedDocumentVersion: null,
        reviewReason: "与当前项目约定不一致",
      })],
      documents: [],
    });

    expect(plan.errors).toEqual([]);
    expect(plan.batches[0]).toMatchObject({ status: "rejected" });
    expect(plan.items[0]).toMatchObject({ decision: "reject", decisionReason: "与当前项目约定不一致", publishedVersion: null });
    expect(plan.entries).toEqual([]);
    expect(plan.versions).toEqual([]);
  });

  it("emits a matching deterministic Job for every backfilled Batch", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }, { id: "project_2" }],
      candidates: [
        publishedCandidate({ id: "candidate_published" }),
        publishedCandidate({
          id: "candidate_review",
          status: "review_required",
          publishedDocumentId: null,
          publishedDocumentVersion: null,
        }),
      ],
      documents: [publishedDocument()],
    });
    const jobIds = new Set(plan.jobs.map((job) => job.id));

    expect(plan.errors).toEqual([]);
    expect(plan.jobs).toHaveLength(plan.batches.length);
    expect(plan.batches.every((batch) => jobIds.has(batch.jobId))).toBe(true);
    expect(plan.jobs.every((job) => job.dedupeKey === `knowledge-job:${job.id}`)).toBe(true);
    expect(plan.jobs.every((job) => /^[a-f0-9]{32}$/u.test(job.sourceSnapshotDigest))).toBe(true);
    expect(plan.jobs.every((job) => (
      Array.isArray(job.sourceSnapshot.sourceRefs)
      && job.sourceSnapshot.sourceRefs.length > 0
      && job.sourceSnapshot.sourceRefs.every((reference) => reference.kind && reference.ref)
    ))).toBe(true);
    expect(plan.batches[0]).toMatchObject({
      jobId: plan.jobs[0].id,
      status: "archiving",
      progress: 45,
      completedAt: null,
    });
  });

  it("rejects replacement candidates that cannot produce an admissible target entry", () => {
    for (const status of ["candidate", "review_required", "rejected"]) {
      const plan = planKnowledgeDomainBackfill({
        projects: [{ id: "project_1" }],
        candidates: [
          publishedCandidate({
            id: "candidate_old",
            stableKey: "rule.release.gate.v1",
            status: "superseded",
            publishedDocumentId: null,
            publishedDocumentVersion: null,
            replacementCandidateId: "candidate_new",
          }),
          publishedCandidate({
            id: "candidate_new",
            stableKey: "rule.release.gate.v2",
            status,
            publishedDocumentId: null,
            publishedDocumentVersion: null,
          }),
        ],
        documents: [],
      });

      expect(plan.errors).toEqual([
        expect.objectContaining({
          code: "replacement_target_not_publishable",
          candidateId: "candidate_old",
          replacementCandidateId: "candidate_new",
          replacementStatus: status,
        }),
      ]);
      expect(plan.relations).toEqual([]);
    }
  });

  it("rejects a superseded replacement that has no resolvable replacement chain", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [
        publishedCandidate({
          id: "candidate_old",
          stableKey: "rule.release.gate.v1",
          status: "superseded",
          publishedDocumentId: null,
          publishedDocumentVersion: null,
          replacementCandidateId: "candidate_middle",
        }),
        publishedCandidate({
          id: "candidate_middle",
          stableKey: "rule.release.gate.v2",
          status: "superseded",
          publishedDocumentId: null,
          publishedDocumentVersion: null,
        }),
      ],
      documents: [],
    });

    expect(plan.errors).toEqual([
      expect.objectContaining({
        code: "replacement_target_not_publishable",
        candidateId: "candidate_old",
        replacementCandidateId: "candidate_middle",
        replacementStatus: "superseded",
      }),
    ]);
    expect(plan.relations).toEqual([]);
  });

  it("populates replacement target identity for an admissible target", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [
        publishedCandidate({
          id: "candidate_old",
          stableKey: "rule.release.gate.v1",
          status: "superseded",
          publishedDocumentId: null,
          publishedDocumentVersion: null,
          replacementCandidateId: "candidate_new",
        }),
        publishedCandidate({
          id: "candidate_new",
          stableKey: "rule.release.gate.v2",
        }),
      ],
      documents: [publishedDocument({ id: "doc_1" })],
    });

    expect(plan.errors).toEqual([]);
    expect(plan.relations[0]).toMatchObject({
      toEntryId: md5("knowledge-entry", md5("project", "project_1"), "rule.release.gate.v2"),
      toVersion: 1,
    });
  });

  it("fails the plan when a candidate project is missing", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [],
      candidates: [publishedCandidate()],
      documents: [publishedDocument()],
    });

    expect(plan.errors).toEqual([expect.objectContaining({ code: "project_missing", candidateId: "candidate_1", projectId: "project_1" })]);
    expect(plan.batches).toEqual([]);
  });

  it("fails the plan when published document ownership or version conflicts", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [publishedCandidate()],
      documents: [publishedDocument({ projectId: "project_2", version: 3 })],
    });

    expect(plan.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "published_document_project_mismatch", candidateId: "candidate_1" }),
      expect.objectContaining({ code: "published_document_version_mismatch", candidateId: "candidate_1", expectedVersion: 2, actualVersion: 3 }),
    ]));
    expect(plan.entries).toEqual([]);
  });

  it("uses the candidate revision when the current Document has advanced", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [publishedCandidate()],
      documents: [publishedDocument({ version: 3, contentMarkdown: "后续变更" })],
      documentRevisions: [{
        id: "revision_2",
        documentId: "doc_1",
        version: 2,
        contentMarkdown: "候选发布时的内容",
      }],
    });

    expect(plan.errors).toEqual([]);
    expect(plan.versions[0]).toMatchObject({
      bodyMarkdown: "候选发布时的内容",
      sourceRefs: {
        documentRevisionDigest: md5("knowledge-document-revision", "revision_2"),
      },
    });
  });

  it("fails duplicate stable keys before emitting entry identities", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [
        publishedCandidate({ id: "candidate_1", stableKey: "rule.release.gate" }),
        publishedCandidate({ id: "candidate_2", stableKey: "rule.release.gate", publishedDocumentId: "doc_2" }),
      ],
      documents: [
        publishedDocument(),
        publishedDocument({ id: "doc_2", path: "知识库/Loop/doc_2.md" }),
      ],
    });

    expect(plan.errors).toEqual([
      expect.objectContaining({
        code: "duplicate_stable_key",
        stableKey: "rule.release.gate",
        candidateIds: ["candidate_1", "candidate_2"],
      }),
    ]);
    expect(plan.entries).toEqual([]);
  });

  it("rejects destination titles longer than 191 characters before emitting any rows", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [publishedCandidate({ title: "标".repeat(192) })],
      documents: [publishedDocument()],
    });

    expect(plan.errors).toEqual([
      expect.objectContaining({
        code: "destination_title_too_long",
        candidateId: "candidate_1",
        field: "title",
        length: 192,
        maxLength: 191,
      }),
    ]);
    expect(plan.batches).toEqual([]);
    expect(plan.items).toEqual([]);
    expect(plan.entries).toEqual([]);
    expect(plan.versions).toEqual([]);
  });

  it("rejects destination stable keys longer than 191 characters before emitting any rows", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [publishedCandidate({ stableKey: "k".repeat(192) })],
      documents: [publishedDocument()],
    });

    expect(plan.errors).toEqual([
      expect.objectContaining({
        code: "destination_stable_key_too_long",
        candidateId: "candidate_1",
        field: "stableKey",
        length: 192,
        maxLength: 191,
      }),
    ]);
    expect(plan.batches).toEqual([]);
    expect(plan.items).toEqual([]);
    expect(plan.entries).toEqual([]);
    expect(plan.versions).toEqual([]);
  });

  it("stores only digest evidence for legacy candidate, Loop, Document, and revision identifiers", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [publishedCandidate()],
      documents: [publishedDocument()],
      documentRevisions: [{
        id: "revision_1",
        documentId: "doc_1",
        version: 2,
        contentMarkdown: "必须全量测试",
      }],
    });

    const evidence = plan.versions[0].sourceRefs;
    expect(evidence).toMatchObject({
      legacyCandidateDigest: md5("knowledge-candidate", "candidate_1"),
      loopRunDigest: md5("knowledge-loop-run", "run_1"),
      documentDigest: md5("knowledge-document", "doc_1"),
      documentRevisionDigest: md5("knowledge-document-revision", "revision_1"),
    });
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain("candidate_1");
    expect(serialized).not.toContain("run_1");
    expect(serialized).not.toContain("doc_1");
    expect(serialized).not.toContain("revision_1");
  });

  it("preserves legacy source-reference arrays without retaining raw identifiers", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [publishedCandidate({
        sourceReferences: [{ loopRunId: "run_array", nodeRunId: "node_array" }],
      })],
      documents: [publishedDocument()],
    });

    expect(plan.errors).toEqual([]);
    expect(plan.items[0].evidence).toMatchObject({
      sourceReferenceCount: 1,
      sourceReferenceDigests: [{
        loopRunDigest: md5("knowledge-loop-run", "run_array"),
        loopNodeRunDigest: md5("knowledge-loop-node-run", "node_array"),
      }],
    });
    expect(JSON.stringify(plan.items[0].evidence)).not.toContain("run_array");
    expect(JSON.stringify(plan.items[0].evidence)).not.toContain("node_array");
  });

  it("rejects malformed source-reference shapes instead of dropping provenance", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [publishedCandidate({ sourceReferences: "malformed" })],
      documents: [publishedDocument()],
    });

    expect(plan.errors).toEqual([
      expect.objectContaining({
        code: "provenance_shape_invalid",
        candidateId: "candidate_1",
      }),
    ]);
    expect(plan.batches).toEqual([]);
    expect(plan.items).toEqual([]);
    expect(plan.entries).toEqual([]);
    expect(plan.versions).toEqual([]);
  });

  it("rejects source references without a Loop Run instead of emitting empty digest records", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [publishedCandidate({
        sourceReferences: { references: [{ nodeRunId: "node_without_run" }] },
      })],
      documents: [publishedDocument()],
    });

    expect(plan.errors).toEqual([
      expect.objectContaining({
        code: "provenance_loop_run_missing",
        candidateId: "candidate_1",
        referenceIndex: 0,
      }),
    ]);
    expect(plan.batches).toEqual([]);
    expect(plan.items).toEqual([]);
  });

  it("rejects empty source references and a missing candidate Loop Run", () => {
    const emptyReferences = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [publishedCandidate({ sourceReferences: { references: [] } })],
      documents: [publishedDocument()],
    });
    expect(emptyReferences.errors).toEqual([
      expect.objectContaining({ code: "provenance_references_empty", candidateId: "candidate_1" }),
    ]);

    const missingLoopRun = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [publishedCandidate({ loopRunId: null })],
      documents: [publishedDocument()],
    });
    expect(missingLoopRun.errors).toEqual([
      expect.objectContaining({ code: "candidate_loop_run_missing", candidateId: "candidate_1" }),
    ]);
  });

  it("resolves replacementStableKey independently to a same-project candidate", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [
        publishedCandidate({
          id: "candidate_old",
          stableKey: "rule.release.gate.v1",
          status: "superseded",
          publishedDocumentId: null,
          publishedDocumentVersion: null,
          sourceReferences: {
            title: "旧发布门禁",
            replacementStableKey: "rule.release.gate.v2",
            references: [{ loopRunId: "run_1" }],
          },
        }),
        publishedCandidate({
          id: "candidate_new",
          stableKey: "rule.release.gate.v2",
          publishedDocumentId: "doc_new",
        }),
      ],
      documents: [
        publishedDocument({ id: "doc_new", path: "知识库/Loop/doc_new.md" }),
      ],
    });

    expect(plan.errors).toEqual([]);
    expect(plan.entries).toHaveLength(2);
    expect(plan.versions[0]).toMatchObject({ version: 1, status: "superseded" });
    expect(plan.relations).toEqual([
      expect.objectContaining({ relationType: "supersedes", toStableKey: "rule.release.gate.v2", origin: "explicit" }),
    ]);
  });

  it("resolves replacementCandidateId independently to a same-project candidate", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [
        publishedCandidate({
          id: "candidate_old",
          stableKey: "rule.release.gate.v1",
          status: "superseded",
          publishedDocumentId: null,
          publishedDocumentVersion: null,
          replacementCandidateId: "candidate_new",
        }),
        publishedCandidate({
          id: "candidate_new",
          stableKey: "rule.release.gate.v2",
          publishedDocumentId: "doc_new",
        }),
      ],
      documents: [
        publishedDocument({ id: "doc_new", path: "知识库/Loop/doc_new.md" }),
      ],
    });

    expect(plan.errors).toEqual([]);
    expect(plan.relations).toEqual([
      expect.objectContaining({ relationType: "supersedes", toStableKey: "rule.release.gate.v2" }),
    ]);
  });

  it("rejects contradictory replacementStableKey and replacementCandidateId values", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [
        publishedCandidate({
          id: "candidate_old",
          stableKey: "rule.release.gate.v1",
          status: "superseded",
          publishedDocumentId: null,
          publishedDocumentVersion: null,
          replacementCandidateId: "candidate_new",
          sourceReferences: {
            replacementStableKey: "rule.release.gate.v3",
            references: [{ loopRunId: "run_1" }],
          },
        }),
        publishedCandidate({
          id: "candidate_new",
          stableKey: "rule.release.gate.v2",
          status: "candidate",
          publishedDocumentId: null,
          publishedDocumentVersion: null,
        }),
      ],
      documents: [],
    });

    expect(plan.errors).toEqual([
      expect.objectContaining({
        code: "replacement_target_contradiction",
        candidateId: "candidate_old",
        replacementCandidateId: "candidate_new",
        replacementStableKey: "rule.release.gate.v3",
        candidateStableKey: "rule.release.gate.v2",
      }),
    ]);
    expect(plan.relations).toEqual([]);
  });

  it("rejects self and cross-project replacements while mapping absent evidence nonfatally", () => {
    const self = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [publishedCandidate({
        id: "candidate_old",
        stableKey: "rule.release.gate.v1",
        status: "superseded",
        publishedDocumentId: null,
        publishedDocumentVersion: null,
        replacementCandidateId: "candidate_old",
      })],
      documents: [],
    });
    expect(self.errors).toEqual([
      expect.objectContaining({ code: "replacement_self", candidateId: "candidate_old" }),
    ]);

    const crossProject = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }, { id: "project_2" }],
      candidates: [
        publishedCandidate({
          id: "candidate_old",
          stableKey: "rule.release.gate.v1",
          status: "superseded",
          publishedDocumentId: null,
          publishedDocumentVersion: null,
          replacementCandidateId: "candidate_other",
        }),
        publishedCandidate({
          id: "candidate_other",
          projectId: "project_2",
          stableKey: "rule.release.gate.v2",
          status: "candidate",
          publishedDocumentId: null,
          publishedDocumentVersion: null,
        }),
      ],
      documents: [],
    });
    expect(crossProject.errors).toEqual([
      expect.objectContaining({
        code: "replacement_project_mismatch",
        candidateId: "candidate_old",
        replacementCandidateId: "candidate_other",
        replacementProjectId: "project_2",
      }),
    ]);

    const absent = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [publishedCandidate({
        id: "candidate_old",
        stableKey: "rule.release.gate.v1",
        status: "superseded",
        publishedDocumentId: null,
        publishedDocumentVersion: null,
      })],
      documents: [],
    });
    expect(absent.errors).toEqual([]);
    expect(absent.batches).toEqual([
      expect.objectContaining({ status: "rejected" }),
    ]);
    expect(absent.items).toEqual([
      expect.objectContaining({
        decision: "reject",
        decisionReason: "legacy_superseded_without_explicit_replacement",
      }),
    ]);
    expect(absent.entries).toEqual([]);
    expect(absent.versions).toEqual([]);
    expect(absent.relations).toEqual([]);
  });

  it("keeps a present-but-invalid replacement fatal", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [publishedCandidate({
        id: "candidate_old",
        stableKey: "rule.release.gate.v1",
        status: "superseded",
        publishedDocumentId: null,
        publishedDocumentVersion: null,
        replacementCandidateId: "missing_candidate",
      })],
      documents: [],
    });

    expect(plan.errors).toEqual([
      expect.objectContaining({
        code: "replacement_candidate_missing",
        candidateId: "candidate_old",
        replacementCandidateId: "missing_candidate",
      }),
    ]);
    expect(plan.batches).toEqual([]);
    expect(plan.items).toEqual([]);
    expect(plan.relations).toEqual([]);
  });

  it("rejects unresolved replacement identifiers and stable keys", () => {
    const missingCandidate = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [publishedCandidate({
        id: "candidate_old",
        stableKey: "rule.release.gate.v1",
        status: "superseded",
        publishedDocumentId: null,
        publishedDocumentVersion: null,
        replacementCandidateId: "missing_candidate",
      })],
      documents: [],
    });
    expect(missingCandidate.errors).toEqual([
      expect.objectContaining({
        code: "replacement_candidate_missing",
        candidateId: "candidate_old",
        replacementCandidateId: "missing_candidate",
      }),
    ]);

    const missingStableKey = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [publishedCandidate({
        id: "candidate_old",
        stableKey: "rule.release.gate.v1",
        status: "superseded",
        publishedDocumentId: null,
        publishedDocumentVersion: null,
        sourceReferences: {
          replacementStableKey: "rule.release.gate.missing",
          references: [{ loopRunId: "run_1" }],
        },
      })],
      documents: [],
    });
    expect(missingStableKey.errors).toEqual([
      expect.objectContaining({
        code: "replacement_stable_key_missing",
        candidateId: "candidate_old",
        replacementStableKey: "rule.release.gate.missing",
      }),
    ]);
  });

  it("uses 32-character lowercase MD5 identifiers throughout the plan", () => {
    const plan = planKnowledgeDomainBackfill({
      projects: [{ id: "project_1" }],
      candidates: [publishedCandidate()],
      documents: [publishedDocument()],
    });
    const identifiers = [
      ...plan.policies.flatMap((row) => [row.id, row.projectDigest]),
      ...plan.batches.flatMap((row) => [row.id, row.jobId, row.projectDigest, row.submissionId, row.templateDigest]),
      ...plan.jobs.flatMap((row) => [row.id, row.projectDigest, row.taskId, row.templateVersionId, row.sourceSnapshotDigest]),
      ...plan.items.map((row) => row.id),
      ...plan.entries.map((row) => row.id),
      ...plan.versions.flatMap((row) => [row.id, row.entryId, row.batchItemId, row.publishedByDigest]),
    ];

    expect(identifiers.length).toBeGreaterThan(0);
    expect(identifiers.every((identifier) => /^[a-f0-9]{32}$/u.test(identifier))).toBe(true);
  });
});
