import { describe, expect, it, vi } from "vitest";

import { backfillProjectKnowledge } from "./project-knowledge-backfill";

const PROJECT_ID = "project_1";
const DIGEST = "a".repeat(32);

describe("project knowledge backfill", () => {
  it("initializes a stale project and creates one deterministic Job", async () => {
    const initialize = vi.fn(async () => ({
      policyId: DIGEST,
      templateId: "b".repeat(32),
      templateVersionId: "c".repeat(32),
      created: true,
    }));
    const createGenerationTask = vi.fn(async () => ({
      jobId: "d".repeat(32),
      taskId: "e".repeat(32),
      projectDigest: "f".repeat(32),
      mode: "project_initialization" as const,
      duplicate: false,
    }));

    const result = await backfillProjectKnowledge({ projectId: PROJECT_ID, actorUserId: "user_1" }, {
      initialize,
      createGenerationTask,
      loadProject: async () => ({ id: PROJECT_ID, name: "示例项目", objective: "巡检", createdAt: new Date("2026-09-20T16:07:21.446Z") }),
    });

    expect(result).toMatchObject({
      projectId: PROJECT_ID,
      jobId: "d".repeat(32),
      taskId: "e".repeat(32),
      duplicate: false,
    });
    expect(createGenerationTask).toHaveBeenCalledWith(expect.objectContaining({
      projectId: PROJECT_ID,
      mode: "project_initialization",
      dedupeIdentity: `project-initialization:${PROJECT_ID}`,
      templateVersionId: "c".repeat(32),
    }));
  });

  it("is idempotent and reports the duplicate Job on a second run", async () => {
    const dependencies = {
      initialize: vi.fn(async () => ({
        policyId: DIGEST,
        templateId: "b".repeat(32),
        templateVersionId: "c".repeat(32),
        created: false,
      })),
      createGenerationTask: vi.fn(async () => ({
        jobId: "d".repeat(32),
        taskId: "e".repeat(32),
        projectDigest: "f".repeat(32),
        mode: "project_initialization" as const,
        duplicate: true,
      })),
      loadProject: async () => ({ id: PROJECT_ID, name: "示例项目", objective: null, createdAt: new Date("2026-09-20T16:07:21.446Z") }),
    };

    await backfillProjectKnowledge({ projectId: PROJECT_ID, actorUserId: "user_1" }, dependencies);
    const second = await backfillProjectKnowledge({ projectId: PROJECT_ID, actorUserId: "user_1" }, dependencies);

    expect(second.duplicate).toBe(true);
    expect(second.jobId).toBe("d".repeat(32));
  });

  it("rejects an unknown project before writing anything", async () => {
    const initialize = vi.fn();
    await expect(backfillProjectKnowledge({ projectId: PROJECT_ID, actorUserId: "user_1" }, {
      initialize: initialize as never,
      createGenerationTask: vi.fn() as never,
      loadProject: async () => null,
    })).rejects.toMatchObject({ code: "not_found" });
    expect(initialize).not.toHaveBeenCalled();
  });

  it("reuses an existing deterministic Job without creating another generation task", async () => {
    const createGenerationTask = vi.fn();
    const result = await backfillProjectKnowledge({ projectId: PROJECT_ID, actorUserId: "user_1" }, {
      initialize: vi.fn(async () => ({
        policyId: DIGEST,
        templateId: "b".repeat(32),
        templateVersionId: "c".repeat(32),
        created: false,
      })),
      createGenerationTask,
      loadProject: async () => ({ id: PROJECT_ID, name: "示例项目", objective: null, createdAt: new Date("2026-09-20T16:07:21.446Z") }),
      loadExistingJob: async () => ({
        jobId: "d".repeat(32),
        taskId: "e".repeat(32),
        templateVersionId: "c".repeat(32),
      }),
    });

    expect(createGenerationTask).not.toHaveBeenCalled();
    expect(result).toMatchObject({ jobId: "d".repeat(32), taskId: "e".repeat(32), duplicate: true });
  });

  it("uses the project creation time as a stable source snapshot clock", async () => {
    const createGenerationTask = vi.fn(async () => ({
      jobId: "d".repeat(32),
      taskId: "e".repeat(32),
      projectDigest: "f".repeat(32),
      mode: "project_initialization" as const,
      duplicate: false,
    }));
    await backfillProjectKnowledge({ projectId: PROJECT_ID, actorUserId: "user_1" }, {
      initialize: vi.fn(async () => ({
        policyId: DIGEST,
        templateId: "b".repeat(32),
        templateVersionId: "c".repeat(32),
        created: true,
      })),
      createGenerationTask,
      loadProject: async () => ({ id: PROJECT_ID, name: "示例项目", objective: null, createdAt: new Date("2026-09-20T16:07:21.446Z") }),
      loadExistingJob: async () => null,
    });

    expect(createGenerationTask).toHaveBeenCalledWith(expect.objectContaining({
      sourceSnapshot: expect.objectContaining({ observedAt: "2026-09-20T16:07:21.446Z" }),
    }));
  });
});
