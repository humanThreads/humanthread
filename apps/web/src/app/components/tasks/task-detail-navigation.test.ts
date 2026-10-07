import { describe, expect, it } from "vitest";
import { buildTaskCenterHref } from "./task-detail-navigation";

describe("buildTaskCenterHref", () => {
  it("routes a selected task to its full page", () => {
    expect(buildTaskCenterHref(
      "spaceKey=personal&relation=assigned&view=board&filter=open&taskId=old&taskId=stale",
      "task_new",
    )).toBe("/tasks/task_new");
  });

  it("removes every taskId while preserving every unrelated query parameter", () => {
    expect(buildTaskCenterHref(
      "spaceKey=personal&relation=assigned&view=list&filter=open&taskId=old&taskId=stale",
    )).toBe("/tasks?spaceKey=personal&relation=assigned&view=list&filter=open");
  });
});
