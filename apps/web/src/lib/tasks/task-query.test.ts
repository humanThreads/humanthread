import { describe, expect, it } from "vitest";
import { parseTaskQuery } from "./task-query";

describe("parseTaskQuery", () => {
  it("normalizes stable Task Center URL keys", () => {
    expect(parseTaskQuery({
      spaceKey: " company:1 ",
      relation: "assigned",
      view: "board",
      status: "todo,in_progress,invalid",
      assignee: ["user_2", "user_1"],
      priority: "0,2,invalid",
      project: "project_1",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      group: "assignee",
      sort: "due_asc",
      taskId: "task_1",
      search: " 发布清单 ",
    })).toEqual({
      spaceKey: "company:1",
      relation: "assigned",
      view: "board",
      status: ["todo", "in_progress"],
      assignee: ["user_2", "user_1"],
      priority: [0, 2],
      project: ["project_1"],
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      group: "assignee",
      sort: "due_asc",
      taskId: "task_1",
      search: "发布清单",
    });
  });

  it("uses conservative defaults and drops malformed values", () => {
    expect(parseTaskQuery({
      relation: "admin",
      view: "gantt",
      dateFrom: "2026-02-30",
      dateTo: "tomorrow",
      group: "worker",
      sort: "queue",
    })).toEqual({
      spaceKey: "all",
      relation: "all",
      view: "list",
      status: [],
      assignee: [],
      priority: [],
      project: [],
      group: "status",
      sort: "updated_desc",
    });
  });

  it("keeps the blocked relation as a shareable task filter", () => {
    expect(parseTaskQuery({ relation: "blocked" }).relation).toBe("blocked");
  });

  it("keeps the archived relation as a shareable task filter", () => {
    expect(parseTaskQuery({ relation: "archived" }).relation).toBe("archived");
  });
});
