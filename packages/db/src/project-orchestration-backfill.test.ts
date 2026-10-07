import { describe, expect, it } from "vitest";
import {
  planProjectOrchestrationBackfill,
  summarizeProjectOrchestrationBackfill,
} from "../../../prisma/project-orchestration-backfill-plan.mjs";

describe("project orchestration backfill", () => {
  it("creates deterministic governance records while preserving IDs", () => {
    const plan = planProjectOrchestrationBackfill({
      projects: [{ id: "project_1", status: null, version: null }],
      tasks: [{ id: "task_1", projectId: "project_1", milestoneId: null }],
      stages: [],
      milestones: [],
    });

    expect(plan.projects).toEqual([{ projectId: "project_1", status: "active", version: 1 }]);
    expect(plan.stages).toEqual([expect.objectContaining({ id: "stage:legacy:project_1", projectId: "project_1" })]);
    expect(plan.milestones).toEqual([expect.objectContaining({ id: "milestone:legacy:project_1", stageId: "stage:legacy:project_1" })]);
    expect(plan.tasks).toEqual([{ taskId: "task_1", milestoneId: "milestone:legacy:project_1" }]);
    expect(plan.errors).toEqual([]);
  });

  it("is idempotent for fully migrated projects", () => {
    const plan = planProjectOrchestrationBackfill({
      projects: [{ id: "project_1", status: "active", version: 1 }],
      tasks: [{ id: "task_1", projectId: "project_1", milestoneId: "milestone:legacy:project_1" }],
      stages: [{ id: "stage:legacy:project_1", projectId: "project_1" }],
      milestones: [{ id: "milestone:legacy:project_1", projectId: "project_1" }],
    });

    expect(summarizeProjectOrchestrationBackfill(plan)).toEqual({
      projects: 0,
      stages: 0,
      milestones: 0,
      tasks: 0,
      skipped: 4,
      errors: 0,
    });
  });
});
