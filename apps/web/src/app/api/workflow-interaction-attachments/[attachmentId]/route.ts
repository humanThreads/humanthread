import { readFile } from "node:fs/promises";

import {
  readWorkflowInteractionAttachment,
  workflowInteractionAttachmentDisposition,
} from "@/lib/orchestration/workflow-interaction-attachments";
import { decodeWorkflowInteractionRouteId } from "../../../../lib/orchestration/workflow-interaction-http";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const attachmentId = decodeWorkflowInteractionRouteId((await context.params).attachmentId);
    const attachment = await readWorkflowInteractionAttachment({ userId: actor.userId, attachmentId });
    return new Response(await readFile(attachment.filePath), {
      headers: {
        "content-type": attachment.mimeType,
        "content-length": String(attachment.byteSize),
        "content-disposition": workflowInteractionAttachmentDisposition(attachment.originalName),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workflow attachment not found";
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const status = message === "Workbench API authentication required" ? 401
      : code === "attachment_quarantined" ? 423
        : 404;
    return Response.json({
      ok: false,
      code: code || (status === 401 ? "authentication_required" : "not_found"),
      error: status === 404 ? "Workflow attachment not found" : message,
    }, { status });
  }
}
