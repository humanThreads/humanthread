import { describe, expect, it } from "vitest";
import {
  buildDeliveryHealthTrend,
  buildDeliveryHealthSnapshot,
  normalizeDeliveryHealthRange,
} from "./workbench-delivery-health-report";

describe("delivery health report", () => {
  it("defaults invalid ranges to 30 days", () => {
    expect(normalizeDeliveryHealthRange(undefined)).toBe("30d");
    expect(normalizeDeliveryHealthRange("90d")).toBe("90d");
    expect(normalizeDeliveryHealthRange("year")).toBe("30d");
  });

  it("keeps unavailable automation distinct from zero success", () => {
    const result = buildDeliveryHealthSnapshot({
      now: new Date("2026-07-24T12:00:00.000Z"),
      rangeStart: new Date("2026-06-24T12:00:00.000Z"),
      tasks: [],
      approvals: [],
      runs: [],
    });

    expect(result.automationSuccess).toEqual({
      state: "unavailable",
      label: "未自动化",
    });
  });

  it("calculates terminal automation success and active wait ages", () => {
    const result = buildDeliveryHealthSnapshot({
      now: new Date("2026-07-24T12:00:00.000Z"),
      rangeStart: new Date("2026-06-24T12:00:00.000Z"),
      tasks: [{ statusCategory: "completed", completedAt: new Date("2026-07-23T12:00:00.000Z"), dueAt: null, blockers: [] }],
      approvals: [{ status: "pending", createdAt: new Date("2026-07-24T07:00:00.000Z") }],
      runs: [{ status: "succeeded" }, { status: "failed" }],
    });

    expect(result.completedTasks).toBe(1);
    expect(result.humanWaitMedianAgeHours).toBe(5);
    expect(result.automationSuccess).toMatchObject({ state: "known", rate: 50 });
  });

  it("counts completed throughput only inside the selected range", () => {
    const result = buildDeliveryHealthSnapshot({
      now: new Date("2026-07-24T12:00:00.000Z"),
      rangeStart: new Date("2026-07-17T12:00:00.000Z"),
      tasks: [
        { statusCategory: "completed", completedAt: new Date("2026-07-10T12:00:00.000Z"), dueAt: null, blockers: [] },
        { statusCategory: "completed", completedAt: new Date("2026-07-20T12:00:00.000Z"), dueAt: null, blockers: [] },
      ],
      approvals: [],
      runs: [],
    });

    expect(result.completedTasks).toBe(1);
  });

  it("buckets the full range including recent completions and blockers", () => {
    const trend = buildDeliveryHealthTrend({
      now: new Date("2026-07-24T12:00:00.000Z"),
      range: "30d",
      tasks: [
        { statusCategory: "completed", completedAt: new Date("2026-07-23T12:00:00.000Z"), dueAt: null, blockers: [] },
        { statusCategory: "in_progress", completedAt: null, dueAt: null, blockers: [{ createdAt: new Date("2026-07-22T12:00:00.000Z") }] },
      ],
    });

    expect(trend.state).toBe("ready");
    if (trend.state === "ready") {
      expect(trend.points.at(-1)).toMatchObject({ completed: 1, blockers: 1 });
    }
  });
});
