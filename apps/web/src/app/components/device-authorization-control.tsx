"use client";

import { setWorkbenchDeviceAuthorizationAction } from "../workbench/actions";
import { DangerConfirmDialog } from "./settings-dialog";

export function DeviceAuthorizationControl({
  deviceId,
  mode,
  label,
  action = setWorkbenchDeviceAuthorizationAction,
}: {
  deviceId: string;
  mode: "authorize" | "revoke";
  label: string;
  action?: (formData: FormData) => Promise<void>;
}) {
  if (mode === "authorize") {
    return (
      <form action={action} className="mt-3">
        <input type="hidden" name="deviceId" value={deviceId} />
        <button type="submit" name="mode" value="authorize" className="rounded-md border border-[#1f883d] bg-[#1f883d] px-3 py-1.5 text-xs font-semibold text-white">
          {label}
        </button>
      </form>
    );
  }

  return (
    <div className="mt-3">
      <DangerConfirmDialog
        triggerLabel={label}
        title="撤销设备授权"
        description="撤销后该设备将无法继续访问 Agent 接口，需要重新授权才能恢复。"
        actionLabel="确认撤销授权"
        onConfirm={async () => {
          const formData = new FormData();
          formData.set("deviceId", deviceId);
          formData.set("mode", "revoke");
          await action(formData);
        }}
      />
    </div>
  );
}
