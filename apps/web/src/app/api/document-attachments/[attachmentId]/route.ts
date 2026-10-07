import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import {
  buildDocumentAttachmentContentDisposition,
  isInlineDocumentAttachmentMimeType,
  readWorkbenchDocumentAttachment,
} from "@/lib/workbench/workbench-document-attachments";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  try {
    const { attachmentId } = await context.params;
    const attachment = await readWorkbenchDocumentAttachment({
      userId: (await resolveWorkbenchApiActor(request)).userId,
      attachmentId,
    });
    const bytes = await readFile(attachment.filePath);
    return new Response(bytes, {
      headers: {
        "content-type": attachment.mimeType,
        "content-length": String(attachment.byteSize),
        "content-disposition": isInlineDocumentAttachmentMimeType(attachment.mimeType)
          ? "inline"
          : buildDocumentAttachmentContentDisposition(attachment.originalName),
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
        ...(attachment.mimeType === "text/html" ? {
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src https: data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
          "content-disposition": "inline",
        } : {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document attachment not found";
    const status = message === "Workbench API authentication required"
      ? 401
      : /access denied/iu.test(message)
        ? 403
        : 404;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
