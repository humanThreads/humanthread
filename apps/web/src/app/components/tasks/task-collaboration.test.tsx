// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskCollaboration } from "./task-collaboration";

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("TaskCollaboration", () => {
  const props = {
    taskId: "task_1", version: 3, canComment: true, canEdit: true, canManageMembers: true, canChangeStatus: true,
    comments: [{ id: "comment_1", contentMarkdown: "**完成检查**", createdAt: new Date(), updatedAt: new Date(), author: { id: "user_1", name: "Owner", avatarUrl: null } }],
    activities: [{ id: "activity_1", type: "status_changed", actorType: "user", message: "进入进行中", payload: null, createdAt: new Date() }],
    members: [], availableMembers: [{ id: "user_2", name: "Reviewer" }], blocker: null,
    assignedLabels: [{ id: "label_1", name: "安全", color: "#cf222e" }], availableLabels: [{ id: "label_1", name: "安全", color: "#cf222e" }],
    reminders: [], onVersionChange: vi.fn(),
  };

  it("renders Markdown comments, folded activity, member, blocker, label and reminder controls", () => {
    render(<TaskCollaboration {...props} />);
    expect(screen.getByText("完成检查")).toBeTruthy();
    expect(screen.getByText("进入进行中")).toBeTruthy();
    expect(screen.getByLabelText("添加协作者")).toBeTruthy();
    expect(screen.getByRole("button", { name: "添加阻塞" })).toBeTruthy();
    expect(screen.getAllByText("安全").find((item) => item.tagName === "BUTTON")?.getAttribute("style")).toContain("rgb(207, 34, 46)");
    expect(screen.getByLabelText("提醒时间")).toBeTruthy();
  });

  it("adds a Markdown comment through the versioned API", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { version: 4 } }), { status: 201, headers: { "content-type": "application/json" } }));
    render(<TaskCollaboration {...props} />);
    await user.type(screen.getByLabelText("评论内容"), "请复核 **发布记录**");
    await user.click(screen.getByRole("button", { name: "添加评论" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/tasks/task_1/comments", expect.objectContaining({ method: "POST" })));
    expect(props.onVersionChange).toHaveBeenCalledWith(4);
  });

  it("keeps collaboration command IDs within the API limit for long internal task IDs", async () => {
    const user = userEvent.setup();
    const longTaskId = `task:space:company:${"company_".repeat(8)}:${"command_".repeat(8)}`;
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { version: 4 } }), { status: 201, headers: { "content-type": "application/json" } }));
    render(<TaskCollaboration {...props} taskId={longTaskId} />);

    await user.type(screen.getByLabelText("评论内容"), "请复核发布记录");
    await user.click(screen.getByRole("button", { name: "添加评论" }));

    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as { commandId: string };
    expect(body.commandId).toMatch(/^[a-f0-9]{32}$/);
  });
});
