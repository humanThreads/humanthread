import { createHash } from "node:crypto";

export type WorkerValidationAssignment = {
  id: string;
  kind: "worker_validation";
  taskId: null;
  loopRunId: null;
  reclaimed: boolean;
};

export type WorkerValidationSession = {
  id: string;
  projectId: string;
  poolId: string;
  environmentConfigurationVersion: number;
  assignment: WorkerValidationAssignment;
};

export type WorkerValidationObservation = {
  registered: boolean;
  lastSeenAt: Date | null;
  capabilities: Record<string, unknown>;
  environmentConfigurationVersion: number | null;
  claim: {
    accepted: boolean;
    assignmentId: string;
    sideEffect: boolean;
  } | null;
  validatorConfigured: boolean;
  claimPending?: boolean;
};

export type WorkerValidationCheckStatus = "passed" | "pending" | "failed" | "executor_not_configured" | "stale_configuration";

export type WorkerValidationReport = {
  sessionId: string;
  projectId: string;
  poolId: string;
  environmentConfigurationVersion: number;
  status: "passed" | "pending" | "failed" | "executor_not_configured" | "stale_configuration";
  reason: string | null;
  checks: Array<{ key: "registration" | "heartbeat" | "capabilities" | "configuration_version" | "claim"; status: WorkerValidationCheckStatus; summary: string }>;
};

export function createWorkerValidationSession(input: {
  projectId: string;
  poolId: string;
  environmentConfigurationVersion: number;
  selectedPoolAuthorized: boolean;
}): WorkerValidationSession {
  if (!input.selectedPoolAuthorized) throw new Error("Worker Pool 未获项目授权");
  if (!Number.isInteger(input.environmentConfigurationVersion) || input.environmentConfigurationVersion < 1) {
    throw new Error("项目环境配置版本无效");
  }
  const id = digest(["worker-validation-session", input.projectId, input.poolId, String(input.environmentConfigurationVersion)]);
  return {
    id,
    projectId: input.projectId,
    poolId: input.poolId,
    environmentConfigurationVersion: input.environmentConfigurationVersion,
    assignment: {
      id: digest(["worker-validation-assignment", id]),
      kind: "worker_validation",
      taskId: null,
      loopRunId: null,
      reclaimed: false,
    },
  };
}

export function evaluateWorkerValidation(input: {
  session: WorkerValidationSession;
  currentEnvironmentConfigurationVersion: number;
  now: Date;
  observation: WorkerValidationObservation;
  heartbeatTimeoutMs: number;
}): WorkerValidationReport {
  const { session, observation } = input;
  const checks: WorkerValidationReport["checks"] = [];
  const stale = input.currentEnvironmentConfigurationVersion !== session.environmentConfigurationVersion;

  checks.push({
    key: "registration",
    status: observation.registered ? "passed" : "failed",
    summary: observation.registered ? "Worker 已注册" : "Worker 未注册",
  });

  const heartbeatFresh = observation.lastSeenAt !== null
    && input.now.getTime() - observation.lastSeenAt.getTime() <= input.heartbeatTimeoutMs;
  checks.push({
    key: "heartbeat",
    status: heartbeatFresh ? "passed" : "failed",
    summary: heartbeatFresh ? "Worker 心跳在有效窗口内" : "Worker 心跳超时或缺失",
  });

  const capabilityKeys = Object.keys(observation.capabilities).sort();
  checks.push({
    key: "capabilities",
    status: capabilityKeys.length > 0 ? "passed" : "failed",
    summary: capabilityKeys.length > 0 ? `已报告 ${capabilityKeys.length} 项能力` : "Worker 未报告能力",
  });

  const configurationMatches = observation.environmentConfigurationVersion === session.environmentConfigurationVersion;
  checks.push({
    key: "configuration_version",
    status: stale || !configurationMatches ? "stale_configuration" : "passed",
    summary: stale || !configurationMatches ? "Worker 环境配置版本与锁定版本不一致" : "Worker 环境配置版本匹配",
  });

  const claimStatus: WorkerValidationCheckStatus = !observation.validatorConfigured
    ? "executor_not_configured"
    : observation.claim?.accepted === true
      && observation.claim.assignmentId === session.assignment.id
      && observation.claim.sideEffect === false
      ? "passed"
      : observation.claimPending
        ? "pending"
        : "failed";
  checks.push({
    key: "claim",
    status: claimStatus,
    summary: claimStatus === "passed"
      ? "校验 Assignment claim 已确认无副作用"
      : claimStatus === "executor_not_configured"
        ? "无副作用 claim 验证器未配置"
        : claimStatus === "pending"
          ? "等待 Worker 确认无副作用 claim"
          : "校验 Assignment claim 未通过或存在副作用风险",
  });

  const status = checks.some((check) => check.status === "failed")
    ? "failed"
    : stale
      ? "stale_configuration"
      : claimStatus === "pending"
        ? "pending"
        : claimStatus === "executor_not_configured"
          ? "executor_not_configured"
          : checks.every((check) => check.status === "passed")
            ? "passed"
            : "failed";
  const reason = status === "passed"
    ? null
    : status === "stale_configuration"
      ? "环境配置版本已变化，必须重新发起校验"
      : status === "pending"
        ? "已发起无副作用校验，正在等待 Worker 确认"
        : status === "executor_not_configured"
          ? "校验执行器未配置，不能判定 Worker 可用"
          : "至少一项 Worker 校验未通过";
  return {
    sessionId: session.id,
    projectId: session.projectId,
    poolId: session.poolId,
    environmentConfigurationVersion: session.environmentConfigurationVersion,
    status,
    reason,
    checks,
  };
}

export function reclaimWorkerValidationAssignment(session: WorkerValidationSession): WorkerValidationAssignment {
  if (session.assignment.reclaimed) throw new Error("校验 Assignment 已回收");
  return { ...session.assignment, reclaimed: true };
}

function digest(parts: readonly string[]): string {
  return createHash("md5").update(parts.join("\u0000")).digest("hex");
}
