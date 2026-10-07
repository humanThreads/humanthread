import { describe, expect, it } from "vitest";
import {
  buildLoopEngineBackfillWhere,
  planLoopEngineBackfill,
  summarizeLoopEngineBackfill,
} from "./loop-engine-backfill-plan.mjs";

describe("planLoopEngineBackfill", () => {
  it("maps legacy LoopRuns to their Task project without graph identifiers", () => {
    expect(planLoopEngineBackfill({
      runs: [{ id: "loop_1", taskId: "task_1", projectId: null, engineKind: null }],
      tasks: [{ id: "task_1", projectId: "project_1" }],
    })).toEqual({
      updates: [{ id: "loop_1", projectId: "project_1", engineKind: "legacy_bounded" }],
      errors: [],
    });
  });

  it("skips rows that already have the expected compatibility values", () => {
    expect(planLoopEngineBackfill({
      runs: [{
        id: "loop_1",
        taskId: "task_1",
        projectId: "project_1",
        engineKind: "legacy_bounded",
      }],
      tasks: [{ id: "task_1", projectId: "project_1" }],
    })).toEqual({ updates: [], errors: [] });
  });

  it("preserves graph_v1 rows instead of interpreting them as legacy runs", () => {
    expect(planLoopEngineBackfill({
      runs: [{
        id: "loop_graph",
        taskId: "task_1",
        projectId: "project_1",
        engineKind: "graph_v1",
      }],
      tasks: [{ id: "task_1", projectId: "project_1" }],
    })).toEqual({ updates: [], errors: [] });
  });

  it("reports unexpected engine kinds instead of coercing them", () => {
    expect(planLoopEngineBackfill({
      runs: [{
        id: "loop_unknown",
        taskId: "task_1",
        projectId: null,
        engineKind: "future_engine",
      }],
      tasks: [{ id: "task_1", projectId: "project_1" }],
    })).toEqual({
      updates: [],
      errors: [{
        id: "loop_unknown",
        code: "unexpected_engine_kind",
        engineKind: "future_engine",
      }],
    });
  });

  it("uses the partially staged row snapshot as its optimistic update predicate", () => {
    const run = {
      id: "loop_partial",
      taskId: "task_1",
      projectId: "project_1",
      engineKind: null,
    };

    expect(planLoopEngineBackfill({
      runs: [run],
      tasks: [{ id: "task_1", projectId: "project_1" }],
    })).toEqual({
      updates: [{ id: "loop_partial", projectId: "project_1", engineKind: "legacy_bounded" }],
      errors: [],
    });
    expect(buildLoopEngineBackfillWhere(run)).toEqual({
      id: "loop_partial",
      projectId: "project_1",
      engineKind: null,
    });
  });

  it("plans zero updates after applying the first plan", () => {
    const input = {
      runs: [
        { id: "loop_1", taskId: "task_1", projectId: null, engineKind: "legacy_bounded" },
        { id: "loop_2", taskId: "task_2", projectId: "project_2", engineKind: null },
      ],
      tasks: [
        { id: "task_1", projectId: "project_1" },
        { id: "task_2", projectId: "project_2" },
      ],
    };
    const first = planLoopEngineBackfill(input);
    const updatesById = new Map(first.updates.map((update) => [update.id, update]));
    const migratedRuns = input.runs.map((run) => ({ ...run, ...updatesById.get(run.id) }));

    expect(first.updates).toHaveLength(2);
    expect(planLoopEngineBackfill({ ...input, runs: migratedRuns })).toEqual({
      updates: [],
      errors: [],
    });
  });

  it("rejects graph AgentRuns carrying legacy Task identity", () => {
    expect(planLoopEngineBackfill({
      runs: [],
      tasks: [],
      agentRuns: [
        { id: "agent_legacy", taskId: "task_1", loopNodeRunId: null },
        { id: "agent_graph", taskId: null, loopNodeRunId: "node_1" },
        { id: "agent_mixed", taskId: "task_1", loopNodeRunId: "node_2" },
        { id: "agent_unscoped", taskId: null, loopNodeRunId: null },
      ],
    })).toEqual({
      updates: [],
      errors: [{
        id: "agent_mixed",
        code: "graph_agent_run_has_task",
        taskId: "task_1",
        loopNodeRunId: "node_2",
      }, {
        id: "agent_unscoped",
        code: "legacy_agent_run_missing_task",
      }],
    });
  });

  it("reports legacy rows whose Task has no project", () => {
    expect(planLoopEngineBackfill({
      runs: [{ id: "loop_1", taskId: "task_1", projectId: null, engineKind: null }],
      tasks: [{ id: "task_1", projectId: null }],
    })).toEqual({
      updates: [],
      errors: [{ id: "loop_1", code: "missing_task_project", taskId: "task_1" }],
    });
  });

  it("reports conflicting project assignments without overwriting them", () => {
    expect(planLoopEngineBackfill({
      runs: [{
        id: "loop_1",
        taskId: "task_1",
        projectId: "project_2",
        engineKind: "legacy_bounded",
      }],
      tasks: [{ id: "task_1", projectId: "project_1" }],
    })).toEqual({
      updates: [],
      errors: [{
        id: "loop_1",
        code: "project_conflict",
        taskId: "task_1",
        projectId: "project_2",
        taskProjectId: "project_1",
      }],
    });
  });

  it("summarizes dry-run counts", () => {
    expect(summarizeLoopEngineBackfill({
      runs: [
        { id: "loop_1", taskId: "task_1", projectId: null, engineKind: null },
        { id: "loop_2", taskId: "task_2", projectId: "project_2", engineKind: "legacy_bounded" },
        { id: "loop_3", taskId: "task_3", projectId: null, engineKind: null },
      ],
      tasks: [
        { id: "task_1", projectId: "project_1" },
        { id: "task_2", projectId: "project_2" },
        { id: "task_3", projectId: null },
      ],
    })).toEqual({ processed: 3, updated: 1, skipped: 1, errors: 1 });
  });

  it("does not subtract AgentRun identity errors from LoopRun skip counts", () => {
    expect(summarizeLoopEngineBackfill({
      runs: [],
      tasks: [],
      agentRuns: [{ id: "agent_mixed", taskId: "task_1", loopNodeRunId: "node_1" }],
    })).toEqual({ processed: 0, updated: 0, skipped: 0, errors: 1 });
  });
});
