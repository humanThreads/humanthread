import { describe, expect, it } from "vitest";
import {
  createWorkerValidationSession,
  evaluateWorkerValidation,
  reclaimWorkerValidationAssignment,
  type WorkerValidationObservation,
} from "./worker-validation";

const baseObservation: WorkerValidationObservation = {
  registered: true,
  lastSeenAt: new Date("2026-09-11T10:00:00.000Z"),
  capabilities: { shell: true, gpu: false },
  environmentConfigurationVersion: 7,
  claim: { accepted: true, assignmentId: "validation-assignment-1", sideEffect: false },
  validatorConfigured: true,
};

describe("Worker 校验会话", () => {
  it("锁定项目环境版本并创建不能绑定业务 Loop 或任务的校验 Assignment", () => {
    const session = createWorkerValidationSession({
      projectId: "project_1",
      poolId: "a".repeat(32),
      environmentConfigurationVersion: 7,
      selectedPoolAuthorized: true,
    });

    expect(session).toMatchObject({
      projectId: "project_1",
      poolId: "a".repeat(32),
      environmentConfigurationVersion: 7,
      assignment: {
        kind: "worker_validation",
        taskId: null,
        loopRunId: null,
        reclaimed: false,
      },
    });
    expect(session).not.toHaveProperty("loopVersionId");
  });

  it("拒绝未授权 Pool，且不创建校验 Assignment", () => {
    expect(() => createWorkerValidationSession({
      projectId: "project_1",
      poolId: "a".repeat(32),
      environmentConfigurationVersion: 7,
      selectedPoolAuthorized: false,
    })).toThrow("Worker Pool 未获项目授权");
  });

  it("逐项验证注册、心跳、能力、配置版本和无副作用 claim", () => {
    const session = createWorkerValidationSession({
      projectId: "project_1",
      poolId: "a".repeat(32),
      environmentConfigurationVersion: 7,
      selectedPoolAuthorized: true,
    });
    const report = evaluateWorkerValidation({
      session,
      currentEnvironmentConfigurationVersion: 7,
      now: new Date("2026-09-11T10:00:30.000Z"),
      observation: { ...baseObservation, claim: { ...baseObservation.claim!, assignmentId: session.assignment.id } },
      heartbeatTimeoutMs: 60_000,
    });

    expect(report.status).toBe("passed");
    expect(report.checks.map((check) => check.key)).toEqual([
      "registration", "heartbeat", "capabilities", "configuration_version", "claim",
    ]);
    expect(report.sessionId).toBe(session.id);
    expect(report).not.toHaveProperty("loopVersionId");
  });

  it("配置版本在校验期间变化时使报告失效，且校验契约不依赖 Loop version", () => {
    const session = createWorkerValidationSession({
      projectId: "project_1",
      poolId: "a".repeat(32),
      environmentConfigurationVersion: 7,
      selectedPoolAuthorized: true,
    });
    const report = evaluateWorkerValidation({
      session,
      currentEnvironmentConfigurationVersion: 8,
      now: new Date("2026-09-11T10:00:30.000Z"),
      observation: { ...baseObservation, claim: { ...baseObservation.claim!, assignmentId: session.assignment.id } },
      heartbeatTimeoutMs: 60_000,
    });

    expect(report.status).toBe("stale_configuration");
    expect(report.reason).toContain("环境配置版本已变化");
    expect(report).not.toHaveProperty("loopVersionId");
  });

  it("缺少验证器时标记 executor_not_configured，不伪报成功", () => {
    const session = createWorkerValidationSession({
      projectId: "project_1",
      poolId: "a".repeat(32),
      environmentConfigurationVersion: 7,
      selectedPoolAuthorized: true,
    });
    const report = evaluateWorkerValidation({
      session,
      currentEnvironmentConfigurationVersion: 7,
      now: new Date("2026-09-11T10:00:30.000Z"),
      observation: { ...baseObservation, validatorConfigured: false, claim: null },
      heartbeatTimeoutMs: 60_000,
    });

    expect(report.status).toBe("executor_not_configured");
    expect(report.checks.find((check) => check.key === "claim")).toMatchObject({ status: "executor_not_configured" });
  });

  it("等待 Worker 回执时标记 pending，不误报为 claim 失败或副作用风险", () => {
    const session = createWorkerValidationSession({
      projectId: "project_1",
      poolId: "a".repeat(32),
      environmentConfigurationVersion: 7,
      selectedPoolAuthorized: true,
    });
    const report = evaluateWorkerValidation({
      session,
      currentEnvironmentConfigurationVersion: 7,
      now: new Date("2026-09-11T10:00:30.000Z"),
      observation: { ...baseObservation, claim: null, claimPending: true },
      heartbeatTimeoutMs: 60_000,
    });

    expect(report.status).toBe("pending");
    expect(report.checks.find((check) => check.key === "claim")).toMatchObject({
      status: "pending",
      summary: "等待 Worker 确认无副作用 claim",
    });
  });

  it("Worker 未注册时不被缺失的 claim 执行器掩盖", () => {
    const session = createWorkerValidationSession({
      projectId: "project_1",
      poolId: "a".repeat(32),
      environmentConfigurationVersion: 7,
      selectedPoolAuthorized: true,
    });
    const report = evaluateWorkerValidation({
      session,
      currentEnvironmentConfigurationVersion: 7,
      now: new Date("2026-09-17T10:00:30.000Z"),
      observation: {
        registered: false,
        lastSeenAt: null,
        capabilities: {},
        environmentConfigurationVersion: null,
        claim: null,
        validatorConfigured: false,
      },
      heartbeatTimeoutMs: 60_000,
    });

    expect(report.status).toBe("failed");
    expect(report.reason).toBe("至少一项 Worker 校验未通过");
  });

  it("报告只包含脱敏摘要，回收后 Assignment 不可再次使用", () => {
    const session = createWorkerValidationSession({
      projectId: "project_1",
      poolId: "a".repeat(32),
      environmentConfigurationVersion: 7,
      selectedPoolAuthorized: true,
    });
    const report = evaluateWorkerValidation({
      session,
      currentEnvironmentConfigurationVersion: 7,
      now: new Date("2026-09-11T10:00:30.000Z"),
      observation: { ...baseObservation, claim: { ...baseObservation.claim!, assignmentId: session.assignment.id } },
      heartbeatTimeoutMs: 60_000,
    });
    expect(JSON.stringify(report)).not.toMatch(/secret|password|token|Bearer|true|false/iu);
    expect(reclaimWorkerValidationAssignment(session)).toMatchObject({ reclaimed: true });
    expect(() => reclaimWorkerValidationAssignment({ ...session, assignment: { ...session.assignment, reclaimed: true } })).toThrow("校验 Assignment 已回收");
  });
});
