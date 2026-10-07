import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { TaskDetail } from "./task-detail";

const detail = {
  task: {
    id: "task_1",
    shortId: "HT100001",
    title: "完成桌面任务详情",
    statusCategory: "todo" as const,
    status: { id: null, name: "待处理", category: "todo", color: "#57606a" },
    visibility: "company" as const,
    priority: 2,
    startAt: null,
    dueAt: "2026-07-30T10:00:00.000Z",
    overdue: false,
    version: 3,
    createdAt: "2026-07-26T08:00:00.000Z",
    updatedAt: "2026-07-27T08:00:00.000Z",
    createdById: "user_1",
    assignee: { id: "user_1", name: "Owner", avatarUrl: null },
    project: { id: "project_1", name: "HumanThread" },
    blocker: null,
    labels: [],
    childCount: 0,
    automation: null,
    contentMarkdown: "## 验收\n\n- Windows 兼容测试",
    acceptanceMode: "human",
    archivedAt: null,
    createdBy: { id: "user_1", name: "Owner", avatarUrl: null },
    acceptanceReviewer: null,
    members: [],
    blockers: [],
    comments: [],
    activities: [],
    reminders: [],
    attachments: [],
    documentLinks: [],
    childTasks: [],
  },
  capabilities: {
    read: true,
    comment: false,
    edit: false,
    changeStatus: false,
    manageMembers: false,
    manageVisibility: false,
    dispatchAgent: false,
    govern: false,
    nativeExecute: false,
  },
  collaboration: { availableMembers: [], availableLabels: [] },
  execution: {
    projectId: "project_1",
    workflowInstanceId: "workflow_1",
    localPath: "/workspace/humanthread",
    command: "codex",
    toolSession: null,
  },
};

describe("desktop Task detail", () => {
  it("renders the Task as a readable work surface and obeys server-provided capabilities", () => {
    render(
      <MemoryRouter>
        <TaskDetail
          detail={detail}
          onCommand={vi.fn()}
          mutateCollaboration={vi.fn()}
          postComment={vi.fn()}
          writeEnabled
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "完成桌面任务详情" })).toBeVisible();
    expect(screen.getByRole("region", { name: "任务正文" })).toHaveTextContent("Windows 兼容测试");
    expect(screen.queryByRole("button", { name: "开始任务" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发送评论" })).not.toBeInTheDocument();
  });

  it("uses the refreshed Task version for subsequent status commands", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn().mockResolvedValue(undefined);
    const interactiveDetail = {
      ...detail,
      capabilities: { ...detail.capabilities, changeStatus: true },
    };
    const { rerender } = render(
      <MemoryRouter>
        <TaskDetail
          detail={interactiveDetail}
          onCommand={onCommand}
          mutateCollaboration={vi.fn()}
          postComment={vi.fn()}
          writeEnabled
        />
      </MemoryRouter>,
    );

    rerender(
      <MemoryRouter>
        <TaskDetail
          detail={{
            ...interactiveDetail,
            task: { ...interactiveDetail.task, version: 4 },
          }}
          onCommand={onCommand}
          mutateCollaboration={vi.fn()}
          postComment={vi.fn()}
          writeEnabled
        />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "开始任务" }));

    expect(onCommand).toHaveBeenCalledWith("start", expect.objectContaining({
      expectedVersion: 4,
    }));
  });
});
