export type LoopExecutionOption = {
  type: "local_agent" | "linux_worker_pool";
  id: string;
  displayName: string;
  ready: boolean;
  reason: string | null;
};

export type ProjectExecutionBindingInput = {
  allowedAgentProfileIds: unknown;
  allowedProviders: unknown;
  workerStageConfigurations: unknown;
};

export type WorkerPoolOptionInput = {
  id: string;
  displayName: string;
  status: string;
  revokedAt: Date | null;
  maxConcurrentRuns: number;
  sessions: Array<{
    requestedConcurrency: number;
    lastSeenAt: Date | null;
    linuxRuns: Array<{ id: string }>;
  }>;
};

export type AgentProfileOptionInput = {
  id: string;
  name: string;
  provider: string;
};

export type ProjectExecutionOptions = {
  options: LoopExecutionOption[];
  defaultTarget: LoopExecutionOption | null;
};

export function buildProjectExecutionOptions(input: {
  binding: ProjectExecutionBindingInput | null;
  workerPool: WorkerPoolOptionInput | null;
  agentProfiles: AgentProfileOptionInput[];
  now?: Date;
}): ProjectExecutionOptions {
  if (!input.binding) return { options: [], defaultTarget: null };
  const now = input.now ?? new Date();
  const allowedProfiles = Array.isArray(input.binding.allowedAgentProfileIds)
    ? input.binding.allowedAgentProfileIds.filter((id): id is string => typeof id === "string")
    : [];
  const allowedProviders = new Set(Array.isArray(input.binding.allowedProviders)
    ? input.binding.allowedProviders.filter((provider): provider is string => typeof provider === "string")
    : []);
  const options: LoopExecutionOption[] = input.agentProfiles
    .filter((profile) => allowedProfiles.includes(profile.id) && (profile.provider === "codex" || profile.provider === "claude"))
    .map((profile) => ({
      type: "local_agent",
      id: profile.id,
      displayName: `本地 Agent · ${profile.name}`,
      ready: allowedProviders.has(profile.provider),
      reason: allowedProviders.has(profile.provider) ? null : "此 Loop 不允许该 Provider",
    }));
  const hasStages = input.binding.workerStageConfigurations
    && typeof input.binding.workerStageConfigurations === "object"
    && !Array.isArray(input.binding.workerStageConfigurations)
    && Object.keys(input.binding.workerStageConfigurations).length > 0;
  if (input.workerPool) {
    const pool = input.workerPool;
    const active = pool.status === "active" && pool.revokedAt === null;
    const freshSessions = pool.sessions.filter((session) => (
      session.lastSeenAt !== null && session.lastSeenAt.getTime() >= now.getTime() - 60_000
    ));
    const capacity = Math.min(
      pool.maxConcurrentRuns,
      freshSessions.reduce((total, session) => total + session.requestedConcurrency, 0),
    );
    const currentRuns = freshSessions.reduce((total, session) => total + session.linuxRuns.length, 0);
    options.push({
      type: "linux_worker_pool",
      id: pool.id,
      displayName: `Linux Worker · ${pool.displayName}`,
      ready: Boolean(active && hasStages && allowedProfiles.length > 0 && capacity > currentRuns),
      reason: !active
        ? "Worker Pool 不可用"
        : !hasStages
          ? "任务 Loop 尚未配置 Worker 节点模型"
          : allowedProfiles.length === 0
            ? "任务 Loop 未配置 Agent Profile"
            : !(capacity > currentRuns) ? "Linux Worker 暂无可用容量" : null,
    });
  }
  return {
    options,
    defaultTarget: options.find((option) => option.ready && option.type === "linux_worker_pool")
      ?? options.find((option) => option.ready)
      ?? null,
  };
}
