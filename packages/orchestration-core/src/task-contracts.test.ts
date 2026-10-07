import { describe, expect, it } from "vitest";
import {
  TaskDomainError,
  type TaskAcceptanceMode,
  type TaskSnapshot,
  type TaskStatusCategory,
} from "./task-contracts";

describe("user task contracts", () => {
  it("exposes the stable user-facing categories and acceptance modes", () => {
    const statuses: TaskStatusCategory[] = [
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "completed",
      "cancelled",
    ];
    const modes: TaskAcceptanceMode[] = ["none", "human", "automated", "hybrid"];

    expect(statuses).toHaveLength(6);
    expect(modes).toHaveLength(4);
  });

  it("represents a task without coupling identity to Workflow or Agent runtime fields", () => {
    const task: TaskSnapshot = {
      id: "task_1",
      status: "todo",
      version: 1,
      acceptanceMode: "none",
      isBlocked: true,
    };

    expect(task).toEqual({
      id: "task_1",
      status: "todo",
      version: 1,
      acceptanceMode: "none",
      isBlocked: true,
    });
  });

  it("exposes stable domain error metadata for API translation", () => {
    const error = new TaskDomainError(
      "acceptance is required",
      "task_acceptance_required",
      "in_progress",
      "complete",
    );

    expect(error).toMatchObject({
      code: "task_acceptance_required",
      currentStatus: "in_progress",
      command: "complete",
    });
    expect(error.message).toBe("task_acceptance_required: acceptance is required");
  });
});
