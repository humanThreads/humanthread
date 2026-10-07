import { desktopNotificationsResponseSchema } from "@humanthread/workbench-client";
import { vi } from "vitest";

import { readDesktopNotifications } from "@/lib/desktop/desktop-notification-models";
import { testDesktopReadRoute } from "../route-test-support";
import { GET } from "./route";

vi.mock("@/lib/desktop/desktop-notification-models", () => ({
  readDesktopNotifications: vi.fn(),
}));

testDesktopReadRoute({
  name: "notifications",
  url: "http://localhost:3000/api/desktop/notifications?space=personal",
  get: GET,
  read: vi.mocked(readDesktopNotifications),
  schema: desktopNotificationsResponseSchema,
  data: { summary: { unreadCount: 0, todayCount: 0 }, items: [] },
});
