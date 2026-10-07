export function loopStatusReasonLabel(statusReason: string | null | undefined): string | null {
  if (!statusReason) return null;
  if (statusReason === "runtime_safety_expired") return "运行安全审批已过期";
  if (statusReason === "runtime_safety_rejected") return "运行安全审批被拒绝";
  if (statusReason === "task_branch_missing") return "任务分支尚未创建，请先运行任务开发 Loop";
  if (statusReason === "task_branch_head_missing") return "任务分支还没有推送提交，完成任务开发 Loop 后再发布";
  return "运行失败（平台未提供更多原因）";
}

export function loopFailureReasonLabel(statusReason: string | null | undefined): string {
  return loopStatusReasonLabel(statusReason) ?? "运行未能完成";
}
