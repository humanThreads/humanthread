export interface LoopEngineBackfillRun {
  id: string;
  taskId: string | null;
  projectId: string | null;
  engineKind: string | null;
}

export interface LoopEngineBackfillTask {
  id: string;
  projectId: string | null;
}

export interface LoopEngineBackfillAgentRun {
  id: string;
  taskId: string | null;
  loopNodeRunId: string | null;
}

export interface LoopEngineBackfillUpdate {
  id: string;
  projectId: string;
  engineKind: "legacy_bounded";
}

export type LoopEngineBackfillError =
  | { id: string; code: "missing_task_project"; taskId: string | null }
  | { id: string; code: "unexpected_engine_kind"; engineKind: string }
  | {
      id: string;
      code: "project_conflict";
      taskId: string;
      projectId: string;
      taskProjectId: string;
    }
  | {
      id: string;
      code: "graph_agent_run_has_task";
      taskId: string;
      loopNodeRunId: string;
    }
  | { id: string; code: "legacy_agent_run_missing_task" };

export interface LoopEngineBackfillPlan {
  updates: LoopEngineBackfillUpdate[];
  errors: LoopEngineBackfillError[];
}

export interface LoopEngineBackfillSummary {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
}

export function planLoopEngineBackfill(input: {
  runs: LoopEngineBackfillRun[];
  tasks: LoopEngineBackfillTask[];
  agentRuns?: LoopEngineBackfillAgentRun[];
}): LoopEngineBackfillPlan;

export function buildLoopEngineBackfillWhere(run: LoopEngineBackfillRun): {
  id: string;
  projectId: string | null;
  engineKind: string | null;
};

export function summarizeLoopEngineBackfill(input: {
  runs: LoopEngineBackfillRun[];
  tasks: LoopEngineBackfillTask[];
  agentRuns?: LoopEngineBackfillAgentRun[];
}): LoopEngineBackfillSummary;
