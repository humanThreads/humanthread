import { createHash } from "node:crypto";

const IDLE_WINDOW_MS = 60_000;
const SCALE_COOLDOWN_MS = 60_000;

export type KubernetesTaskWorkspaceContract = {
  sharedStorage: true;
  taskId: string;
  branch: string;
  directory: string;
  lockFile: string;
  lockMode: "exclusive";
};

export function buildKubernetesTaskWorkspaceContract(input: {
  taskId: string;
  branch: string;
}): KubernetesTaskWorkspaceContract {
  const taskId = input.taskId.trim();
  const branch = input.branch.trim();
  if (!taskId || !branch) throw new Error("Kubernetes task workspace requires taskId and branch");
  const key = createHash("sha256").update(taskId).update("\u0000").update(branch).digest("hex");
  const directory = `/var/lib/humanthread/tasks/${key}`;
  return { sharedStorage: true, taskId, branch, directory, lockFile: `${directory}/.humanthread.lock`, lockMode: "exclusive" };
}
export type KubernetesTaskLockInput = {
  lockOwnerInstanceId: string | null;
  requesterInstanceId: string;
  leaseValid: boolean;
};

export function evaluateKubernetesTaskLock(input: KubernetesTaskLockInput):
  | { allowed: true; reason: "unlocked" | "expired" | "reentrant" }
  | { allowed: false; reason: "held_by_active_worker" } {
  const requester = input.requesterInstanceId.trim();
  if (!requester) throw new Error("Kubernetes task lock requester is required");
  if (!input.lockOwnerInstanceId) return { allowed: true, reason: "unlocked" };
  if (input.lockOwnerInstanceId === requester && input.leaseValid) return { allowed: true, reason: "reentrant" };
  if (!input.leaseValid) return { allowed: true, reason: "expired" };
  return { allowed: false, reason: "held_by_active_worker" };
}

export type KubernetesWorkerScalingInput = {
  minReplicas: number;
  maxReplicas: number;
  currentReplicas: number;
  idleWorkers: number;
  pendingTasks: number;
  now: Date;
  lastScaleAt: Date | null;
  idleSince: Date | null;
};

export type KubernetesWorkerScalingDecision = {
  action: "scale_up" | "scale_down" | "hold";
  desiredReplicas: number;
  idleWorkersTarget: 1;
  reason?: "minimum_replicas" | "pending_tasks_without_idle_worker" | "idle_window_not_elapsed" | "cooldown" | "at_capacity" | "at_minimum" | "steady";
};

function assertScalingInput(input: KubernetesWorkerScalingInput): void {
  if (![input.minReplicas, input.maxReplicas, input.currentReplicas, input.idleWorkers, input.pendingTasks].every(Number.isInteger)) {
    throw new Error("Kubernetes Worker scaling values must be integers");
  }
  if (input.minReplicas < 1 || input.maxReplicas < input.minReplicas || input.currentReplicas < 0 || input.idleWorkers < 0 || input.pendingTasks < 0) {
    throw new Error("Kubernetes Worker scaling values are invalid");
  }
}

export function evaluateKubernetesWorkerScaling(input: KubernetesWorkerScalingInput): KubernetesWorkerScalingDecision {
  assertScalingInput(input);
  const current = Math.min(input.currentReplicas, input.maxReplicas);
  const cooldown = input.lastScaleAt !== null && input.now.getTime() - input.lastScaleAt.getTime() < SCALE_COOLDOWN_MS;

  if (current < input.minReplicas) {
    return {
      action: "scale_up",
      desiredReplicas: input.minReplicas,
      idleWorkersTarget: 1,
      reason: "minimum_replicas",
    };
  }

  if (input.pendingTasks > 0 && input.idleWorkers === 0) {
    if (current >= input.maxReplicas) return { action: "hold", desiredReplicas: current, idleWorkersTarget: 1, reason: "at_capacity" };
    if (cooldown) return { action: "hold", desiredReplicas: current, idleWorkersTarget: 1, reason: "cooldown" };
    return { action: "scale_up", desiredReplicas: current + 1, idleWorkersTarget: 1, reason: "pending_tasks_without_idle_worker" };
  }

  const idleWindowElapsed = input.idleSince !== null && input.now.getTime() - input.idleSince.getTime() >= IDLE_WINDOW_MS;
  if (input.pendingTasks === 0 && input.idleWorkers > 1 && current > input.minReplicas) {
    if (!idleWindowElapsed) return { action: "hold", desiredReplicas: current, idleWorkersTarget: 1, reason: "idle_window_not_elapsed" };
    if (cooldown) return { action: "hold", desiredReplicas: current, idleWorkersTarget: 1, reason: "cooldown" };
    return { action: "scale_down", desiredReplicas: current - 1, idleWorkersTarget: 1 };
  }

  return {
    action: "hold",
    desiredReplicas: current,
    idleWorkersTarget: 1,
    reason: current <= input.minReplicas ? "at_minimum" : "steady",
  };
}
