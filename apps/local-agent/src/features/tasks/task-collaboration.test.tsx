import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TaskCollaboration } from "./task-collaboration";

describe("desktop Task collaboration", () => {
  it("submits Markdown comments with a generated command id and keeps versioning explicit", async () => {
    const user = userEvent.setup();
    const postComment = vi.fn().mockResolvedValue({ version: 4 });
    render(
      <TaskCollaboration
        availableLabels={[]}
        availableMembers={[]}
        canComment
        canEdit={false}
        canManageMembers={false}
        comments={[]}
        labels={[]}
        members={[]}
        postComment={postComment}
        mutateCollaboration={vi.fn()}
        reminders={[]}
        taskId="task_1"
        version={3}
      />,
    );

    await user.type(screen.getByLabelText("评论"), "需要补充 Windows 兼容测试");
    await user.click(screen.getByRole("button", { name: "发送评论" }));

    expect(postComment).toHaveBeenCalledWith("task_1", expect.objectContaining({
      commandId: expect.stringMatching(/^desktop:task:comment:/u),
      contentMarkdown: "需要补充 Windows 兼容测试",
      expectedVersion: 3,
    }));
    expect(screen.getByLabelText("评论")).toHaveValue("");
  });

  it("uses generated command ids for members, labels, and reminders", async () => {
    const user = userEvent.setup();
    const mutateCollaboration = vi.fn().mockResolvedValue({ version: 4 });
    render(
      <TaskCollaboration
        availableLabels={[{ id: "label_1", name: "桌面端", color: "#087f73" }]}
        availableMembers={[{ id: "user_2", name: "Reviewer" }]}
        canComment
        canEdit
        canManageMembers
        comments={[]}
        labels={[]}
        members={[]}
        mutateCollaboration={mutateCollaboration}
        postComment={vi.fn()}
        reminders={[]}
        taskId="task_1"
        version={3}
      />,
    );

    await user.selectOptions(screen.getByLabelText("添加协作者"), "user_2");
    expect(mutateCollaboration).toHaveBeenCalledWith("members", "POST", expect.objectContaining({
      commandId: expect.stringMatching(/^desktop:task:members:/u),
      expectedVersion: 3,
      userId: "user_2",
      role: "participant",
    }));

    await user.selectOptions(screen.getByLabelText("添加标签"), "label_1");
    expect(mutateCollaboration).toHaveBeenCalledWith("labels", "POST", expect.objectContaining({
      commandId: expect.stringMatching(/^desktop:task:labels:/u),
      labelId: "label_1",
    }));

    await user.type(screen.getByLabelText("提醒时间"), "2026-07-30T09:00");
    await user.click(screen.getByRole("button", { name: "创建提醒" }));
    expect(mutateCollaboration).toHaveBeenCalledWith("reminders", "POST", expect.objectContaining({
      commandId: expect.stringMatching(/^desktop:task:reminders:/u),
      remindAt: "2026-07-30T01:00:00.000Z",
    }));
  });

  it("uses a refreshed external version for the next collaboration mutation", async () => {
    const user = userEvent.setup();
    const postComment = vi.fn().mockResolvedValue({ version: 5 });
    const props = {
      availableLabels: [],
      availableMembers: [],
      canComment: true,
      canEdit: false,
      canManageMembers: false,
      comments: [],
      labels: [],
      members: [],
      mutateCollaboration: vi.fn(),
      postComment,
      reminders: [],
      taskId: "task_1",
    };
    const { rerender } = render(<TaskCollaboration {...props} version={3} />);

    rerender(<TaskCollaboration {...props} version={4} />);
    await user.type(screen.getByLabelText("评论"), "使用服务端刷新后的版本");
    await user.click(screen.getByRole("button", { name: "发送评论" }));

    expect(postComment).toHaveBeenCalledWith("task_1", expect.objectContaining({
      expectedVersion: 4,
    }));
  });
});
