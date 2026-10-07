import { desktopProjectDetailResponseSchema } from "@humanthread/workbench-client";

import { readDesktopProjectDetail } from "@/lib/desktop/desktop-read-models";
import {
  createDesktopReadPreflightResponse,
  createDesktopReadResponse,
} from "../../../../../lib/desktop/desktop-read-route";

export const OPTIONS = createDesktopReadPreflightResponse;

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  return createDesktopReadResponse(
    request,
    (currentRequest) => readDesktopProjectDetail(currentRequest, projectId),
    desktopProjectDetailResponseSchema,
  );
}
