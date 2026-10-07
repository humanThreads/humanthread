import { describe, expect, it } from "vitest";
import { evaluateLocalAgentOnboarding } from "./onboarding-readiness";

const ready = {
  deviceStatus: "authorized" as const,
  identityMatches: true,
  configurationVersionMatches: true,
  requiredChecks: [{ key: "model", status: "passed" as const }, { key: "git", status: "passed" as const }],
  heartbeat: "healthy" as const,
  successfulExecutions: 1,
  blockers: [],
};

describe("Local Agent 开箱状态判定", () => {
  it("所有前置条件满足且至少成功执行一次时允许启动并判定结束", () => {
    expect(evaluateLocalAgentOnboarding(ready)).toEqual({ canStart: true, canFinish: true, blockers: [] });
  });

  it("设备未授权、配置版本不匹配或必需校验失败时阻止启动", () => {
    const result = evaluateLocalAgentOnboarding({
      ...ready,
      deviceStatus: "pending",
      configurationVersionMatches: false,
      requiredChecks: [{ key: "model", status: "failed" }],
    });
    expect(result.canStart).toBe(false);
    expect(result.canFinish).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining(["设备未授权", "环境配置版本不匹配", "必需配置校验未通过"]));
  });

  it("心跳异常、未执行成功或运行阻塞时不能判定结束", () => {
    const result = evaluateLocalAgentOnboarding({ ...ready, heartbeat: "stale", successfulExecutions: 0, blockers: ["等待人工确认"] });
    expect(result.canStart).toBe(true);
    expect(result.canFinish).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining(["心跳异常", "尚未完成成功的领取与执行链路", "等待人工确认"]));
  });
});
