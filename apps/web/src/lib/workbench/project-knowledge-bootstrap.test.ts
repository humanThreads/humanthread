import { describe, expect, it, vi } from "vitest";

import { initializeProjectKnowledgeAfterCreate } from "./project-knowledge-bootstrap";

describe("project knowledge bootstrap", () => {
  it("initializes policy/template and creates one deterministic generation task", async () => {
    const initialize = vi.fn(async () => ({
      policyId: "a".repeat(32),
      templateId: "b".repeat(32),
      templateVersionId: "c".repeat(32),
      templateVersionIds: {
        project_initialization: "c".repeat(32),
        task_completion: "1".repeat(32),
        scheduled_update: "2".repeat(32),
        manual_update: "3".repeat(32),
      },
      created: true,
    }));
    const createGenerationTask = vi.fn(async () => ({
      jobId: "d".repeat(32),
      taskId: "e".repeat(32),
      projectDigest: "f".repeat(32),
      mode: "project_initialization" as const,
      duplicate: false,
    }));

    const result = await initializeProjectKnowledgeAfterCreate({
      projectId: "project_1",
      actorUserId: "user_1",
      projectName: "Atlas",
      objective: "Ship Atlas",
      dependencies: { initialize, createGenerationTask },
    });

    expect(initialize).toHaveBeenCalledWith({ projectId: "project_1", actorUserId: "user_1" });
    expect(createGenerationTask).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project_1",
      actorUserId: "user_1",
      mode: "project_initialization",
      dedupeIdentity: "project-initialization:project_1",
      templateVersionId: "c".repeat(32),
    }));
    expect(result).toMatchObject({ jobId: "d".repeat(32), taskId: "e".repeat(32), templateVersionId: "c".repeat(32) });
  });

  it("propagates initialization failure to the post-commit caller", async () => {
    await expect(initializeProjectKnowledgeAfterCreate({
      projectId: "project_1",
      actorUserId: "user_1",
      projectName: "Atlas",
      objective: "Ship Atlas",
      dependencies: {
        initialize: vi.fn(async () => { throw new Error("database unavailable"); }),
        createGenerationTask: vi.fn(),
      },
    })).rejects.toThrow("database unavailable");
  });
});
