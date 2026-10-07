import { describe, expect, it } from "vitest";
import { buildProjectExecutionOptions, type ProjectExecutionBindingInput, type WorkerPoolOptionInput } from "./execution-options";

const NOW = new Date("2026-09-10T06:00:30.000Z");

const binding = (overrides: Partial<ProjectExecutionBindingInput> = {}): ProjectExecutionBindingInput => ({
  allowedAgentProfileIds: [],
  allowedProviders: [],
  workerStageConfigurations: null,
  ...overrides,
});

const workerPool = (overrides: Partial<WorkerPoolOptionInput> = {}): WorkerPoolOptionInput => ({
  id: "a".repeat(32),
  displayName: "ht-agent",
  status: "active",
  revokedAt: null,
  maxConcurrentRuns: 2,
  sessions: [{ requestedConcurrency: 2, lastSeenAt: new Date("2026-09-10T06:00:00.000Z"), linuxRuns: [] }],
  ...overrides,
});

describe("buildProjectExecutionOptions", () => {
  it("builds named Local Agent and Linux Worker options and prefers a ready Linux Worker as default", () => {
    const result = buildProjectExecutionOptions({
      now: NOW,
      binding: binding({
        allowedAgentProfileIds: ["profile_1"],
        allowedProviders: ["codex"],
        workerStageConfigurations: { "agent-action-3": { model: "deepseek-flash" } },
      }),
      workerPool: workerPool(),
      agentProfiles: [{ id: "profile_1", name: "Gelsang Codex", provider: "codex" }],
    });

    expect(result.options).toEqual([
      { type: "local_agent", id: "profile_1", displayName: "本地 Agent · Gelsang Codex", ready: true, reason: null },
      { type: "linux_worker_pool", id: "a".repeat(32), displayName: "Linux Worker · ht-agent", ready: true, reason: null },
    ]);
    expect(result.defaultTarget).toEqual({ type: "linux_worker_pool", id: "a".repeat(32), displayName: "Linux Worker · ht-agent", ready: true, reason: null });
  });

  it("marks a Local Agent whose provider is not allowed as unavailable", () => {
    const result = buildProjectExecutionOptions({
      now: NOW,
      binding: binding({ allowedAgentProfileIds: ["profile_1"], allowedProviders: ["claude"] }),
      workerPool: null,
      agentProfiles: [{ id: "profile_1", name: "Gelsang Codex", provider: "codex" }],
    });

    expect(result.options).toEqual([
      { type: "local_agent", id: "profile_1", displayName: "本地 Agent · Gelsang Codex", ready: false, reason: "此 Loop 不允许该 Provider" },
    ]);
    expect(result.defaultTarget).toBeNull();
  });

  it("marks a Linux Worker without stage models as unavailable", () => {
    const result = buildProjectExecutionOptions({
      now: NOW,
      binding: binding({ workerStageConfigurations: null }),
      workerPool: workerPool(),
      agentProfiles: [],
    });

    expect(result.options).toEqual([
      { type: "linux_worker_pool", id: "a".repeat(32), displayName: "Linux Worker · ht-agent", ready: false, reason: "任务 Loop 尚未配置 Worker 节点模型" },
    ]);
  });

  it("marks a Linux Worker without fresh capacity as unavailable", () => {
    const stale = buildProjectExecutionOptions({
      now: NOW,
      binding: binding({ allowedAgentProfileIds: ["profile_1"], workerStageConfigurations: { implement: {} } }),
      workerPool: workerPool({ sessions: [{ requestedConcurrency: 2, lastSeenAt: new Date("2026-09-10T05:50:00.000Z"), linuxRuns: [] }] }),
      agentProfiles: [],
    });
    expect(stale.options[0]).toMatchObject({ ready: false, reason: "Linux Worker 暂无可用容量" });

    const busy = buildProjectExecutionOptions({
      now: NOW,
      binding: binding({ allowedAgentProfileIds: ["profile_1"], workerStageConfigurations: { implement: {} } }),
      workerPool: workerPool({ sessions: [{ requestedConcurrency: 2, lastSeenAt: NOW, linuxRuns: [{ id: "run_1" }, { id: "run_2" }] }] }),
      agentProfiles: [],
    });
    expect(busy.options[0]).toMatchObject({ ready: false, reason: "Linux Worker 暂无可用容量" });
  });

  it("marks a Linux Worker as unavailable when the binding allows no Agent Profile", () => {
    const result = buildProjectExecutionOptions({
      now: NOW,
      binding: binding({ workerStageConfigurations: { implement: {} } }),
      workerPool: workerPool(),
      agentProfiles: [],
    });

    expect(result.options).toEqual([
      { type: "linux_worker_pool", id: "a".repeat(32), displayName: "Linux Worker · ht-agent", ready: false, reason: "任务 Loop 未配置 Agent Profile" },
    ]);
    expect(result.defaultTarget).toBeNull();
  });

  it("returns no options when the Project has no task-development binding", () => {
    const result = buildProjectExecutionOptions({ now: NOW, binding: null, workerPool: workerPool(), agentProfiles: [] });
    expect(result).toEqual({ options: [], defaultTarget: null });
  });
});
