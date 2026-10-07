import { describe, expect, it } from "vitest";
import {
  formatDesktopSelfCheckSummary,
  type DesktopSelfCheckSummary,
} from "./self-check-summary";

describe("formatDesktopSelfCheckSummary", () => {
  it("formats an authorized summary with current task details", () => {
    const summary: DesktopSelfCheckSummary = {
      checkedAt: "2026-05-19T08:00:00.000Z",
      healthDb: "connected",
      deviceStatus: "authorized",
      queueLength: 2,
      taskId: "workflow_1:run_cli",
      taskTitle: "运行 Claude/Codex",
    };

    expect(formatDesktopSelfCheckSummary(summary)).toEqual({
      title: "最近一次桌面自检",
      lines: [
        "时间：2026-05-19T08:00:00.000Z",
        "数据库：connected",
        "设备状态：authorized",
        "当前任务：运行 Claude/Codex",
        "后续任务：2",
      ],
    });
  });

  it("formats a pending summary without current task details", () => {
    const summary: DesktopSelfCheckSummary = {
      checkedAt: "2026-05-19T08:05:00.000Z",
      healthDb: "connected",
      deviceStatus: "pending",
      queueLength: null,
      taskId: null,
      taskTitle: null,
    };

    expect(formatDesktopSelfCheckSummary(summary)).toEqual({
      title: "最近一次桌面自检",
      lines: [
        "时间：2026-05-19T08:05:00.000Z",
        "数据库：connected",
        "设备状态：pending",
        "当前任务：无",
      ],
    });
  });
});
