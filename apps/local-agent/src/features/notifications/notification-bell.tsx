import { Bell } from "lucide-react";
import { Link } from "react-router-dom";

import { useDesktopNotifications } from "./use-desktop-notifications";

export function NotificationBell() {
  const query = useDesktopNotifications();
  const unreadCount = query.data?.data.summary.unreadCount ?? 0;
  const label = unreadCount > 0 ? `通知，${unreadCount} 条未读` : "通知";

  return (
    <Link
      aria-label={label}
      className="icon-button notification-bell"
      title={label}
      to="/notifications"
    >
      <Bell aria-hidden="true" size={18} />
      {unreadCount > 0 ? (
        <span aria-hidden="true" className="notification-badge">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </Link>
  );
}
