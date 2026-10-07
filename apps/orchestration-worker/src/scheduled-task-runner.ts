import {
  projectScheduledTaskRunStatuses,
  recoverPreparingProjectScheduledTaskRuns,
  runDueProjectScheduledTasks,
  type ProjectScheduledTaskRunStatusDependencies,
  type RecoverPreparingProjectScheduledTaskRunsResult,
  type RunDueProjectScheduledTaskDependencies,
  type RunDueProjectScheduledTasksResult,
} from "@humanthread/db";

export { runDueProjectScheduledTasks } from "@humanthread/db";

export interface ScheduledTaskIterationDependencies {
  recoverPreparing?: (input: { limit: number }) => Promise<RecoverPreparingProjectScheduledTaskRunsResult>;
  projectStatuses?: (input: {
    now: Date;
    limit: number;
    dependencies: ProjectScheduledTaskRunStatusDependencies;
  }) => Promise<{ scanned: number; terminalized: number; errors: number }>;
  runDue?: (input: {
    now: Date;
    limit: number;
    dependencies?: RunDueProjectScheduledTaskDependencies;
  }) => Promise<RunDueProjectScheduledTasksResult>;
  reportProjectionError?: (error: { runId: string | null; errorCode: string }) => void;
  emitMetrics?: (metrics: ScheduledTaskIterationMetrics) => void;
}

export interface ScheduledTaskIterationMetrics {
  event: "scheduled_task_scan";
  health: ScheduledTaskHealth;
  scanned: number;
  created: number;
  deferred: number;
  blocked: number;
  failed: number;
  recovered: number;
  recoveryFailed: number;
  recoveryErrors: number;
  projectionErrors: number;
  errorCode?: string;
}

export type ScheduledTaskHealth =
  | "disabled"
  | "healthy_scan"
  | "database_error"
  | "target_resolution_failure"
  | "degraded";

const EMPTY_RECOVERY_RESULT: RecoverPreparingProjectScheduledTaskRunsResult = {
  scanned: 0,
  recovered: 0,
  failed: 0,
  errors: 0,
};

export function classifyScheduledTaskHealth(input: {
  enabled: boolean;
  topLevelErrorCode?: string;
  scheduled?: Pick<RunDueProjectScheduledTasksResult, "blocked" | "failureCodes">;
  projectionErrors?: number;
  recoveryErrors?: number;
}): ScheduledTaskHealth {
  if (!input.enabled) return "disabled";
  if (input.topLevelErrorCode) return "database_error";
  const failureCodes = input.scheduled?.failureCodes ?? {};
  if (Object.keys(failureCodes).some((code) => (
    code === "execution_target_invalid" || code === "execution_target_unavailable"
  ))) return "target_resolution_failure";
  if (
    (input.scheduled?.blocked ?? 0) > 0
    || (input.projectionErrors ?? 0) > 0
    || (input.recoveryErrors ?? 0) > 0
  ) return "degraded";
  return "healthy_scan";
}

const DEFAULT_SCHEDULED_TASK_ITERATION_DEPENDENCIES: Required<ScheduledTaskIterationDependencies> = {
  recoverPreparing: (input) => recoverPreparingProjectScheduledTaskRuns(input),
  projectStatuses: ({ now, limit, dependencies }) => projectScheduledTaskRunStatuses({
    now,
    limit,
    dependencies,
  }),
  runDue: (input) => runDueProjectScheduledTasks(input),
  reportProjectionError: (error) => {
    // Structured and code-only: never log task content or credentials.
    console.error({
      event: "scheduled_task_projection_error",
      errorCode: error.errorCode,
      runId: error.runId,
    });
  },
  emitMetrics: (metrics) => {
    console.info(metrics);
  },
};

function emptyScheduledResult(): RunDueProjectScheduledTasksResult {
  return { scanned: 0, created: 0, deferred: 0, blocked: 0, failed: 0, failureCodes: {} };
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code);
    if (/^[A-Za-z0-9_:-]{1,64}$/u.test(code)) return code;
  }
  return "database_error";
}

export async function runScheduledTaskIteration(
  now: Date,
  dependencies: ScheduledTaskIterationDependencies = {},
): Promise<{
  scheduled: RunDueProjectScheduledTasksResult;
  recovery: RecoverPreparingProjectScheduledTaskRunsResult;
  projectionErrors: number;
  health: ScheduledTaskHealth;
  errorCode?: string;
}> {
  const resolved = { ...DEFAULT_SCHEDULED_TASK_ITERATION_DEPENDENCIES, ...dependencies };
  try {
    const recovery = await resolved.recoverPreparing({ limit: 100 });
    const projection = await resolved.projectStatuses({
      now,
      limit: 100,
      dependencies: {
        onProjectionError: (error) => resolved.reportProjectionError(error),
      },
    });
    const due = await resolved.runDue({ now, limit: 100 });
    const scheduled = { ...emptyScheduledResult(), ...due };
    const metrics: ScheduledTaskIterationMetrics = {
      event: "scheduled_task_scan",
      health: classifyScheduledTaskHealth({
        enabled: true,
        scheduled,
        projectionErrors: projection.errors,
        recoveryErrors: recovery.errors,
      }),
      scanned: scheduled.scanned,
      created: scheduled.created,
      deferred: scheduled.deferred,
      blocked: scheduled.blocked,
      failed: scheduled.failed,
      recovered: recovery.recovered,
      recoveryFailed: recovery.failed,
      recoveryErrors: recovery.errors,
      projectionErrors: projection.errors,
    };
    resolved.emitMetrics(metrics);
    return {
      scheduled,
      recovery,
      projectionErrors: projection.errors,
      health: metrics.health,
    };
  } catch (error) {
    const errorCode = safeErrorCode(error);
    const metrics: ScheduledTaskIterationMetrics = {
      event: "scheduled_task_scan",
      health: "database_error",
      scanned: 0,
      created: 0,
      deferred: 0,
      blocked: 0,
      failed: 0,
      recovered: 0,
      recoveryFailed: 0,
      recoveryErrors: 0,
      projectionErrors: 0,
      errorCode,
    };
    resolved.emitMetrics(metrics);
    return {
      scheduled: emptyScheduledResult(),
      recovery: EMPTY_RECOVERY_RESULT,
      projectionErrors: 0,
      health: "database_error",
      errorCode,
    };
  }
}
