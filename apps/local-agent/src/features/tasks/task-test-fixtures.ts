import type {
  DesktopTask,
  DesktopTaskCollectionResponse,
} from "@humanthread/workbench-client";

export const taskFixture: DesktopTask = {
  id: "task_1",
  shortId: "HT100001",
  title: "完成桌面任务中心",
  statusCategory: "todo",
  status: { id: "status_todo", name: "待处理", category: "todo", color: "#57606a" },
  visibility: "company",
  priority: 2,
  startAt: "2026-07-27T02:00:00.000Z",
  dueAt: "2026-07-30T10:00:00.000Z",
  overdue: false,
  version: 3,
  createdAt: "2026-07-26T08:00:00.000Z",
  updatedAt: "2026-07-27T08:00:00.000Z",
  createdById: "user_1",
  assignee: { id: "user_1", name: "Owner", avatarUrl: null },
  project: { id: "project_1", name: "HumanThread" },
  blocker: null,
  labels: [{ id: "label_1", name: "桌面端", color: "#087f73" }],
  childCount: 2,
  automation: null,
};

export const collectionFixture: DesktopTaskCollectionResponse["data"]["collection"] = {
  listRows: [taskFixture],
  boardGroups: [{ key: "todo", tasks: [taskFixture] }],
  calendar: {
    entries: [{
      taskId: taskFixture.id,
      shortId: taskFixture.shortId,
      title: taskFixture.title,
      kind: "due",
      at: taskFixture.dueAt!,
      dateKey: "2026-07-30",
      overdue: false,
    }],
    unscheduled: [{
      ...taskFixture,
      id: "task_2",
      title: "补充未排期验收项",
      startAt: null,
      dueAt: null,
    }],
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
};
