import { desktopTaskDetailResponseSchema } from "@humanthread/workbench-client";

import { readDesktopTaskDetail } from "@/lib/desktop/desktop-read-models";
import {
  createDesktopReadPreflightResponse,
  createDesktopReadResponse,
} from "../../../../../lib/desktop/desktop-read-route";

export const OPTIONS = createDesktopReadPreflightResponse;

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await context.params;
  return createDesktopReadResponse(
    request,
    (currentRequest) => readDesktopTaskDetail(currentRequest, taskId),
    desktopTaskDetailResponseSchema,
  );
}
