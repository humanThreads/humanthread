import { describe, expect, it } from "vitest";

import {
  desktopAgentsResponseSchema,
  desktopDashboardResponseSchema,
  desktopLoopDetailResponseSchema,
  desktopNotificationsResponseSchema,
  desktopReportsResponseSchema,
  desktopSearchResponseSchema,
  desktopSettingsResponseSchema,
  desktopTeamResponseSchema,
  desktopTemplatesResponseSchema,
} from "./read-models";
import { parseForwardCompatibleResponse } from "../response-compatibility";

describe("desktop read-model contracts", () => {
  it("accepts the minimum response for every desktop read domain", () => {
    desktopDashboardResponseSchema.parse({
      ok: true,
      data: {
        currentTask: null,
        stats: [],
        actionSignals: [],
        tasks: [],
        devices: [],
      },
    });
    desktopAgentsResponseSchema.parse({
      ok: true,
      data: {
        canManage: false,
        profiles: [],
        workers: [],
        runs: [],
        loops: [],
        approvals: [],
      },
    });
    desktopTeamResponseSchema.parse({
      ok: true,
      data: { team: null, members: [] },
    });
    desktopReportsResponseSchema.parse({
      ok: true,
      data: {
        range: "30d",
        generatedAt: "2026-07-27T10:15:00.000Z",
        metrics: {
          completedTasks: 0,
          overdueTasks: 0,
          blockerMedianAgeHours: null,
          humanWaitMedianAgeHours: null,
          automationSuccess: { state: "unavailable", label: "未自动化" },
        },
        trend: { state: "insufficient", message: "数据不足" },
        projects: [],
        insights: [],
      },
    });
    desktopTemplatesResponseSchema.parse({
      ok: true,
      data: { templates: [] },
    });
    desktopSettingsResponseSchema.parse({
      ok: true,
      data: {
        user: {
          id: "user_1",
          name: "User",
          email: "user@example.com",
          avatarUrl: null,
          status: "active",
        },
        companies: [],
        isSiteAdmin: false,
        selectedCompany: null,
      },
    });
  });

  it("requires ISO timestamps across HTTP read models", () => {
    expect(() =>
      desktopReportsResponseSchema.parse({
        ok: true,
        data: {
          range: "7d",
          generatedAt: new Date("2026-07-27T10:15:00.000Z"),
          metrics: {
            completedTasks: 0,
            overdueTasks: 0,
            blockerMedianAgeHours: null,
            humanWaitMedianAgeHours: null,
            automationSuccess: { state: "unavailable", label: "未自动化" },
          },
          trend: { state: "insufficient", message: "数据不足" },
          projects: [],
          insights: [],
        },
      }),
    ).toThrow();
  });

  it("bounds every search category and requires a desktop route", () => {
    const item = {
      id: "task_1",
      title: "Review desktop API",
      subtitle: "Desktop project",
      status: "active",
      updatedAt: "2026-07-27T10:15:00.000Z",
      route: "/tasks/task_1",
    };
    const response = desktopSearchResponseSchema.parse({
      ok: true,
      data: {
        query: "desktop",
        tasks: [item],
        projects: [],
        documents: [],
        members: [],
        agents: [],
      },
    });

    expect(response.data.tasks[0]?.route).toBe("/tasks/task_1");
    expect(() =>
      desktopSearchResponseSchema.parse({
        ok: true,
        data: {
          query: "desktop",
          tasks: Array.from({ length: 21 }, (_, index) => ({
            ...item,
            id: `task_${index}`,
          })),
          projects: [],
          documents: [],
          members: [],
          agents: [],
        },
      }),
    ).toThrow();
  });

  it("rejects secret material from the settings transport", () => {
    expect(() =>
      desktopSettingsResponseSchema.parse({
        ok: true,
        data: {
          user: {
            id: "user_1",
            name: "User",
            email: "user@example.com",
            avatarUrl: null,
            status: "active",
          },
          companies: [],
          isSiteAdmin: false,
          selectedCompany: null,
          smtpPassword: "secret",
        },
      }),
    ).toThrow();
  });

  it("keeps Agent execution links public and rejects internal Space identifiers", () => {
    const parsed = desktopAgentsResponseSchema.parse({
      ok: true,
      data: {
        canManage: true,
        profiles: [{
          id: "profile_1",
          name: "Codex",
          provider: "codex",
          status: "active",
          model: null,
          route: "/agents?profile=profile_1",
        }],
        workers: [],
        runs: [{
          id: "run_1",
          taskId: "task_1",
          taskTitle: "Build Agent workspace",
          status: "running",
          attempt: 2,
          provider: "codex",
          workerName: "Mac Studio",
          createdAt: "2026-07-27T10:00:00.000Z",
          lastHeartbeatAt: "2026-07-27T10:05:00.000Z",
          route: "/tasks/task_1",
        }],
        loops: [{
          id: "loop_1",
          taskId: "task_1",
          taskTitle: "Build Agent workspace",
          loopName: "Task Loop",
          scope: "task",
          parentLoopRunId: null,
          parentLoopName: null,
          status: "running",
          waitingReason: "worker_offline",
          version: 3,
          currentIteration: 2,
          maxIterations: 5,
          attempt: 2,
          lastHeartbeatAt: "2026-07-27T10:05:00.000Z",
          route: "/tasks/task_1",
        }],
        approvals: [],
      },
    });

    expect(parsed.data.runs[0]?.route).toBe("/tasks/task_1");
    expect(JSON.stringify(parsed)).not.toContain("spaceId");
    expect(() => desktopAgentsResponseSchema.parse({
      ...parsed,
      data: { ...parsed.data, spaceId: "space_internal" },
    })).toThrow();
  });

  it("validates the Desktop Loop runtime detail projection", () => {
    const response = {
      ok: true as const,
      data: {
        run: {
          id: "loop_1",
          status: "waiting",
          version: 4,
          definitionVersion: 2,
          projectionVersion: 7,
          currentIteration: 2,
          maxIterations: 5,
          transitionCount: 6,
          stopReason: null,
          waitingReason: "requirement_confirmation",
          lastHeartbeatAt: "2026-08-06T10:05:00.000Z",
        },
        task: { id: "task_1", title: "Desktop Loop detail", route: "/tasks/task_1" },
        worker: { id: "worker_1", name: "Mac Studio", status: "online" },
        agentRunId: "agent_run_1",
        nodes: [{
          nodeKey: "develop",
          label: "Develop",
          type: "agent_action",
          status: "waiting_input",
          currentNodeRunId: "node_run_1",
          attemptNo: 2,
          waitingReason: "requirement_confirmation",
          attempts: [{
            attempt: 2,
            status: "waiting",
            executorType: "local_agent",
            startedAt: "2026-08-06T10:00:00.000Z",
            finishedAt: null,
            summary: "Implementation paused for confirmation",
            errorSummary: null,
          }],
        }],
        edges: [{
          edgeId: "edge_done",
          source: "develop",
          target: "test",
          kind: "forward",
          outcome: "success",
          traversalCount: 0,
          limit: 1,
          lastTraversalAt: null,
        }],
        timeline: [{
          id: "timeline_1",
          kind: "workflow.interaction.opened",
          occurredAt: "2026-08-06T10:05:00.000Z",
          summary: "Waiting for requirement confirmation",
          actorType: "agent",
          actorId: "agent_1",
          status: "open",
          routeDecision: {
            decisionId: "decision_1",
            sourceNodeId: "develop",
            targetNodeId: "test",
            reasonCode: "READY_FOR_TEST",
            summary: "进入测试节点",
            confidence: 0.94,
            evidence: ["artifacts/test-plan.md"],
            routerContractVersion: 1,
            routerContractDigest: "digest_1",
            selectedEdgeId: "edge_done",
            errorSummary: null,
          },
        }],
        interaction: {
          id: "interaction_1",
          kind: "requirement_conversation",
          status: "open",
          version: 3,
          createdAt: "2026-08-06T10:05:00.000Z",
          closedAt: null,
          messages: [{
            id: "message_1",
            sequence: 1,
            actorType: "agent",
            actorId: "agent_1",
            body: "Which migration path should be used?",
            answers: {},
            createdAt: "2026-08-06T10:05:00.000Z",
          }],
          decision: null,
        },
        capabilities: {
          canReply: true,
          canConfirm: true,
          canDecideApproval: false,
        },
      },
    };

    expect(desktopLoopDetailResponseSchema.parse(response).data.nodes[0]?.attemptNo).toBe(2);
    expect(desktopLoopDetailResponseSchema.safeParse({
      ...response,
      data: { ...response.data, internalSpaceId: "space_internal" },
    }).success).toBe(false);
  });

  it("keeps Loop detail responses forward-compatible without accepting invalid known fields", () => {
    const base = {
      ok: true as const,
      data: {
        run: {
          id: "loop_1", status: "running", version: 1, definitionVersion: 1,
          projectionVersion: 1, currentIteration: 1, maxIterations: 3,
          transitionCount: 0, stopReason: null, waitingReason: null,
          lastHeartbeatAt: null,
        },
        task: { id: "task_1", title: "Task", route: "/tasks/task_1" },
        worker: null,
        agentRunId: null,
        nodes: [],
        edges: [],
        timeline: [],
        interaction: null,
        capabilities: { canReply: false, canConfirm: false, canDecideApproval: false },
      },
    };

    expect(parseForwardCompatibleResponse(desktopLoopDetailResponseSchema, {
      ...base,
      data: { ...base.data, futureField: "ignored" },
    })).toEqual(base);
    expect(() => parseForwardCompatibleResponse(desktopLoopDetailResponseSchema, {
      ...base,
      data: { ...base.data, run: { ...base.data.run, version: "one" } },
    })).toThrow();
  });

  it("accepts desktop notification targets without exposing internal Space identifiers", () => {
    const parsed = desktopNotificationsResponseSchema.parse({
      ok: true,
      data: {
        summary: { unreadCount: 1, todayCount: 1 },
        items: [{
          id: "event:event_1",
          kind: "agent",
          title: "等待人工审批",
          description: "Build desktop notifications",
          occurredAt: "2026-07-27T12:00:00.000Z",
          timeLabel: "07/27 20:00",
          tone: "warning",
          isUnread: true,
          target: {
            resourceType: "task",
            resourceId: "task_1",
            route: "/tasks/task_1",
            label: "打开任务",
          },
        }],
      },
    });

    expect(parsed.data.items[0]?.target.route).toBe("/tasks/task_1");
    expect(() => desktopNotificationsResponseSchema.parse({
      ...parsed,
      data: {
        ...parsed.data,
        items: [{
          ...parsed.data.items[0],
          spaceId: "space_internal",
          target: {
            resourceType: "task",
            resourceId: "task_1",
            route: "/workflows/workflow_1",
            label: "打开任务",
          },
        }],
      },
    })).toThrow();
  });

  it("requires every notification target to use its canonical resource route", () => {
    const item = {
      id: "event:event_1",
      kind: "agent" as const,
      title: "等待人工审批",
      description: "Build desktop notifications",
      occurredAt: "2026-07-27T12:00:00.000Z",
      timeLabel: "07/27 20:00",
      tone: "warning" as const,
      isUnread: true,
      target: {
        resourceType: "task" as const,
        resourceId: "task_1",
        route: "/tasks/task_1",
        label: "打开任务",
      },
    };
    const invalidTargets = [
      { resourceType: "task", resourceId: "task_1", route: "/tasks/../settings", label: "打开任务" },
      { resourceType: "task", resourceId: "task_1", route: "/tasks/", label: "打开任务" },
      { resourceType: "task", resourceId: "task_1", route: "/tasks/task_2", label: "打开任务" },
      { resourceType: "task", resourceId: "task_1", route: "/tasks/task_1?space=other", label: "打开任务" },
      { resourceType: "document", resourceId: "doc_1", route: "/documents/doc_2", label: "打开文档" },
      { resourceType: "project", resourceId: "project_1", route: "/projects/project_2", label: "打开项目" },
    ];

    for (const target of invalidTargets) {
      expect(() => desktopNotificationsResponseSchema.parse({
        ok: true,
        data: {
          summary: { unreadCount: 1, todayCount: 1 },
          items: [{ ...item, target }],
        },
      })).toThrow();
    }

    expect(() => desktopNotificationsResponseSchema.parse({
      ok: true,
      data: {
        summary: { unreadCount: 1, todayCount: 1 },
        items: [{
          ...item,
          target: {
            resourceType: "task",
            resourceId: "task/1",
            route: "/tasks/task%2F1",
            label: "打开任务",
          },
        }],
      },
    })).not.toThrow();
  });

  it("accepts critical Loop Run and approval targets with canonical routes", () => {
    const base = {
      id: "loop-notification:notice_1",
      kind: "agent" as const,
      title: "Loop 重试预算已耗尽",
      description: "质量门禁已达到最大返工次数",
      occurredAt: "2026-07-31T08:00:00.000Z",
      timeLabel: "07/31 16:00",
      tone: "danger" as const,
      isUnread: true,
    };
    expect(desktopNotificationsResponseSchema.parse({
      ok: true,
      data: {
        summary: { unreadCount: 2, todayCount: 2 },
        items: [
          { ...base, target: { resourceType: "loop_run", resourceId: "run_1", route: "/loop-runs/run_1", label: "打开运行图" } },
          { ...base, id: "loop-notification:notice_2", tone: "warning", target: { resourceType: "approval", resourceId: "approval_1", route: "/agents?approvalId=approval_1", label: "处理审批" } },
        ],
      },
    }).data.items).toHaveLength(2);
  });
});
