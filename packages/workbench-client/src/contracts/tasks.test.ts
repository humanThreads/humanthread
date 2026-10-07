import { describe, expect, it } from "vitest";

import {
  desktopTaskCollectionResponseSchema,
  desktopTaskDetailResponseSchema,
} from "./tasks";

const task = {
  id: "task_1",
  shortId: "HT100001",
  title: "完成桌面任务中心",
  statusCategory: "in_progress",
  status: { id: "status_doing", name: "进行中", category: "in_progress", color: "#1f883d" },
  visibility: "company",
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
};

describe("desktop Task contracts", () => {
  it("validates the complete collection projection", () => {
    const response = desktopTaskCollectionResponseSchema.parse({
      ok: true,
      data: {
        collection: {
          listRows: [task],
          boardGroups: [{ key: "in_progress", tasks: [task] }],
          calendar: {
            entries: [{
              taskId: "task_1",
              shortId: "HT100001",
              title: "完成桌面任务中心",
              kind: "due",
              at: "2026-07-30T10:00:00.000Z",
              dateKey: "2026-07-30",
              overdue: false,
            }],
            unscheduled: [],
          },
          relationCounts: {
            assigned: 1,
            created: 1,
            participating: 0,
            following: 0,
            overdue: 0,
            blocked: 0,
            completed: 0,
          },
          total: 1,
        },
      },
    });

    expect(response.data.collection.listRows[0]?.dueAt)
      .toBe("2026-07-30T10:00:00.000Z");
    expect(response.data.collection.listRows[0]?.shortId).toBe("HT100001");
    expect(response.data.collection.calendar.entries[0]?.shortId).toBe("HT100001");
  });

  it("rejects Date objects at the HTTP boundary", () => {
    expect(() => desktopTaskCollectionResponseSchema.parse({
      ok: true,
      data: {
        collection: {
          listRows: [{ ...task, updatedAt: new Date(task.updatedAt) }],
          boardGroups: [],
          calendar: { entries: [], unscheduled: [] },
          relationCounts: {},
          total: 1,
        },
      },
    })).toThrow();
  });

  it("validates a Task detail without exposing an internal Space id", () => {
    const response = desktopTaskDetailResponseSchema.parse({
      ok: true,
      data: {
        detail: {
          task: {
            ...task,
            contentMarkdown: "## 验收\n\n- [ ] Windows 兼容测试",
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
            comment: true,
            edit: true,
            changeStatus: true,
            manageMembers: true,
            manageVisibility: true,
            dispatchAgent: true,
            govern: true,
            nativeExecute: true,
          },
          collaboration: {
            availableMembers: [{ id: "user_1", name: "Owner" }],
            availableLabels: [],
          },
          execution: {
            projectId: "project_1",
            workflowInstanceId: "workflow_1",
            localPath: "/workspace/humanthread",
            command: "codex",
            toolSession: null,
          },
        },
      },
    });

    expect(response.data.detail.task.id).toBe("task_1");
    expect(response.data.detail.task.shortId).toBe("HT100001");
    expect(JSON.stringify(response)).not.toContain("spaceId");
  });
});
