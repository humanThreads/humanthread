import { describe, expect, it } from "vitest";
import {
  buildTaskCalendarEntries,
  getTaskDateRange,
} from "./task-calendar";

describe("task calendar projection", () => {
  it("uses Asia/Shanghai day boundaries for a requested date range", () => {
    expect(getTaskDateRange({
      dateFrom: "2026-07-01",
      dateTo: "2026-07-01",
      timeZone: "Asia/Shanghai",
    })).toEqual({
      from: new Date("2026-06-30T16:00:00.000Z"),
      to: new Date("2026-07-01T15:59:59.999Z"),
    });
  });

  it("creates start and due entries while keeping unscheduled Tasks separate", () => {
    const result = buildTaskCalendarEntries({
      tasks: [
        {
          id: "task_1",
          shortId: "HT100001",
          title: "跨日交付",
          statusCategory: "in_progress",
          startAt: new Date("2026-07-01T01:00:00.000Z"),
          dueAt: new Date("2026-07-02T09:00:00.000Z"),
        },
        {
          id: "task_2",
          shortId: null,
          title: "待排期",
          statusCategory: "todo",
          startAt: null,
          dueAt: null,
        },
      ],
      timeZone: "Asia/Shanghai",
      now: new Date("2026-07-03T00:00:00.000Z"),
    });

    expect(result.entries).toEqual([
      expect.objectContaining({ taskId: "task_1", shortId: "HT100001", kind: "start", dateKey: "2026-07-01" }),
      expect.objectContaining({ taskId: "task_1", shortId: "HT100001", kind: "due", dateKey: "2026-07-02", overdue: true }),
    ]);
    expect(result.unscheduled.map((task) => task.id)).toEqual(["task_2"]);
  });

  it("does not mark completed Tasks overdue", () => {
    const result = buildTaskCalendarEntries({
      tasks: [{
        id: "task_done",
        shortId: "HT100002",
        title: "已完成",
        statusCategory: "completed",
        startAt: null,
        dueAt: new Date("2026-07-01T00:00:00.000Z"),
      }],
      timeZone: "Asia/Shanghai",
      now: new Date("2026-07-03T00:00:00.000Z"),
    });

    expect(result.entries[0]).toMatchObject({ overdue: false });
  });
});
