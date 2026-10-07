import { NextResponse } from "next/server";
import { saveTaskAttachment } from "@/lib/tasks/task-attachments";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { getStorageSettings } from "../../../../../lib/storage/storage-settings";

export const runtime = "nodejs";

function status(message: string) {
  if (message === "Workbench API authentication required") return 401;
  if (/too large/iu.test(message)) return 413;
  if (/unsupported/iu.test(message)) return 415;
  if (/not found/iu.test(message)) return 404;
  if (/access denied/iu.test(message)) return 403;
  return 400;
}

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { taskId } = await context.params;
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Task attachment is required" }, { status: 400 });
    const storageConfig = await getStorageSettings();
    const attachment = await saveTaskAttachment({ userId: actor.userId, taskId, file, ...(storageConfig ? { storageConfig } : {}) });
    return NextResponse.json({ ok: true, attachment }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task attachment upload failed";
    return NextResponse.json({ ok: false, error: message }, { status: status(message) });
  }
}
