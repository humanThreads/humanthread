import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertCanDispatchTaskAgent, prisma } from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { GET } from "./route";

vi.mock("@humanthread/db", () => ({
  assertCanDispatchTaskAgent: vi.fn(),
  prisma: { task: { findUnique: vi.fn() }, agentProfile: { findMany: vi.fn() } },
}));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const context = { params: Promise.resolve({ taskId: "task_1" }) };

describe("GET /api/tasks/:taskId/loop/execution-options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1", authKind: "web_session", webSessionId: "a".repeat(32) });
    vi.mocked(assertCanDispatchTaskAgent).mockResolvedValue({ taskId: "task_1", role: "project_admin" });
    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      project: {
        spaceId: "space_1",
        loopGroupConfig: {
          projectLoopVersionIds: ["loop_version_1"],
          defaultTaskLoopVersionId: "loop_version_1",
          defaultProjectLoopVersionId: "loop_version_1",
          taskLoopVersionIds: [],
          selectedPresetKeys: ["研发交付"],
          defaultPresetKey: "研发交付",
        },
        workerPool: {
          id: "a".repeat(32), displayName: "ht-agent", status: "active", revokedAt: null, maxConcurrentRuns: 2,
          sessions: [{ requestedConcurrency: 2, lastSeenAt: new Date(), linuxRuns: [] }],
        },
        loopBindings: [{
          id: "binding_1",
          loopDefinitionId: "loop_definition_1",
          activeVersionId: "loop_version_1",
          bindingRole: "task_development",
          allowedAgentProfileIds: ["profile_1"],
          allowedProviders: ["codex"],
          workerStageConfigurations: { implement: { siteId: "b".repeat(32), model: "gpt-5", reasoningEffort: "high" } },
          loopDefinition: { name: "分支开发 Loop", description: "执行实现并提交候选结果" },
          activeVersion: { versionNumber: 12 },
        }],
      },
    } as never);
    vi.mocked(prisma.agentProfile.findMany).mockResolvedValue([
      { id: "profile_1", name: "Gelsang Codex", provider: "codex" },
    ] as never);
  });

  it("returns named, non-secret Local Agent and Linux Worker options", async () => {
    const response = await GET(new Request("http://localhost/api/tasks/task_1/loop/execution-options"), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      loops: [{
        bindingId: "binding_1",
        loopDefinitionId: "loop_definition_1",
        loopVersionId: "loop_version_1",
        name: "分支开发 Loop",
        description: "执行实现并提交候选结果",
        versionNumber: 12,
        isDefault: true,
        ready: true,
        reason: null,
      }],
      selectedBindingId: "binding_1",
      options: [
        { type: "local_agent", id: "profile_1", displayName: "本地 Agent · Gelsang Codex", ready: true, reason: null },
        { type: "linux_worker_pool", id: "a".repeat(32), displayName: "Linux Worker · ht-agent", ready: true, reason: null },
      ],
      defaultTarget: { type: "linux_worker_pool", id: "a".repeat(32), displayName: "Linux Worker · ht-agent", ready: true, reason: null },
    });
  });

  it("marks an incomplete Linux configuration unavailable before a Run can be created", async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      project: {
        spaceId: "space_1",
        loopGroupConfig: null,
        workerPool: {
          id: "a".repeat(32), displayName: "ht-agent", status: "active", revokedAt: null, maxConcurrentRuns: 2,
          sessions: [{ requestedConcurrency: 2, lastSeenAt: new Date(), linuxRuns: [] }],
        },
        loopBindings: [{
          id: "binding_1", loopDefinitionId: "loop_definition_1", activeVersionId: "loop_version_1", bindingRole: "task_development",
          allowedAgentProfileIds: [], allowedProviders: [], workerStageConfigurations: null,
          loopDefinition: { name: "分支开发 Loop", description: null }, activeVersion: { versionNumber: 1 },
        }],
      },
    } as never);

    const response = await GET(new Request("http://localhost/api/tasks/task_1/loop/execution-options"), context);
    const body = await response.json() as { options: Array<{ type: string; ready: boolean; reason: string | null }> };

    expect(body.options).toEqual([expect.objectContaining({
      type: "linux_worker_pool",
      ready: false,
      reason: "任务 Loop 尚未配置 Worker 节点模型",
    })]);
  });

  it("marks a Pool without a fresh session unavailable before start", async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      project: {
        spaceId: "space_1",
        loopGroupConfig: null,
        workerPool: { id: "a".repeat(32), displayName: "ht-agent", status: "active", revokedAt: null, maxConcurrentRuns: 2, sessions: [] },
        loopBindings: [{
          id: "binding_1", loopDefinitionId: "loop_definition_1", activeVersionId: "loop_version_1", bindingRole: "task_development",
          allowedAgentProfileIds: ["profile_1"], allowedProviders: ["codex"], workerStageConfigurations: { implement: {} },
          loopDefinition: { name: "分支开发 Loop", description: null }, activeVersion: { versionNumber: 1 },
        }],
      },
    } as never);

    const response = await GET(new Request("http://localhost/api/tasks/task_1/loop/execution-options"), context);
    const body = await response.json() as { options: Array<{ type: string; ready: boolean; reason: string | null }> };

    expect(body.options.at(-1)).toMatchObject({
      type: "linux_worker_pool",
      ready: false,
      reason: "Linux Worker 暂无可用容量",
    });
  });

  it("marks a Linux Worker unavailable when the binding allows no Agent Profile", async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      project: {
        spaceId: "space_1",
        loopGroupConfig: null,
        workerPool: {
          id: "a".repeat(32), displayName: "ht-agent", status: "active", revokedAt: null, maxConcurrentRuns: 2,
          sessions: [{ requestedConcurrency: 2, lastSeenAt: new Date(), linuxRuns: [] }],
        },
        loopBindings: [{
          id: "binding_1", loopDefinitionId: "loop_definition_1", activeVersionId: "loop_version_1", bindingRole: "task_development",
          allowedAgentProfileIds: [], allowedProviders: [], workerStageConfigurations: { implement: {} },
          loopDefinition: { name: "分支开发 Loop", description: null }, activeVersion: { versionNumber: 1 },
        }],
      },
    } as never);

    const response = await GET(new Request("http://localhost/api/tasks/task_1/loop/execution-options"), context);
    const body = await response.json() as { options: Array<{ type: string; ready: boolean; reason: string | null }> };

    expect(body.options).toEqual([expect.objectContaining({
      type: "linux_worker_pool",
      ready: false,
      reason: "任务 Loop 未配置 Agent Profile",
    })]);
    expect(prisma.agentProfile.findMany).not.toHaveBeenCalled();
  });

  it("returns configured project Loops when the legacy task-development binding is absent", async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      project: {
        spaceId: "space_1",
        loopGroupConfig: {
          projectLoopVersionIds: ["loop_version_default", "loop_version_fast"],
          defaultTaskLoopVersionId: "loop_version_default",
          defaultProjectLoopVersionId: "loop_version_fast",
          taskLoopVersionIds: [],
          selectedPresetKeys: ["研发交付"],
          defaultPresetKey: "研发交付",
        },
        workerPool: {
          id: "a".repeat(32), displayName: "ht-agent", status: "active", revokedAt: null, maxConcurrentRuns: 2,
          sessions: [{ requestedConcurrency: 2, lastSeenAt: new Date(), linuxRuns: [] }],
        },
        loopBindings: [
          {
            id: "binding_default", loopDefinitionId: "loop_default", activeVersionId: "loop_version_default", bindingRole: null,
            allowedAgentProfileIds: ["profile_1"], allowedProviders: ["codex"], workerStageConfigurations: { implement: {} },
            loopDefinition: { name: "分支开发 Loop", description: "默认开发流程" }, activeVersion: { versionNumber: 12 },
          },
          {
            id: "binding_fast", loopDefinitionId: "loop_fast", activeVersionId: "loop_version_fast", bindingRole: null,
            allowedAgentProfileIds: ["profile_1"], allowedProviders: ["codex"], workerStageConfigurations: { implement: {} },
            loopDefinition: { name: "快速修复 Loop", description: "短流程修复" }, activeVersion: { versionNumber: 8 },
          },
          {
            id: "binding_release", loopDefinitionId: "loop_release", activeVersionId: "loop_version_release", bindingRole: "milestone_release",
            allowedAgentProfileIds: ["profile_1"], allowedProviders: ["codex"], workerStageConfigurations: { implement: {} },
            loopDefinition: { name: "发布 Loop", description: "不应从任务启动" }, activeVersion: { versionNumber: 5 },
          },
        ],
      },
    } as never);

    const response = await GET(new Request("http://localhost/api/tasks/task_1/loop/execution-options?bindingId=binding_fast"), context);
    const body = await response.json() as {
      selectedBindingId: string;
      loops: Array<{ bindingId: string; name: string; isDefault: boolean }>;
    };

    expect(response.status).toBe(200);
    expect(body.selectedBindingId).toBe("binding_fast");
    expect(body.loops).toEqual([
      expect.objectContaining({ bindingId: "binding_default", name: "分支开发 Loop", isDefault: true }),
      expect.objectContaining({ bindingId: "binding_fast", name: "快速修复 Loop", isDefault: false }),
    ]);
  });
});
