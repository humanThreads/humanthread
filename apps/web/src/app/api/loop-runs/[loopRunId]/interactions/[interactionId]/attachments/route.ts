import { NextResponse } from "next/server";

import { createWorkflowInteractionAttachment } from "@/lib/orchestration/workflow-interaction-attachments";
import {
  decodeWorkflowInteractionRouteId,
  workflowInteractionApiErrorResponse,
} from "../../../../../../../lib/orchestration/workflow-interaction-http";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ loopRunId: string; interactionId: string }> },
) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const params = await context.params;
    const loopRunId = decodeWorkflowInteractionRouteId(params.loopRunId, 96);
    const interactionId = decodeWorkflowInteractionRouteId(params.interactionId, 96);
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, code: "attachment_required", error: "Workflow attachment is required" }, { status: 400 });
    }
    const attachment = await createWorkflowInteractionAttachment({
      userId: actor.userId,
      loopRunId,
      interactionId,
      file,
    });
    return NextResponse.json({ ok: true, attachment }, { status: 201 });
  } catch (error) {
    const response = attachmentErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

function attachmentErrorResponse(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "Workflow attachment upload failed";
  if (code === "too_large") return { status: 413, body: { ok: false, code, error: message } };
  if (code === "unsupported_mime") return { status: 415, body: { ok: false, code, error: message } };
  if (["invalid_name", "attachment_required"].includes(code)) {
    return { status: 400, body: { ok: false, code, error: message } };
  }
  return workflowInteractionApiErrorResponse(error);
}
