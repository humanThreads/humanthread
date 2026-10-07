import assert from "node:assert/strict";
import test from "node:test";
import { planProjectRoadmapOrderBackfill } from "./project-roadmap-order-backfill-plan.mjs";

test("assigns deterministic contiguous milestone order inside each stage", () => {
  const plan = planProjectRoadmapOrderBackfill({ milestones: [
    { id: "m_b", stageId: "s_1", sortOrder: 0, targetAt: new Date("2026-08-02T00:00:00.000Z") },
    { id: "m_a", stageId: "s_1", sortOrder: 0, targetAt: new Date("2026-08-01T00:00:00.000Z") },
    { id: "m_c", stageId: "s_2", sortOrder: 0, targetAt: null },
  ] });
  assert.deepEqual(plan.updates, [
    { milestoneId: "m_b", sortOrder: 1 },
  ]);
});

test("keeps an already unique contiguous order unchanged", () => {
  const plan = planProjectRoadmapOrderBackfill({ milestones: [
    { id: "m_2", stageId: "s_1", sortOrder: 1, targetAt: null },
    { id: "m_1", stageId: "s_1", sortOrder: 0, targetAt: null },
  ] });
  assert.deepEqual(plan.updates, []);
});
