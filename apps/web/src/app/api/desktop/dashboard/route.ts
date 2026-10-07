import { desktopDashboardResponseSchema } from "@humanthread/workbench-client";

import { createDesktopReadPreflightResponse, createDesktopReadResponse } from "../../../../lib/desktop/desktop-read-route";
import { readDesktopDashboard } from "@/lib/desktop/desktop-read-models";

export const OPTIONS = createDesktopReadPreflightResponse;

export function GET(request: Request) {
  return createDesktopReadResponse(request, readDesktopDashboard, desktopDashboardResponseSchema);
}
