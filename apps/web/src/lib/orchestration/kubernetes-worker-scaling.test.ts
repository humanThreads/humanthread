import { describe, expect, it } from "vitest";
import {
  buildKubernetesTaskWorkspaceContract,
  evaluateKubernetesWorkerScaling,
  evaluateKubernetesTaskLock,
} from "./kubernetes-worker-scaling";

describe("Kubernetes 共享存储任务隔离", () => {
  it("为每个任务和分支生成稳定独立目录及排他锁", () => {
    const contract = buildKubernetesTaskWorkspaceContract({
      taskId: "task:2026:1",
      branch: "task/2026-HUMANTHR1",
    });

    expect(contract.sharedStorage).toBe(true);
    expect(contract.directory).toMatch(/^\/var\/lib\/humanthread\/tasks\/[a-f0-9]{64}$/u);
    expect(contract.lockFile).toBe(`${contract.directory}/.humanthread.lock`);
    expect(contract.branch).toBe("task/2026-HUMANTHR1");
    expect(contract.lockMode).toBe("exclusive");
    expect(buildKubernetesTaskWorkspaceContract({ taskId: "task:2026:1", branch: "task/2026-HUMANTHR1" })).toEqual(contract);
    expect(buildKubernetesTaskWorkspaceContract({ taskId: "task:2026:2", branch: "task/2026-HUMANTHR1" }).directory).not.toBe(contract.directory);
  });

  it("允许 Pod 切换，但拒绝仍由有效租约持有的目录锁", () => {
    expect(evaluateKubernetesTaskLock({ lockOwnerInstanceId: null, requesterInstanceId: "pod-a", leaseValid: false })).toEqual({ allowed: true, reason: "unlocked" });
    expect(evaluateKubernetesTaskLock({ lockOwnerInstanceId: "pod-a", requesterInstanceId: "pod-b", leaseValid: false })).toEqual({ allowed: true, reason: "expired" });
    expect(evaluateKubernetesTaskLock({ lockOwnerInstanceId: "pod-a", requesterInstanceId: "pod-b", leaseValid: true })).toEqual({ allowed: false, reason: "held_by_active_worker" });
    expect(evaluateKubernetesTaskLock({ lockOwnerInstanceId: "pod-a", requesterInstanceId: "pod-a", leaseValid: true })).toEqual({ allowed: true, reason: "reentrant" });
  });
});

describe("Kubernetes Worker 弹性扩缩容", () => {
  const base = {
    minReplicas: 2,
    maxReplicas: 6,
    currentReplicas: 2,
    idleWorkers: 0,
    pendingTasks: 1,
    now: new Date("2026-09-11T00:00:00.000Z"),
    lastScaleAt: null,
    idleSince: null,
  } as const;

  it("空闲 Worker 为 0 且有待处理任务时扩容并保留 1 个空闲副本", () => {
    expect(evaluateKubernetesWorkerScaling(base)).toMatchObject({
      action: "scale_up",
      desiredReplicas: 3,
      idleWorkersTarget: 1,
    });
  });

  it("始终不低于最小副本数", () => {
    expect(evaluateKubernetesWorkerScaling({
      ...base,
      minReplicas: 3,
      maxReplicas: 6,
      currentReplicas: 1,
      idleWorkers: 1,
      pendingTasks: 0,
    })).toMatchObject({ action: "scale_up", desiredReplicas: 3 });
  });

  it("连续空闲不足 1 分钟不缩容，达到 1 分钟后只缩容一个副本", () => {
    expect(evaluateKubernetesWorkerScaling({
      ...base,
      currentReplicas: 4,
      idleWorkers: 3,
      pendingTasks: 0,
      idleSince: new Date("2026-09-10T23:59:30.000Z"),
    })).toMatchObject({ action: "hold", desiredReplicas: 4, reason: "idle_window_not_elapsed" });
    expect(evaluateKubernetesWorkerScaling({
      ...base,
      currentReplicas: 4,
      idleWorkers: 3,
      pendingTasks: 0,
      idleSince: new Date("2026-09-10T23:58:59.000Z"),
    })).toMatchObject({ action: "scale_down", desiredReplicas: 3 });
  });

  it("扩缩容冷却期间保持当前副本，避免抖动", () => {
    expect(evaluateKubernetesWorkerScaling({
      ...base,
      currentReplicas: 3,
      idleWorkers: 0,
      pendingTasks: 1,
      lastScaleAt: new Date("2026-09-10T23:59:30.000Z"),
    })).toMatchObject({ action: "hold", desiredReplicas: 3, reason: "cooldown" });
  });
});
