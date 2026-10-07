import { describe, expect, it } from "vitest";
import { assertLegacyWorkflowTask } from "./legacy-workflow-task";

describe("assertLegacyWorkflowTask", () => {
  it("accepts a task with the complete legacy Workflow context", () => {
    const task = {
      id: "task_1",
      workflowInstanceId: "workflow_1",
      projectId: "project_1",
      stepTemplateId: "step_1",
      workflowInstance: { id: "workflow_1" },
      project: { id: "project_1" },
    };

    expect(() => assertLegacyWorkflowTask(task)).not.toThrow();
  });

  it("rejects a standalone user task at a legacy Workflow boundary", () => {
    const task = {
      id: "task_standalone",
      workflowInstanceId: null,
      projectId: null,
      stepTemplateId: null,
      workflowInstance: null,
      project: null,
    };

    expect(() => assertLegacyWorkflowTask(task)).toThrowError(
      expect.objectContaining({
        code: "legacy_workflow_task_required",
        message: "Task task_standalone is not linked to a legacy Workflow",
      }),
    );
  });

  it("rejects an inconsistent task whose legacy relation was not loaded", () => {
    const task = {
      id: "task_inconsistent",
      workflowInstanceId: "workflow_1",
      projectId: "project_1",
      stepTemplateId: "step_1",
      workflowInstance: null,
      project: { id: "project_1" },
    };

    expect(() => assertLegacyWorkflowTask(task)).toThrowError(
      expect.objectContaining({ code: "legacy_workflow_task_required" }),
    );
  });
});
