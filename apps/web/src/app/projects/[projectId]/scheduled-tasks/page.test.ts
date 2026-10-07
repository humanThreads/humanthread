import { describe, expect, it } from "vitest";

import {
  dynamic,
  PROJECT_SCHEDULED_TASK_STATUS_TABS,
  resolveProjectScheduledTaskStatus,
} from "./page";

describe("Project scheduled tasks page", () => {
  it("forces dynamic rendering", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("uses only supported URL status filters", () => {
    expect(PROJECT_SCHEDULED_TASK_STATUS_TABS).toEqual(["all", "inactive", "enabled", "disabled"]);
    expect(resolveProjectScheduledTaskStatus({})).toBe("all");
    expect(resolveProjectScheduledTaskStatus({ status: "inactive" })).toBe("inactive");
    expect(resolveProjectScheduledTaskStatus({ status: ["enabled", "disabled"] })).toBe("enabled");
    expect(resolveProjectScheduledTaskStatus({ status: "unknown" })).toBe("all");
  });
});
