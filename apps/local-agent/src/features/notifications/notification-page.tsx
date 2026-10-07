import { useMutation, useQueryClient } from "@tanstack/react-query";
import { desktopNotificationReadResponseSchema } from "@humanthread/workbench-client";
import { useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { getNativeBridge } from "../../lib/native-bridge";
import { useOptionalDesktopSession } from "../../session/session-provider";
import {
  buildNotificationSearch,
  createNotificationCommandMetadata,
  filterNotifications,
  notificationQueryKey,
  parseNotificationQuery,
  type NotificationQuery,
} from "./notification-queries";
import { NotificationWorkspace } from "./notification-workspace";
import { useDesktopNotifications } from "./use-desktop-notifications";

interface ReadMutationInput {
  notificationId: string;
  openAfter: boolean;
  route: string;
}

export function NotificationPage() {
  const session = useOptionalDesktopSession();
  const notifications = useDesktopNotifications();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeQuery = useMemo(
    () => parseNotificationQuery(searchParams),
    [searchParams],
  );
  const isWebLoopRoute = (route: string) => route.startsWith("/loop-runs/");
  const openNotificationRoute = async (route: string) => {
    if (!isWebLoopRoute(route)) {
      navigate(route);
      return;
    }
    if (!session?.context) throw new Error("桌面会话不可用，无法打开运行图");
    const deployment = new URL(session.context.deploymentKey);
    const target = new URL(route, deployment);
    if (target.origin !== deployment.origin) throw new Error("运行图地址不受信任");
    const bridge = getNativeBridge();
    if (!bridge) throw new Error("系统浏览器仅在桌面客户端中可用");
    await bridge.openExternal(target.toString());
  };
  const mutation = useMutation({
    mutationFn: async (input: ReadMutationInput) => {
      if (!session?.client || !session.context || !session.actionsEnabled) {
        throw new Error("桌面会话当前不可写");
      }
      const spaceSearch = new URLSearchParams({ space: session.context.spaceKey });
      const result = await session.client.request(
        `/api/desktop/notifications/${encodeURIComponent(input.notificationId)}/read?${spaceSearch}`,
        desktopNotificationReadResponseSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(createNotificationCommandMetadata()),
        },
      );
      if (input.openAfter && isWebLoopRoute(input.route)) {
        await openNotificationRoute(input.route);
      }
      return result;
    },
    onSuccess: async (_result, input) => {
      if (session?.context) {
        await queryClient.invalidateQueries({
          queryKey: notificationQueryKey(session.context),
        });
      }
      if (input.openAfter && !isWebLoopRoute(input.route)) navigate(input.route);
    },
  });
  const openMutation = useMutation({
    mutationFn: openNotificationRoute,
  });
  const data = notifications.data?.data;
  const routeItemIsKnown = Boolean(
    routeQuery.itemId && data?.items.some((item) => item.id === routeQuery.itemId),
  );
  const normalizedRouteQuery: NotificationQuery = routeQuery.itemId && data && !routeItemIsKnown
    ? { read: routeQuery.read, kind: routeQuery.kind }
    : routeQuery;
  const resetMutation = mutation.reset;

  useEffect(() => {
    if (!data || !routeQuery.itemId || routeItemIsKnown) return;
    resetMutation();
    setSearchParams(buildNotificationSearch({
      read: routeQuery.read,
      kind: routeQuery.kind,
    }), { replace: true });
  }, [
    data,
    resetMutation,
    routeItemIsKnown,
    routeQuery.itemId,
    routeQuery.kind,
    routeQuery.read,
    setSearchParams,
  ]);

  if (notifications.isPending && !notifications.data) {
    return (
      <div aria-label="正在加载通知" className="feature-loading-state" role="status">
        <span className="sr-only">正在加载通知</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="notification-load-error" role="alert">
        <strong>通知暂时无法加载</strong>
        <span>{notifications.error?.message ?? "请检查连接后重试。"}</span>
        <button onClick={() => void notifications.refetch()} type="button">重试加载</button>
      </div>
    );
  }

  const loadedData = data;
  const visibleItems = filterNotifications(loadedData.items, normalizedRouteQuery);
  const selected = visibleItems.find((item) => item.id === normalizedRouteQuery.itemId)
    ?? visibleItems[0]
    ?? null;
  const writeEnabled = Boolean(
    session?.status === "ready"
    && session.actionsEnabled
    && session.client
    && session.context
    && !notifications.isError,
  );

  function changeQuery(next: NotificationQuery) {
    mutation.reset();
    openMutation.reset();
    setSearchParams(buildNotificationSearch(next));
  }

  function markRead(notificationId: string, openAfter: boolean) {
    const item = loadedData.items.find((candidate) => candidate.id === notificationId);
    if (!item) return;
    mutation.mutate({ notificationId, openAfter, route: item.target.route });
  }

  return (
    <NotificationWorkspace
      actionError={mutation.isError
        ? mutation.error instanceof Error
          ? mutation.error.message
          : "标记通知失败"
        : openMutation.isError
          ? openMutation.error instanceof Error
            ? openMutation.error.message
            : "打开通知失败"
          : null}
      busyId={mutation.isPending
        ? mutation.variables.notificationId
        : openMutation.isPending && selected
          ? selected.id
          : null}
      data={loadedData}
      onMarkRead={markRead}
      onOpen={(route) => openMutation.mutate(route)}
      onQueryChange={changeQuery}
      query={normalizedRouteQuery}
      selected={selected}
      syncState={notifications.isError
        ? "cached"
        : notifications.isFetching
          ? "syncing"
          : null}
      writeEnabled={writeEnabled}
    />
  );
}
