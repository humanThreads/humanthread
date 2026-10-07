import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { planProjectWorkerResourceBackfill } from "./project-worker-resource-backfill-plan.mjs";

const resource = { workerPoolId: "a".repeat(32), workerRepositoryUrl: "https://github.com/org/project.git", workerBranchPolicy: { allowedBranches: ["main"] } };
const project = { id: "project_1", version: 3, workerPoolId: null, workerRepositoryUrl: null, workerBranchPolicy: null };

describe("Project Worker resource backfill plan", () => {
  it("backfills only unanimous legacy Binding resources", () => {
    expect(planProjectWorkerResourceBackfill({ projects: [project], bindings: [{ projectId: project.id, ...resource }, { projectId: project.id, ...resource }] }).updates).toEqual([{ id: project.id, version: 3, ...resource }]);
  });

  it("leaves conflicting legacy resources unconfigured", () => {
    const result = planProjectWorkerResourceBackfill({ projects: [project], bindings: [{ projectId: project.id, ...resource }, { projectId: project.id, ...resource, workerRepositoryUrl: "https://github.com/org/other.git" }] });
    expect(result.updates).toEqual([]);
    expect(result.warnings).toEqual([{ id: project.id, code: "conflicting_legacy_worker_resources" }]);
  });

  it("uses Prisma's database-null sentinel for the JSON CAS condition", async () => {
    const script = await readFile(new URL("./backfill-project-worker-resources.mjs", import.meta.url), "utf8");

    expect(script).toContain("workerBranchPolicy: { equals: Prisma.DbNull }");
  });
});
