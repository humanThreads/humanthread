import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  spaceFindMany: vi.fn(),
  agentProfileFindMany: vi.fn(),
  agentWorkerFindMany: vi.fn(),
  approvalFindMany: vi.fn(),
  approvalUpdateMany: vi.fn().mockResolvedValue({ count: 0 }),
  loopRunFindMany: vi.fn(),
  buildAccessibleTaskWhere: vi.fn(),
}));

vi.mock("../../../../../packages/db/src/index", () => ({
  buildAccessibleTaskWhere: dbMocks.buildAccessibleTaskWhere,
  prisma: {
    space: { findMany: dbMocks.spaceFindMany },
    agentProfile: { findMany: dbMocks.agentProfileFindMany },
    agentWorker: { findMany: dbMocks.agentWorkerFindMany },
    approvalRequest: { findMany: dbMocks.approvalFindMany, updateMany: dbMocks.approvalUpdateMany },
    loopRun: { findMany: dbMocks.loopRunFindMany },
    agentRun: { findMany: vi.fn(), groupBy: vi.fn() },
    task: { findFirst: vi.fn() },
  },
}));

import {
  AGENT_RUN_PAGE_SIZE,
  buildAgentWorkerWhere,
  buildAccessibleAgentSpaceWhere,
  buildActiveAgentLoopRunWhere,
  decodeAgentRunCursor,
  encodeAgentRunCursor,
  getAgentControlPlane,
  getAgentRunCursorWhere,
  isTaskScopedRecord,
  projectLoopMonitorItem,
} from "./agent-read-model";

describe("Agent Run pagination", () => {
  it("uses a bounded page size and a stable createdAt/id cursor", () => {
    const createdAt = new Date("2026-08-10T10:00:00.000Z");
    const cursor = encodeAgentRunCursor({ id: "run_20", createdAt });

    expect(AGENT_RUN_PAGE_SIZE).toBe(20);
    expect(decodeAgentRunCursor(cursor)).toEqual({ id: "run_20", createdAt });
    expect(getAgentRunCursorWhere(cursor)).toEqual({
      OR: [
        { createdAt: { lt: createdAt } },
        { createdAt, id: { lt: "run_20" } },
      ],
    });
  });

  it("ignores malformed cursors instead of failing the Agent page", () => {
    expect(decodeAgentRunCursor("not-a-cursor")).toBeNull();
    expect(getAgentRunCursorWhere("not-a-cursor")).toBeNull();
  });

  it("aggregates active Loop attempt summaries in the database", () => {
    const source = readFileSync(new URL("./agent-read-model.ts", import.meta.url), "utf8");

    expect(source).toContain("prisma.agentRun.groupBy");
    expect(source).toContain("_max: { attempt: true }");
    expect(source).toContain("latestAttemptGroups.flatMap");
    expect(source).toContain("select: { taskId: true, attempt: true, lastHeartbeatAt: true }");
  });
});

describe("buildAgentWorkerWhere", () => {
  it("includes only online authorized device Workers across selected Spaces", () => {
    expect(buildAgentWorkerWhere({
      userId: "user_1",
      spaceIds: ["space_company"],
      now: new Date("2026-08-10T10:00:00.000Z"),
    })).toEqual({
      status: "online",
      AND: [
        { OR: [
          { spaceId: { in: ["space_company"] } },
          { localDevice: { userId: "user_1", status: "authorized" } },
        ] },
        { OR: [
          { lastHeartbeatAt: { gte: new Date("2026-08-10T09:59:30.000Z") } },
          { runs: { some: {
            status: { in: ["claimed", "starting", "running", "waiting_approval"] },
            lastHeartbeatAt: { gte: new Date("2026-08-10T09:59:30.000Z") },
          } } },
        ] },
      ],
    });
  });
});

describe("buildAccessibleAgentSpaceWhere", () => {
  it("limits the all view to personal ownership and active company memberships", () => {
    expect(buildAccessibleAgentSpaceWhere({ userId: "user_1" })).toEqual({
      OR: [
        { type: "personal", ownerUserId: "user_1" },
        { type: "company", company: { members: { some: { userId: "user_1", status: "active" } } } },
      ],
    });
  });

  it("resolves a selected company without broadening membership access", () => {
    expect(buildAccessibleAgentSpaceWhere({ userId: "user_1", ownerType: "company", companyId: "company_1" })).toEqual({
      type: "company",
      companyId: "company_1",
      company: { members: { some: { userId: "user_1", status: "active" } } },
    });
  });
});

describe("isTaskScopedRecord", () => {
  it("keeps graph-only records out of legacy Task projections", () => {
    expect(isTaskScopedRecord({ taskId: "task_1", task: { title: "Legacy task" } })).toBe(true);
    expect(isTaskScopedRecord({ taskId: null, task: null })).toBe(false);
    expect(isTaskScopedRecord({ taskId: "task_missing", task: null })).toBe(false);
  });
});

describe("buildActiveAgentLoopRunWhere", () => {
  it("keeps only actionable task Loops in the live monitor", () => {
    expect(buildActiveAgentLoopRunWhere(["space_1"])).toEqual({
      OR: [
        { taskId: { not: null }, task: { project: { spaceId: { in: ["space_1"] } } } },
        { taskId: null, project: { spaceId: { in: ["space_1"] } } },
      ],
      status: { in: ["created", "running", "paused", "waiting_approval", "waiting"] },
    });
  });
});

describe("projectLoopMonitorItem", () => {
  it("projects authoritative scope, Loop name and parent relationship", () => {
    expect(projectLoopMonitorItem({
      id: "child_1",
      taskId: "task_1",
      task: { title: "实现审批恢复" },
      project: { name: "humanthread" },
      inputSnapshot: {},
      status: "running",
      statusReason: null,
      version: 2,
      currentIteration: 1,
      budgetSnapshot: { maxIterations: 2 },
      parentLoopRunId: "parent_1",
      parentLoopRun: { loopVersion: { loopDefinition: { name: "分支开发" } } },
      loopVersion: { loopDefinition: { name: "Gelsang Project Loop", scope: "task" } },
    }, { attempt: 1, lastHeartbeatAt: null })).toEqual({
      id: "child_1",
      taskId: "task_1",
      taskTitle: "实现审批恢复",
      loopName: "Gelsang Project Loop",
      scope: "task",
      parentLoopRunId: "parent_1",
      parentLoopName: "分支开发",
      status: "running",
      waitingReason: null,
      version: 2,
      currentIteration: 1,
      maxIterations: 2,
      attempt: 1,
      lastHeartbeatAt: null,
    });
  });

  it("projects a project-level release Loop without a Task relation", () => {
    expect(projectLoopMonitorItem({
      id: "release_run_1",
      taskId: null,
      task: null,
      project: { name: "humanthread" },
      inputSnapshot: { releasePlanName: "临时发布计划" },
      status: "running",
      statusReason: "runtime_safety",
      version: 2,
      currentIteration: 0,
      budgetSnapshot: { maxIterations: 1 },
      parentLoopRunId: null,
      parentLoopRun: null,
      loopVersion: { loopDefinition: { name: "Branch Release", scope: "project" } },
    }, undefined)).toMatchObject({
      id: "release_run_1",
      taskId: null,
      taskTitle: "临时发布计划",
      scope: "project",
      loopName: "Branch Release",
    });
  });
});

describe("Agent Center approvals", () => {
  it("selects contextual relations and projects a Loop-scoped approval", async () => {
    dbMocks.spaceFindMany.mockResolvedValue([{
      id: "space_1", type: "personal", ownerUserId: "user_1", company: null,
    }]);
    dbMocks.agentProfileFindMany.mockResolvedValue([]);
    dbMocks.agentWorkerFindMany.mockResolvedValue([]);
    dbMocks.loopRunFindMany.mockResolvedValue([]);
    dbMocks.approvalFindMany.mockResolvedValue([{
      id: "approval_1",
      type: "loop_human_gate",
      status: "pending",
      projectId: "project_1",
      createdAt: new Date("2026-08-11T10:00:00.000Z"),
      project: { name: "humanthread" },
      taskId: null,
      task: null,
      loopRunId: "loop_run_1",
      loopRun: {
        id: "loop_run_1",
        taskId: "task_1",
        task: { id: "task_1", shortId: "HUMANTHR1100003", title: "优化任务详情交互" },
        loopVersion: {
          loopDefinition: { name: "Gelsang Project Loop" },
          graph: { nodes: [{ key: "confirm_requirement", label: "确认需求" }] },
        },
      },
      loopNodeRunId: "node_run_1",
      loopNodeRun: { id: "node_run_1", nodeKey: "confirm_requirement" },
      requestPayload: { routes: { pass: ["confirm_write_prd"], rework: [], reject: [] } },
      policySnapshot: { reason: "需要确认" },
    }]);

    const result = await getAgentControlPlane({ userId: "user_1", includeRuns: false });

    expect(result.approvals).toEqual([expect.objectContaining({
      taskId: "task_1",
      taskShortId: "HUMANTHR1100003",
      taskTitle: "优化任务详情交互",
      projectName: "humanthread",
      loopLabel: "Gelsang Project Loop",
      nodeLabel: "确认需求",
      routes: { pass: ["confirm_write_prd"], rework: [], reject: [] },
    })]);
    expect(dbMocks.approvalFindMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        project: { select: { name: true } },
        task: { select: { id: true, shortId: true, title: true } },
        loopRun: expect.any(Object),
        loopNodeRun: {
          select: expect.objectContaining({
            id: true,
            nodeKey: true,
            inputSnapshot: true,
            artifacts: expect.objectContaining({
              where: { type: "review_html" },
              take: 20,
            }),
          }),
        },
      }),
    }));
    expect(dbMocks.approvalUpdateMany).toHaveBeenCalledTimes(2);
    for (const call of dbMocks.approvalUpdateMany.mock.calls) {
      expect(call[0].where.AND).toEqual(expect.arrayContaining([{ project: { spaceId: { in: ["space_1"] } } }]));
      expect(call[0].where.AND.some((entry: { status?: string }) => entry.status === "pending")).toBe(true);
    }
  });
});
