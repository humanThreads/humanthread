const LEGACY_ENGINE_KIND = "legacy_bounded";
const AGENT_RUN_ERROR_CODES = new Set([
  "graph_agent_run_has_task",
  "legacy_agent_run_missing_task",
]);

export function buildLoopEngineBackfillWhere(run) {
  return {
    id: run.id,
    projectId: run.projectId,
    engineKind: run.engineKind,
  };
}

export function planLoopEngineBackfill({ runs, tasks, agentRuns = [] }) {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const updates = [];
  const errors = [];

  for (const run of runs) {
    if (run.engineKind === "graph_v1") continue;
    if (run.engineKind !== null && run.engineKind !== LEGACY_ENGINE_KIND) {
      errors.push({
        id: run.id,
        code: "unexpected_engine_kind",
        engineKind: run.engineKind,
      });
      continue;
    }

    const task = run.taskId ? tasksById.get(run.taskId) : null;
    if (!task?.projectId) {
      errors.push({
        id: run.id,
        code: "missing_task_project",
        taskId: run.taskId,
      });
      continue;
    }
    if (run.projectId && run.projectId !== task.projectId) {
      errors.push({
        id: run.id,
        code: "project_conflict",
        taskId: run.taskId,
        projectId: run.projectId,
        taskProjectId: task.projectId,
      });
      continue;
    }
    if (run.projectId === task.projectId && run.engineKind === LEGACY_ENGINE_KIND) continue;

    updates.push({
      id: run.id,
      projectId: task.projectId,
      engineKind: LEGACY_ENGINE_KIND,
    });
  }

  for (const agentRun of agentRuns) {
    if (agentRun.loopNodeRunId && agentRun.taskId) {
      errors.push({
        id: agentRun.id,
        code: "graph_agent_run_has_task",
        taskId: agentRun.taskId,
        loopNodeRunId: agentRun.loopNodeRunId,
      });
    } else if (!agentRun.loopNodeRunId && !agentRun.taskId) {
      errors.push({
        id: agentRun.id,
        code: "legacy_agent_run_missing_task",
      });
    }
  }

  return { updates, errors };
}

export function summarizeLoopEngineBackfill(input) {
  const plan = planLoopEngineBackfill(input);
  const loopRunErrors = plan.errors.filter((error) => !AGENT_RUN_ERROR_CODES.has(error.code));
  return {
    processed: input.runs.length,
    updated: plan.updates.length,
    skipped: input.runs.length - plan.updates.length - loopRunErrors.length,
    errors: plan.errors.length,
  };
}
