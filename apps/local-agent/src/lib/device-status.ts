import type { AgentDeviceStatus } from "@humanthread/shared";

export interface LocalAgentDeviceStatusMeta {
  label: string;
  hint: string;
  tone: "authorized" | "pending" | "revoked";
}

export function getLocalAgentDeviceStatusMeta(
  status: AgentDeviceStatus,
): LocalAgentDeviceStatusMeta {
  switch (status) {
    case "authorized":
      return {
        label: "已授权",
        hint: "这台设备已允许拉取当前任务，并可回传本地执行事件。",
        tone: "authorized",
      };
    case "pending":
      return {
        label: "待授权",
        hint: "这台设备已注册，需先在工作台授权后才能拉取和执行本地任务。",
        tone: "pending",
      };
    case "revoked":
      return {
        label: "已撤销",
        hint: "这台设备的授权已被撤销，需回到工作台重新授权后才能继续执行。",
        tone: "revoked",
      };
  }
}

export function getLocalAgentTaskEmptyMessage(
  status: AgentDeviceStatus,
): string {
  switch (status) {
    case "authorized":
      return "当前没有分配到本地执行任务，Agent 会继续轮询。";
    case "pending":
      return "这台设备正在等待授权，授权后才会显示当前任务。";
    case "revoked":
      return "这台设备的授权已被撤销，请先在工作台重新授权。";
  }
}

