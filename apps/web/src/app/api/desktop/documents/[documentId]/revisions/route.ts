import { desktopDocumentRevisionsResponseSchema } from "@humanthread/workbench-client";

import { readDesktopDocumentRevisions } from "@/lib/desktop/desktop-document-models";
import {
  createDesktopReadPreflightResponse,
  createDesktopReadResponse,
} from "../../../../../../lib/desktop/desktop-read-route";

export const OPTIONS = createDesktopReadPreflightResponse;

export async function GET(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await context.params;
  return createDesktopReadResponse(
    request,
    (currentRequest) => readDesktopDocumentRevisions(currentRequest, documentId),
    desktopDocumentRevisionsResponseSchema,
  );
}
