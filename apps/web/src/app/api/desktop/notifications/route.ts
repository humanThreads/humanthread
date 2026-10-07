import { desktopNotificationsResponseSchema } from "@humanthread/workbench-client";

import { readDesktopNotifications } from "@/lib/desktop/desktop-notification-models";
import {
  createDesktopReadPreflightResponse,
  createDesktopReadResponse,
} from "../../../../lib/desktop/desktop-read-route";

export const OPTIONS = createDesktopReadPreflightResponse;

export function GET(request: Request) {
  return createDesktopReadResponse(
    request,
    readDesktopNotifications,
    desktopNotificationsResponseSchema,
  );
}
