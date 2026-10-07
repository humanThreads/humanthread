export type LoopExecutionTarget =
  | { type: "local_agent"; agentProfileId: string }
  | { type: "linux_worker_pool"; workerPoolId: string };

export function parseLoopExecutionTarget(value: unknown): LoopExecutionTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const target = value as Record<string, unknown>;
  if (target.type === "local_agent" && typeof target.agentProfileId === "string" && target.agentProfileId.trim()) {
    return { type: "local_agent", agentProfileId: target.agentProfileId.trim() };
  }
  if (
    target.type === "linux_worker_pool"
    && typeof target.workerPoolId === "string"
    && /^[a-f0-9]{32}$/u.test(target.workerPoolId)
  ) {
    return { type: "linux_worker_pool", workerPoolId: target.workerPoolId };
  }
  return null;
}
