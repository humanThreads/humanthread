import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { desktopNotificationsResponseSchema } from "@humanthread/workbench-client";

import { getNativeBridge } from "../lib/native-bridge";

import type { LocalAgentAccountSession } from "../lib/binding";
import {
  runDesktopSelfCheck,
  type DesktopSelfCheckInput,
  type DesktopSelfCheckResult,
} from "../lib/desktop-self-check";
import type {
  CommandExitedEventPayload,
  LocalPlatform,
  LocalRuntime,
} from "../lib/runtime";
import {
  useDesktopSession,
  type DesktopRuntimeCredentials,
} from "../session/session-provider";
import { routeDesktopDeepLinks, subscribeDesktopDeepLinks } from "./deep-links";
import {
  buildNativeNotification,
  createInvokeNotificationDispatcher,
  deliverUnreadLoopNotifications,
  routeNativeNotificationAction,
  type NativeNotification,
} from "./notifications";
import { DesktopQuitDialog } from "./quit-dialog";
import {
  readDesktopQuitState,
  requestDesktopQuit,
  type DesktopQuitState,
  type QuitChoice,
} from "./quit-safety";
import { createNativeTrayController, subscribeDesktopTrayActions } from "./tray";

interface LifecycleNotice {
  tone: "success" | "warning" | "error";
  text: string;
  route?: string;
}

export function buildLifecycleFailureNotice(
  error: unknown,
  fallback: string,
): LifecycleNotice {
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : fallback;
  return {
    tone: "warning",
    text: message.length > 180 ? `${message.slice(0, 179)}…` : message,
  };
}

type DesktopPlatform = Exclude<LocalPlatform, "unknown">;

export function createTraySelfCheckRunner(input: {
  accountSession: LocalAgentAccountSession;
  platform: DesktopPlatform;
  generation: number;
  credentials: DesktopRuntimeCredentials | null;
  updateCredentials(
    credentials: DesktopRuntimeCredentials,
    generation: number,
  ): void;
  runSelfCheck(input: DesktopSelfCheckInput): Promise<DesktopSelfCheckResult>;
}): () => Promise<LifecycleNotice> {
  return async () => {
    if (!input.credentials?.deviceToken.trim()) {
      throw new Error("当前登录已失效，请重新登录");
    }
    const result = await input.runSelfCheck({
      binding: {
        apiBaseUrl: input.accountSession.apiBaseUrl,
        teamId: input.accountSession.teamId,
        userId: input.accountSession.userId,
        userEmail: input.accountSession.email,
        bindingCode: "",
        deviceId: input.accountSession.deviceId,
        deviceName: input.accountSession.deviceName,
        deviceToken: input.credentials.deviceToken,
        pollIntervalMs: 10_000,
        apiToken: input.credentials.apiToken,
        commandTemplate: "{command}",
      },
      platform: input.platform,
    });
    if (
      result.nextDeviceToken.trim()
      && result.nextDeviceToken !== input.credentials.deviceToken
    ) {
      input.updateCredentials({
        ...input.credentials,
        deviceToken: result.nextDeviceToken,
      }, input.generation);
    }
    return {
      tone: result.deviceStatus === "authorized" ? "success" : "warning",
      text: `桌面自检通过 · ${result.deviceStatus === "authorized" ? "设备已授权" : "设备待授权"}${
        result.taskSummary ? ` · 队列 ${result.taskSummary.queueLength}` : ""
      }`,
    };
  };
}

export function buildCommandExitNotification(
  event: CommandExitedEventPayload,
  taskTitle?: string,
): NativeNotification {
  return buildNativeNotification({
    id: `command:${event.taskId}:${event.processId}`,
    kind: event.status === "completed" ? "command_completed" : "command_failed",
    taskId: event.taskId,
    taskTitle: taskTitle ?? `任务 ${event.taskId}`,
    ...(event.exitCode !== null ? { exitCode: event.exitCode } : {}),
    filePath: event.cwd,
    command: event.command,
  });
}

export function isTrayDeviceAuthorized(
  deviceId: string | null | undefined,
  nativeExecution: boolean | null | undefined,
): boolean {
  return Boolean(deviceId && nativeExecution);
}

export function DesktopNativeLifecycle(props: {
  accountSession: LocalAgentAccountSession | null;
  runtime: LocalRuntime;
}) {
  const session = useDesktopSession();
  const navigate = useNavigate();
  const [windowVisible, setWindowVisible] = useState(true);
  const [notice, setNotice] = useState<LifecycleNotice | null>(null);
  const [quitState, setQuitState] = useState<DesktopQuitState | null>(null);
  const [quitPending, setQuitPending] = useState(false);
  const [quitError, setQuitError] = useState<string | null>(null);
  const bridge = getNativeBridge();
  const native = Boolean(bridge) && props.runtime.isNative;
  const currentTask = session.bootstrap?.currentTask ?? null;
  const currentTaskRoute = currentTask ? `/tasks/${encodeURIComponent(currentTask.id)}` : null;

  const notificationDispatcher = useMemo(() => {
    if (!bridge) {
      return null;
    }
    return createInvokeNotificationDispatcher({
      invoke: bridge.invoke.bind(bridge),
      isPermissionGranted: bridge.isNotificationPermissionGranted.bind(bridge),
      requestPermission: bridge.requestNotificationPermission.bind(bridge),
      fallback: (notification) => setNotice({
        tone: "warning",
        text: `${notification.title} · ${notification.body}`,
        ...(notification.route ? { route: notification.route } : {}),
      }),
    });
  }, [bridge]);

  const selfCheck = useCallback(async () => {
    if (!props.accountSession) {
      setNotice({ tone: "warning", text: "请先登录并完成设备绑定" });
      return;
    }
    if (props.runtime.platform === "unknown") {
      setNotice({ tone: "error", text: "当前平台不支持桌面自检" });
      return;
    }
    try {
      const runner = createTraySelfCheckRunner({
        accountSession: props.accountSession,
        credentials: session.runtimeCredentials,
        generation: session.generation,
        platform: props.runtime.platform,
        runSelfCheck: (selfCheckInput) => runDesktopSelfCheck(selfCheckInput),
        updateCredentials: session.updateRuntimeCredentials,
      });
      setNotice(await runner());
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "桌面自检失败",
      });
    }
  }, [
    props.accountSession,
    props.runtime.platform,
    session.runtimeCredentials,
    session.generation,
    session.updateRuntimeCredentials,
  ]);

  useEffect(() => {
    if (!native || !bridge) return;
    let disposed = false;
    let stopDeepLinks: (() => void) | undefined;
    void bridge.getCurrentDeepLinks().then((urls) => {
      if (!disposed && urls) routeDesktopDeepLinks(urls, navigate);
    }).catch((error) => {
      if (!disposed) setNotice(buildLifecycleFailureNotice(error, "无法读取启动链接"));
    });
    void subscribeDesktopDeepLinks({
      onOpenUrl: bridge.onOpenUrl.bind(bridge),
      navigate,
    }).then((stop) => {
      if (disposed) stop();
      else stopDeepLinks = stop;
    }).catch((error) => {
      if (!disposed) setNotice(buildLifecycleFailureNotice(error, "深链监听不可用"));
    });
    return () => {
      disposed = true;
      stopDeepLinks?.();
    };
  }, [bridge, native, navigate]);

  useEffect(() => {
    if (!native || !bridge) return;
    let disposed = false;
    const controller = createNativeTrayController({ invoke: bridge.invoke.bind(bridge) });
    void controller.sync({
      connected: session.status === "ready",
      deviceAuthorized: isTrayDeviceAuthorized(
        props.accountSession?.deviceId,
        session.bootstrap?.capabilities.nativeExecution,
      ),
      windowVisible,
      currentTask,
    }).catch((error) => {
      if (!disposed) setNotice(buildLifecycleFailureNotice(error, "托盘状态同步失败"));
    });
    return () => {
      disposed = true;
    };
  }, [
    bridge,
    currentTask,
    native,
    props.accountSession?.deviceId,
    session.bootstrap?.capabilities.nativeExecution,
    session.status,
    windowVisible,
  ]);

  useEffect(() => {
    if (!native || !bridge) return;
    let disposed = false;
    let stopActions: (() => void) | undefined;
    void subscribeDesktopTrayActions({
      currentTaskRoute,
      listen: bridge.listen.bind(bridge),
      navigate,
      selfCheck,
    }).then((stop) => {
      if (disposed) stop();
      else stopActions = stop;
    }).catch((error) => {
      if (!disposed) setNotice(buildLifecycleFailureNotice(error, "托盘操作监听不可用"));
    });
    return () => {
      disposed = true;
      stopActions?.();
    };
  }, [bridge, currentTaskRoute, native, navigate, selfCheck]);

  useEffect(() => {
    if (!native || !bridge) return;
    let disposed = false;
    const stops: Array<() => void> = [];
    void bridge.listen<boolean>("desktop_window_visibility", (event) => {
      setWindowVisible(event.payload);
    }).then((stop) => disposed ? stop() : stops.push(stop)).catch((error) => {
      if (!disposed) setNotice(buildLifecycleFailureNotice(error, "窗口状态监听不可用"));
    });
    void bridge.listen("desktop_quit_requested", () => {
      setQuitError(null);
      void readDesktopQuitState({ invoke: bridge.invoke.bind(bridge) }).then(setQuitState).catch((error) => {
        setNotice({
          tone: "error",
          text: error instanceof Error ? error.message : "无法读取退出状态",
        });
      });
    }).then((stop) => disposed ? stop() : stops.push(stop)).catch((error) => {
      if (!disposed) setNotice(buildLifecycleFailureNotice(error, "退出请求监听不可用"));
    });
    void bridge.listen<string>("desktop_notification_action", (event) => {
      routeNativeNotificationAction(event.payload, navigate);
    }).then((stop) => disposed ? stop() : stops.push(stop)).catch((error) => {
      if (!disposed) setNotice(buildLifecycleFailureNotice(error, "通知导航监听不可用"));
    });
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
    };
  }, [bridge, native, navigate]);

  useEffect(() => {
    if (!native || !notificationDispatcher) return;
    let disposed = false;
    let stopCommands: (() => void) | undefined;
    void props.runtime.subscribeCommandExited((event) => {
      if (disposed) return;
      void notificationDispatcher.deliver(buildCommandExitNotification(
        event,
        currentTask?.id === event.taskId ? currentTask.title : undefined,
      )).catch((error) => {
        if (!disposed) {
          setNotice({
            tone: "warning",
            text: error instanceof Error ? error.message : "系统通知发送失败",
            route: `/tasks/${encodeURIComponent(event.taskId)}`,
          });
        }
      });
    }).then((stop) => {
      if (disposed) stop();
      else stopCommands = stop;
    }).catch((error) => {
      if (!disposed) setNotice(buildLifecycleFailureNotice(error, "命令退出监听不可用"));
    });
    return () => {
      disposed = true;
      stopCommands?.();
    };
  }, [currentTask, native, notificationDispatcher, props.runtime]);

  useEffect(() => {
    if (!native || !notificationDispatcher || !props.accountSession || !session.client || !session.context) return;
    let disposed = false;
    const poll = async () => {
      try {
        const search = new URLSearchParams({ space: session.context!.spaceKey });
        const response = await session.client!.request(
          `/api/desktop/notifications?${search.toString()}`,
          desktopNotificationsResponseSchema,
        );
        if (!disposed) await deliverUnreadLoopNotifications(response, notificationDispatcher);
      } catch (error) {
        if (!disposed) setNotice(buildLifecycleFailureNotice(error, "Loop 通知同步失败"));
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 15_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [native, notificationDispatcher, props.accountSession, session.client, session.context]);

  async function chooseQuit(choice: QuitChoice) {
    if (choice === "cancel") {
      setQuitState(null);
      setQuitError(null);
      return;
    }
    if (choice === "hide_to_tray") {
      setQuitState(null);
      setQuitError(null);
      return;
    }
    if (!bridge) return;
    setQuitPending(true);
    setQuitError(null);
    try {
      await requestDesktopQuit(choice, { invoke: bridge.invoke.bind(bridge) });
    } catch (error) {
      setQuitError(error instanceof Error ? error.message : "退出请求失败");
    } finally {
      setQuitPending(false);
    }
  }

  if (!native) return null;
  return (
    <>
      {notice ? (
        <div className="desktop-native-notice" data-tone={notice.tone} role="status">
          <span>{notice.text}</span>
          {notice.route ? <button onClick={() => navigate(notice.route!)} type="button">查看</button> : null}
          <button aria-label="关闭桌面提示" onClick={() => setNotice(null)} type="button">关闭</button>
        </div>
      ) : null}
      {quitState ? (
        <DesktopQuitDialog
          error={quitError}
          onChoice={(choice) => void chooseQuit(choice)}
          pending={quitPending}
          state={quitState}
        />
      ) : null}
    </>
  );
}
