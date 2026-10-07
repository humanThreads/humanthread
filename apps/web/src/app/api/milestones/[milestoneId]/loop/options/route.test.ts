import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertCanWriteProject, prisma } from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { GET } from "./route";

vi.mock("@humanthread/db", () => ({
  assertCanWriteProject: vi.fn(),
  prisma: {
    milestone: { findUnique: vi.fn() },
    projectLoopBinding: { findFirst: vi.fn() },
    agentProfile: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const context = { params: Promise.resolve({ milestoneId: "milestone_1" }) };
const poolId = "a".repeat(32);

describe("GET /api/milestones/:milestoneId/loop/options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1", authKind: "web_session", webSessionId: "a".repeat(32) });
    vi.mocked(assertCanWriteProject).mockResolvedValue({ projectId: "project_1", role: "owner" } as never);
    vi.mocked(prisma.milestone.findUnique).mockResolvedValue({
      id: "milestone_1",
      name: "首轮交付",
      projectId: "project_1",
      tasks: [
        { id: "task_1", title: "待开发任务", statusCategory: "in_progress", archivedAt: null },
        { id: "task_2", title: "已完成任务", statusCategory: "completed", archivedAt: null },
        { id: "task_3", title: "已归档任务", statusCategory: "todo", archivedAt: new Date("2026-08-01T00:00:00.000Z") },
      ],
      project: {
        spaceId: "space_1",
        workerPool: {
          id: poolId, displayName: "disaster", status: "active", revokedAt: null, maxConcurrentRuns: 2,
          sessions: [{ requestedConcurrency: 2, lastSeenAt: new Date(), linuxRuns: [] }],
        },
      },
    } as never);
    vi.mocked(prisma.projectLoopBinding.findFirst).mockResolvedValue({
      allowedAgentProfileIds: ["profile_1"],
      allowedProviders: ["codex"],
      workerStageConfigurations: { "agent-action-3": { model: "deepseek-flash" } },
    } as never);
    vi.mocked(prisma.agentProfile.findMany).mockResolvedValue([
      { id: "profile_1", name: "Gelsang Codex", provider: "codex" },
    ] as never);
  });

  it("returns per-task eligibility and the selectable execution targets", async () => {
    const response = await GET(new Request("http://localhost/api/milestones/milestone_1/loop/options"), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      milestone: { id: "milestone_1", name: "首轮交付" },
      tasks: [
        { id: "task_1", title: "待开发任务", eligible: true, reason: null },
        { id: "task_2", title: "已完成任务", eligible: false, reason: "任务已完成" },
        { id: "task_3", title: "已归档任务", eligible: false, reason: "任务已归档" },
      ],
      defaultTarget: { type: "linux_worker_pool", id: poolId },
    });
    expect(body.options).toEqual([
      { type: "local_agent", id: "profile_1", displayName: "本地 Agent · Gelsang Codex", ready: true, reason: null },
      { type: "linux_worker_pool", id: poolId, displayName: "Linux Worker · disaster", ready: true, reason: null },
    ]);
  });

  it("reports every task as skipped and offers no target when the binding is missing", async () => {
    vi.mocked(prisma.milestone.findUnique).mockResolvedValue({
      id: "milestone_1",
      name: "首轮交付",
      projectId: "project_1",
      tasks: [
        { id: "task_1", title: "待开发任务", statusCategory: "in_progress", archivedAt: null },
        { id: "task_2", title: "待开发任务二", statusCategory: "todo", archivedAt: null },
      ],
      project: { spaceId: "space_1", workerPool: null },
    } as never);
    vi.mocked(prisma.projectLoopBinding.findFirst).mockResolvedValue(null as never);

    const response = await GET(new Request("http://localhost/api/milestones/milestone_1/loop/options"), context);
    const body = await response.json() as { options: unknown[]; defaultTarget: unknown; tasks: Array<{ eligible: boolean; reason: string }> };

    expect(body.options).toEqual([]);
    expect(body.defaultTarget).toBeNull();
    expect(body.tasks.every((task) => !task.eligible && task.reason === "未绑定可运行的 Loop")).toBe(true);
    expect(prisma.agentProfile.findMany).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown milestone", async () => {
    vi.mocked(prisma.milestone.findUnique).mockResolvedValue(null as never);

    const response = await GET(new Request("http://localhost/api/milestones/milestone_missing/loop/options"), { params: Promise.resolve({ milestoneId: "milestone_missing" }) });

    expect(response.status).toBe(404);
  });

  it("returns 403 when the actor cannot write the project", async () => {
    vi.mocked(assertCanWriteProject).mockRejectedValue(new Error("Project write access denied"));

    const response = await GET(new Request("http://localhost/api/milestones/milestone_1/loop/options"), context);

    expect(response.status).toBe(403);
  });
});
