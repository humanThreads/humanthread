// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProjectInitCommand, deriveProjectOnboardingSteps, ProjectOnboardingWizard } from "./project-onboarding-wizard";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("项目开箱向导", () => {
  it("生成带当前项目标识的初始化命令", () => {
    expect(buildProjectInitCommand("project_1")).toBe("ht init --project project_1");
  });

  it("keeps the required five-step order and blocks completion when an environment item is missing", () => {
    const steps = deriveProjectOnboardingSteps({
      projectId: "project_1",
      hasEnabledProjectLoop: true,
      environmentConfiguration: { schemaVersion: 1, entries: [{ id: "a".repeat(32), name: "MODEL_API_KEY", purpose: "模型", executionTargets: ["worker"], sourceType: "humanthread", reference: "MODEL_API_KEY", status: "missing", revision: 1 }] },
      hasWorkerResource: true,
    });

    expect(steps.map((step) => step.key)).toEqual(["loops", "local-rules", "credentials", "execution", "verification"]);
    expect(steps.find((step) => step.key === "credentials")).toMatchObject({ status: "blocked" });
    expect(steps.find((step) => step.key === "verification")).toMatchObject({ status: "blocked" });
  });

  it("does not treat unavailable local-rule evidence as a successful onboarding step", () => {
    const steps = deriveProjectOnboardingSteps({ projectId: "project_1", hasEnabledProjectLoop: true, environmentConfiguration: { schemaVersion: 1, entries: [] }, hasWorkerResource: false });

    expect(steps.find((step) => step.key === "local-rules")).toMatchObject({ status: "unverified" });
    expect(steps.find((step) => step.key === "verification")).toMatchObject({ status: "blocked" });
  });

  it("does not treat unverified environment entries as a completed credential step", () => {
    const steps = deriveProjectOnboardingSteps({
      projectId: "project_1",
      hasEnabledProjectLoop: true,
      environmentConfiguration: { schemaVersion: 1, entries: [{ id: "a".repeat(32), name: "MODEL_API_KEY", purpose: "模型", executionTargets: ["worker"], sourceType: "humanthread", reference: "MODEL_API_KEY", status: "unverified", revision: 1 }] },
      hasWorkerResource: true,
    });

    expect(steps.find((step) => step.key === "credentials")).toMatchObject({ status: "in_progress" });
    expect(steps.find((step) => step.key === "verification")).toMatchObject({ status: "blocked" });
  });

  it("accepts a verified project repository when no extra environment entries are required", () => {
    const steps = deriveProjectOnboardingSteps({
      projectId: "project_1",
      hasEnabledProjectLoop: true,
      environmentConfiguration: { schemaVersion: 1, entries: [] },
      hasWorkerResource: true,
      repositoryCredentialVerified: true,
      localRulesVerified: true,
    });

    expect(steps.find((step) => step.key === "credentials")).toMatchObject({ status: "completed" });
    expect(steps.find((step) => step.key === "execution")).toMatchObject({ status: "completed" });
    expect(steps.find((step) => step.key === "verification")).toMatchObject({ status: "unverified" });
  });

  it("shows repository-backed credentials as completed in the wizard", () => {
    window.localStorage.setItem("humanthread:onboarding:project_1:local-rules", "completed");
    render(<ProjectOnboardingWizard
      projectId="project_1"
      hasEnabledProjectLoop
      environmentConfiguration={{ schemaVersion: 1, entries: [] }}
      hasWorkerResource
      repositoryCredentialVerified
    />);

    expect(screen.getByRole("button", { name: "选择步骤：推导并校验凭证" }).textContent).toContain("已完成");
    expect(screen.getByText("当前步骤：完成并验证")).toBeTruthy();
  });

  it("marks the final step completed only after the real Worker validation report passes", () => {
    const baseInput = {
      projectId: "project_1",
      hasEnabledProjectLoop: true,
      environmentConfiguration: { schemaVersion: 1, entries: [{ id: "a".repeat(32), name: "MODEL_API_KEY", purpose: "模型", executionTargets: ["worker"], sourceType: "humanthread", reference: "MODEL_API_KEY", status: "configured", revision: 1 }] },
      hasWorkerResource: true,
      localRulesVerified: true,
    } as const;

    expect(deriveProjectOnboardingSteps(baseInput).find((step) => step.key === "verification")).toMatchObject({ status: "unverified" });
    expect(deriveProjectOnboardingSteps({ ...baseInput, workerValidationPassed: true }).find((step) => step.key === "verification")).toMatchObject({ status: "completed" });
  });

  it("does not skip an incomplete local-rules step", async () => {
    const user = userEvent.setup();
    render(<ProjectOnboardingWizard projectId="project_1" hasEnabledProjectLoop environmentConfiguration={{ schemaVersion: 1, entries: [] }} hasWorkerResource={false} />);

    await user.click(screen.getByRole("button", { name: "选择步骤：推导并校验凭证" }));
    expect(screen.getByText("当前步骤：初始化本地规则")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "下一步" })).toBeNull();
    expect(screen.getByText("请先完成当前步骤，再查看后续步骤。")).toBeTruthy();
  });

  it("does not allow selecting a later step before the current step is complete", async () => {
    const user = userEvent.setup();
    render(<ProjectOnboardingWizard projectId="project_1" hasEnabledProjectLoop environmentConfiguration={{ schemaVersion: 1, entries: [] }} hasWorkerResource={false} />);

    await user.click(screen.getByRole("button", { name: "选择步骤：推导并校验凭证" }));
    expect(screen.getByText("当前步骤：初始化本地规则")).toBeTruthy();
  });

  it("does not advance past an incomplete step and can complete local rules after explicit confirmation", async () => {
    window.localStorage.clear();
    render(<ProjectOnboardingWizard projectId="project_1" hasEnabledProjectLoop={false} environmentConfiguration={{ schemaVersion: 1, entries: [] }} hasWorkerResource={false} />);

    expect(screen.getByText("当前步骤：选择 Loop 范围")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "下一步" })).toBeNull();
    expect(screen.getByText("当前步骤：选择 Loop 范围")).toBeTruthy();
    expect(screen.getByRole("link", { name: "打开此项配置" }).getAttribute("href")).toBe("/projects/project_1/settings?tab=loops");
  });

  it("shows the full init command and marks the local rules step complete only after confirmation", async () => {
    const user = userEvent.setup();
    render(<ProjectOnboardingWizard projectId="project_1" hasEnabledProjectLoop environmentConfiguration={{ schemaVersion: 1, entries: [] }} hasWorkerResource={false} />);

    await user.click(screen.getByRole("button", { name: "选择步骤：初始化本地规则" }));
    expect(screen.getByText("ht init --project project_1")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "我已执行，标记完成" }));
    expect(screen.getByText("初始化本地规则")).toBeTruthy();
    expect(screen.getAllByText("已完成").length).toBeGreaterThan(0);
  });

  it("restores the local rules completion after the page is remounted", async () => {
    const user = userEvent.setup();
    const props = { projectId: "project_1", hasEnabledProjectLoop: true, environmentConfiguration: { schemaVersion: 1, entries: [{ id: "a".repeat(32), name: "MODEL_API_KEY", purpose: "模型", executionTargets: ["worker"], sourceType: "humanthread", reference: "MODEL_API_KEY", status: "configured", revision: 1 }] }, hasWorkerResource: true } as const;
    const first = render(<ProjectOnboardingWizard {...props} />);
    await user.click(screen.getByRole("button", { name: "选择步骤：初始化本地规则" }));
    await user.click(screen.getByRole("button", { name: "我已执行，标记完成" }));
    first.unmount();
    render(<ProjectOnboardingWizard {...props} />);
    expect(screen.getByText("当前步骤：完成并验证")).toBeTruthy();
    expect(screen.getByRole("button", { name: "选择步骤：初始化本地规则" }).textContent).toContain("已完成");
    expect(screen.queryAllByText("待验证").length).toBeGreaterThan(0);
  });

  it("starts worker validation and immediately displays the real per-check report", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("humanthread:onboarding:project_1:local-rules", "completed");
    const startWorkerValidation = vi.fn().mockResolvedValue({
      report: {
        status: "executor_not_configured",
        reason: "校验执行器未配置，不能判定 Worker 可用",
        checks: [
          { key: "registration", status: "passed", summary: "Worker 已注册" },
          { key: "heartbeat", status: "passed", summary: "Worker 心跳在有效窗口内" },
          { key: "capabilities", status: "passed", summary: "已报告 3 项能力" },
          { key: "configuration_version", status: "passed", summary: "Worker 环境配置版本匹配" },
          { key: "claim", status: "executor_not_configured", summary: "无副作用 claim 验证器未配置" },
        ],
      },
    });
    render(<ProjectOnboardingWizard
      projectId="project_1"
      hasEnabledProjectLoop
      environmentConfiguration={{ schemaVersion: 1, entries: [{ id: "a".repeat(32), name: "MODEL_API_KEY", purpose: "模型", executionTargets: ["worker"], sourceType: "humanthread", reference: "MODEL_API_KEY", status: "configured", revision: 1 }] }}
      hasWorkerResource
      workerPoolId={"b".repeat(32)}
      workerValidationApi={{ start: startWorkerValidation }}
    />);

    expect(screen.getByText("当前步骤：完成并验证")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "开始 Worker 校验" }));
    expect(startWorkerValidation).toHaveBeenCalledWith({ poolId: "b".repeat(32) });
    expect(await screen.findByText("无副作用 claim 验证器未配置")).toBeTruthy();
    expect(screen.getByText("校验执行器未配置，不能判定 Worker 可用")).toBeTruthy();
    expect(screen.getAllByText("待验证").length).toBeGreaterThan(0);
  });

  it("shows claim validation as pending instead of a failed side-effect check", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("humanthread:onboarding:project_1:local-rules", "completed");
    const startWorkerValidation = vi.fn().mockResolvedValue({
      report: {
        status: "pending",
        reason: "已发起无副作用校验，正在等待 Worker 确认",
        checks: [
          { key: "registration", status: "passed", summary: "Worker 已注册" },
          { key: "heartbeat", status: "passed", summary: "Worker 心跳在有效窗口内" },
          { key: "capabilities", status: "passed", summary: "已报告 3 项能力" },
          { key: "configuration_version", status: "passed", summary: "Worker 环境配置版本匹配" },
          { key: "claim", status: "pending", summary: "等待 Worker 确认无副作用 claim" },
        ],
      },
    });
    render(<ProjectOnboardingWizard
      projectId="project_1"
      hasEnabledProjectLoop
      environmentConfiguration={{ schemaVersion: 1, entries: [{ id: "a".repeat(32), name: "MODEL_API_KEY", purpose: "模型", executionTargets: ["worker"], sourceType: "humanthread", reference: "MODEL_API_KEY", status: "configured", revision: 1 }] }}
      hasWorkerResource
      workerPoolId={"b".repeat(32)}
      workerValidationApi={{ start: startWorkerValidation }}
    />);

    await user.click(screen.getByRole("button", { name: "开始 Worker 校验" }));

    expect(await screen.findByText("等待 Worker 确认无副作用 claim")).toBeTruthy();
    expect(screen.getByText("已发起无副作用校验，正在等待 Worker 确认")).toBeTruthy();
    expect(screen.getAllByText("等待确认").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "重新检查校验结果" })).toBeTruthy();
    expect(screen.queryByText("校验 Assignment claim 未通过或存在副作用风险")).toBeNull();
  });
});
