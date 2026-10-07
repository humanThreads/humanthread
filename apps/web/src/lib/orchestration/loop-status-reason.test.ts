import { describe, expect, it } from "vitest";
import { loopFailureReasonLabel, loopStatusReasonLabel } from "./loop-status-reason";

describe("Loop status reason labels", () => {
  it("translates runtime safety expiry into an actionable user-facing reason", () => {
    expect(loopStatusReasonLabel("runtime_safety_expired")).toBe("运行安全审批已过期");
  });

  it("uses a safe generic label for an unknown persisted failure reason", () => {
    expect(loopFailureReasonLabel("stage_failed")).toBe("运行失败（平台未提供更多原因）");
  });

  it("labels branch preparation failures with actionable guidance", () => {
    expect(loopStatusReasonLabel("task_branch_missing")).toBe("任务分支尚未创建，请先运行任务开发 Loop");
    expect(loopStatusReasonLabel("task_branch_head_missing")).toBe("任务分支还没有推送提交，完成任务开发 Loop 后再发布");
  });
});
