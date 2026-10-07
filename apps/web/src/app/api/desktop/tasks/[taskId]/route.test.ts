import { desktopTaskDetailResponseSchema } from "@humanthread/workbench-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readDesktopTaskDetail } from "@/lib/desktop/desktop-read-models";
import { GET } from "./route";

vi.mock("@/lib/desktop/desktop-read-models", () => ({ readDesktopTaskDetail: vi.fn() }));

const detail = {
  task: {
    id: "task_1", shortId: "HT100001", title: "桌面详情", statusCategory: "todo", status: { id: null, name: "待处理", category: "todo", color: "#57606a" },
    visibility: "company", priority: 0, startAt: null, dueAt: null, overdue: false, version: 1,
    createdAt: "2026-07-27T00:00:00.000Z", updatedAt: "2026-07-27T00:00:00.000Z", createdById: "user_1",
    assignee: null, project: null, blocker: null, labels: [], childCount: 0, automation: null,
    contentMarkdown: "", acceptanceMode: "none", archivedAt: null,
    createdBy: { id: "user_1", name: "Owner", avatarUrl: null }, acceptanceReviewer: null,
    members: [], blockers: [], comments: [], activities: [], reminders: [], attachments: [], documentLinks: [], childTasks: [],
  },
  capabilities: { read: true, comment: true, edit: true, changeStatus: true, manageMembers: true, manageVisibility: true, dispatchAgent: true, govern: true, nativeExecute: false },
  collaboration: { availableMembers: [], availableLabels: [] },
  execution: { projectId: null, workflowInstanceId: null, localPath: null, command: null, toolSession: null },
};

describe("desktop Task detail route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a runtime-validated detail with desktop CORS", async () => {
    vi.mocked(readDesktopTaskDetail).mockResolvedValue({ detail } as never);
    const request = new Request("http://localhost:3000/api/desktop/tasks/task_1?space=personal", {
      headers: { origin: "http://localhost:1420" },
    });

    const response = await GET(request, { params: Promise.resolve({ taskId: "task_1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:1420");
    expect(desktopTaskDetailResponseSchema.parse(body).data.detail.task.shortId).toBe("HT100001");
    expect(readDesktopTaskDetail).toHaveBeenCalledWith(request, "task_1");
  });

  it("returns 404 without leaking a Task from another Space", async () => {
    vi.mocked(readDesktopTaskDetail).mockRejectedValue(new Error("Task not found"));
    const response = await GET(
      new Request("http://localhost:3000/api/desktop/tasks/task_other?space=personal"),
      { params: Promise.resolve({ taskId: "task_other" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "task_not_found" });
  });
});
