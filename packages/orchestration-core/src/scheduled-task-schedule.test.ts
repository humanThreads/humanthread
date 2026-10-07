import { describe, expect, it } from "vitest";
import {
  calculateNextScheduledTaskOccurrence,
  parseScheduledTaskCron,
  resolveDueScheduledTaskSlot,
  transitionScheduledTaskStatus,
} from "./scheduled-task-schedule";

describe("project scheduled task scheduling", () => {
  it("calculates the next five-field Cron occurrence in Asia/Shanghai", () => {
    const next = calculateNextScheduledTaskOccurrence({
      rule: "15 2 * * *",
      timezone: "Asia/Shanghai",
      after: new Date("2026-09-20T17:00:00.000Z"),
    });
    expect(next).toEqual(new Date("2026-09-20T18:15:00.000Z"));
  });

  it("supports day-of-month and day-of-week fields", () => {
    expect(parseScheduledTaskCron("0 9 1,15 * *")).toMatchObject({
      minute: [0], hour: [9], dayOfMonth: [1, 15], month: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    });
    expect(parseScheduledTaskCron("0 9 * * 1-5")).toMatchObject({ dayOfWeek: [1, 2, 3, 4, 5] });
  });

  it.each([
    "1-2-3 0 * * *",
    "1/2/3 0 * * *",
    "-1 0 * * *",
    "0,, 0 * * *",
    "0, 0 * * *",
    "1--2 0 * * *",
    "1-* 0 * * *",
    "a 0 * * *",
    "+1 0 * * *",
    "60 0 * * *",
    "*/0 0 * * *",
    "5-1 0 * * *",
    "1/ 0 * * *",
  ])("rejects malformed Cron rule %s", (rule) => {
    expect(() => parseScheduledTaskCron(rule)).toThrow();
  });

  it("supports leap-day schedules across multiple years", () => {
    const next = calculateNextScheduledTaskOccurrence({
      rule: "0 0 29 2 *",
      timezone: "UTC",
      after: new Date("2025-03-01T00:00:00.000Z"),
    });
    expect(next).toEqual(new Date("2028-02-29T00:00:00.000Z"));
  }, 15_000);

  it("uses OR semantics when both day fields are restricted", () => {
    expect(calculateNextScheduledTaskOccurrence({
      rule: "0 0 1 * 1",
      timezone: "UTC",
      after: new Date("2026-08-31T00:00:00.000Z"),
    })).toEqual(new Date("2026-09-01T00:00:00.000Z"));
    expect(calculateNextScheduledTaskOccurrence({
      rule: "0 0 1 * 1",
      timezone: "UTC",
      after: new Date("2026-09-01T12:00:00.000Z"),
    })).toEqual(new Date("2026-09-07T00:00:00.000Z"));
  });

  it("rejects an invalid timezone", () => {
    expect(() => calculateNextScheduledTaskOccurrence({
      rule: "0 0 * * *",
      timezone: "Not/AZone",
      after: new Date("2026-09-22T00:00:00.000Z"),
    })).toThrow("Scheduled task timezone is invalid");
  });

  it("does not match a nonexistent spring-forward local time", () => {
    const next = calculateNextScheduledTaskOccurrence({
      rule: "30 2 * * *",
      timezone: "America/New_York",
      after: new Date("2026-03-08T05:00:00.000Z"),
    });
    expect(next).toEqual(new Date("2026-03-09T06:30:00.000Z"));
  });

  it("returns only the first UTC occurrence of a duplicated fall-back local time", () => {
    expect(calculateNextScheduledTaskOccurrence({
      rule: "30 1 * * *",
      timezone: "America/New_York",
      after: new Date("2026-11-01T05:00:00.000Z"),
    })).toEqual(new Date("2026-11-01T05:30:00.000Z"));
    expect(calculateNextScheduledTaskOccurrence({
      rule: "30 1 * * *",
      timezone: "America/New_York",
      after: new Date("2026-11-01T05:30:00.000Z"),
    })).toEqual(new Date("2026-11-02T06:30:00.000Z"));
  });

  it("returns only the latest missed slot for catch-up", () => {
    const due = resolveDueScheduledTaskSlot({
      rule: "0 * * * *",
      timezone: "Asia/Shanghai",
      now: new Date("2026-09-22T03:30:00.000Z"),
      nextRunAt: new Date("2026-09-22T01:00:00.000Z"),
      pendingScheduledFor: null,
      lastScheduledFor: new Date("2026-09-22T01:00:00.000Z"),
    });
    expect(due).toEqual({
      scheduledFor: new Date("2026-09-22T03:00:00.000Z"),
      source: "catch_up",
      nextRunAt: new Date("2026-09-22T04:00:00.000Z"),
    });
  });

  it("enforces pending-slot due boundaries", () => {
    const base = {
      rule: "0 * * * *",
      timezone: "UTC",
      now: new Date("2026-09-22T03:00:00.000Z"),
      nextRunAt: new Date("2026-09-22T02:00:00.000Z"),
      lastScheduledFor: null,
    };
    expect(resolveDueScheduledTaskSlot({
      ...base,
      pendingScheduledFor: new Date("2026-09-22T03:01:00.000Z"),
    })).toBeNull();
    expect(resolveDueScheduledTaskSlot({
      ...base,
      pendingScheduledFor: new Date("2026-09-22T03:00:00.000Z"),
    })).toEqual({
      scheduledFor: new Date("2026-09-22T03:00:00.000Z"),
      source: "catch_up",
      nextRunAt: new Date("2026-09-22T04:00:00.000Z"),
    });
  });

  it("enforces the three-state execution matrix", () => {
    const now = new Date("2026-09-22T02:00:00.000Z");
    const enabled = transitionScheduledTaskStatus("inactive", "enable", now);
    expect(enabled).toEqual({ status: "enabled", nextRunAt: null, pendingScheduledFor: null });
    expect(enabled.nextRunAt === null || enabled.nextRunAt > now).toBe(true);
    expect(transitionScheduledTaskStatus("enabled", "deactivate", now)).toMatchObject({ status: "inactive" });
    expect(transitionScheduledTaskStatus("disabled", "restore", now)).toMatchObject({ status: "inactive" });
  });

  it("allows manual runs for inactive and enabled tasks but denies disabled tasks", () => {
    const now = new Date("2026-09-22T02:00:00.000Z");
    expect(transitionScheduledTaskStatus("inactive", "run", now)).toEqual({
      status: "inactive", nextRunAt: null, pendingScheduledFor: null,
    });
    expect(transitionScheduledTaskStatus("enabled", "run", now)).toEqual({
      status: "enabled", nextRunAt: null, pendingScheduledFor: null,
    });
    expect(() => transitionScheduledTaskStatus("disabled", "run", now)).toThrow(/policy_denied/u);
  });
});
