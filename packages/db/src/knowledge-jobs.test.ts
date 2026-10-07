import { describe, expect, it, vi } from "vitest";

import { createKnowledgeJob, startKnowledgeJob } from "./knowledge-jobs";
import { knowledgeDigest, knowledgeId, knowledgeProjectDigest } from "./knowledge-reference";

const PROJECT_DIGEST = knowledgeProjectDigest("project_1");
const TEMPLATE_VERSION_ID = "c".repeat(32);
const NOW = new Date("2026-09-20T12:00:00.000Z");

type Row = Record<string, unknown> & { id: string };

function fixtureJobDb() {
  const projects = new Map<string, Row>([["project_1", { id: "project_1" }]]);
  const templateVersions = new Map<string, Row>([[
    TEMPLATE_VERSION_ID,
    {
      id: TEMPLATE_VERSION_ID,
      version: 3,
      contentHash: "a".repeat(32),
      publishedAt: NOW,
      template: {
        id: "d".repeat(32),
        projectDigest: PROJECT_DIGEST,
        mode: "task_completion",
        status: "published",
      },
    },
  ]]);
  const policies = new Map<string, Row>([[
    PROJECT_DIGEST,
    { id: "e".repeat(32), projectDigest: PROJECT_DIGEST, version: 7, sourceTypeOverrides: [] },
  ]]);
  const jobs = new Map<string, Row>();
  const queryRaw = vi.fn(async (query: readonly string[], ...values: unknown[]) => {
    const sql = query.join("?");
    if (sql.includes("KnowledgeJob") && sql.includes("FOR UPDATE")) {
      const job = jobs.get(String(values[0] ?? ""));
      return job ? [job] : [];
    }
    return [];
  });

  const knowledgeJob = {
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (typeof where.id === "string") return jobs.get(where.id) ?? null;
      if (typeof where.dedupeKey === "string") {
        return Array.from(jobs.values()).find((job) => job.dedupeKey === where.dedupeKey) ?? null;
      }
      return null;
    }),
    createMany: vi.fn(async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates: boolean }) => {
      let count = 0;
      for (const row of data) {
        if (jobs.has(row.id)) {
          if (skipDuplicates) continue;
          throw Object.assign(new Error("duplicate job"), { code: "P2002" });
        }
        jobs.set(row.id, row);
        count += 1;
      }
      return { count };
    }),
  };

  const stores = {
    $queryRaw: queryRaw,
    project: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => projects.get(where.id) ?? null),
    },
    knowledgeTemplateVersion: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => templateVersions.get(where.id) ?? null),
    },
    knowledgePolicy: {
      findUnique: vi.fn(async ({ where }: { where: { projectDigest: string } }) => policies.get(where.projectDigest) ?? null),
    },
    knowledgeJob,
  };

  return {
    projects,
    templateVersions,
    policies,
    jobs,
    queryRaw,
    db: {
      ...stores,
      $transaction: async <T>(callback: (tx: typeof stores) => Promise<T>) => callback(stores),
    },
  };
}

function jobInput() {
  return {
    projectId: "project_1",
    taskId: "task_1",
    mode: "task_completion",
    templateVersionId: TEMPLATE_VERSION_ID,
    dedupeIdentity: "task-completion:task_1",
    sourceSnapshot: {
      observedAt: NOW.toISOString(),
      sourceRefs: [{ kind: "task", ref: "task:task_1" }],
    },
  };
}

describe("knowledge job creation", () => {
  it("resolves an insert race with a full-row current read", async () => {
    const fixture = fixtureJobDb();
    const input = jobInput();
    const id = knowledgeId("knowledge-job", PROJECT_DIGEST, "task_completion", input.dedupeIdentity);
    fixture.db.knowledgeJob.createMany.mockImplementationOnce(async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates: boolean }) => {
      if (!skipDuplicates) throw new Error("expected skipDuplicates");
      fixture.jobs.set(id, data[0]!);
      return { count: 0 };
    });

    await expect(createKnowledgeJob(input, { ...fixture as never, now: () => NOW })).resolves.toMatchObject({ id });

    expect(fixture.queryRaw).toHaveBeenCalledOnce();
    expect(fixture.queryRaw.mock.calls[0]?.[0].join("?")).toContain("FOR UPDATE");
  });

  it("creates a deterministic idempotent Job from locked template and policy state", async () => {
    const fixture = fixtureJobDb();
    const input = jobInput();

    const first = await createKnowledgeJob(input, { ...fixture as never, now: () => NOW });
    const duplicate = await createKnowledgeJob(input, { ...fixture as never, now: () => NOW });

    expect(duplicate).toEqual(first);
    expect(first).toMatchObject({
      projectDigest: PROJECT_DIGEST,
      taskId: knowledgeId("knowledge-task", "task_1"),
      mode: "task_completion",
      status: "queued",
      templateVersionId: TEMPLATE_VERSION_ID,
      policyVersion: 7,
      sourceSnapshot: input.sourceSnapshot,
    });
    expect(first.id).toBe(knowledgeId(
      "knowledge-job",
      PROJECT_DIGEST,
      "task_completion",
      "task-completion:task_1",
    ));
    expect(first.dedupeKey).toBe(`knowledge-job:${first.id}`);
    expect(first.sourceSnapshotDigest).toMatch(/^[a-f0-9]{32}$/u);
    expect(fixture.db.knowledgeJob.createMany).toHaveBeenCalledOnce();
    expect(fixture.jobs).toHaveLength(1);
  });

  it("rejects reuse of a deterministic Job identity with changed immutable input", async () => {
    const fixture = fixtureJobDb();
    const input = jobInput();
    await createKnowledgeJob(input, { ...fixture as never, now: () => NOW });

    await expect(createKnowledgeJob({
      ...input,
      sourceSnapshot: {
        observedAt: NOW.toISOString(),
        sourceRefs: [{ kind: "task", ref: "task:changed" }],
      },
    }, { ...fixture as never, now: () => NOW })).rejects.toMatchObject({ code: "version_conflict" });
    expect(fixture.jobs).toHaveLength(1);
  });

  it("rejects template project, mode, status, and digest mismatches", async () => {
    const cases = [
      { template: { projectDigest: knowledgeProjectDigest("project_2") } },
      { template: { mode: "manual_update" } },
      { template: { status: "draft" } },
    ];

    for (const change of cases) {
      const fixture = fixtureJobDb();
      const current = fixture.templateVersions.get(TEMPLATE_VERSION_ID)!;
      fixture.templateVersions.set(TEMPLATE_VERSION_ID, {
        ...current,
        template: { ...(current.template as Row), ...change.template },
      });

      await expect(createKnowledgeJob(jobInput(), { ...fixture as never, now: () => NOW }))
        .rejects.toMatchObject({ code: "version_conflict" });
      expect(fixture.jobs).toHaveLength(0);
    }
  });

  it("rejects malformed source snapshots before creating a Job", async () => {
    const fixture = fixtureJobDb();

    await expect(createKnowledgeJob({
      ...jobInput(),
      sourceSnapshot: { observedAt: "not-a-date", sourceRefs: [] },
    }, { ...fixture as never, now: () => NOW })).rejects.toMatchObject({ code: "validation_failed" });
    expect(fixture.jobs).toHaveLength(0);
  });
});

describe("knowledge job start", () => {
  function fixtureStartDb(status: string) {
    const digest = knowledgeProjectDigest("project_1");
    const row = {
      id: "a".repeat(32),
      projectDigest: digest,
      taskId: "b".repeat(32),
      mode: "project_initialization",
      status,
      templateVersionId: "c".repeat(32),
      policyVersion: 1,
      dedupeKey: `knowledge-job:${"a".repeat(32)}`,
      sourceSnapshot: {},
      sourceSnapshotDigest: "d".repeat(32),
      failureCode: null,
      failureMessage: null,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const jobs = new Map([[row.id, row]]);
    const updateMany = vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const current = jobs.get(String(where.id));
      if (!current || current.status !== where.status || current.version !== where.version) return { count: 0 };
      const next = { ...current, ...data } as Record<string, unknown>;
      if (data.version && typeof data.version === "object" && "increment" in (data.version as object)) {
        next.version = current.version + 1;
      }
      jobs.set(current.id, next as never);
      return { count: 1 };
    });
    return { jobs, updateMany };
  }

  it("moves a queued Job to worker_running once", async () => {
    const fixture = fixtureStartDb("queued");
    const started = await startKnowledgeJob({
      jobId: "a".repeat(32),
      projectId: "project_1",
    }, {
      db: {
        knowledgeJob: {
          findUnique: vi.fn(async () => fixture.jobs.get("a".repeat(32)) ?? null),
          updateMany: fixture.updateMany,
        },
      },
      now: () => NOW,
    });

    expect(started.status).toBe("worker_running");
    expect(fixture.updateMany).toHaveBeenCalledOnce();
  });

  it("is idempotent for a Job already running or awaiting submission", async () => {
    for (const status of ["worker_running", "awaiting_submission"]) {
      const fixture = fixtureStartDb(status);
      const started = await startKnowledgeJob({
        jobId: "a".repeat(32),
        projectId: "project_1",
      }, {
        db: {
          knowledgeJob: {
            findUnique: vi.fn(async () => fixture.jobs.get("a".repeat(32)) ?? null),
            updateMany: fixture.updateMany,
          },
        },
        now: () => NOW,
      });

      expect(started.status).toBe(status);
      expect(fixture.updateMany).not.toHaveBeenCalled();
    }
  });

  it("rejects a Job that belongs to another project", async () => {
    const otherProject = fixtureStartDb("queued");
    await expect(startKnowledgeJob({
      jobId: "a".repeat(32),
      projectId: "project_2",
    }, {
      db: {
        knowledgeJob: {
          findUnique: vi.fn(async () => otherProject.jobs.get("a".repeat(32)) ?? null),
          updateMany: otherProject.updateMany,
        },
      },
      now: () => NOW,
    })).rejects.toMatchObject({ code: "not_found" });
  });

  it("is idempotent after a Job has moved into ingestion or searchable state", async () => {
    for (const status of ["ingesting", "searchable"]) {
      const fixture = fixtureStartDb(status);
      const started = await startKnowledgeJob({
        jobId: "a".repeat(32),
        projectId: "project_1",
      }, {
        db: {
          knowledgeJob: {
            findUnique: vi.fn(async () => fixture.jobs.get("a".repeat(32)) ?? null),
            updateMany: fixture.updateMany,
          },
        },
        now: () => NOW,
      });

      expect(started.status).toBe(status);
      expect(fixture.updateMany).not.toHaveBeenCalled();
    }
  });
});
