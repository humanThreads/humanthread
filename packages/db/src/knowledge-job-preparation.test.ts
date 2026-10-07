import { describe, expect, it, vi } from "vitest";

import { prepareKnowledgeJobForSubmission } from "./knowledge-job-preparation";
import { knowledgeId, knowledgeProjectDigest } from "./knowledge-reference";

const PROJECT_ID = "project_1";
const JOB_ID = "d".repeat(32);
const TEMPLATE_VERSION_ID = "c".repeat(32);
const MANUAL_TEMPLATE_VERSION_ID = "b".repeat(32);

const TEMPLATE_VERSION_IDS = {
  project_initialization: TEMPLATE_VERSION_ID,
  task_completion: "1".repeat(32),
  scheduled_update: "2".repeat(32),
  manual_update: MANUAL_TEMPLATE_VERSION_ID,
};

const MANUAL_JOB_ID = knowledgeId(
  "knowledge-job",
  knowledgeProjectDigest(PROJECT_ID),
  "manual_update",
  "medical-finance-military-materials-advantages",
);

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    backfill: vi.fn(async () => ({
      projectId: PROJECT_ID,
      policyId: "a".repeat(32),
      templateId: "b".repeat(32),
      templateVersionId: TEMPLATE_VERSION_ID,
      templateVersionIds: TEMPLATE_VERSION_IDS,
      jobId: JOB_ID,
      taskId: "e".repeat(32),
      duplicate: false,
    })),
    start: vi.fn(async () => ({ id: JOB_ID, status: "worker_running" })),
    createGenerationTask: vi.fn(async (input) => ({
      jobId: MANUAL_JOB_ID,
      taskId: "6".repeat(32),
      projectDigest: "f".repeat(32),
      mode: input.mode,
      duplicate: false,
    })),
    readJob: vi.fn(async () => ({
      id: JOB_ID,
      projectDigest: "f".repeat(32),
      taskId: "e".repeat(32),
      mode: "project_initialization",
      status: "worker_running",
      templateVersionId: TEMPLATE_VERSION_ID,
      policyVersion: 1,
      sourceSnapshot: { observedAt: "2026-09-23T00:00:00.000Z", sourceRefs: [] },
      sourceSnapshotDigest: "9".repeat(32),
    })),
    readTemplateDigest: vi.fn(async () => "8".repeat(32)),
    now: vi.fn(() => new Date("2026-09-24T00:00:00.000Z")),
    ...overrides,
  };
}

describe("prepare knowledge job for submission", () => {
  it("repairs, starts the Job, and returns the jobId with its template digest", async () => {
    const deps = dependencies();
    const result = await prepareKnowledgeJobForSubmission(
      { projectId: PROJECT_ID, actorUserId: "user_1" },
      deps,
    );

    expect(result).toMatchObject({
      jobId: JOB_ID,
      templateDigest: "8".repeat(32),
      status: "worker_running",
      repaired: true,
      duplicate: false,
    });
    expect(deps.start).toHaveBeenCalledWith({ jobId: JOB_ID, projectId: PROJECT_ID });
  });

  it("reports repaired=false when the project was already initialized", async () => {
    const deps = dependencies({
      backfill: vi.fn(async () => ({
        projectId: PROJECT_ID,
        policyId: "a".repeat(32),
        templateId: "b".repeat(32),
        templateVersionId: TEMPLATE_VERSION_ID,
        templateVersionIds: TEMPLATE_VERSION_IDS,
        jobId: JOB_ID,
        taskId: "e".repeat(32),
        duplicate: true,
      })),
    });

    const result = await prepareKnowledgeJobForSubmission(
      { projectId: PROJECT_ID, actorUserId: "user_1" },
      deps,
    );

    expect(result.repaired).toBe(false);
    expect(result.duplicate).toBe(true);
  });

  it("creates a new manual-update Job for the same project knowledge base", async () => {
    let manualJobReads = 0;
    const deps = dependencies({
      readJob: vi.fn(async (jobId: string) => {
        if (jobId !== MANUAL_JOB_ID) return null;
        manualJobReads += 1;
        return manualJobReads === 1 ? null : {
          id: MANUAL_JOB_ID,
          projectDigest: "f".repeat(32),
          taskId: "6".repeat(32),
          mode: "manual_update",
          status: "worker_running",
          templateVersionId: MANUAL_TEMPLATE_VERSION_ID,
          policyVersion: 1,
          sourceSnapshot: { observedAt: "2026-09-24T00:00:00.000Z", sourceRefs: [] },
          sourceSnapshotDigest: "5".repeat(32),
        };
      }),
    });

    const result = await prepareKnowledgeJobForSubmission(
      {
        projectId: PROJECT_ID,
        actorUserId: "user_1",
        mode: "manual_update",
        dedupeIdentity: "medical-finance-military-materials-advantages",
        title: "补交领域知识",
      },
      deps,
    );

    expect(deps.createGenerationTask).toHaveBeenCalledWith(expect.objectContaining({
      projectId: PROJECT_ID,
      actorUserId: "user_1",
      mode: "manual_update",
      dedupeIdentity: "medical-finance-military-materials-advantages",
      templateVersionId: MANUAL_TEMPLATE_VERSION_ID,
      sourceSnapshot: {
        observedAt: "2026-09-24T00:00:00.000Z",
        sourceRefs: [{
          kind: "task",
          sourceType: "manual_update",
          ref: `task:${knowledgeId("knowledge-generation-task", MANUAL_JOB_ID)}`,
        }],
      },
    }));
    expect(deps.start).toHaveBeenCalledWith({ jobId: MANUAL_JOB_ID, projectId: PROJECT_ID });
    expect(result).toMatchObject({
      jobId: MANUAL_JOB_ID,
      mode: "manual_update",
      status: "worker_running",
      templateDigest: "8".repeat(32),
      duplicate: false,
    });
  });

  it("reuses an existing manual-update Job without creating a duplicate", async () => {
    const deps = dependencies({
      readJob: vi.fn(async (jobId: string) => jobId === MANUAL_JOB_ID ? {
        id: MANUAL_JOB_ID,
        projectDigest: "f".repeat(32),
        taskId: "6".repeat(32),
        mode: "manual_update",
        status: "worker_running",
        templateVersionId: MANUAL_TEMPLATE_VERSION_ID,
        policyVersion: 1,
        sourceSnapshot: { observedAt: "2026-09-24T00:00:00.000Z", sourceRefs: [] },
        sourceSnapshotDigest: "5".repeat(32),
      } : null),
    });

    const result = await prepareKnowledgeJobForSubmission(
      {
        projectId: PROJECT_ID,
        actorUserId: "user_1",
        mode: "manual_update",
        dedupeIdentity: "medical-finance-military-materials-advantages",
      },
      deps,
    );

    expect(deps.createGenerationTask).not.toHaveBeenCalled();
    expect(result).toMatchObject({ jobId: MANUAL_JOB_ID, duplicate: true });
  });

  it("requires a stable dedupe identity for follow-up Jobs", async () => {
    await expect(prepareKnowledgeJobForSubmission(
      { projectId: PROJECT_ID, actorUserId: "user_1", mode: "manual_update" },
      dependencies(),
    )).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects a custom identity for the initialization Job", async () => {
    await expect(prepareKnowledgeJobForSubmission(
      {
        projectId: PROJECT_ID,
        actorUserId: "user_1",
        mode: "project_initialization",
        dedupeIdentity: "custom-initialization",
      },
      dependencies(),
    )).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("fails when the template version is missing", async () => {
    await expect(prepareKnowledgeJobForSubmission(
      { projectId: PROJECT_ID, actorUserId: "user_1" },
      dependencies({ readTemplateDigest: vi.fn(async () => null) }),
    )).rejects.toMatchObject({ code: "not_found" });
  });
});
