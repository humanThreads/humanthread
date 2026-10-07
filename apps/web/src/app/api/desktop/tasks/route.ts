import { desktopTaskCollectionResponseSchema } from "@humanthread/workbench-client";

import { readDesktopTasks } from "@/lib/desktop/desktop-read-models";
import {
  createDesktopReadPreflightResponse,
  createDesktopReadResponse,
} from "../../../../lib/desktop/desktop-read-route";

export const OPTIONS = createDesktopReadPreflightResponse;

export function GET(request: Request) {
  return createDesktopReadResponse(
    request,
    readDesktopTasks,
    desktopTaskCollectionResponseSchema,
  );
}
