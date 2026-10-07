import { describe, expect, it } from "vitest";
import {
  mapLegacyTaskStatus,
  mapWorkflowTransitionToTaskCommand,
} from "./task-workflow-mapping";

describe("task workflow compatibility mapping", () => {
  it("maps legacy execution and approval states into separate projections", () => {
    expect(mapLegacyTaskStatus("blocked")).toEqual({
      category: "in_progress",
      blockerRequired: true,
    });
    expect(mapLegacyTaskStatus("verifying")).toEqual({
      category: "in_review",
      executionStatus: "verifying",
    });
    expect(mapLegacyTaskStatus("waiting_approval")).toEqual({
      category: "in_review",
      approvalStatus: "pending",
    });
  });

  it.each([
    ["pending", "todo"],
    ["ready", "todo"],
    ["follow_up", "todo"],
    ["active", "in_progress"],
    ["running", "in_progress"],
    ["interrupted", "in_progress"],
    ["completed", "completed"],
    ["cancelled", "cancelled"],
  ])("maps %s to %s", (status, category) => {
    expect(mapLegacyTaskStatus(status)).toEqual({ category });
  });

  it("requests user-task commands instead of mutating state", () => {
    expect(mapWorkflowTransitionToTaskCommand({
      currentCategory: "todo",
      legacyStatus: "active",
      acceptanceMode: "none",
    })).toEqual({ command: "start", blockerRequired: false });
    expect(mapWorkflowTransitionToTaskCommand({
      currentCategory: "in_progress",
      legacyStatus: "verifying",
      acceptanceMode: "hybrid",
    })).toEqual({ command: "submit_for_review", blockerRequired: false });
    expect(mapWorkflowTransitionToTaskCommand({
      currentCategory: "in_progress",
      legacyStatus: "blocked",
      acceptanceMode: "none",
    })).toEqual({ command: null, blockerRequired: true });
  });
});
