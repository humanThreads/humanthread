import type { WorkbenchDeviceOverview } from "./workbench-devices";

const DEVICE_STATUS_PRIORITY: Record<WorkbenchDeviceOverview["status"], number> = {
  pending: 0,
  authorized: 1,
  revoked: 2,
};

function getDeviceLastSeenTime(device: WorkbenchDeviceOverview): number {
  return device.lastSeenAt?.getTime() ?? 0;
}

export function orderWorkbenchDevicesForDisplay(
  devices: WorkbenchDeviceOverview[],
): WorkbenchDeviceOverview[] {
  return [...devices].sort((left, right) => {
    const priorityDifference =
      DEVICE_STATUS_PRIORITY[left.status] - DEVICE_STATUS_PRIORITY[right.status];

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    return getDeviceLastSeenTime(right) - getDeviceLastSeenTime(left);
  });
}

export function getWorkbenchDeviceAuthorizationActionLabel(
  status: WorkbenchDeviceOverview["status"],
): string {
  return status === "authorized" ? "撤销授权" : "授权设备";
}

export function getWorkbenchDeviceAuthorizationPrompt(
  device: Pick<WorkbenchDeviceOverview, "id" | "name" | "status">,
): string {
  if (device.status === "authorized") {
    return `设备 ${device.name} 已授权，可拉取任务和回传事件。`;
  }

  if (device.status === "revoked") {
    return `设备 ${device.name} 已撤销；确认属于当前用户后可重新授权。`;
  }

  return `确认设备 ID ${device.id} 属于当前用户后再授权。`;
}
