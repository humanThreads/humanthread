import { describe, expect, it } from "vitest";
import {
  getLocalAgentDeviceStatusMeta,
  getLocalAgentTaskEmptyMessage,
} from "./device-status";

describe("local agent device status helpers", () => {
  it("maps pending status to waiting-for-authorization guidance", () => {
    expect(getLocalAgentDeviceStatusMeta("pending")).toEqual({
      label: "待授权",
      hint: "这台设备已注册，需先在工作台授权后才能拉取和执行本地任务。",
      tone: "pending",
    });
    expect(getLocalAgentTaskEmptyMessage("pending")).toBe(
      "这台设备正在等待授权，授权后才会显示当前任务。",
    );
  });

  it("maps revoked status to reauthorization guidance", () => {
    expect(getLocalAgentDeviceStatusMeta("revoked")).toEqual({
      label: "已撤销",
      hint: "这台设备的授权已被撤销，需回到工作台重新授权后才能继续执行。",
      tone: "revoked",
    });
    expect(getLocalAgentTaskEmptyMessage("revoked")).toBe(
      "这台设备的授权已被撤销，请先在工作台重新授权。",
    );
  });
});
