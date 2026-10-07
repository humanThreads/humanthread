import { describe, expect, it } from "vitest";
import {
  getWorkbenchDeviceStatusHint,
  getWorkbenchDeviceStatusLabel,
  getWorkbenchDeviceStatusTone,
} from "./workbench-device-status";

describe("workbench device status helpers", () => {
  it("maps authorized status to a label, hint, and tone", () => {
    expect(getWorkbenchDeviceStatusLabel("authorized")).toBe("已授权");
    expect(getWorkbenchDeviceStatusHint("authorized")).toBe(
      "这台设备已允许拉取任务和回传事件。",
    );
    expect(getWorkbenchDeviceStatusTone("authorized")).toBe(
      "bg-[#edf6ee] text-[#2f5c3a]",
    );
  });

  it("maps pending status to a label, hint, and tone", () => {
    expect(getWorkbenchDeviceStatusLabel("pending")).toBe("待授权");
    expect(getWorkbenchDeviceStatusHint("pending")).toBe(
      "这台设备已注册，需先授权后才能执行本地任务。",
    );
    expect(getWorkbenchDeviceStatusTone("pending")).toBe(
      "bg-[#fff2dd] text-[#8d5d1e]",
    );
  });

  it("maps revoked status to a label, hint, and tone", () => {
    expect(getWorkbenchDeviceStatusLabel("revoked")).toBe("已撤销");
    expect(getWorkbenchDeviceStatusHint("revoked")).toBe(
      "这台设备已被撤销，当前不能继续访问 Agent 接口。",
    );
    expect(getWorkbenchDeviceStatusTone("revoked")).toBe(
      "bg-[#f8e7e2] text-[#8a4636]",
    );
  });
});
