import { desktopDocumentTreeResponseSchema } from "@humanthread/workbench-client";

import { readDesktopDocumentTree } from "@/lib/desktop/desktop-document-models";
import {
  createDesktopReadPreflightResponse,
  createDesktopReadResponse,
} from "../../../../../lib/desktop/desktop-read-route";

export const OPTIONS = createDesktopReadPreflightResponse;

export function GET(request: Request) {
  return createDesktopReadResponse(
    request,
    readDesktopDocumentTree,
    desktopDocumentTreeResponseSchema,
  );
}
