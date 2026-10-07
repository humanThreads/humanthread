import { describe, expect, it } from "vitest";
import { resolveLaunchCommand } from "./launch-command";

describe("resolveLaunchCommand", () => {
  it("returns the raw command when the template is the default placeholder", () => {
    const command = resolveLaunchCommand({
      template: "{command}",
      command: "codex",
      taskId: "task_1",
      projectId: "project_1",
      workflowInstanceId: "workflow_1",
    });

    expect(command).toBe("codex");
  });

  it("injects task metadata into a wrapper command template", () => {
    const command = resolveLaunchCommand({
      template:
        "pnpm exec ht-run --task {taskId} --project {projectId} --workflow {workflowInstanceId} -- {command}",
      command: "npm test",
      taskId: "task_1",
      projectId: "project_1",
      workflowInstanceId: "workflow_1",
    });

    expect(command).toBe(
      "pnpm exec ht-run --task task_1 --project project_1 --workflow workflow_1 -- npm test",
    );
  });

  it("falls back to the raw command when the template is blank", () => {
    const command = resolveLaunchCommand({
      template: "   ",
      command: "claude",
      taskId: "task_1",
      projectId: "project_1",
      workflowInstanceId: "workflow_1",
    });

    expect(command).toBe("claude");
  });
});
