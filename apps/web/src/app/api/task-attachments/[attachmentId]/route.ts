import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import {
  isInlineTaskAttachment,
  readTaskAttachment,
  removeTaskAttachment,
  taskAttachmentDisposition,
} from "@/lib/tasks/task-attachments";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

export const runtime = "nodejs";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Task attachment not found";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const status = message === "Workbench API authentication required" ? 401
    : code === "version_conflict" ? 409
      : /access denied/iu.test(message) ? 403 : 404;
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { attachmentId } = await context.params;
    const attachment = await readTaskAttachment({ userId: actor.userId, attachmentId });
    return new Response(await readFile(attachment.filePath), { headers: {
      "content-type": attachment.mimeType,
      "content-length": String(attachment.byteSize),
      "content-disposition": isInlineTaskAttachment(attachment.mimeType) ? "inline" : taskAttachmentDisposition(attachment.originalName),
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    } });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { attachmentId } = await context.params;
    const result = await removeTaskAttachment({ userId: actor.userId, attachmentId });
    return NextResponse.json({ ok: true, result });
  } catch (error) { return errorResponse(error); }
}
