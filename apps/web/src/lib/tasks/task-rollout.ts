export interface UserTaskRollout {
  reads: boolean;
  writes: boolean;
}

type RolloutEnv = Record<string, string | undefined>;
type LegacyUsage = { reads: number; writes: number; surfaces: Record<string, number> };

const usage: LegacyUsage = { reads: 0, writes: 0, surfaces: {} };

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function getUserTaskRollout(env: RolloutEnv = process.env): UserTaskRollout {
  const reads = enabled(env.HUMANTHREAD_USER_TASKS_READS);
  const writes = enabled(env.HUMANTHREAD_USER_TASKS_WRITES);
  if (writes && !reads) throw new Error("User Task writes require reads to be enabled first");
  return { reads, writes };
}

function rolloutDisabled(code: "user_tasks_reads_disabled" | "user_tasks_writes_disabled") {
  return Object.assign(new Error(code), { code });
}

export function requireUserTaskReads(env: RolloutEnv = process.env) {
  if (!getUserTaskRollout(env).reads) throw rolloutDisabled("user_tasks_reads_disabled");
}

export function requireUserTaskWrites(env: RolloutEnv = process.env) {
  if (!getUserTaskRollout(env).writes) throw rolloutDisabled("user_tasks_writes_disabled");
}

export function recordLegacyTaskUsage(input: {
  kind: "read" | "write";
  surface: string;
  taskId?: string;
  log?: (event: string, metadata: Record<string, unknown>) => void;
}) {
  if (input.kind === "read") usage.reads += 1; else usage.writes += 1;
  usage.surfaces[input.surface] = (usage.surfaces[input.surface] ?? 0) + 1;
  (input.log ?? console.info)("user_task_legacy_usage", {
    kind: input.kind,
    surface: input.surface,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    count: usage.surfaces[input.surface],
  });
}

export function getLegacyTaskUsageSnapshot(): LegacyUsage {
  return { reads: usage.reads, writes: usage.writes, surfaces: { ...usage.surfaces } };
}

export function resetLegacyTaskUsage() {
  usage.reads = 0;
  usage.writes = 0;
  usage.surfaces = {};
}
