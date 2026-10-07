import { describe, expect, it } from "vitest";
import { planLoopRunSnapshotBackfill } from "./backfill-loop-run-snapshots.mjs";

const graph = (nodes = [{ type: "start" }]) => ({ nodes });

describe("planLoopRunSnapshotBackfill", () => {
  it("plans only terminal graph-v1 runs without SubLoops", () => {
    expect(planLoopRunSnapshotBackfill([
      {
        id: "run_completed",
        engineKind: "graph_v1",
        status: "completed",
        loopVersionId: "version_1",
        loopVersion: { graph: graph() },
      },
      {
        id: "run_running",
        engineKind: "graph_v1",
        status: "running",
        loopVersionId: "version_2",
        loopVersion: { graph: graph() },
      },
      {
        id: "run_subloop",
        engineKind: "graph_v1",
        status: "completed",
        loopVersionId: "version_3",
        loopVersion: { graph: graph([{ type: "start" }, { type: "subloop_call" }]) },
      },
      {
        id: "run_legacy",
        engineKind: "legacy_bounded",
        status: "completed",
        loopVersionId: "version_4",
        loopVersion: { graph: graph() },
      },
    ])).toEqual([
      { id: "run_completed", rootLoopVersionId: "version_1" },
    ]);
  });

  it("recognizes every terminal LoopRun status conservatively", () => {
    const statuses = ["completed", "succeeded", "failed", "cancelled"];
    expect(planLoopRunSnapshotBackfill(statuses.map((status, index) => ({
      id: `run_${index}`,
      engineKind: "graph_v1",
      status,
      loopVersionId: `version_${index}`,
      loopVersion: { graph: graph() },
    })))).toHaveLength(statuses.length);
  });
});
