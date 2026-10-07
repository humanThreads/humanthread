import { normalizeDesktopRoute } from "../app/route-restore";
import type { DesktopNotificationsResponse } from "@humanthread/workbench-client";

export type NativeNotificationKind =
  | "assignment"
  | "approval"
  | "blocker"
  | "reminder"
  | "command_completed"
  | "command_failed";

export interface NativeNotificationInput {
  id: string;
  kind: NativeNotificationKind;
  taskId?: string;
  taskTitle?: string;
  exitCode?: number;
  filePath?: string;
  command?: string;
}

export interface NativeNotification {
  id: string;
  kind: NativeNotificationKind;
  title: string;
  body: string;
  route?: string;
}

export async function deliverUnreadLoopNotifications(
  response: DesktopNotificationsResponse,
  input: { deliver(notification: NativeNotification): Promise<unknown> },
): Promise<void> {
  for (const item of response.data.items) {
    if (!item.isUnread || !item.id.startsWith("loop-notification:")) continue;
    await input.deliver({
      id: item.id,
      kind: "approval",
      title: item.title,
      body: item.description,
      route: `/notifications?item=${encodeURIComponent(item.id)}&read=all&kind=all`,
    });
  }
}

const TITLES: Record<NativeNotificationKind, string> = {
  assignment: "收到新的任务",
  approval: "任务等待审批",
  blocker: "任务出现阻塞",
  reminder: "任务提醒到期",
  command_completed: "本地命令执行完成",
  command_failed: "本地命令执行失败",
};

function boundedText(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().replace(/\s+/gu, " ") || fallback;
  return normalized.length > 160 ? `${normalized.slice(0, 159)}…` : normalized;
}

export function buildNativeNotification(input: NativeNotificationInput): NativeNotification {
  const taskTitle = boundedText(input.taskTitle, "打开 HumanThread 查看详情");
  const body = input.kind === "command_failed" && Number.isInteger(input.exitCode)
    ? `${taskTitle} · 退出码 ${input.exitCode}`
    : taskTitle;
  const taskId = input.taskId?.trim();

  return {
    id: input.id.trim(),
    kind: input.kind,
    title: TITLES[input.kind],
    body,
    ...(taskId ? { route: `/tasks/${encodeURIComponent(taskId)}` } : {}),
  };
}

export function createNativeNotificationDispatcher(input: {
  isPermissionGranted(): Promise<boolean>;
  requestPermission(): Promise<"granted" | "denied" | "default">;
  send(notification: NativeNotification): Promise<void>;
  fallback(notification: NativeNotification): void;
}) {
  const delivered = new Set<string>();
  let permissionDenied = false;

  return {
    async deliver(notification: NativeNotification): Promise<"native" | "fallback" | "duplicate"> {
      if (delivered.has(notification.id)) return "duplicate";
      const alreadyGranted = await input.isPermissionGranted();
      const granted = alreadyGranted || (!permissionDenied
        && await input.requestPermission() === "granted");
      if (!granted) {
        permissionDenied = true;
        input.fallback(notification);
        delivered.add(notification.id);
        return "fallback";
      }
      await input.send(notification);
      delivered.add(notification.id);
      return "native";
    },
  };
}

export function createInvokeNotificationDispatcher(input: {
  isPermissionGranted(): Promise<boolean>;
  requestPermission(): Promise<"granted" | "denied" | "default">;
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  fallback(notification: NativeNotification): void;
}) {
  return createNativeNotificationDispatcher({
    isPermissionGranted: input.isPermissionGranted,
    requestPermission: input.requestPermission,
    fallback: input.fallback,
    send: async (notification) => {
      await input.invoke("send_native_notification", {
        id: notification.id,
        kind: notification.kind,
        title: notification.title,
        body: notification.body,
        ...(notification.route ? { route: notification.route } : {}),
      });
    },
  });
}

export function routeNativeNotificationAction(
  candidate: string,
  navigate: (route: string) => void,
): void {
  const route = normalizeDesktopRoute(candidate);
  if (route) navigate(route);
}
