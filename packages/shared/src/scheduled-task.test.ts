import { describe, expect, it } from "vitest";
import {
  createProjectScheduledTaskSchema,
  updateProjectScheduledTaskSchema,
} from "./scheduled-task";

describe("project scheduled task contracts", () => {
  it("requires loop-managed content to omit platform markdown", () => {
    expect(() => createProjectScheduledTaskSchema.parse({
      commandId: "cmd_1",
      name: "每日巡检",
      description: "",
      loopBindingId: "binding_1",
      cronExpression: "0 9 * * *",
      timezone: "Asia/Shanghai",
      contentMode: "loop_managed",
      contentMarkdown: "不应保存",
      executionTarget: { type: "linux_worker_pool", workerPoolId: "a".repeat(32) },
    })).toThrow(/contentMarkdown/u);
  });

  it("accepts a concrete local Agent target and platform content", () => {
    const parsed = createProjectScheduledTaskSchema.parse({
      commandId: "cmd_1",
      name: "每日质检",
      description: "检查昨日交付",
      loopBindingId: "binding_1",
      cronExpression: "0 10 * * 1-5",
      timezone: "Asia/Shanghai",
      contentMode: "platform",
      contentMarkdown: "# 检查项\n- 缺陷",
      executionTarget: { type: "local_agent", agentProfileId: "profile_1" },
    });
    expect(parsed.executionTarget.type).toBe("local_agent");
    expect(parsed.contentMode).toBe("platform");
  });

  it("allows status commands but not direct status changes through update", () => {
    expect(updateProjectScheduledTaskSchema.safeParse({
      commandId: "cmd_2",
      expectedVersion: 1,
      name: "更新名称",
    }).success).toBe(true);
    expect(updateProjectScheduledTaskSchema.safeParse({
      commandId: "cmd_2",
      expectedVersion: 1,
      status: "enabled",
    }).success).toBe(false);
  });
});
