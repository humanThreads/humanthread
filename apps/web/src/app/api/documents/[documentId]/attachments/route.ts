import { NextResponse } from "next/server";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { saveWorkbenchDocumentAttachment } from "@/lib/workbench/workbench-document-attachments";

export const runtime = "nodejs";

function getStatus(message: string) {
  if (message === "Workbench API authentication required") return 401;
  if (/access denied|write access denied/iu.test(message)) return 403;
  if (/not found/iu.test(message)) return 404;
  if (/too large/iu.test(message)) return 413;
  if (/unsupported/iu.test(message)) return 415;
  return 400;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId } = await context.params;
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Document attachment is required" }, { status: 400 });
    }
    const attachment = await saveWorkbenchDocumentAttachment({
      userId: (await resolveWorkbenchApiActor(request)).userId,
      documentId,
      file,
    });
    return NextResponse.json({ ok: true, attachment }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document attachment upload failed";
    return NextResponse.json({ ok: false, error: message }, { status: getStatus(message) });
  }
}
