import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AgentCenterPanel,
  CurrentTaskConsole,
  formatWorkbenchDateTime,
  QuickCreatePanel,
  TaskInboxPanel,
  TeamSnapshotPanel,
} from "./workbench-sections";

describe("formatWorkbenchDateTime", () => {
  it("formats ISO date strings returned by document APIs", () => {
    expect(formatWorkbenchDateTime("2026-09-14T05:48:28.574Z")).toMatch(/09[\/月]14/);
  });
});

function createInboxTask(input: {
  id: string;
  status: "active" | "pending" | "blocked";
  stepTitle: string;
  workflowTitle: string;
  queuePosition: number;
  displayQueueLabel?: string | null;
  displayQueueOrder?: number | null;
  localPath?: string | null;
  defaultCommand?: string | null;
  updatedAt?: Date;
  timeBucket?: "today" | "overdue" | "next_7" | "later";
  timeBucketLabel?: string;
  priority?: "high" | "medium" | "low";
  toolSession?: {
    id: string;
    sessionType: string;
    sessionName: string;
    status: string;
    lastOutputSummary: string | null;
  } | null;
}) {
  return {
    task: {
      id: input.id,
      status: input.status,
      title: input.stepTitle,
      queuePosition: input.queuePosition,
      createdAt: new Date("2026-05-28T09:00:00.000Z"),
      updatedAt: input.updatedAt ?? new Date("2026-05-28T09:10:00.000Z"),
    },
    workflow: {
      id: `${input.id}:workflow`,
      title: input.workflowTitle,
      status: input.status === "blocked" ? "blocked" : "running",
      currentStepKey: input.stepTitle,
      matterType: {
        id: "matter_dev",
        name: "开发任务",
        description: "AI 辅助开发流程",
      },
    },
    project: {
      id: "project_1",
      name: "HumanThread",
      spaceLabel: "个人空间",
      description: null,
      localPath: input.localPath ?? null,
      defaultCommand: input.defaultCommand ?? null,
    },
    toolSession: input.toolSession ?? null,
    assignee: {
      id: "user_owner",
      name: "Owner",
      email: "owner@example.com",
      status: "active",
      lastSeenAt: null,
    },
    riskIds:
      input.localPath && input.defaultCommand
        ? []
        : ["missing_local_path", "missing_default_command", "missing_mcp_credentials"],
    contextMissingKeys:
      input.localPath && input.defaultCommand
        ? []
        : ["local_path", "default_command", "mcp_credentials"],
    isToday: input.timeBucket === "today" || !input.timeBucket,
    isQueued: input.queuePosition > 0,
    requiresAttention: input.status !== "pending" || input.queuePosition === 0,
    timeBucket: input.timeBucket ?? "today",
    timeBucketLabel: input.timeBucketLabel ?? "今天",
    priority: input.priority ?? "high",
    displayQueueLabel: input.displayQueueLabel ?? null,
    displayQueueOrder: input.displayQueueOrder ?? null,
  };
}

describe("TaskInboxPanel", () => {
  it("renders grouped inbox rows with phase, project source, priority, time bucket, env state, and selection links", () => {
    const markup = renderToStaticMarkup(
      createElement(TaskInboxPanel, {
        pathname: "/dashboard",
        activeFilter: "today",
        activeView: "time",
        selectedTaskId: "task_active",
        selectedSpaceKey: "all",
        groups: [
          {
            key: "attention",
            title: "立即处理",
            description: "今天要确认或继续推进的事项。",
            tasks: [
              createInboxTask({
                id: "task_active",
                status: "active",
                stepTitle: "确认需求",
                workflowTitle: "小说后端数据库索引",
                queuePosition: 0,
                displayQueueLabel: null,
                localPath: null,
                defaultCommand: null,
                timeBucket: "today",
                timeBucketLabel: "今天",
                priority: "high",
              }),
              createInboxTask({
                id: "task_queue",
                status: "pending",
                stepTitle: "执行索引变更",
                workflowTitle: "修复站内信未读联动",
                queuePosition: 2,
                displayQueueLabel: "队列 #2",
                displayQueueOrder: 2,
                localPath: "/repo",
                defaultCommand: "pnpm test",
                timeBucket: "next_7",
                timeBucketLabel: "未来 7 天",
                priority: "medium",
              }),
            ],
          },
        ],
      }),
    );

    expect(markup).toContain("任务收件箱");
    expect(markup).toContain("当前筛选：今天 · 按时间");
    expect(markup).toContain("/dashboard?filter=today&amp;view=time&amp;taskId=task_active");
    expect(markup).toContain("/dashboard?filter=today&amp;view=owner&amp;taskId=task_active");
    expect(markup).toContain("/dashboard?filter=today&amp;view=phase&amp;taskId=task_active");
    expect(markup).toContain("/dashboard?filter=today&amp;view=risk&amp;taskId=task_active");
    expect(markup).toContain("立即处理");
    expect(markup).toContain("小说后端数据库索引");
    expect(markup).toContain("阶段 · 确认需求");
    expect(markup).toContain("负责人 · Owner");
    expect(markup).toContain("优先级 高");
    expect(markup).toContain("今天");
    expect(markup).toContain("未配置本地目录");
    expect(markup).toContain("未配置默认命令");
    expect(markup).toContain("缺少 MCP 凭据");
    expect(markup).toContain("修复站内信未读联动");
    expect(markup).toContain("未来 7 天");
    expect(markup).toContain("队列 #2");
    expect(markup).not.toContain("队列 #0");
    expect(markup).toContain("配置执行环境");
    expect(markup).toContain(">开始</button>");
    expect(markup).toContain("/dashboard?filter=today&amp;view=time&amp;taskId=task_active");
    expect(markup).toContain("/dashboard?filter=today&amp;view=time&amp;taskId=task_queue");
  });

  it("renders an empty-state next action when the current filter has no tasks", () => {
    const markup = renderToStaticMarkup(
      createElement(TaskInboxPanel, {
        pathname: "/dashboard",
        activeFilter: "overdue",
        activeView: "risk",
        selectedTaskId: null,
        selectedSpaceKey: "all",
        groups: [],
      }),
    );

    expect(markup).toContain("当前筛选下没有任务");
    expect(markup).toContain("当前筛选：已逾期 · 按风险");
    expect(markup).toContain("创建首个事项");
    expect(markup).toContain("#quick-create-panel");
  });
});

describe("CurrentTaskConsole", () => {
  it("renders task metadata, next action, context completeness, risks, related documents, and timeline", () => {
    const markup = renderToStaticMarkup(
      createElement(CurrentTaskConsole, {
        detail: {
          task: createInboxTask({
            id: "task_active",
            status: "active",
            stepTitle: "确认需求",
            workflowTitle: "小说后端数据库索引",
            queuePosition: 0,
            displayQueueLabel: "队列 #1",
            displayQueueOrder: 1,
            localPath: null,
            defaultCommand: null,
            timeBucket: "overdue",
            timeBucketLabel: "已逾期",
            priority: "high",
            toolSession: {
              id: "tool_session_1",
              sessionType: "codex",
              sessionName: "Owner Mac",
              status: "active",
              lastOutputSummary: "running migrations",
            },
          }),
          metadata: {
            ownerLabel: "Owner",
            agentLabel: "Owner Mac",
            priorityLabel: "高",
            dueLabel: "已逾期",
            phaseLabel: "确认需求",
            projectLabel: "HumanThread · 个人空间",
          },
          workflowDescription: "补齐需求边界、验收标准与本地运行方式。",
          context: {
            complete: 3,
            total: 5,
            items: [
              { key: "description", label: "需求说明", complete: true, detail: "已补充" },
              { key: "documents", label: "相关文档", complete: false, detail: "尚未绑定说明文档" },
              { key: "local_path", label: "本地目录", complete: false, detail: "未配置" },
              { key: "default_command", label: "默认命令", complete: false, detail: "未配置" },
              { key: "mcp_credentials", label: "MCP 凭据", complete: true, detail: "已签发 1 个可用凭据" },
            ],
          },
          risks: [
            {
              id: "missing_local_path",
              tone: "warning",
              title: "未配置本地目录",
              description: "当前任务还不能一键打开到本地工程。",
            },
            {
              id: "missing_default_command",
              tone: "warning",
              title: "未配置默认命令",
              description: "Agent 还没有默认执行入口。",
            },
            {
              id: "overdue",
              tone: "danger",
              title: "任务已逾期",
              description: "当前事项已超过建议处理窗口，建议优先清理。",
            },
          ],
          nextAction: {
            label: "补充验收标准并配置本地目录",
            description: "先把需求说明和运行目录补齐，再开始执行。",
          },
          relatedDocuments: [
            {
              id: "doc_1",
              projectId: "project_1",
              projectName: "HumanThread",
              title: "任务说明",
              path: "docs/task-spec.md",
              version: 1,
              updatedAt: new Date("2026-05-28T09:20:00.000Z"),
            },
          ],
          timelineEvents: [
            {
              id: "event_1",
              taskId: "task_active",
              workflowInstanceId: "workflow_1",
              type: "task_created",
              actorType: "system",
              actorUserId: "user_owner",
              message: "已创建任务",
              payload: null,
              createdAt: new Date("2026-05-28T09:00:00.000Z"),
              task: {
                id: "task_active",
                title: "确认需求",
                status: "pending",
                stepTemplateId: "step_confirm_requirement",
              },
            },
          ],
          executionLinks: [
            {
              label: "任务详情",
              href: "/tasks/task_active",
              description: "打开这条事项的独立任务详情页。",
            },
            {
              label: "项目详情",
              href: "/projects/project_1?taskId=task_active",
              description: "回到项目空间查看该事项所属项目、文档和最近任务。",
            },
            {
              label: "团队协作",
              href: "/team?taskId=task_active",
              description: "查看负责人和团队线程占用，准备转交或协同。",
            },
            {
              label: "通知中心",
              href: "/notifications?taskId=task_active",
              description: "查看与当前任务相关的提醒、时间线和文档更新。",
            },
          ],
        },
      }),
    );

    expect(markup).toContain("当前任务详情");
    expect(markup).toContain("小说后端数据库索引");
    expect(markup).toContain("Owner");
    expect(markup).toContain("Owner Mac");
    expect(markup).toContain("队列 #1");
    expect(markup).not.toContain("队列 #0");
    expect(markup).toContain("高");
    expect(markup).toContain("已逾期");
    expect(markup).toContain("HumanThread · 个人空间");
    expect(markup).toContain("上下文完整度 3 / 5");
    expect(markup).toContain("补充验收标准并配置本地目录");
    expect(markup).toContain("未配置本地目录");
    expect(markup).toContain("任务已逾期");
    expect(markup).toContain("docs/task-spec.md");
    expect(markup).toContain("执行联动");
    expect(markup).toContain("/tasks/task_active");
    expect(markup).toContain("/projects/project_1?taskId=task_active");
    expect(markup).toContain("/team?taskId=task_active");
    expect(markup).toContain("/notifications?taskId=task_active");
    expect(markup).toContain("task_created");
    expect(markup).toContain("已创建任务");
  });

  it("offers a quick-create next action when no task is selected", () => {
    const markup = renderToStaticMarkup(
      createElement(CurrentTaskConsole, {
        detail: null,
      }),
    );

    expect(markup).toContain("当前没有打开任务");
    expect(markup).toContain("创建首个事项");
    expect(markup).toContain("#quick-create-panel");
  });
});

describe("QuickCreatePanel", () => {
  it("renders a project picker and immediate-start entry for quick creation", () => {
    const markup = renderToStaticMarkup(
      createElement(QuickCreatePanel, {
        selectedSpaceKey: "company_1",
        selectedProjectId: "project_1",
        templatePreset: {
          key: "requirement-review",
          title: "需求确认模板",
          description: "适合从任务中心快速发起一个带验收标准的事项。",
          savedView: "missing_context",
          quickCreate: {
            titlePrefix: "需求确认：",
            phase: "确认需求",
            priority: "medium",
            acceptanceCriteria: ["明确目标边界", "列出验收条件", "补齐负责人"],
            requiredDocs: ["需求说明", "验收标准"],
            agentPrerequisites: ["可选，不强依赖 Agent"],
          },
        },
        projects: [
          {
            id: "project_1",
            spaceId: "space_1",
            name: "HumanThread",
            description: null,
            localPath: null,
            defaultCommand: null,
            updatedAt: new Date("2026-05-28T09:00:00.000Z"),
            activeWorkflowCount: 2,
            milestones: [],
          },
        ],
      }),
    );

    expect(markup).toContain("快速创建入口");
    expect(markup).toContain("已应用需求确认模板");
    expect(markup).toContain("从模板创建事项");
    expect(markup).toContain('name="projectId"');
    expect(markup).toContain('name="phase"');
    expect(markup).toContain('name="priority"');
    expect(markup).toContain('name="dueAt"');
    expect(markup).toContain('name="acceptanceCriteria"');
    expect(markup).toContain('name="requiredDocs"');
    expect(markup).toContain('name="agentPrerequisites"');
    expect(markup).toContain("HumanThread");
    expect(markup).toContain('name="startImmediately"');
    expect(markup).toContain('name="spaceKey"');
    expect(markup).toContain("需求说明");
    expect(markup).toContain("可选，不强依赖 Agent");
    expect(markup).toContain("value=\"需求确认：\"");
  });
});

describe("AgentCenterPanel", () => {
  it("shows dispatch intent state and safer dangerous actions", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentCenterPanel, {
        devices: [
          {
            id: "device_1",
            name: "Owner Mac",
            platform: "macos",
            status: "authorized",
            authorizedAt: new Date("2026-05-28T08:00:00.000Z"),
            revokedAt: null,
            lastSeenAt: new Date("2026-05-28T09:45:00.000Z"),
            user: {
              id: "user_owner",
              name: "Owner",
            },
          },
        ],
        userId: "user_owner",
        credentialCount: 1,
        activeTaskCount: 2,
        dispatchSummary: {
          readyCount: 1,
          missingContextCount: 3,
          riskCount: 2,
        },
      }),
    );

    expect(markup).toContain("派单预览");
    expect(markup).toContain("可派单 1");
    expect(markup).toContain("缺前置 3");
    expect(markup).toContain("需清风险 2");
    expect(markup).toContain("/tasks?view=owner&amp;intent=dispatch_by_owner");
    expect(markup).toContain("/tasks?view=risk&amp;intent=clear_risk");
    expect(markup).toContain("危险操作");
    expect(markup).toContain("确认撤销授权");
    expect(markup).toContain("确认生成绑定码");
    expect(markup).toContain("确认生成新 Token");
  });
});

describe("TeamSnapshotPanel", () => {
  it("shows the matter title before the current step label", () => {
    const markup = renderToStaticMarkup(
      createElement(TeamSnapshotPanel, {
        selectedUserId: "user_owner",
        allowUserSwitch: false,
        members: [
          {
            user: {
              id: "user_owner",
              name: "Owner",
              email: "owner@example.com",
              status: "active",
              lastSeenAt: null,
            },
            queueLength: 1,
            currentTask: {
              task: {
                id: "task_active",
                status: "active",
                title: "确认需求",
                queuePosition: 0,
              },
              workflow: {
                id: "workflow_1",
                title: "小说后端数据库索引",
                status: "running",
                currentStepKey: "confirm_requirement",
                matterType: {
                  id: "matter_dev",
                  name: "开发任务",
                  description: null,
                },
              },
              project: {
                id: "project_1",
                name: "HumanThread",
                spaceLabel: "个人空间",
                description: null,
                localPath: "/repo",
                defaultCommand: "codex",
              },
              toolSession: null,
              assignee: {
                id: "user_owner",
                name: "Owner",
                email: "owner@example.com",
                status: "active",
                lastSeenAt: null,
              },
            },
          },
        ],
      }),
    );

    expect(markup).toContain("小说后端数据库索引 · 确认需求");
  });
});
