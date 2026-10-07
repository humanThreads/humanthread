import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLegacyTaskUsageSnapshot, resetLegacyTaskUsage } from "../tasks/task-rollout";
import { buildTaskReportMetrics } from "./workbench-task-analytics";

describe("legacy workbench task analytics", () => {
  beforeEach(() => {
    resetLegacyTaskUsage();
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("records one legacy read for the report projection", () => {
    buildTaskReportMetrics([]);

    expect(getLegacyTaskUsageSnapshot()).toMatchObject({
      reads: 1,
      surfaces: { "workbench-task-report": 1 },
    });
  });
});
