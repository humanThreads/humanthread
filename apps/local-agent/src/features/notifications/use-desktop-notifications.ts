import { useQuery } from "@tanstack/react-query";
import { desktopNotificationsResponseSchema } from "@humanthread/workbench-client";

import { useOptionalDesktopSession } from "../../session/session-provider";
import { notificationQueryKey } from "./notification-queries";

export function useDesktopNotifications() {
  const session = useOptionalDesktopSession();

  return useQuery({
    enabled: Boolean(session?.client && session.context),
    queryKey: session?.context
      ? notificationQueryKey(session.context)
      : ["desktop", "notifications", "disabled"],
    queryFn: async () => {
      if (!session?.client || !session.context) {
        throw new Error("桌面会话不可用");
      }
      const search = new URLSearchParams({ space: session.context.spaceKey });
      return session.client.request(
        `/api/desktop/notifications?${search.toString()}`,
        desktopNotificationsResponseSchema,
      );
    },
  });
}
