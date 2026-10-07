export type WorkbenchDeviceStatus = "authorized" | "pending" | "revoked";

export function getWorkbenchDeviceStatusLabel(status: WorkbenchDeviceStatus): string {
  switch (status) {
    case "authorized":
      return "已授权";
    case "pending":
      return "待授权";
    case "revoked":
      return "已撤销";
  }
}

export function getWorkbenchDeviceStatusHint(status: WorkbenchDeviceStatus): string {
  switch (status) {
    case "authorized":
      return "这台设备已允许拉取任务和回传事件。";
    case "pending":
      return "这台设备已注册，需先授权后才能执行本地任务。";
    case "revoked":
      return "这台设备已被撤销，当前不能继续访问 Agent 接口。";
  }
}

export function getWorkbenchDeviceStatusTone(status: WorkbenchDeviceStatus): string {
  switch (status) {
    case "authorized":
      return "bg-[#edf6ee] text-[#2f5c3a]";
    case "pending":
      return "bg-[#fff2dd] text-[#8d5d1e]";
    case "revoked":
      return "bg-[#f8e7e2] text-[#8a4636]";
  }
}
