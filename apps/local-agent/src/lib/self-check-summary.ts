import type { AgentDeviceStatus } from "@humanthread/shared";

export interface DesktopSelfCheckSummary {
  checkedAt: string;
  healthDb: string;
  deviceStatus: AgentDeviceStatus;
  queueLength: number | null;
  taskId: string | null;
  taskTitle: string | null;
}

export function formatDesktopSelfCheckSummary(summary: DesktopSelfCheckSummary): {
  title: string;
  lines: string[];
} {
  const lines = [
    `时间：${summary.checkedAt}`,
    `数据库：${summary.healthDb}`,
    `设备状态：${summary.deviceStatus}`,
    `当前任务：${summary.taskTitle ?? "无"}`,
  ];

  if (typeof summary.queueLength === "number") {
    lines.push(`后续任务：${summary.queueLength}`);
  }

  return {
    title: "最近一次桌面自检",
    lines,
  };
}
