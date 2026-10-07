import type { AgentDeviceStatus } from "@humanthread/shared";

type RequiredCheck = { key: string; status: "passed" | "failed" | "pending" | "skipped" };

export type LocalAgentOnboardingInput = {
  deviceStatus: AgentDeviceStatus;
  identityMatches: boolean;
  configurationVersionMatches: boolean;
  requiredChecks: RequiredCheck[];
  heartbeat: "healthy" | "stale" | "offline";
  successfulExecutions: number;
  blockers: string[];
};

export type LocalAgentOnboardingResult = {
  canStart: boolean;
  canFinish: boolean;
  blockers: string[];
};

export function evaluateLocalAgentOnboarding(input: LocalAgentOnboardingInput): LocalAgentOnboardingResult {
  const blockers = [...input.blockers];
  if (input.deviceStatus !== "authorized") blockers.push("设备未授权");
  if (!input.identityMatches) blockers.push("设备身份不匹配");
  if (!input.configurationVersionMatches) blockers.push("环境配置版本不匹配");
  if (input.requiredChecks.some((check) => check.status !== "passed")) blockers.push("必需配置校验未通过");
  const uniqueBlockers = [...new Set(blockers)];
  const canStart = input.deviceStatus === "authorized"
    && input.identityMatches
    && input.configurationVersionMatches
    && input.requiredChecks.every((check) => check.status === "passed");
  if (input.heartbeat !== "healthy") uniqueBlockers.push("心跳异常");
  if (input.successfulExecutions < 1) uniqueBlockers.push("尚未完成成功的领取与执行链路");
  return {
    canStart,
    canFinish: canStart && input.heartbeat === "healthy" && input.successfulExecutions > 0 && input.blockers.length === 0,
    blockers: [...new Set(uniqueBlockers)],
  };
}
