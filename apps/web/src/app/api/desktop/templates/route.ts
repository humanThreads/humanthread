import { desktopTemplatesResponseSchema } from "@humanthread/workbench-client";

import { createDesktopReadPreflightResponse, createDesktopReadResponse } from "../../../../lib/desktop/desktop-read-route";
import { readDesktopTemplates } from "@/lib/desktop/desktop-read-models";

export const OPTIONS = createDesktopReadPreflightResponse;

export function GET(request: Request) {
  return createDesktopReadResponse(request, readDesktopTemplates, desktopTemplatesResponseSchema);
}
