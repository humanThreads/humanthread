import { desktopBootstrapResponseSchema } from "@humanthread/workbench-client";

import { createDesktopReadPreflightResponse, createDesktopReadResponse } from "../../../../../lib/desktop/desktop-read-route";
import { readDesktopBootstrap } from "@/lib/desktop/desktop-read-models";

export const OPTIONS = createDesktopReadPreflightResponse;

export function GET(request: Request) {
  return createDesktopReadResponse(request, readDesktopBootstrap, desktopBootstrapResponseSchema);
}
