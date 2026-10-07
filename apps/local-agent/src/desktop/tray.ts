export type TrayMenuItemId =
  | "status"
  | "current-task"
  | "toggle-window"
  | "self-check"
  | "quit";

export interface TrayMenuItem {
  id: TrayMenuItemId;
  label: string;
  enabled: boolean;
  route?: string;
}

export interface TrayMenuModel {
  items: TrayMenuItem[];
}

function boundedLabel(value: string, maximum = 72): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length > maximum
    ? `${normalized.slice(0, maximum - 1)}…`
    : normalized;
}

export function buildTrayMenu(input: {
  connected: boolean;
  deviceAuthorized: boolean;
  windowVisible: boolean;
  currentTask: { id: string; title: string } | null;
}): TrayMenuModel {
  const status = `${input.connected ? "已连接" : "离线"} · ${
    input.deviceAuthorized ? "设备已授权" : "设备未授权"
  }`;
  const taskId = input.currentTask?.id.trim();
  const taskTitle = input.currentTask?.title.trim();

  return {
    items: [
      { id: "status", label: status, enabled: false },
      taskId && taskTitle
        ? {
            id: "current-task",
            label: boundedLabel(taskTitle),
            enabled: true,
            route: `/tasks/${encodeURIComponent(taskId)}`,
          }
        : { id: "current-task", label: "暂无当前任务", enabled: false },
      {
        id: "toggle-window",
        label: input.windowVisible ? "隐藏窗口" : "显示窗口",
        enabled: true,
      },
      { id: "self-check", label: "运行桌面自检", enabled: true },
      { id: "quit", label: "退出 HumanThread", enabled: true },
    ],
  };
}

export function createNativeTrayController(input: {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}) {
  return {
    async sync(state: Parameters<typeof buildTrayMenu>[0]): Promise<void> {
      await input.invoke("set_tray_menu", { state: buildTrayMenu(state) });
    },
  };
}

export async function subscribeDesktopTrayActions(input: {
  listen(
    event: "desktop_tray_action",
    handler: (event: { payload: string }) => void,
  ): Promise<() => void>;
  currentTaskRoute: string | null;
  navigate(route: string): void;
  selfCheck(): Promise<void>;
}): Promise<() => void> {
  return input.listen("desktop_tray_action", (event) => {
    if (event.payload === "current-task" && input.currentTaskRoute) {
      input.navigate(input.currentTaskRoute);
    }
    if (event.payload === "self-check") {
      void input.selfCheck();
    }
  });
}
