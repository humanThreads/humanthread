import type { LiveSessionView } from "../../../../../packages/shared/src/index";

type LoopExecutionTarget =
  | { type: "local_agent"; agentProfileId: string }
  | { type: "linux_worker_pool"; workerPoolId: string };

function loopRunError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/**
 * Binds a Loop LiveSession to a real platform LoopRun. The execution target is
 * derived from the session target and never from user-supplied input, so a
 * Worker session cannot silently execute on a local Agent or a foreign Pool.
 */
export async function startLiveSessionLoopRun(input: {
  userId: string;
  projectId: string;
  taskId: string;
  commandId: string;
  target: LiveSessionView["target"];
}, dependencies: {
  triggerTaskLoop(input: {
    actorUserId: string;
    taskId: string;
    commandId: string;
    payload: Record<string, unknown>;
    executionTarget: LoopExecutionTarget;
  }): Promise<{ id: string }>;
  findLocalAgentProfile(input: { projectId: string }): Promise<{ id: string } | null>;
}): Promise<{ type: "loop_run"; id: string }> {
  let executionTarget: LoopExecutionTarget;
  if (input.target.type === "worker_pool") {
    executionTarget = { type: "linux_worker_pool", workerPoolId: input.target.workerPoolId };
  } else {
    const profile = await dependencies.findLocalAgentProfile({ projectId: input.projectId });
    if (!profile) {
      throw loopRunError("agent_runtime_unavailable", "No active local Agent profile is available for this project");
    }
    executionTarget = { type: "local_agent", agentProfileId: profile.id };
  }
  const run = await dependencies.triggerTaskLoop({
    actorUserId: input.userId,
    taskId: input.taskId,
    commandId: input.commandId,
    payload: {},
    executionTarget,
  });
  return { type: "loop_run", id: run.id };
}
